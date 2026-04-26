# DEVELOPMENT.md

Instructions for **Claude Code** (the agent) on running the dev stack so logs stay tailable for debugging. This file is *for the agent*, not a human onboarding doc — keep it operational.

## The stack

Three services, orchestrated by `docker-compose.yml` at the repo root:

| Service | Port | Tech | Notes |
|---|---|---|---|
| `client` | 5173 | Vite + React (HMR) | builds via `client/Dockerfile.dev` |
| `server` | 3001 | Node + Express + Prisma | builds via `server/Dockerfile.dev`, runs `prisma migrate deploy` on boot |
| `sidecar` | 3002 | Python (DXF/PDF pipeline) | health endpoint at `/health` |

Shared `./uploads` is bind-mounted into both `server` and `sidecar`.

## Golden rule for the agent: never block on `up`

Always start compose **in the background** and tail logs separately. Foreground `docker compose up` ties up the tool call until the user interrupts — useless for debugging.

### Start the stack

```bash
docker compose up -d --build
```

- `-d` = detached (returns immediately).
- `--build` only on first run or after Dockerfile/dep changes; otherwise plain `docker compose up -d` is faster.
- Wait for sidecar healthcheck before assuming the server is up. Check with `docker compose ps`.

### Tail logs (the debugging path)

For ongoing monitoring, run the log tail with `run_in_background: true` so you get notified on output without blocking:

```bash
docker compose logs -f --tail=50 server         # one service
docker compose logs -f --tail=50 server client  # multiple
docker compose logs -f --tail=100               # all three
```

Then read incrementally with the BashOutput tool. **Do not** poll in a sleep loop.

For a one-shot snapshot (e.g. "what happened in the last minute"):

```bash
docker compose logs --since=1m server
docker compose logs --tail=200 server
```

### Server log files (Winston)

The server *also* writes structured JSON logs to disk inside the container, which are visible on the host because the server image runs from a bind mount in dev. Inside the running container they live at `/app/logs/`. The host-side path depends on whether the file mount is in place — when it is, look at:

- `server/logs/error.log`
- `server/logs/info.log`
- `server/logs/warning.log`

If you only need errors, `cat server/logs/error.log` is faster than scraping `docker compose logs`. These files are append-only across restarts, so for a fresh run truncate first or filter by timestamp.

### Restart a single service after a code change

Most code changes are picked up by HMR (client) or nodemon (server) without a restart. If you change Dockerfiles, env, or compose config:

```bash
docker compose up -d --build server   # rebuild + restart just the server
docker compose restart server         # plain restart, no rebuild
```

### Stop the stack

```bash
docker compose down            # stop + remove containers
docker compose stop            # stop only, keep state
```

Use `down -v` only if the user explicitly asks to wipe volumes — otherwise you'll trash the host `./uploads` mount expectations.

## Pre-flight checklist before `up`

1. `server/.env` exists and has at least `DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET` (32+ chars), `ADMIN_EMAIL`, `ADMIN_INITIAL_PASSWORD`, `ANTHROPIC_API_KEY`. The server fails fast on missing vars.
2. Docker daemon is running (`docker info` succeeds).
3. Ports 5173, 3001, 3002 are free. If `up` fails with a bind error, check what else is listening before killing anything.

### Service health probes

After `up -d`, verify each service is actually serving (not just running):

```bash
curl -sS http://localhost:3002/health   # sidecar  → {"status":"ok"} or similar
curl -sS http://localhost:3001/health   # server   → {"status":"ok"}   (note: NOT /api/health — /health is on the root app, before the /api mount)
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:5173/   # client → 200
```

## Validating the UI end-to-end with Claude in Chrome

When a change touches the client (or you need to verify a backend change actually reaches the UI), drive a real browser via the **`mcp__Claude_in_Chrome__*`** MCP tools instead of guessing from code. The user has the Claude Chrome extension installed.

Standard flow:

1. `mcp__Claude_in_Chrome__list_connected_browsers` — confirm a browser is connected. If none, ask the user to open the extension; do not try to auto-launch Chrome.
2. `mcp__Claude_in_Chrome__tabs_create_mcp` with `url: "http://localhost:5173"` (or `navigate` on an existing tab) to load the client.
3. `mcp__Claude_in_Chrome__read_page` / `get_page_text` / `find` to read what's actually rendered. Use `read_console_messages` and `read_network_requests` to see client-side errors and the actual API calls hitting `localhost:3001`.
4. Drive interactions with `form_input`, `file_upload` (e.g. fixtures from `dummy_data/`), and `computer` for clicks/keys. Use `preview_screenshot` only when text/snapshot tools aren't enough — screenshots are heavy.
5. While exercising the UI, keep the `docker compose logs -f` background tail running so client console + server logs are observed in parallel.

When to reach for this:
- After a frontend change, before claiming the feature works.
- When a server endpoint *says* it's correct but the UI behaves wrong — read network requests to see the actual payload/headers/status the client sent or received.
- Reproducing a user-reported flow against `dummy_data/` fixtures end-to-end (DXF upload → explore → render).
- Verifying CORS, auth cookies, or redirects — these are invisible from server logs alone.

Skip this for backend-only changes that have integration test coverage; run the tests instead.

Cleanup: close any tabs you opened with `tabs_close_mcp` when done so you don't leave the user's browser littered.

## Common debug flows

**Server won't start.** `docker compose logs --tail=100 server` — usually env validation or a Prisma migrate error. Don't restart blindly; read the actual error.

**Sidecar healthcheck failing.** `docker compose logs --tail=100 sidecar`. Check `curl http://localhost:3002/health` from the host.

**Pipeline (DXF → render) regression.** Use fixtures from `dummy_data/` (gitignored — DXF + תקנון PDF). Submit through the client at http://localhost:5173 and tail server + sidecar in parallel.

**Client API call is failing.** Tail `server` to see the request hit the controller. CORS origin is hard-coded to `http://localhost:5173` in compose env — match it.

**Need a clean slate.** `docker compose down && docker compose up -d --build`. Don't `down -v` unless the user asks.

## What *not* to do

- Don't run `docker compose up` (no `-d`) — it blocks the tool call.
- Don't poll logs with sleep loops. Use `run_in_background: true` + BashOutput, or `--since`/`--tail` snapshots.
- Don't restart the whole stack when one service needs a kick.
- Don't run `npm run dev` in client/ or server/ directly *while* the compose stack is up — port collisions on 5173/3001.
- Don't claim "the dev stack is running" without verifying via `docker compose ps` and a log peek. Per project memory: verify with real tooling, don't assert from reasoning.
