"""
main.py — FastAPI app for the Bridge.

Endpoints (§4):
  GET  /health        liveness.
  GET  /ws            the WebSocket (Bearer or first-frame token auth).
  POST /files         upload -> {id}. Caps size + mime.
  GET  /files/{id}    download with HTTP Range; ?thumb=1 for thumbnail.
  POST /internal/ui   localhost-only; Hermes plugin pushes a frame to the app.

Run:  python3 -m uvicorn bridge.main:app --host 127.0.0.1 --port 8787
"""

from __future__ import annotations

import json
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import (
    Depends,
    FastAPI,
    Header,
    HTTPException,
    Request,
    Response,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import ValidationError

from . import __version__
from . import pydantic_schema as ps

# Pillow is optional: on a Pi without it, uploads still work but serve the full
# image when a thumbnail is requested. Generation is skipped with a clear log.
try:
    from PIL import Image as _PILImage

    _HAVE_PIL = True
except Exception:  # noqa: BLE001 — pillow not installed
    _PILImage = None
    _HAVE_PIL = False

# Longest edge of a generated thumbnail, in pixels.
_THUMB_MAX_EDGE = 256
from .auth import (
    check_internal_token,
    extract_bearer,
    validate_device_token,
)
from .config import Settings, get_settings
from .db import Database
from .ratelimit import TokenBucket
from .ulid import new_ulid
from .ws import ConnectionManager, WSHandler, now_ms

manager = ConnectionManager()

_cfg = get_settings()
# New WS connection attempts per remote host, and /internal/ui calls per minute.
connect_limiter = TokenBucket(_cfg.ws_connect_rate_limit_per_min)
internal_limiter = TokenBucket(_cfg.internal_rate_limit_per_min)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    db = Database(settings.db_path)
    await db.connect()
    app.state.db = db
    app.state.settings = settings
    try:
        yield
    finally:
        await db.close()


app = FastAPI(title="Hermes Bridge", version=__version__, lifespan=lifespan)


def get_db(request: Request) -> Database:
    return request.app.state.db


def get_cfg(request: Request) -> Settings:
    return request.app.state.settings


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------


@app.get("/health")
async def health() -> dict:
    return {"ok": True, "service": "hermes-bridge", "version": __version__, "ts": now_ms()}


# ---------------------------------------------------------------------------
# WebSocket
# ---------------------------------------------------------------------------


async def _authenticate_ws(ws: WebSocket, db: Database) -> str | None:
    """
    Resolve a device hash from the Authorization header. If absent (some tunnels
    drop custom headers on WS upgrade), fall back to a first-frame hello token.
    Returns the device hash, or None if auth fails.
    """
    token = extract_bearer(ws.headers.get("authorization"))
    if token:
        return await validate_device_token(db, token)
    return None  # caller will try the first-frame fallback


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket) -> None:
    db: Database = ws.app.state.db
    settings: Settings = ws.app.state.settings

    # Throttle connection attempts per remote to blunt reconnect storms / probes.
    client_host = ws.client.host if ws.client else "unknown"
    if not connect_limiter.allow(client_host):
        await ws.close(code=4429)  # too many requests
        return

    device = await _authenticate_ws(ws, db)

    await ws.accept()

    # First-frame token fallback: the app may send the device token in the
    # initial hello frame when the tunnel strips the Authorization header.
    if device is None:
        try:
            raw = await ws.receive_text()
            data = json.loads(raw)
            token = data.get("token") or (data.get("device") or {}).get("token")
            device = await validate_device_token(db, token)
            if device is None:
                await ws.close(code=4401)  # unauthorized
                return
            # Process the hello frame (token field is stripped before validation).
            data.pop("token", None)
            if isinstance(data.get("device"), dict):
                data["device"].pop("token", None)
            handler = WSHandler(ws, device, db, manager, settings)
            try:
                frame = ps.parse_frame_json(json.dumps(data))
                await manager.register(device, ws)
                await handler._dispatch(frame)
            except (ValidationError, ValueError):
                pass
            # Continue the normal loop without re-registering.
            try:
                while True:
                    raw = await ws.receive_text()
                    await handler._handle_raw(raw)
            finally:
                manager.unregister(device, ws)
            return
        except (WebSocketDisconnect, json.JSONDecodeError):
            await ws.close(code=4401)
            return

    handler = WSHandler(ws, device, db, manager, settings)
    try:
        await handler.run()
    except WebSocketDisconnect:
        pass


# ---------------------------------------------------------------------------
# Files
# ---------------------------------------------------------------------------


async def require_device(
    db: Database = Depends(get_db),
    authorization: str | None = Header(default=None),
) -> str:
    device = await validate_device_token(db, extract_bearer(authorization))
    if device is None:
        raise HTTPException(status_code=401, detail="invalid or missing device token")
    return device


def _make_thumbnail(src: Path, dest: Path) -> bool:
    """
    Write a small JPEG thumbnail of ``src`` to ``dest``. Returns True on success.
    No-op (returns False) when Pillow is unavailable or the file isn't a
    decodable image — the caller then just serves the full file.
    """
    if not _HAVE_PIL:
        return False
    try:
        with _PILImage.open(src) as im:
            im = im.convert("RGB")
            im.thumbnail((_THUMB_MAX_EDGE, _THUMB_MAX_EDGE))
            im.save(dest, format="JPEG", quality=80)
        return True
    except Exception:  # noqa: BLE001 — not a decodable image / decode failure
        dest.unlink(missing_ok=True)
        return False


@app.post("/files")
async def upload_file(
    file: UploadFile,
    db: Database = Depends(get_db),
    cfg: Settings = Depends(get_cfg),
    _device: str = Depends(require_device),
) -> JSONResponse:
    if file.content_type and file.content_type not in cfg.allowed_upload_mimes:
        raise HTTPException(status_code=415, detail=f"mime not allowed: {file.content_type}")

    file_id = new_ulid()
    dest = cfg.uploads_dir / file_id
    size = 0
    with dest.open("wb") as out:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > cfg.max_upload_bytes:
                out.close()
                dest.unlink(missing_ok=True)
                raise HTTPException(status_code=413, detail="file too large")
            out.write(chunk)

    # Generate a small thumbnail for images so the app can show a cheap preview
    # (GET /files/{id}?thumb=1) without downloading the full asset.
    thumb_id: str | None = None
    if (file.content_type or "").startswith("image/"):
        thumb_path = cfg.uploads_dir / f"{file_id}.thumb"
        if _make_thumbnail(dest, thumb_path):
            thumb_id = f"{file_id}.thumb"

    await db.add_upload(
        file_id=file_id,
        name=file.filename,
        mime=file.content_type,
        size=size,
        path=str(dest),
        thumb_id=thumb_id,
    )
    return JSONResponse(
        {"id": file_id, "size": size, "mime": file.content_type, "thumb": bool(thumb_id)}
    )


@app.get("/files/{file_id}")
async def get_file(
    file_id: str,
    request: Request,
    db: Database = Depends(get_db),
    _device: str = Depends(require_device),
) -> Response:
    meta = await db.get_upload(file_id)
    if not meta:
        raise HTTPException(status_code=404, detail="file not found")

    # ?thumb=1 serves the small JPEG preview when one was generated at upload.
    # Falls through to the full file if no thumbnail exists (e.g. Pillow absent).
    want_thumb = request.query_params.get("thumb") in ("1", "true", "yes")
    if want_thumb and meta.get("thumb_id"):
        thumb_path = Path(meta["path"]).with_name(meta["thumb_id"])
        if thumb_path.exists():
            return FileResponse(thumb_path, media_type="image/jpeg")

    path = Path(meta["path"])
    if not path.exists():
        raise HTTPException(status_code=410, detail="file gone")

    mime = meta["mime"] or "application/octet-stream"
    file_size = path.stat().st_size
    range_header = request.headers.get("range")

    if not range_header:
        return FileResponse(path, media_type=mime, filename=meta["name"] or file_id)

    # Minimal single-range support for audio/video streaming + lazy images.
    try:
        units, rng = range_header.split("=", 1)
        if units.strip() != "bytes":
            raise ValueError
        start_s, end_s = rng.split("-", 1)
        start = int(start_s) if start_s else 0
        end = int(end_s) if end_s else file_size - 1
        end = min(end, file_size - 1)
        if start > end:
            raise ValueError
    except ValueError:
        raise HTTPException(status_code=416, detail="invalid range")

    length = end - start + 1

    def _iter():
        with path.open("rb") as f:
            f.seek(start)
            remaining = length
            while remaining > 0:
                chunk = f.read(min(1024 * 256, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk

    headers = {
        "Content-Range": f"bytes {start}-{end}/{file_size}",
        "Accept-Ranges": "bytes",
        "Content-Length": str(length),
    }
    return StreamingResponse(_iter(), status_code=206, media_type=mime, headers=headers)


# ---------------------------------------------------------------------------
# Internal UI push (localhost + shared secret only)
# ---------------------------------------------------------------------------


# CAVEAT: the loopback check below is WEAK behind cloudflared. The tunnel
# terminates and re-originates requests from localhost, so every tunneled
# request also appears to come from 127.0.0.1 — the source-IP check cannot
# distinguish the local Hermes plugin from a remote caller. The real guard is
# the shared X-Internal-Token (check_internal_token). Operationally, the
# cloudflared ingress MUST NOT map any /internal/* path (see
# cloudflared/cloudflared-config.yml) so this endpoint is never reachable
# through the tunnel at all.
@app.post("/internal/ui")
async def internal_ui(
    request: Request,
    db: Database = Depends(get_db),
    cfg: Settings = Depends(get_cfg),
    x_internal_token: str | None = Header(default=None),
) -> JSONResponse:
    # Reject non-loopback callers outright (defence in depth; see caveat above).
    client_host = request.client.host if request.client else ""
    if client_host not in ("127.0.0.1", "::1", "localhost"):
        raise HTTPException(status_code=403, detail="loopback only")
    if not check_internal_token(x_internal_token, cfg.internal_token):
        raise HTTPException(status_code=401, detail="bad internal token")
    if not internal_limiter.allow("internal"):
        raise HTTPException(status_code=429, detail="internal rate limit exceeded")

    body = await request.json()

    # In-place update path (ui_update): merge a patch into one block of an
    # existing message, then emit an `edit` carrying the full updated blocks.
    if body.get("_action") == "update":
        return await _internal_update(db, body)

    try:
        frame = ps.parse_frame(body)
    except ValidationError as e:
        raise HTTPException(status_code=422, detail=json.loads(e.json()))

    wire = ps.frame_to_wire(frame)
    await db.append_frame(wire)
    await manager.broadcast(wire)
    return JSONResponse({"ok": True, "id": wire["id"]})


async def _internal_update(db: Database, body: dict) -> JSONResponse:
    msg_id = body.get("msgId")
    block_id = body.get("blockId")
    patch = body.get("patch") or {}
    if not msg_id or not block_id or not isinstance(patch, dict):
        raise HTTPException(status_code=422, detail="update needs msgId, blockId, patch")

    original = await db.get_frame_by_id(msg_id)
    if not original or original.get("kind") != "message":
        raise HTTPException(status_code=404, detail="message not found")

    blocks = original.get("blocks", [])
    found = False
    for b in blocks:
        if b.get("id") == block_id:
            b.update(patch)
            found = True
            break
    if not found:
        raise HTTPException(status_code=404, detail="block not found")

    original["blocks"] = blocks
    await db.update_frame_payload(msg_id, original)

    edit = {
        "v": ps.PROTOCOL_VERSION,
        "id": new_ulid(),
        "ts": now_ms(),
        "chat": original["chat"],
        "from": "agent",
        "kind": "edit",
        "msgId": msg_id,
        "blocks": blocks,
    }
    # Validate the edit before persisting/broadcasting.
    try:
        ps.parse_frame(edit)
    except ValidationError as e:
        raise HTTPException(status_code=422, detail=json.loads(e.json()))
    await db.append_frame(edit)
    await manager.broadcast(edit)
    return JSONResponse({"ok": True, "id": edit["id"], "edited": msg_id})
