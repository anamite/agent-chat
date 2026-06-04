# Disable streaming in the Hermes Bridge — send full messages only

The user wants the app to receive complete messages at once, not word-by-word streaming deltas.

## What to change

**File: /home/hermes/hermes-mobile-gateway/bridge/hermes.py**

In `stream_hermes_reply()` (line 92-163):

1. Change `"stream": True` to `"stream": False` (line 115)

2. Change `"Accept": "text/event-stream"` to `"Accept": "application/json"` (line 119)

3. Replace the `client.stream()` + SSE iteration block (lines 129-147) with a simple `client.post()` that gets the full JSON response. Extract the full content from `resp.json()["choices"][0]["message"]["content"]`.

4. Remove ALL `emit()` calls for `stream` frames — no more token-by-token deltas.

5. Keep `typing start/stop` frames — they provide UX feedback that the agent is working.

6. Keep the final `message` frame emission and the `_extract_fenced_ui` logic — those stay the same.

7. Keep the `typing stop` at the end.

## The new flow should be:
```
typing(start) → POST (non-streaming) → get full response → message(full blocks) → typing(stop)
```

## Rules
- Only change bridge/hermes.py
- Do NOT change the protocol or the app code
- The `_iter_sse_deltas` function can stay (it won't be called anymore) or be removed — your call
- Do NOT change any other files
