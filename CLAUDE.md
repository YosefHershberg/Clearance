# Clearance

## Architecture
Full-stack monorepo:
- `client/` — frontend (React + Vite + TypeScript)
- `server/` — backend (Node.js + Express + TypeScript)
- `sidecar/` — Python sidecar (FastAPI) for the DXF/PDF pipeline

## Conventions
- All PRs require at least 1 review and passing CI before merge
- Use conventional commits: feat:, fix:, chore:, docs:
- Never commit secrets or .env files
- settings.local.json is gitignored (personal Claude overrides only)

## Running and validating the dev stack
`DEVELOPMENT.md` (repo root) is the agent's operational guide for the local stack — read it before:
- Running the dev servers (`docker compose` flow, detached + background log tail — never foreground `up`).
- Debugging via logs (`docker compose logs -f` patterns, `server/logs/*.log` files).
- Validating client/UI changes end-to-end via the Claude in Chrome MCP tools against `http://localhost:5173`.
- Reproducing pipeline issues with `dummy_data/` fixtures.

## Knowledge Vault
An Obsidian knowledge graph lives at `docs/vault/`. Use it as the first stop for architecture, request lifecycle, API index, and end-to-end flows — it's kept in sync with the code and structured for cross-linking.

- Start at `docs/vault/00-Index/Home.md` (MOCs for Architecture, Client, Server, API, Data, Flows)
- When changing behavior, update the relevant vault page in the same PR
- Use the `obsidian:obsidian-markdown` skill for wikilinks/callouts/frontmatter and `obsidian:obsidian-cli` for vault queries

## BuildCheck redesign
A ground-up redesign of the app is in progress, broken into ~10 phases. v1 (phases 0–4c + design-system port) shipped to `main`; phases 5–10 are still planned. Always start by checking current phase state before proposing work.

- **Current phase + status:** `docs/vault/00-Index/Phase Status.md` — single source of truth; check first, update on every transition
- **Spec:** `docs/superpowers/specs/2026-04-19-buildcheck-full-redesign.md` (§13 = phase breakdown)
- **Git workflow:** under review (the long-lived `integration/buildcheck` strategy retired with v1; new strategy TBD).
- **When a phase transitions** (branch created, PR opened, PR merged, next phase picked up): update `Phase Status.md` in the same commit.
