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
