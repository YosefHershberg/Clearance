---
title: User
type: model
layer: data
tags:
  - prisma
  - auth
source:
  - server/prisma/schema.prisma
---

# User

## Fields
- `id: cuid PK`
- `email: unique`
- `name: string`
- `passwordHash: string` (bcrypt cost 10 per [[Auth - Login Flow]])
- `role: UserRole` (`ADMIN` | `USER`) — immutable after creation; see [[Auth - Admin Seeder]]
- `isActive: boolean` (default `true`) — `false` blocks login instantly per [[Auth - Middleware Chain]]
- `createdAt`, `updatedAt`

## Invariants (spec §2.2)
- Exactly one `ADMIN` row, identified by `env.ADMIN_EMAIL`
- No API endpoint mutates `role`
- No API endpoint deletes or disables an `ADMIN` row
- The seeder is the sole writer of `role` on the admin row
