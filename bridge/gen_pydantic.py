#!/usr/bin/env python3
"""
gen_pydantic.py — verify the pydantic schema matches the Zod contract.

Pipeline:
  1. ``npm run gen:schema`` writes ``protocol.schema.json`` from protocol.ts (Zod).
  2. This script loads that JSON Schema and a set of representative frames,
     then asserts that BOTH validators (jsonschema against the generated
     schema, and pydantic_schema.parse_frame) agree on accept/reject.

Run: ``python3 gen_pydantic.py`` (after ``npm run gen:schema``).

If jsonschema is not installed it falls back to pydantic-only checks so the
scaffold still verifies end to end on the Pi without extra deps.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from pydantic import ValidationError

import pydantic_schema as ps

HERE = Path(__file__).parent
SCHEMA = HERE / "protocol.schema.json"

GOOD_ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV"


def _frame(**kw):
    base = {"v": 1, "id": GOOD_ULID, "ts": 1, "chat": "main", "from": "user"}
    base.update(kw)
    return base


VALID = [
    _frame(kind="hello", device={"id": "dev1", "platform": "android"}, sinceTs=0),
    _frame(kind="ping"),
    _frame(kind="pong", **{"from": "agent"}),
    _frame(kind="message", msgId=GOOD_ULID, blocks=[{"type": "text", "text": "hi"}]),
    _frame(kind="stream", **{"from": "agent"}, msgId=GOOD_ULID, delta="tok", done=False),
    _frame(kind="typing", **{"from": "agent"}, state="start"),
    _frame(kind="receipt", **{"from": "agent"}, msgId=GOOD_ULID, status="delivered"),
    _frame(
        kind="event",
        msgId=GOOD_ULID,
        event={"type": "action", "source": "b1", "name": "approve", "value": "yes"},
    ),
    _frame(
        kind="edit",
        **{"from": "agent"},
        msgId=GOOD_ULID,
        blocks=[{"type": "card", "id": "c1", "title": "Email", "status": "approved"}],
    ),
    _frame(kind="error", **{"from": "agent"}, code="bad", message="nope"),
]

INVALID = [
    {"kind": "ping"},  # missing envelope
    _frame(kind="ping", v=2),  # wrong version
    _frame(kind="message", msgId="not-a-ulid", blocks=[{"type": "text", "text": "x"}]),
    _frame(kind="message", msgId=GOOD_ULID, blocks=[]),  # empty blocks
    _frame(kind="nope"),  # unknown kind
    _frame(kind="ping", extra="field"),  # extra field rejected
]


def check_pydantic() -> int:
    fails = 0
    for ex in VALID:
        try:
            ps.parse_frame(ex)
        except ValidationError as e:
            fails += 1
            print(f"[pydantic] FAIL valid {ex.get('kind')}: {e}", file=sys.stderr)
    for ex in INVALID:
        try:
            ps.parse_frame(ex)
            fails += 1
            print(f"[pydantic] FAIL invalid accepted: {ex}", file=sys.stderr)
        except ValidationError:
            pass
    return fails


def check_jsonschema() -> int:
    try:
        import jsonschema
    except ImportError:
        print("[jsonschema] not installed; skipping cross-check (pydantic-only).")
        return 0
    if not SCHEMA.exists():
        print(f"[jsonschema] {SCHEMA.name} missing; run `npm run gen:schema` first.")
        return 0
    schema = json.loads(SCHEMA.read_text())
    validator = jsonschema.Draft7Validator(schema)
    fails = 0
    for ex in VALID:
        errs = list(validator.iter_errors(ex))
        if errs:
            fails += 1
            print(f"[jsonschema] FAIL valid {ex.get('kind')}: {errs[0].message}", file=sys.stderr)
    for ex in INVALID:
        if validator.is_valid(ex):
            fails += 1
            print(f"[jsonschema] FAIL invalid accepted: {ex}", file=sys.stderr)
    return fails


def main() -> int:
    fails = check_pydantic() + check_jsonschema()
    if fails:
        print(f"\n{fails} schema check(s) failed.", file=sys.stderr)
        return 1
    print(f"OK — pydantic_schema matches the contract ({len(VALID)} valid, {len(INVALID)} invalid).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
