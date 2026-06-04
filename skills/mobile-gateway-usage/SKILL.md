---
name: mobile-gateway-usage
version: 1.0.0
description: >
  How to use the Hermes Mobile Gateway app day to day — the Telegram-style phone
  client for this Hermes agent. Covers the three tabs, sending text / photos /
  files / voice notes, how the agent replies with interactive UI (buttons,
  forms, approval cards, charts, HTML, voice), the approve/reject confirmation
  flow, pairing and re-pairing, offline/reconnect behavior, and managing paired
  devices. Use this to explain how the gateway works, to answer "how do I … in
  the app", or to guide a user who has just paired their phone.
---

# Mobile Gateway — How to Use

The **Hermes Mobile Gateway** is a phone app (Android) that is a private,
Telegram-style chat with this Hermes agent. Unlike a normal messenger, the agent
can reply not just with text but with **interactive widgets** — tappable
buttons, forms, approval cards, charts, and small HTML views — and can speak
back as a voice note.

If the app isn't connected yet, that's a setup task → use the
**mobile-gateway-setup** skill instead.

---

## The app at a glance

Three bottom tabs:

| Tab | What it's for |
|---|---|
| **Brain** | the chat — messages, attachments, voice, and all interactive UI |
| **Processes** | background/long-running activity surfaced by the agent |
| **Settings** | pairing status, pair/unpair, device info |

A small **status pill** at the top of Brain shows the live link: *connected*
(green), *connecting/reconnecting* (amber), or *offline*. Banners appear when
offline or when the Bridge reports an error.

---

## Talking to the agent

### Text
Type in the composer and send. Replies arrive as a complete message (streaming
is off by design — you get the finished answer after a brief "typing…"
indicator), rendered with full markdown (bold, lists, tables, code).

### Photos & files
Tap **+** → **Photo** or **File**. The file uploads over HTTPS (never inside the
chat socket) and appears as an inline image or a document chip. The agent
"sees" it referenced and can act on it. Images get a cheap thumbnail preview;
tap to load the full asset.

### Voice notes
**Press and hold the mic button** to record; release to send. The Bridge
transcribes it with Hermes' built-in Whisper, shows the transcript under the
waveform, and the agent replies to what you said. You can play any voice
note back with scrub/seek.

---

## How the agent replies with interactive UI

The agent reaches for a widget only when it genuinely helps — a short text reply
is still the norm. What you may see:

| Widget | When the agent uses it | What you do |
|---|---|---|
| **Buttons** | pick one of a few options | tap one — your choice becomes the agent's next turn |
| **Form** | collect several values at once (inputs, sliders, dropdowns) | fill and **Submit** |
| **Approval card** | before any action with consequences | **Accept** or **Reject** (see below) |
| **Chart** | numbers worth seeing as a shape (line/bar/area/pie) | just read it |
| **HTML** | a rich static layout or table | read it (no scripts run — it's sandboxed) |
| **Voice** | you spoke, or asked it to talk | play it back |

After the agent sends buttons / a form / a card, **it pauses and waits for you** —
it won't guess your answer. Your tap or submission is delivered back to the
agent as your next message, and it continues from there.

---

## The approval / confirmation flow (important)

Anything **consequential or hard to undo** — sending a message or email,
deleting, spending, scheduling, messaging someone else — comes to you first as
an **approval card**:

```
┌────────────────────────────────────────┐
│ Send follow-up email to Dana?  [Pending]│
│ Re: Q3 renewal                           │
│ Hi Dana — circling back on the renewal…  │
│      [ Reject ]      [ Accept & send ]   │
└────────────────────────────────────────┘
```

- **Accept** → the agent performs the action, then updates the card to
  **Approved** (green) and confirms.
- **Reject** → nothing happens; the card flips to **Rejected** (red).

The agent will **never** take a consequential action without showing this card
first. Treat the card as the moment of consent — read the body before tapping.
(Once you've tapped, the buttons disable so you can't double-submit.)

---

## Pairing & devices

- **Pairing** (first run): on the Pi run `bridge pair`, then in the app go to
  **Settings → Pair** and scan the QR. The device token is stored in the Android
  Keystore; the Bridge keeps only a hash of it.
- **Re-pairing**: if the app says *"This device was unpaired by the Bridge. Pair
  again"* the token was revoked or rotated — just pair again.
- **Multiple devices**: pair each separately (`bridge pair --label "<name>"`).
- **Revoking**: `bridge tokens` lists devices; `bridge revoke <hash-prefix>`
  removes one. The app on that device will drop and prompt re-pair.

---

## Offline, reconnect & reliability

- The app keeps **one WebSocket** open with a heartbeat. If the network drops it
  reconnects automatically with backoff; the status pill shows progress.
- **Nothing is lost.** Messages you send while offline are queued locally and
  flushed when the link returns; on reconnect the app replays anything it missed
  from the Bridge. Messages are de-duplicated, so reconnects never double-post.
- Chat history lives on the phone (SQLite), so it's there when you reopen the app
  even before reconnecting.

---

## Tips & limits

- **One decision per message** from the agent — if you need several things,
  ask one at a time for the cleanest UI.
- Voice replies and spoken answers are concise by design.
- Files cap at ~50 MB and an allowed set of types (images, PDF, common audio,
  text). Bigger or exotic types are rejected with a clear error.
- HTML widgets are **sandboxed** (no JavaScript, no app access) — safe to view.
- Never expects secrets in widgets; the agent is instructed not to put tokens or
  keys into charts/HTML.

---

## If something's wrong

| You see | Do |
|---|---|
| Status stuck on *offline/reconnecting* | check the Bridge is up and the tunnel is running; see **mobile-gateway-setup** → Troubleshooting |
| Replies are plain text, never any cards/buttons | the UI layer isn't wired — **mobile-gateway-setup** Step 4 / `DIALOGS_SETUP.md` |
| "This device was unpaired" | re-pair in Settings |
| A file won't send | likely too large or an unsupported type |
| Voice note not transcribed | Whisper unavailable on the host — the agent still sees "[voice note]" |

For installation, repair, or tunnel issues, switch to the
**mobile-gateway-setup** skill.
