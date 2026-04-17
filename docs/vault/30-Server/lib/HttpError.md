---
title: HttpError
type: lib
layer: server
tags:
  - server
  - errors
source: server/src/lib/HttpError.ts
---

# HttpError

Lightweight error class carrying an HTTP `statusCode` alongside the message. Used to throw recognizable errors that [[errorHandler]] turns into JSON responses with the right status.

```ts
throw new HttpError(401, 'Invalid or expired token');
```

## Links
- Thrown by → [[authMiddleware]]
- Caught by → [[errorHandler]]
- Source: [server/src/lib/HttpError.ts:1](../../../server/src/lib/HttpError.ts)
