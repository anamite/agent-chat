"""
ulid.py — minimal ULID generator (Crockford base32, lexicographically sortable).

Matches the ULID regex in protocol.ts: 26 chars, 48-bit ms timestamp + 80 bits
of randomness. No external dependency.
"""

from __future__ import annotations

import os
import time

_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def _encode(value: int, length: int) -> str:
    chars = []
    for _ in range(length):
        chars.append(_CROCKFORD[value & 0x1F])
        value >>= 5
    return "".join(reversed(chars))


def new_ulid(ts_ms: int | None = None) -> str:
    """Return a fresh 26-char ULID."""
    if ts_ms is None:
        ts_ms = int(time.time() * 1000)
    rand = int.from_bytes(os.urandom(10), "big")  # 80 bits
    return _encode(ts_ms, 10) + _encode(rand, 16)
