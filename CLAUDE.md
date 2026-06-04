# Hermes Mobile Gateway

Three components: Expo React Native app (Android), FastAPI Bridge (Python), Hermes plugin.

## Architecture
- App (Expo SDK 54, TypeScript) → Cloudflare Tunnel (TLS) → Bridge (FastAPI, 127.0.0.1:8787) → Hermes API server
- WebSocket for real-time frames, HTTP for file upload/download
- Shared wire protocol in `protocol.ts` (Zod) → Python pydantic equivalent

## Design System (dark-first, lime accent)
- Canvas: #08090A, Surface: #15171A, Border: #2A2D33
- Text: #F3F4F5, Text secondary: #969BA3
- Accent: #D6FF3D (lime/neon), OK: #5CE08F, Warn: #F5C451, Fail: #FF6B5E
- Font: Geist (300-700 weight), Geist Mono (monospace labels/timestamps)
- Bottom nav tabs: Brain (chat), Processes, Settings
- Two visual modes: Console (dense, hairline borders, bubbleless agent) and Canvas (roomy, elevated, rounded agent bubbles, lime user bubbles)
- Rounded cards at 16px, inputs/buttons at 3px, console cards at 8px

## Design files
- BUILD_PLAN.md — complete build plan with milestones
- design/hermes-design.html — reference design (dark theme, mobile layout)

## Key URLs
- Hermes API: http://127.0.0.1:4700/v1/chat/completions (OpenAI-compatible)
- Bridge will bind: 127.0.0.1:8787

## Environment
- Node: v22.22.3, npm: 10.9.8 (at ~/.hermes/node/bin/)
- Python: 3.11 (python3)
- Package manager: uv (for Python), npm (for JS/TS)
- Hermes plugins: ~/.hermes/plugins/
- Hermes skills: ~/.hermes/skills/
