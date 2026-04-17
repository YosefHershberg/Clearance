---
title: errorHandler
type: middleware
layer: server
tags:
  - server
  - middleware
source: server/src/middlewares.ts
---

# errorHandler

Terminal Express error handler. Two branches:

- `err instanceof HttpError` → `res.status(err.statusCode).json({ message })`
- otherwise → `res.status(500).json({ message, stack? })` (stack omitted in production)

## Links
- Catches errors from → [[authMiddleware]] · [[validate]] · controllers
- Knows about → [[HttpError]]
- Reads → [[env]] (NODE_ENV)
- Source: [server/src/middlewares.ts:42](../../../server/src/middlewares.ts)
