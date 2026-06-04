"""
test_fenced_ui.py — verify the interactive-UI fenced-block pipeline.

Run on the Pi (where the Bridge deps are installed):

    cd ~/hermes-mobile-gateway && python3 -m bridge.test_fenced_ui

This exercises the path that makes approval cards / buttons / forms appear in
the app even when the native ui_* plugin tools are NOT enabled server-side:
the agent emits a ```hermes-ui fenced block, the Bridge fills the ids the model
omits, validates against the strict pydantic schema, and turns it into real
SDUI blocks. If this prints OK, dialogs will render.
"""

from bridge.hermes import _extract_fenced_ui, _UI_SYSTEM_PROMPT
from bridge import pydantic_schema as ps


def _check(name: str, text: str, expect_types: list[str]) -> None:
    visible, blocks = _extract_fenced_ui(text)
    got = [b.get("type") for b in blocks]
    assert got == expect_types, f"{name}: expected {expect_types}, got {got}"
    # Every produced block must pass the same validator the wire uses.
    for b in blocks:
        ps.parse_block(b)
    print(f"OK  {name}: visible={visible!r:40.40} blocks={got}")


def main() -> None:
    assert "hermes-ui" in _UI_SYSTEM_PROMPT and "card" in _UI_SYSTEM_PROMPT

    # Approval card with no ids supplied by the model (the common case).
    _check(
        "approval card",
        'Sure, here is the draft.\n'
        '```hermes-ui\n'
        '{"type":"card","title":"Send email to Dana?","status":"pending",'
        '"body":"Hi Dana...","actions":['
        '{"label":"Reject","value":"reject","style":"danger"},'
        '{"label":"Accept & send","value":"approve","style":"primary"}]}\n'
        '```',
        ["card"],
    )

    # Buttons with missing button ids.
    _check(
        "buttons",
        '```hermes-ui\n'
        '{"type":"buttons","buttons":[{"label":"Today","value":"today"},'
        '{"label":"This week","value":"week"}]}\n```',
        ["buttons"],
    )

    # Form with missing form id and field ids.
    _check(
        "form",
        '```hermes-ui\n{"type":"form","title":"New reminder","fields":['
        '{"type":"input","label":"What"},'
        '{"type":"slider","label":"Hours","min":1,"max":24},'
        '{"type":"select","label":"Priority","options":['
        '{"label":"Low","value":"low"},{"label":"High","value":"high"}]}]}\n```',
        ["form"],
    )

    # Chart + html need no ids.
    _check(
        "chart",
        '```hermes-ui\n{"type":"chart","chartType":"bar","labels":["A","B"],'
        '"series":[{"label":"x","data":[1,2]}]}\n```',
        ["chart"],
    )

    # An array of blocks in one fence.
    _check(
        "array",
        '```hermes-ui\n[{"type":"text","text":"Pick one:"},'
        '{"type":"buttons","buttons":[{"label":"A"},{"label":"B"}]}]\n```',
        ["text", "buttons"],
    )

    # Invalid block is dropped, fence still stripped from visible text.
    visible, blocks = _extract_fenced_ui(
        'before ```hermes-ui\n{"type":"nope"}\n``` after'
    )
    assert blocks == [], blocks
    assert "hermes-ui" not in visible and "nope" not in visible
    print("OK  invalid block dropped, fence stripped")

    print("\nAll fenced-UI checks passed.")


if __name__ == "__main__":
    main()
