---
title: Database Connection
type: config
layer: server
tags:
  - server
  - config
  - db
source: server/src/config/database.ts
---

# Database Connection

Thin wrappers around `prisma.$connect()` / `prisma.$disconnect()`, with success/failure logged through [[Logger]]. Connect failures are re-thrown so [[Server index]] can crash on boot.

## Exports

- `connectToDatabase(): Promise<void>`
- `disconnectFromDatabase(): Promise<void>`

## Links
- Wraps → [[Prisma Config]]
- Logs via → [[Logger]]
- Called by → [[Server index]]
- Source: [server/src/config/database.ts:4](../../../server/src/config/database.ts)
