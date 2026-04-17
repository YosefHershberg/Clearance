---
title: Server index
type: entry
layer: server
tags:
  - server
  - entry
source: server/src/index.ts
---

# Server index

Process entry point. Reads `PORT` from [[env]], calls [[Database Connection|connectToDatabase]], then starts the Express [[Server app]] listening.

If the DB connect rejects, the error is logged via [[Logger]] and re-thrown — the process crashes by design.

## Links
- Boots → [[Server app]]
- Connects via → [[Database Connection]]
- Reads env via → [[env]]
- Source: [server/src/index.ts:1](../../../server/src/index.ts)
