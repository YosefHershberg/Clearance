---
title: notFound
type: middleware
layer: server
tags:
  - server
  - middleware
source: server/src/middlewares.ts
---

# notFound

Catch-all middleware mounted after all routes. Sets status 404 and forwards an `Error("Not Found - <url>")` to [[errorHandler]].

## Links
- Forwards to → [[errorHandler]]
- Mounted by → [[Server app]]
- Source: [server/src/middlewares.ts:36](../../../server/src/middlewares.ts)
