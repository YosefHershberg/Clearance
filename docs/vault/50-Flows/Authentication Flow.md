---
title: Authentication Flow
type: flow
layer: shared
tags:
  - flow
  - auth
source:
  - server/src/middlewares.ts
---

# Authentication Flow

> [!info] Not implemented
> Authentication has been removed from the server. No auth middleware is currently applied to `/api/*` routes. This note is a placeholder for when a new auth strategy is chosen and implemented.

## Previous state

The server previously used Supabase Auth (JWT verification via service-role key). This was removed before any domain routes existed.

## When re-implementing

- Choose an auth strategy and document it here
- Create an auth middleware in `server/src/middlewares.ts`
- Mount it on `/api/*` in `server/src/app.ts`
- Update [[Client-Server Boundary]] and [[Server MOC]]
