---
title: env
type: util
layer: server
tags:
  - server
  - config
  - env
source: server/src/utils/env.ts
---

# env

Loads `.env` via `dotenv` and validates `process.env` against a Zod schema. Throws on startup if anything required is missing — fail-fast.

## Required

| Variable | Type | Used by |
| --- | --- | --- |
| `PORT` | string | [[Server index]] |
| `DATABASE_URL` | string | [[Prisma Config]] |
| `CORS_ORIGIN` | URL | [[Server app]] (cors origin) |

`NODE_ENV` is not validated; defaulted to `'development'`.

> [!info] DIRECT_URL
> [server/CLAUDE.md](../../../server/CLAUDE.md) mentions `DIRECT_URL` for Prisma migrations. It is read by `prisma.config.ts`, **not** by this Zod schema.

## Links
- Source: [server/src/utils/env.ts:6](../../../server/src/utils/env.ts)
