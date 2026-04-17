---
title: Client-Server Boundary
type: doc
layer: shared
tags:
  - architecture
  - api
source:
  - server/src/app.ts
  - server/src/middlewares.ts
---

# Client-Server Boundary

## Transport

HTTP/JSON. CORS in [server/src/app.ts:19](../../../server/src/app.ts) allows any origin in non-prod, and only `env.CORS_ORIGIN` in production.

## Auth

> [!info] Not implemented
> No authentication middleware is currently applied. See [[Authentication Flow]] for context.

## Mount points

| Path | Auth | Source |
| --- | --- | --- |
| `GET /health` | public | [[healthCheck]] |
| `/api/*` | required | [[API Router]] (currently empty) |

## Response envelope

Per [server/CLAUDE.md](../../../server/CLAUDE.md): `{ data }` on success, `{ error, details? }` on failure. Error responses pass through [[errorHandler]].

> [!warning] Drift between intent and code
> [server/CLAUDE.md](../../../server/CLAUDE.md) describes scripts (`npm run lint`, `db:generate`, etc.) that are **not** in [server/package.json](../../../server/package.json) yet. Treat the CLAUDE.md as forward-looking until those scripts exist.

Related: [[Authentication Flow]] · [[Request Lifecycle]] · [[_API Index]]
