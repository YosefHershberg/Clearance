---
title: Request Lifecycle
type: doc
layer: server
tags:
  - architecture
  - server
source:
  - server/src/app.ts
---

# Request Lifecycle

Order of middleware as wired in [server/src/app.ts:14](../../../server/src/app.ts):

1. `morgan('dev')` — request logger
2. `helmet()` — security headers
3. `app.set('trust proxy', 1)` — needed for [[Rate Limiter]] behind a proxy
4. `cors(...)` — see [[Client-Server Boundary]] for origin policy
5. [[Rate Limiter]] — global limit, applies before any route
6. `express.json()` — JSON body parser
7. **`GET /health`** → [[healthCheck]] (public, before auth)
8. **`/api/*`** → [[authMiddleware]] → [[API Router]]
9. [[notFound]] — unmatched routes
10. [[errorHandler]] — terminal error sink

```mermaid
graph TD
  Req["Incoming HTTP request"] --> Log["morgan / helmet / cors"]
  Log --> Limit["rateLimiter"]
  Limit --> Json["express.json"]
  Json --> Branch{"Path?"}
  Branch -->|/health| Health["healthCheck"]
  Branch -->|/api/*| Auth["authMiddleware"]
  Auth --> Router["API Router"]
  Router --> Validate["validate(schema)"]
  Validate --> Controller["controller"]
  Controller --> Service["service"]
  Service --> DA["data-access (*.da.ts)"]
  DA --> Prisma["Prisma + Postgres"]
  Branch -->|no match| NotFound["notFound"]
  Auth -->|err| Err["errorHandler"]
  Validate -->|err| Err
  Controller -->|err| Err
  NotFound --> Err
```

> [!info] Per-route validation pattern
> Routes are expected to call [[validate]] with a Zod schema, but no `/api` routes exist yet to demonstrate it.
