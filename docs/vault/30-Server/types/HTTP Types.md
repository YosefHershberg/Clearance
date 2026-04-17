---
title: HTTP Types
type: types
layer: server
tags:
  - server
  - types
source: server/src/types/http.types.ts
---

# HTTP Types

Shared HTTP response shapes.

```ts
type CustomRequest = Request;          // alias for Express Request
type MessageResponse = { message: string };
type ErrorResponse  = MessageResponse & { stack?: string };
```

## Links
- Used by → [[errorHandler]]
- Re-exported from → `server/src/types/index.ts`
- Source: [server/src/types/http.types.ts:1](../../../server/src/types/http.types.ts)
