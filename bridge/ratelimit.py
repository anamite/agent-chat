"""
ratelimit.py — small in-memory token-bucket limiter (§6 input limits).

Single-user, single-process Bridge, so an in-memory bucket per key is plenty;
no Redis. Used to cap:
  * inbound WS frames per connection (key = device hash),
  * new WS connection attempts per remote (key = client host),
  * POST /internal/ui calls (key = "internal").

A bucket refills at ``rate`` tokens per minute up to ``burst`` capacity; each
event costs one token. ``allow()`` returns False when the bucket is empty, so
the caller can drop/close instead of doing the work.
"""

from __future__ import annotations

import time
from dataclasses import dataclass


@dataclass
class _Bucket:
    tokens: float
    last: float


class TokenBucket:
    """Per-key token bucket. Thread-unsafe but asyncio-safe (no awaits inside)."""

    def __init__(self, rate_per_min: float, burst: int | None = None):
        self.rate_per_s = rate_per_min / 60.0
        # Default burst to a full minute's worth, min 1.
        self.burst = float(burst if burst is not None else max(1, int(rate_per_min)))
        self._buckets: dict[str, _Bucket] = {}

    def allow(self, key: str, cost: float = 1.0) -> bool:
        now = time.monotonic()
        b = self._buckets.get(key)
        if b is None:
            b = _Bucket(tokens=self.burst, last=now)
            self._buckets[key] = b
        # Refill since last check, capped at burst.
        b.tokens = min(self.burst, b.tokens + (now - b.last) * self.rate_per_s)
        b.last = now
        if b.tokens >= cost:
            b.tokens -= cost
            return True
        return False

    def forget(self, key: str) -> None:
        """Drop a key's bucket (e.g. on disconnect) to bound memory."""
        self._buckets.pop(key, None)
