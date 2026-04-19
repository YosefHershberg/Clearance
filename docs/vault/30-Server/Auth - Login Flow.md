---
title: Auth - Login Flow
type: doc
layer: server
tags:
  - auth
  - server
source:
  - server/src/api/routes/auth.routes.ts
  - server/src/api/controllers/auth.controller.ts
  - server/src/api/services/auth.service.ts
---

# Auth - Login Flow

## Endpoints
- `POST /api/auth/login` — per-IP rate-limited (10/15m); validates body; returns `{ data: { user } }` and `Set-Cookie: auth=<jwt>; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800`
- `POST /api/auth/logout` — unauthenticated, clears the auth cookie
- `GET /api/auth/me` — requires [[auth middleware]], returns `{ data: { user: req.user } }`
- `POST /api/auth/change-password` — requires [[auth middleware]]; current password must match

## Service
`auth.service.ts` exports `login(email, password)` and `changePassword(userId, current, new)`. Any login-side failure (missing user, inactive, wrong password) → `HttpError(401, 'Invalid credentials')` — a single generic message to avoid enumeration (spec §2.6).

## Cookie policy
See [[Client-Server Boundary]]. Production: `Secure=true`; development: `Secure=false` (dropped per `NODE_ENV`).
