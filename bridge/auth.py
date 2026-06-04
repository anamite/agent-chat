"""
auth.py — device token hashing + allowlist validation.

The Bridge never stores raw device tokens. ``bridge pair`` mints a random
32-byte token, prints it (as a QR) for the app to store in expo-secure-store,
and persists only its SHA-256 hash in the allowlist. Validation hashes the
presented token and checks membership in constant time. Tokens are revocable
by deleting their hash row.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets

from .db import Database

TOKEN_BYTES = 32


def mint_token() -> str:
    """Return a fresh URL-safe 32-byte device token (raw secret, shown once)."""
    return secrets.token_urlsafe(TOKEN_BYTES)


def hash_token(token: str) -> str:
    """SHA-256 hex digest of a device token."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def hash_internal(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def constant_time_in(needle: str, haystack: set[str]) -> bool:
    """Membership test that doesn't early-return on the comparison itself."""
    found = False
    for item in haystack:
        if hmac.compare_digest(item, needle):
            found = True
    return found


async def validate_device_token(db: Database, token: str | None) -> str | None:
    """
    Return the token hash (a stable device handle) if valid, else None.
    Also bumps last_seen for observability.
    """
    if not token:
        return None
    digest = hash_token(token)
    hashes = await db.list_token_hashes()
    if not constant_time_in(digest, set(hashes)):
        return None
    await db.touch_token(digest)
    return digest


def check_internal_token(presented: str | None, expected: str) -> bool:
    """Constant-time compare for the /internal/ui shared secret."""
    if not presented:
        return False
    return hmac.compare_digest(presented, expected)


def extract_bearer(authorization: str | None) -> str | None:
    """Pull the token out of an ``Authorization: Bearer <token>`` header."""
    if not authorization:
        return None
    parts = authorization.split(" ", 1)
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1].strip()
    return None
