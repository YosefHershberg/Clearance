---
title: Login and Session
type: flow
tags:
  - auth
  - flow
source:
  - server/src/api/routes/auth.routes.ts
  - server/src/integrations/auth-cookie.ts
---

# Login and Session

```mermaid
sequenceDiagram
  participant C as Client (browser)
  participant S as Express (Node)
  participant DB as Postgres

  C->>S: POST /api/auth/login { email, password }
  S->>DB: findUserByEmail(email)
  DB-->>S: user | null
  alt missing / inactive / password mismatch
    S-->>C: 401 { message: 'Invalid credentials' }
  else ok
    S->>S: setAuthCookie(userId)  # JWT 7d, HttpOnly, SameSite=Strict
    S-->>C: 200 { data: { user } } + Set-Cookie: auth=<jwt>
  end

  Note over C,S: Subsequent requests carry Cookie: auth=<jwt>

  C->>S: GET /api/auth/me
  S->>S: auth middleware: verifyToken + findUserById + isActive check
  S->>DB: findUserById
  DB-->>S: user
  S-->>C: 200 { data: { user } }

  C->>S: POST /api/auth/logout
  S-->>C: 200 + Set-Cookie: auth=; Max-Age=0
```

See [[Auth - Middleware Chain]] for the per-request validation details.
