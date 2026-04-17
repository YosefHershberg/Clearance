---
title: _API Index
type: index
tags:
  - api
  - moc
---

# API Index

Single hub for the HTTP surface. See [[API MOC]] for conventions.

## Endpoints

| Method | Path | Auth | Implemented by | Called by | Brief |
| --- | --- | --- | --- | --- | --- |
| GET | `/health` | public | [[GET health]] | — | Liveness probe |

> [!info] That's the entire surface
> The `/api/*` router is mounted in [[Server app]] and gated by [[authMiddleware]], but [[API Router]] currently registers no routes. Add a row above for each new endpoint.

## Add a new endpoint

1. Define a Zod schema under `server/src/api/schemas/` and link it from a new note.
2. Write a controller under `server/src/api/controllers/` and create a note for it.
3. Register the route in [[API Router]] using [[validate]] + the controller.
4. Create `35-API/<METHOD> <path>.md` with `Implemented by`, `Called by`, `Touches` sections.
5. Add a row to this index.
