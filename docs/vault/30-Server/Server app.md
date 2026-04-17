---
title: Server app
type: entry
layer: server
tags:
  - server
  - entry
source: server/src/app.ts
---

# Server app

Builds the Express application: applies cross-cutting middleware, mounts the public health endpoint and the auth-gated `/api` router, and wires the terminal error handlers.

See [[Request Lifecycle]] for the ordered chain.

## Wiring (in order)

1. `morgan('dev')` request logger
2. `helmet()` security headers
3. `app.set('trust proxy', 1)` — required by [[Rate Limiter]]
4. `cors(...)` — origin policy from [[env]]
5. [[Rate Limiter]]
6. `express.json()` body parser
7. `GET /health` → [[healthCheck]]
8. `/api` → [[authMiddleware]] → [[API Router]]
9. [[notFound]]
10. [[errorHandler]]

## Links
- Mounts → [[healthCheck]] · [[API Router]]
- Uses middleware → [[authMiddleware]] · [[notFound]] · [[errorHandler]] · [[Rate Limiter]]
- Source: [server/src/app.ts:12](../../../server/src/app.ts)
