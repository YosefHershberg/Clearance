---
title: validate
type: middleware
layer: server
tags:
  - server
  - middleware
  - validation
source: server/src/middlewares.ts
---

# validate

Higher-order middleware: `validate(schema)` returns an Express handler that parses `{ body, query, params }` together against the supplied Zod schema.

- On `ZodError` → responds 400 with `{ error: 'Invalid data', details: [{ message }] }`
- On any other thrown error → responds 500 with `{ error: 'Internal Server Error' }`
- Logs the underlying issues via [[Logger]]

## Usage

```ts
router.post('/create', validate(createSchema), createController);
```

## Links
- Logs via → [[Logger]]
- Schemas live in → `server/src/api/schemas/` (empty today)
- Source: [server/src/middlewares.ts:53](../../../server/src/middlewares.ts)

> [!warning] Inconsistent error envelope
> [[errorHandler]] returns `{ message }` for [[HttpError]], but `validate` returns `{ error, details }`. Per [server/CLAUDE.md](../../../server/CLAUDE.md) the canonical error shape is `{ error, details? }`.
