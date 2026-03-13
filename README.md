# OpenCode Remote

Self-hosted remote control for OpenCode with a hardened gateway and a native Expo mobile client.

> Alpha status: OpenCode Remote is currently in alpha. Expect rough edges, breaking changes, and incomplete platform coverage.
>
> Current networking status: the current release is intended for devices on the same network. Broader remote access is in progress.

This project is not affiliated with or endorsed by the OpenCode maintainers. If you publish it under an OpenCode-adjacent name, keep that non-affiliation note in your README and app metadata.

The mobile client uses official OpenCode brand assets from the public OpenCode brand kit for companion positioning, while keeping that non-affiliation note in-product and in project metadata.

## What is included

- `apps/gateway`: Fastify-based companion gateway that wraps the local OpenCode server with pairing, JWT auth, session APIs, realtime streaming, and attach-based terminal bridging.
- `apps/mobile`: Expo React Native client for iOS and Android with pairing, session monitoring, approval inbox handling, device management, prompting, notifications, and terminal attach.
- `packages/shared`: Shared contracts, schemas, and normalized event types used by both sides.

## Quick start

1. On the Windows host, run `powershell -ExecutionPolicy Bypass -File .\scripts\setup-remote.ps1`.
2. Approve the firewall prompt if Windows asks for admin access.
3. Choose whether OpenCode Remote should start automatically when you turn on the PC and sign in to Windows.
4. Wait for the browser to open `http://localhost:8787`.
5. Scan the QR code from the mobile app, or enter the Server URL, Challenge ID, and Code manually.

The setup script creates or updates `.env`, installs dependencies, generates secure defaults, opens the firewall rule for port `8787`, starts OpenCode on `127.0.0.1:4096`, starts the companion gateway on `0.0.0.0:8787`, asks whether Windows should auto-start the host stack after sign-in, and opens the pairing page automatically.

## Host control scripts

- First run: `powershell -ExecutionPolicy Bypass -File .\scripts\setup-remote.ps1`
- Later restarts: `powershell -ExecutionPolicy Bypass -File .\scripts\start-remote.ps1`
- Stop host services: `powershell -ExecutionPolicy Bypass -File .\scripts\stop-remote.ps1`

If you enable Windows startup during setup, sign-in launches `start-remote.ps1` in the background so OpenCode and the gateway come back without reopening the pairing browser. Rerunning `setup-remote.ps1` lets you change that startup choice later.

If setup cannot finish automatically, rerun the script after fixing the printed prerequisite step. The setup flow is Windows-only in v1 and is optimized for phone-and-PC-on-the-same-Wi-Fi pairing.

## Architecture notes

- The gateway expects OpenCode to stay bound to localhost or a private Docker network.
- Session monitoring uses OpenCode's documented HTTP APIs plus `/global/event` SSE.
- Terminal mode uses `opencode attach <server-url> --session <id>` inside a pseudo-terminal so the mobile client gets an actual interactive TUI stream instead of simulated control events.
- Push token registration is implemented on the API surface so approval and completion pushes can be layered in with Expo notifications.
- `resume` and `retry` are implemented as synthetic follow-up prompts because OpenCode does not currently expose documented dedicated HTTP endpoints for those actions.

## Reference endpoints

- Pairing: `POST /mobile/pair/start`, `POST /mobile/pair/complete`
- Auth: `POST /mobile/auth/refresh`
- Host: `GET /mobile/host`
- Devices: `GET /mobile/devices`, `POST /mobile/devices/:id/revoke`, `POST /mobile/devices/:id/push-token`
- Sessions: `GET /mobile/sessions`, `GET /mobile/sessions/:id`, `POST /mobile/sessions/:id/prompt`, `POST /mobile/sessions/:id/control`
- Realtime: `WS /mobile/stream`, `WS /mobile/terminal/:sessionId`
