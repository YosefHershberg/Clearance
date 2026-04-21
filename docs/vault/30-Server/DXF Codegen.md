---
title: DXF Codegen (v3.1 visual bridge)
type: doc
layer: server
tags:
  - server
  - dxf
  - codegen
source:
  - server/src/jobs/handlers/dxf-extraction.handler.ts
  - server/src/integrations/anthropic.client.ts
  - server/src/integrations/python-sidecar.client.ts
  - server/src/api/data-access/extraction-script.da.ts
  - sidecar/app/dxf_explorer.py
  - sidecar/app/dxf_sheet_renderer.py
---

# DXF Codegen (v3.1 visual bridge)

> Generated per-file Python extraction scripts. See the [design spec](../../superpowers/specs/2026-04-19-buildcheck-full-redesign.md) §2.20 + §7.

## Why "visual bridge"

Israeli DXFs encode Hebrew four different ways (Unicode escapes, UTF-8, SHX Latin substitution like `"eu cbhhi" = "קו בניין"`, CP862/Win-1255). ~40% of files contain zero Hebrew bytes — Latin characters are rendered as Hebrew through font glyph mapping at draw time. Hardcoded decoders break on each new architect's file.

Instead of decoding: the sidecar emits `explorationJson` with byte-exact `raw` text samples and renders one PNG per sheet with **numbered red dots at each text position** (dot `N` ↔ `text_samples[N-1]`). Claude Opus + vision sees both, classifies each sheet visually, and builds a **per-file `LABELS` dict** mapping semantic names to the exact raw strings ezdxf returned. Generated Python script matches raw strings, not decoded Hebrew.

This keeps the language model out of the hot path: once codegen succeeds and the `ExtractionScript` is cached by `structuralHash`, every subsequent upload with the same DXF structure runs explore + execute only — no thumbnails, no Opus, no vision tokens.

## Flow (§7.3)

1. **Explore** — `dxf_explorer.py` → `explorationJson` + `structuralHash`.
2. **Cache lookup** — `ExtractionScript.findLatestByHash(hash)`. On hit, skip to execute.
3. **Render thumbnails** (miss only) — `dxf_sheet_renderer.py` → PNG per sheet with numbered dots.
4. **Codegen** (miss only) — `anthropic.client.generateExtractionScript({explorationJson, thumbnails})` → Python source.
5. **Execute** — sidecar `POST /execute` runs the script as a subprocess.
6. **Self-correct** — on crash, one retry via `fixExtractionScript({brokenCode, traceback})` (text-only).
7. **Persist** — `DxfFile.complianceData` + `extractionTrace` + `extractionStatus = COMPLETED` in a single transaction. `SheetRender` rows are Cluster 4c (deferred).

## Key files

- Handler: [server/src/jobs/handlers/dxf-extraction.handler.ts](../../../server/src/jobs/handlers/dxf-extraction.handler.ts)
- Anthropic client: [server/src/integrations/anthropic.client.ts](../../../server/src/integrations/anthropic.client.ts)
- Sidecar client: [server/src/integrations/python-sidecar.client.ts](../../../server/src/integrations/python-sidecar.client.ts)
- Data access: [server/src/api/data-access/extraction-script.da.ts](../../../server/src/api/data-access/extraction-script.da.ts)
- Sidecar explorer: [sidecar/app/dxf_explorer.py](../../../sidecar/app/dxf_explorer.py)
- Sidecar renderer: [sidecar/app/dxf_sheet_renderer.py](../../../sidecar/app/dxf_sheet_renderer.py)

## Caches

- **Byte sha256 dedup** (per project) — identical uploads skip everything.
- **Structural-hash codegen cache** (global, append-only) — Opus cost (~$1) only on first unique DXF structure. Repeat-structure uploads run explore + execute only (~15s, $0, skip thumbnails + codegen entirely).

## Model

- Codegen: `claude-opus-4-7` + vision in v1.
- Fix: same Opus model, text-only (no thumbnails).
- Sonnet 4.6 A/B is a deferred optimization — see spec §14 item 22.

## See also

- [[Phase Status]] — current phase tracker (4b in-progress)
- [design spec §2.20 + §7](../../superpowers/specs/2026-04-19-buildcheck-full-redesign.md)
