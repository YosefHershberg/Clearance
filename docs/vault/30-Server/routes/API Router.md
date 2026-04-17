---
title: API Router
type: route
layer: server
tags:
  - server
  - api
source: server/src/api/routes/index.ts
---

# API Router

Express router mounted at `/api` in [[Server app]] behind [[authMiddleware]]. Currently exports an empty router — no domain routes are registered.

```ts
// router.use('/example', exampleRoutes);  ← placeholder
```

## Links
- Mounted at `/api` by → [[Server app]]
- Gated by → [[authMiddleware]]
- Source: [server/src/api/routes/index.ts:1](../../../server/src/api/routes/index.ts)

> [!info] Add new domain routes here
> Per [server/CLAUDE.md](../../../server/CLAUDE.md), routes follow `<domain>.routes.ts` and call [[validate]] with a Zod schema before reaching the controller.
