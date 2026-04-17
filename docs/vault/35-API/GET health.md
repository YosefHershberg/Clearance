---
title: GET health
type: endpoint
method: GET
path: /health
auth: public
tags:
  - api
  - endpoint
source: server/src/app.ts:27
---

# GET /health

Liveness probe. No auth, no params, no body.

## Request
- Method: `GET`
- Path: `/health`
- Headers: none required

## Response

`200 OK`

```json
{ "status": "ok" }
```

## Implemented by
- [[healthCheck]] (mounted in [[Server app]] before [[authMiddleware]])

## Called by

> [!info] No client caller yet
> The client has no API client (see [[Client API Client]]).

## Touches
- No DB, no external services.
