"""
pair.py — `bridge pair` device pairing.

Mints a random 32-byte device token, stores ONLY its SHA-256 hash in the
allowlist, and prints a QR code encoding {tunnelUrl, deviceToken} for the app
to scan once (stored in expo-secure-store). The raw token is shown exactly
once and never persisted.
"""

from __future__ import annotations

import json

import qrcode

from .auth import hash_token, mint_token
from .config import Settings, get_settings
from .db import Database


async def pair_device(label: str | None, settings: Settings | None = None) -> dict:
    """Mint + store a device token; return the payload to encode in the QR."""
    settings = settings or get_settings()
    db = Database(settings.db_path)
    await db.connect()
    try:
        token = mint_token()
        await db.add_token_hash(hash_token(token), label=label)
    finally:
        await db.close()

    return {"tunnelUrl": settings.public_url, "deviceToken": token}


def render_qr(payload: dict) -> str:
    """Return an ASCII QR code (UTF-8 half-blocks) for terminal display."""
    qr = qrcode.QRCode(
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        border=1,
    )
    qr.add_data(json.dumps(payload, separators=(",", ":")))
    qr.make(fit=True)

    # Render with the compact half-block matrix so it fits a terminal.
    import io

    buf = io.StringIO()
    qr.print_ascii(out=buf, invert=True)
    return buf.getvalue()
