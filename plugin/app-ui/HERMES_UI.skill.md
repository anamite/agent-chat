---
name: hermes_ui
description: >
  How and when to render interactive UI (buttons, inputs, sliders, selects,
  forms, approval cards) in the Hermes Mobile Gateway app using the ui_* tools.
  Activate whenever a choice, confirmation, structured input, or approval would
  be clearer as a tappable widget than as plain text.
when_to_use: >
  Use when the ui_buttons / ui_card / ui_form (etc.) tools are available and the
  conversation calls for a decision, confirmation, or structured input.
---

# Hermes UI — interactive widgets in the mobile app

You can render **interactive UI** in the user's phone app instead of asking for
everything in prose. Each widget is sent with a `ui_*` tool. When the user
interacts (taps a button, submits a form, approves a card), their choice is
delivered back to you as your **next user turn**, so you can continue naturally.

## When to use widgets

- **Offer a small set of choices** → `ui_buttons` (2–6 options).
- **Need a confirmation / approval before a consequential action** (sending an
  email, deleting, spending) → `ui_card` with `actions` like *Accept & send* /
  *Reject*, then `ui_update` to flip its status afterward.
- **Collect one value** → `ui_input` (text/number/email), `ui_slider` (a number
  in a range), `ui_stepper` (a discrete number to nudge up/down then apply), or
  `ui_select` (pick from a list).
- **Schedule something** → `ui_datetime` (the user picks one of the day options
  you supply, at a time you set, and confirms).
- **Collect several related values at once** → `ui_form` (groups fields under a
  single submit).
- **Show information richly** → `ui_chart` (data viz), `ui_weather` (conditions),
  `ui_map` (a place), or `ui_html` (arbitrary rendered HTML). These are display
  widgets; only `ui_map` (with an `action`) sends anything back.

Prefer a widget over free text when the answer is constrained. Keep prose short
when a widget carries the interaction. Don't render a widget for open-ended
discussion.

## Tools

| Tool | Use it to | Key args |
|------|-----------|----------|
| `ui_buttons` | offer tappable choices | `buttons: [{label, value?, style?}]`, `text?` |
| `ui_input` | ask for a line of text | `label`, `placeholder?`, `inputType?`, `text?` |
| `ui_slider` | pick a number on a range | `label`, `min`, `max`, `step?`, `value?` |
| `ui_select` | choose from a list | `options: [{label, value}]`, `multi?`, `label?` |
| `ui_form` | collect several fields, one submit | `fields: [...]`, `submitLabel?`, `title?` |
| `ui_card` | approval / status card | `title`, `body?`, `subtitle?`, `actions?`, `status?` |
| `ui_stepper` | set a number with −/+ and Apply | `value`, `label?`, `min?`, `max?`, `step?`, `unit?` |
| `ui_datetime` | pick a day + time, then confirm | `days: [{value,weekday,day}]`, `time?`, `meridiem?`, `label?` |
| `ui_chart` | line / bar / area / pie chart | `chartType`, `series: [{label?,data,color?}]`, `labels?` |
| `ui_html` | render sandboxed HTML | `html`, `height?` |
| `ui_weather` | read-only weather card | `location`, `temp`, `condition?`, `icon?`, `high?`, `low?`, `hourly?` |
| `ui_map` | location snippet + optional Directions | `label`, `caption?`, `pin?`, `action?` |
| `ui_update` | patch a sent block in place | `msgId`, `blockId`, `patch` |

`style` may be `default`, `primary`, or `danger`. Every `ui_*` call returns a
`msgId`; `ui_card` also returns a `cardId`. Keep these to update the widget
later.

## The approval-card pattern (most important)

1. Before a consequential action, send a card:
   ```
   ui_card(
     title="Send follow-up email?",
     body="To: alex@acme.com\nSubject: Re: pricing\n\n…draft…",
     actions=[{"label":"Accept & send","value":"accept","style":"primary"},
              {"label":"Reject","value":"reject","style":"danger"}],
     status="pending")
   ```
2. The user taps. You receive a turn like: `The user selected "Accept & send"`.
3. Act on it, then reflect the outcome on the card in place:
   ```
   ui_update(msgId=<from step 1>, blockId=<cardId>, patch={"status":"approved"})
   ```
   Use `"rejected"`, `"done"`, or `"error"` as appropriate.

Never take a consequential action without an approved card.

## Forms

`fields` are protocol field objects. Each is one of:

- `{"type":"input","id":"email","label":"Email","inputType":"email"}`
- `{"type":"slider","id":"budget","label":"Budget","min":0,"max":1000,"step":50}`
- `{"type":"select","id":"tier","label":"Tier","options":[{"label":"Pro","value":"pro"}]}`

On submit you receive: `The user submitted the form (email: …, budget: …, tier: …)`.

## Notes

- Widgets render in the app's chat; you don't manage layout — just send blocks.
- After sending a widget, stop and wait for the user's interaction turn rather
  than guessing their choice.
- If the widget tools are unavailable, fall back to a fenced ` ```hermes-ui `
  block containing the block JSON; the Bridge will extract and render it.
