---
title: Prisma Schema
type: model
layer: server
tags:
  - db
  - prisma
source: server/prisma/schema.prisma
---

# Prisma Schema

The single source of truth for DB models, per [server/CLAUDE.md](../../../server/CLAUDE.md).

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}
```

## Models

> [!info] None yet
> No `model` blocks are defined. Once added, give each model its own note under `40-Data/` and link from `Touches` sections in [[_API Index|API endpoints]].

## Links
- Generated client wired in → [[Prisma Config]]
- See concept → [[Prisma]]
- Source: [server/prisma/schema.prisma:1](../../../server/prisma/schema.prisma)
