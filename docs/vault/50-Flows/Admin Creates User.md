---
title: Admin Creates User
type: flow
tags:
  - admin
  - flow
source:
  - server/src/api/routes/admin.routes.ts
  - server/src/api/services/admin-users.service.ts
---

# Admin Creates User

```mermaid
sequenceDiagram
  participant A as Admin
  participant S as Express
  participant DB as Postgres
  participant AL as AuditLog

  A->>S: POST /api/admin/users { email, name, initialPassword }
  Note over S: auth + requireAdmin + validate(createUserSchema)
  S->>S: hash(initialPassword, 10)
  S->>DB: prisma.user.create({ role: 'USER', ... })
  alt email collision (P2002)
    DB-->>S: error
    S-->>A: 409 { message: 'email_in_use' }
  else ok
    DB-->>S: user row
    S->>AL: record({ event: 'admin.user_created', entityId: user.id })
    S-->>A: 201 { data: { user } }
  end
```

## Invariants enforced at the service layer
- Body schema is `z.strictObject(...)` — any extra field (e.g. `role`) 400s in validate middleware.
- Service hard-codes `role: 'USER'`; there is no API surface to create an `ADMIN` via this path.
- Email conflict 409 surfaces via Prisma error code `P2002`.
