---
title: Rate Limiter
type: config
layer: server
tags:
  - server
  - config
  - security
source: server/src/config/rateLimit.ts
---

# Rate Limiter

`express-rate-limit` configured to **500 requests per 5-minute window** per IP, returning a plain text message on overflow.

Mounted globally before all routes by [[Server app]]. Requires `app.set('trust proxy', 1)` to read the real IP behind a proxy.

## Links
- Mounted by → [[Server app]]
- Source: [server/src/config/rateLimit.ts:3](../../../server/src/config/rateLimit.ts)
