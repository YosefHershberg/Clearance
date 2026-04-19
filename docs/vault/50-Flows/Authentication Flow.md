---
title: Authentication Flow
type: flow
layer: shared
tags:
  - flow
  - auth
source:
  - server/src/api/routes/auth.routes.ts
  - server/src/middlewares/auth.middleware.ts
---

# Authentication Flow

Superseded by two more focused pages:

- [[Login and Session]] — session lifecycle (login → /me → logout), cookie policy, sequence diagram
- [[Auth - Middleware Chain]] — per-request validation (token → user → active check), request augmentation with `req.user`

See also: [[Auth - Login Flow]], [[Auth - Admin Seeder]], [[Admin Creates User]].
