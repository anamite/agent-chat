"""
cli.py — the `bridge` command-line entrypoint.

Subcommands:
  bridge pair [--label NAME]   mint a device token + print pairing QR.
  bridge tokens                list device tokens (hash prefix + label).
  bridge revoke <hash_prefix>  revoke a device token by hash prefix.
  bridge serve                 run the FastAPI app via uvicorn.
  bridge internal-token        print the configured internal UI token.

Run as a module too: `python3 -m bridge.cli pair`.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys

from .config import get_settings
from .db import Database
from .pair import pair_device, render_qr


def _cmd_pair(args: argparse.Namespace) -> int:
    payload = asyncio.run(pair_device(args.label))
    print("\nScan this QR in the Hermes app to pair this device:\n")
    print(render_qr(payload))
    print("Or enter manually:")
    print(f"  tunnelUrl   : {payload['tunnelUrl']}")
    print(f"  deviceToken : {payload['deviceToken']}")
    print("\n(The token is shown once and stored only as a hash on the Bridge.)\n")
    if payload["tunnelUrl"].startswith("wss://CHANGE-ME"):
        print("WARNING: set BRIDGE_PUBLIC_URL to your real tunnel hostname.\n")
    return 0


def _cmd_tokens(_args: argparse.Namespace) -> int:
    async def run():
        s = get_settings()
        db = Database(s.db_path)
        await db.connect()
        try:
            return await db.list_tokens()
        finally:
            await db.close()

    tokens = asyncio.run(run())
    if not tokens:
        print("No paired devices.")
        return 0
    for t in tokens:
        print(f"{t['token_hash'][:12]}…  label={t['label'] or '-'}  last_seen={t['last_seen']}")
    return 0


def _cmd_revoke(args: argparse.Namespace) -> int:
    async def run():
        s = get_settings()
        db = Database(s.db_path)
        await db.connect()
        try:
            hashes = await db.list_token_hashes()
            matches = [h for h in hashes if h.startswith(args.prefix)]
            if len(matches) != 1:
                return None
            await db.revoke_token_hash(matches[0])
            return matches[0]
        finally:
            await db.close()

    result = asyncio.run(run())
    if result is None:
        print("No unique token matched that prefix.", file=sys.stderr)
        return 1
    print(f"Revoked {result[:12]}…")
    return 0


def _cmd_serve(args: argparse.Namespace) -> int:
    import uvicorn

    s = get_settings()
    uvicorn.run(
        "bridge.main:app",
        host=args.host or s.host,
        port=args.port or s.port,
        reload=args.reload,
    )
    return 0


def _cmd_internal_token(_args: argparse.Namespace) -> int:
    print(get_settings().internal_token)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="bridge", description="Hermes Bridge CLI")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_pair = sub.add_parser("pair", help="mint a device token + print pairing QR")
    p_pair.add_argument("--label", help="human label for this device")
    p_pair.set_defaults(func=_cmd_pair)

    p_tokens = sub.add_parser("tokens", help="list paired devices")
    p_tokens.set_defaults(func=_cmd_tokens)

    p_revoke = sub.add_parser("revoke", help="revoke a device token by hash prefix")
    p_revoke.add_argument("prefix")
    p_revoke.set_defaults(func=_cmd_revoke)

    p_serve = sub.add_parser("serve", help="run the Bridge (uvicorn)")
    p_serve.add_argument("--host")
    p_serve.add_argument("--port", type=int)
    p_serve.add_argument("--reload", action="store_true")
    p_serve.set_defaults(func=_cmd_serve)

    p_int = sub.add_parser("internal-token", help="print the internal UI token")
    p_int.set_defaults(func=_cmd_internal_token)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
