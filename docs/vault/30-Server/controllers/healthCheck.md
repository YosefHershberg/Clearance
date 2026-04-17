---
title: healthCheck
type: controller
layer: server
tags:
  - server
  - controller
  - api
source: server/src/api/controllers/healthCheck.controller.ts
---

# healthCheck

Public liveness probe. Replies `200 { status: 'ok' }`.

## Links
- Implements → [[GET health]]
- Mounted by → [[Server app]] (before [[authMiddleware]])
- Source: [server/src/api/controllers/healthCheck.controller.ts:3](../../../server/src/api/controllers/healthCheck.controller.ts)
