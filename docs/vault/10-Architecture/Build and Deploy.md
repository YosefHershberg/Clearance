---
title: Build and Deploy
type: doc
layer: shared
tags:
  - architecture
  - build
source:
  - client/package.json
  - server/package.json
---

# Build and Deploy

## Client scripts ([client/package.json](../../../client/package.json))

| Script | Command | Notes |
| --- | --- | --- |
| `dev` | `vite` | Vite dev server |
| `build` | `tsc -b && vite build` | Type-check then bundle |
| `preview` | `vite preview` | Serve `dist/` |
| `lint` | `eslint .` | |
| `typecheck` | `tsc --noEmit` | |
| `test` | `vitest run` | |
| `test:e2e` | `playwright test` | No Playwright dep installed yet — flag |

## Server scripts ([server/package.json](../../../server/package.json))

| Script | Command | Notes |
| --- | --- | --- |
| `dev` | `nodemon src/index.ts` | |
| `start` | `node dist/index.js` | Expects prior `build` |
| `start:test` | `NODE_ENV=test ts-node src/index.ts` | |
| `build` | `tsc` | |
| `typecheck` | `tsc --noEmit` | |
| `test` | `vitest run` | |
| `test:integration` | `vitest run --config vitest.integration.config.ts` | |

> [!warning] CLAUDE.md drift
> [server/CLAUDE.md](../../../server/CLAUDE.md) lists `lint`, `start:dist`, `db:generate`, `db:migrate`, etc. — none of these exist in `package.json` yet.

## Env

Server env is validated at startup by [[env]]. Required: `PORT`, `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CORS_ORIGIN`.
