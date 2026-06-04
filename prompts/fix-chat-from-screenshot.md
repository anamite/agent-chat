# Fix chat UI issues shown in the screenshot

Look at this screenshot: /home/hermes/.hermes/image_cache/img_4d1d797e1ad8.jpg

It shows the Brain/chat tab of the Hermes Mobile Gateway app. Analyze what's wrong with the chat UI and fix it.

The app source is at: /home/hermes/hermes-mobile-gateway/app/

Key files to check:
- app/(tabs)/brain.tsx — the chat screen
- app/(tabs)/_layout.tsx — tab layout
- src/store/app.ts — app state
- src/transport/socket.ts — WebSocket transport
- src/transport/ingest.ts — frame ingestion

Look at the screenshot carefully and identify ALL visible issues, then fix each one. Do NOT change package versions.
