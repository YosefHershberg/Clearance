---
title: Data MOC
type: moc
tags:
  - moc
  - db
---

# Data MOC

Postgres, accessed through Prisma 7 with the [PrismaPg](https://www.prisma.io/docs) driver adapter.

- [[Prisma Schema]] — single source of truth for DB models
- [[Prisma Config]] — runtime client wiring
- [[Database Connection]] — `connectToDatabase` / `disconnectFromDatabase`

## Models

> [!info] No models defined yet
> [server/prisma/schema.prisma](../../../server/prisma/schema.prisma) currently declares only the generator and datasource. There are no `model` blocks.

## Conventions

Per [server/CLAUDE.md](../../../server/CLAUDE.md):

- Only the [[Server MOC|data-access layer]] (`*.da.ts`) talks to Prisma directly.
- Prisma client is generated to `src/generated/prisma/` (gitignored).
- `DATABASE_URL` is the pooler URL (runtime); `DIRECT_URL` is for migrations.
