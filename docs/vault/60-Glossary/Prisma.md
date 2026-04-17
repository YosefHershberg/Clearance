---
title: Prisma
type: concept
tags:
  - concept
  - db
---

# Prisma

Type-safe ORM for Node. The schema in [[Prisma Schema]] generates a typed client. In Clearance, Prisma 7 is wired through the **PrismaPg driver adapter** so it talks to Postgres via the `pg` driver instead of Prisma's built-in engine binary.

Layering rule from [server/CLAUDE.md](../../../server/CLAUDE.md): only the data-access layer (`*.da.ts` files under `server/src/api/data-access/`) is allowed to import the Prisma client.

Related: [[Prisma Config]] · [[Database Connection]] · [[Prisma Schema]]
