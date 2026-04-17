---
title: Server MOC
type: moc
tags:
  - moc
  - server
---

# Server MOC

Node + Express 5 + TypeScript. Postgres via Prisma 7 (PrismaPg adapter). Auth not yet implemented.

## Entry & shell
- [[Server index]] — boots the HTTP server after DB connect
- [[Server app]] — Express app, middleware wiring, route mount points

## Middleware
- [[authMiddleware]] — removed (auth not yet implemented)
- [[validate]] — Zod request validator factory
- [[errorHandler]] — terminal error handler
- [[notFound]] — 404 handler

## Routes & controllers
- [[API Router]] — mounted at `/api`, currently empty
- [[healthCheck]] — public `GET /health`

> [!info] Empty layers
> `services/`, `data-access/`, `schemas/`, `webhooks/` are scaffold-only.

## Config
- [[Prisma Config]] — Prisma client + PrismaPg adapter
- [[Database Connection]] — connect / disconnect helpers
- [[Logger]] — Winston (file + console in non-prod)
- [[Rate Limiter]] — express-rate-limit (500 req / 5 min)

## Lib & utils
- [[HttpError]] — typed HTTP error
- [[env]] — Zod-validated environment variables
- [[HTTP Types]] — shared response shapes
