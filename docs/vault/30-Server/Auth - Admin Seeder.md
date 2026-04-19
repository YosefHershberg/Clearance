---
title: Auth - Admin Seeder
type: doc
layer: server
tags:
  - auth
  - bootstrap
source:
  - server/src/bootstrap/seed-admin.ts
  - server/src/index.ts
---

# Auth - Admin Seeder

## Flow (runs before `app.listen()`)
1. Look up user by `env.ADMIN_EMAIL`.
2. Not found → bcrypt-hash `ADMIN_INITIAL_PASSWORD` (cost 10), insert `role=ADMIN`, `isActive=true`, write audit `admin.seeded`.
3. Found, `role=ADMIN` + `isActive=true` → no-op.
4. Found, drift (wrong role or inactive) → repair `role=ADMIN`, `isActive=true` (never touches `passwordHash`); warn-log `admin.drift_repaired`.
5. Any throw anywhere up the chain → `logger.error('Boot failure')` + `process.exit(1)`.

## Recovery
Password loss: `UPDATE "User" SET "passwordHash" = ... WHERE "email" = $ADMIN_EMAIL;` via psql. The seeder never overwrites a stored hash.
