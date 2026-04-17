---
title: Prisma Config
type: config
layer: server
tags:
  - server
  - config
  - db
source: server/src/config/prisma.ts
---

# Prisma Config

Singleton Prisma Client wired to the `PrismaPg` driver adapter. Connection string comes from `env.DATABASE_URL` (see [[env]]).

```ts
const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
```

## Links
- Generated client → `server/src/generated/prisma/` (gitignored)
- Used by → [[Database Connection]]
- Reads → [[env]]
- Schema → [[Prisma Schema]]
- Source: [server/src/config/prisma.ts:1](../../../server/src/config/prisma.ts)
