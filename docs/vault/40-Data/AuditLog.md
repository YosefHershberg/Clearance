---
title: AuditLog
type: model
layer: data
tags:
  - prisma
  - audit
source:
  - server/prisma/schema.prisma
  - server/src/api/services/audit-log.service.ts
---

# AuditLog

## Fields
- `id: cuid PK`
- `actorId?: string` — nullable (seeder writes are unauthenticated)
- `event: string` — snake_case, dot-separated (e.g. `admin.user_created`, `auth.login`)
- `entity?: string` — model name (`User`, `Project`, …)
- `entityId?: string`
- `metadata?: Json`
- `createdAt`

## Write path — best-effort
Writes go through `audit-log.service.record(...)`. Any insert failure is caught, logged at `error`, and swallowed — a log failure never blocks the user operation (spec §2.17).

## Known events (Phase 1a)
- `admin.seeded`
- `admin.drift_repaired` (warn-log only; not a DB write)
- `auth.login`, `auth.logout`, `auth.password_changed`
- `admin.user_created`, `admin.user_deleted`, `admin.user_password_reset`, `admin.user_enabled`, `admin.user_disabled`
