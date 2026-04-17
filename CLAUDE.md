# Clearance

## Architecture
This is a full-stack app split into two submodules:
- `client/` — frontend (React + Vite + TypeScript)
- `server/` — backend (Node.js + Express + TypeScript)

## Conventions
- All PRs require at least 1 review and passing CI before merge
- Use conventional commits: feat:, fix:, chore:, docs:
- Never commit secrets or .env files
- settings.local.json is gitignored (personal Claude overrides only)

## Knowledge Vault
An Obsidian knowledge graph lives at `docs/vault/`. Use it as the first stop for architecture, request lifecycle, API index, and end-to-end flows — it's kept in sync with the code and structured for cross-linking.

- Start at `docs/vault/00-Index/Home.md` (MOCs for Architecture, Client, Server, API, Data, Flows)
- When changing behavior, update the relevant vault page in the same PR
- Use the `obsidian:obsidian-markdown` skill for wikilinks/callouts/frontmatter and `obsidian:obsidian-cli` for vault queries
