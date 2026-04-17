---
title: Logger
type: config
layer: server
tags:
  - server
  - config
  - logging
source: server/src/config/logger.ts
---

# Logger

Winston logger. JSON output with timestamps. File transports for `error`, `info`, `warn` under `logs/`. In non-production, also logs colorized output to the console.

## Links
- Used by → [[Server index]] · [[Database Connection]] · [[validate]]
- Source: [server/src/config/logger.ts:3](../../../server/src/config/logger.ts)

> [!info] `logs/` is local
> The transports write to `logs/error.log`, `logs/info.log`, `logs/warning.log` relative to the process CWD. Make sure that directory exists or is created at deploy time.
