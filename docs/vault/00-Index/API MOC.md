---
title: API MOC
type: moc
tags:
  - moc
  - api
---

# API MOC

The HTTP surface between [[Client MOC|client]] and [[Server MOC|server]].

- [[_API Index]] — table of every endpoint

## Conventions (from [server/CLAUDE.md](../../../server/CLAUDE.md))

- All `/api/*` routes are currently unprotected (auth not yet implemented).
- `/health` is the only public endpoint today.
- Validation: each route uses [[validate]] with a Zod schema.
- Response envelope: `{ data }` on success, `{ error, details? }` on failure.
- Error responses also flow through [[errorHandler]] when an [[HttpError]] is thrown.

> [!info] Surface is minimal
> Today only `GET /health` exists. The `/api` router in [server/src/api/routes/index.ts:1](../../../server/src/api/routes/index.ts) is an empty stub.
