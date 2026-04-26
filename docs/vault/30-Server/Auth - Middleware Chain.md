---
title: Auth - Middleware Chain
type: doc
layer: server
tags:
  - auth
  - middleware
source:
  - server/src/middlewares/auth.middleware.ts
  - server/src/middlewares/require-admin.middleware.ts
---

# Auth - Middleware Chain

## `auth` middleware
1. Read `req.cookies.auth`. Missing → 401 `{ message: 'Unauthenticated' }`.
2. `verifyToken(cookie)`. Invalid signature / expired → 401 + clear cookie.
3. `findUserById(payload.sub)`. Missing → 401 + clear cookie.
4. `user.isActive === false` → 401 + clear cookie (Approach 2 instant lockout per spec §2.5).
5. Set `req.user = { id, email, name, role }`; call `next()`.

## `requireAdmin` middleware
- `req.user?.role === 'ADMIN'` → `next()`.
- Otherwise → 403 `{ message: 'Forbidden' }`.

## Applied via
- `auth` on `/api/auth/me`, `/api/auth/change-password`, the whole `/api/admin/*` router
- `requireAdmin` mounted after `auth` on the `/api/admin` router
