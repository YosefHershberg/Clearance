# Phase 4b — Codegen + Execute + Self-Correct (v3.1 Visual Bridge) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the v3.1 visual-bridge DXF extraction pipeline end-to-end: rewrite the sidecar explorer to emit raw+decoded samples with encoding flags, add a thumbnail renderer and two new sidecar endpoints, extend the server's Prisma schema with `ExtractionScript` + `DxfFile.complianceData`, add a multimodal Anthropic client, and expand the `DXF_EXTRACTION` handler to the full explore → cache-lookup → (miss: thumbnails + codegen) → execute → self-correct → persist state machine.

**Architecture:** Three submodules each get a `feat/buildcheck-phase-4b` branch. The sidecar lands new Python code + endpoints; the server lands Prisma + integrations + handler + tests; the main repo ships docs and submodule bumps. Per-submodule PRs target `main` in their respective repos; the main-repo PR targets `integration/buildcheck`. No client work in 4b (that's 4c).

**Tech Stack:** FastAPI 0.115 + ezdxf 1.3 + matplotlib 3.8 (sidecar); Node 20 + Express 5 + Prisma 7 + `@anthropic-ai/sdk` + `axios` + Jest (server). Models: `claude-opus-4-7` + vision.

**Design spec:** [2026-04-19-buildcheck-full-redesign.md §2.20 / §7 / §13 Phase 4b](../specs/2026-04-19-buildcheck-full-redesign.md). Review §7.3 (state machine pseudocode) and §7.6 (end-to-end ASCII diagram) before starting.

---

## Cluster overview

```
0. Sidecar: explorer rewrite + dxf_sheet_renderer.py + /render-thumbnails + /execute
   └─> 1. Server: Prisma migration (ExtractionScript + DxfFile.complianceData + data migration)
           └─> 2. Server: integration clients (python-sidecar.client extensions + anthropic.client new)
                   └─> 3. Server: DXF_EXTRACTION handler full state machine
                           └─> 4. Server: unit + integration + contract tests
                                   └─> 5. Vault docs + Phase Status update
                                           └─> 6. Submodule bump + 3 PRs + status transitions
```

Work inside each cluster is mostly linear; clusters 0–1 can in principle be started in parallel because they touch different submodules, but the server handler (cluster 3) hard-depends on cluster 0's endpoint contract and cluster 1's schema — easiest to do clusters in order.

---

## Pre-flight

- [ ] **P.1** You are on `feat/buildcheck-phase-4b` in the main repo (the spec commit is the tip). Verify: `git status` shows the main repo on that branch with the `server` submodule possibly dirty (pre-existing).
- [ ] **P.2** Ensure each submodule is on `main` at the phase-4a merge tip before branching:

  ```bash
  cd sidecar && git fetch origin && git switch main && git pull --ff-only && cd -
  cd server && git fetch origin && git switch main && git pull --ff-only && cd -
  ```

- [ ] **P.3** Create per-submodule feature branches (this plan assumes these exist from this point):

  ```bash
  cd sidecar && git switch -c feat/buildcheck-phase-4b && cd -
  cd server  && git switch -c feat/buildcheck-phase-4b && cd -
  ```

---

## Cluster 0 — Sidecar: explorer rewrite + thumbnail renderer + new endpoints

Directory: `sidecar/` (branch `feat/buildcheck-phase-4b`).

**Files:**
- Modify: `sidecar/app/dxf_explorer.py`
- Create: `sidecar/app/dxf_sheet_renderer.py`
- Modify: `sidecar/app/main.py` — add `/render-thumbnails` + `/execute`
- Modify: `sidecar/requirements.txt` — add `matplotlib>=3.8`
- Modify: `sidecar/Dockerfile` — install matplotlib + system deps (fonts, libpng)
- Create: `sidecar/tests/test_dxf_sheet_renderer.py`
- Create: `sidecar/tests/test_render_thumbnails_endpoint.py`
- Create: `sidecar/tests/test_execute_endpoint.py`
- Modify: `sidecar/tests/test_dxf_explorer.py` — update assertions for new shape
- Modify: `sidecar/tests/fixtures/build_fixture.py` — add a block with ATTRIB entities for the broader sampling test
- Modify: `sidecar/tests/fixtures/small_test.dxf` — regenerate after fixture update

### Steps

- [ ] **0.1 Bump `EXPLORER_VERSION` constant** in `sidecar/app/dxf_explorer.py`:

  ```python
  EXPLORER_VERSION = "4b.1"
  ```

- [ ] **0.2 Broaden entity sampling** in `dxf_explorer.py`:

  ```python
  ENTITY_TYPES = (
      "LINE", "POLYLINE", "LWPOLYLINE", "ARC", "CIRCLE", "INSERT",
      "TEXT", "MTEXT", "ATTRIB", "ATTDEF",
  )
  TEXT_LIKE = ("TEXT", "MTEXT", "ATTRIB", "ATTDEF")
  MAX_SAMPLES_PER_BLOCK = 50
  ```

- [ ] **0.3 Replace `_extract_text` with `_extract_text_record`** that returns a dict instead of a decoded string. The new function must NOT call `_combine_and_scrub_surrogates` on `raw`; decoding goes into `decoded` (nullable).

  ```python
  def _extract_text_record(entity: Any, block_name: str) -> dict[str, Any] | None:
      dxftype = entity.dxftype()
      raw = ""
      if dxftype == "TEXT":
          raw = entity.dxf.text or ""
      elif dxftype == "MTEXT":
          try:
              raw = entity.plain_text() or entity.text or ""
          except Exception:
              raw = getattr(entity, "text", "") or ""
      elif dxftype == "ATTRIB":
          raw = entity.dxf.text or ""
      elif dxftype == "ATTDEF":
          raw = entity.dxf.text or entity.dxf.tag or ""
      if not raw:
          return None
      loc = getattr(entity.dxf, "insert", None) or getattr(entity.dxf, "location", None) or getattr(entity.dxf, "align_point", None)
      x = float(loc.x) if loc is not None else 0.0
      y = float(loc.y) if loc is not None else 0.0
      try:
          decoded_val = _combine_and_scrub_surrogates(raw).strip()
          decoded: str | None = decoded_val if decoded_val != raw.strip() else raw.strip()
      except Exception:
          decoded = None
      return {
          "raw": raw,
          "decoded": decoded,
          "x": round(x, 4),
          "y": round(y, 4),
          "block": block_name,
          "handle": getattr(entity.dxf, "handle", ""),
          "layer": getattr(entity.dxf, "layer", ""),
          "entity_type": dxftype,
      }
  ```

  Rationale: `decoded` is always present as a field; set to the raw stripped form when no meaningful transform occurred, so downstream consumers always have something to render as a Hebrew hint.

- [ ] **0.4 Update `_explore_blocks` to use the new sampler + emit richer samples**. Replace the inner TEXT-sampling block with:

  ```python
  if dxftype in TEXT_LIKE and len(text_samples) < MAX_SAMPLES_PER_BLOCK:
      record = _extract_text_record(entity, name)
      if record is not None:
          text_samples.append(record)
  ```

  `text_samples` now holds list[dict], not list[str].

- [ ] **0.5 Update `_text_flags`** to read `record["decoded"] or record["raw"]` since samples are dicts now:

  ```python
  def _text_flags(samples: list[dict[str, Any]]) -> dict[str, bool]:
      joined = " ".join((s.get("decoded") or s.get("raw") or "") for s in samples)
      # ... existing regex flags unchanged ...
  ```

  `_count_keywords` gets the same treatment.

- [ ] **0.6 Add encoding-signal flags per block**. New helper + integration in `_explore_blocks`:

  ```python
  _UNICODE_ESCAPE_RE = re.compile(r"\\U\+[0-9A-Fa-f]{4}")
  _SHX_PAIR_HINT_RE = re.compile(r"[a-zA-Z]{3,}")  # cheap: long lowercase runs

  def _encoding_flags(samples: list[dict[str, Any]]) -> dict[str, bool]:
      has_unicode_escapes = False
      has_native_hebrew = False
      has_possible_shx = False
      has_high_bytes = False
      for s in samples:
          raw = s.get("raw") or ""
          if _UNICODE_ESCAPE_RE.search(raw):
              has_unicode_escapes = True
          if any("\u0590" <= c <= "\u05FF" for c in raw):
              has_native_hebrew = True
          # possible SHX: long lowercase-latin runs with no Hebrew and no digits
          if _SHX_PAIR_HINT_RE.search(raw) and not any("\u0590" <= c <= "\u05FF" for c in raw):
              has_possible_shx = True
          # high bytes = chars outside basic ASCII and outside the Hebrew block
          for c in raw:
              cp = ord(c)
              if cp > 127 and not (0x0590 <= cp <= 0x05FF):
                  has_high_bytes = True
                  break
      return {
          "has_unicode_escapes": has_unicode_escapes,
          "has_native_hebrew": has_native_hebrew,
          "has_possible_shx": has_possible_shx,
          "has_high_bytes": has_high_bytes,
      }
  ```

  Include `"encoding_flags": _encoding_flags(text_samples)` in each block dict (next to `text_flags`).

- [ ] **0.7 Move dual-viewport detection to `hints`** (demoted from top-level):

  ```python
  # in explore_dxf(), replace the return with:
  hints = {
      "dual_viewport_pairs": pairs,
      "dimension_unit_guess": _guess_dimension_unit(blocks),
  }
  return {
      "source": source,
      "blocks": blocks,
      "layers": layers,
      "hints": hints,
      "meta": { ... unchanged ... },
  }
  ```

  Add a small `_guess_dimension_unit` helper:

  ```python
  def _guess_dimension_unit(blocks: list[dict[str, Any]]) -> str:
      # Look at max bbox extent across all blocks
      max_extent = 0.0
      for b in blocks:
          bbox = b.get("bbox")
          if not bbox:
              continue
          extent = max(bbox[2] - bbox[0], bbox[3] - bbox[1])
          if extent > max_extent:
              max_extent = extent
      # Heuristic: architectural drawings are 20-200m wide
      if max_extent > 20000:   # > 20 km would be absurd → millimeters
          return "mm"
      if max_extent > 200:     # > 200m → centimeters
          return "cm"
      return "m"
  ```

- [ ] **0.8 Keep `structural_hash_for` unchanged** — it already drops `meta` + `source` and canonicalizes via `canonical_sha256`. The new `hints` key and enriched samples flow into the hash naturally, which is the correct behavior (a file with different encoding flags is structurally distinct).

- [ ] **0.9 Update `tests/test_dxf_explorer.py`** — rewrite assertions for the new shape. Key changes:

  ```python
  def test_explore_emits_structured_samples():
      result = explore_dxf(FIXTURE_PATH)
      sample = result["blocks"][0]["text_samples"][0]
      assert set(sample.keys()) == {"raw", "decoded", "x", "y", "block", "handle", "layer", "entity_type"}
      assert isinstance(sample["raw"], str)
      assert sample["decoded"] is None or isinstance(sample["decoded"], str)

  def test_explore_encoding_flags_present():
      result = explore_dxf(FIXTURE_PATH)
      flags = result["blocks"][0]["encoding_flags"]
      assert set(flags.keys()) == {"has_unicode_escapes", "has_native_hebrew", "has_possible_shx", "has_high_bytes"}
      assert all(isinstance(v, bool) for v in flags.values())

  def test_explore_hints_present():
      result = explore_dxf(FIXTURE_PATH)
      assert "dual_viewport_pairs" in result["hints"]
      assert result["hints"]["dimension_unit_guess"] in ("mm", "cm", "m")
  ```

  Drop any test that asserts `text_samples` contains strings directly — update to read `sample["decoded"]` or `sample["raw"]`.

- [ ] **0.10 Update `tests/fixtures/build_fixture.py`** to include an `INSERT` with `ATTRIB` children so the sampler has something to exercise the ATTRIB branch. Minimal addition:

  ```python
  block = doc.blocks.new(name="TitleBlock")
  block.add_attdef("OWNER", insert=(0, 0), text="Owner:")
  msp.add_blockref("TitleBlock", insert=(10, 10)).add_attrib("OWNER", "Test Owner")
  ```

  Re-run the fixture script and commit the regenerated `small_test.dxf`.

- [ ] **0.11 Run sidecar unit tests** → `pytest -q` inside `sidecar/`. Expected: green.

- [ ] **0.12 Commit:**

  ```bash
  cd sidecar
  git add app/dxf_explorer.py tests/test_dxf_explorer.py tests/fixtures/
  git commit -m "feat(explorer): v4b raw+decoded samples, encoding flags, broadened sampling, hints"
  ```

- [ ] **0.13 Create `sidecar/app/dxf_sheet_renderer.py`**. Consumes the exploration JSON, renders PNGs. Key contract: the renderer iterates `text_samples` in order and plots a numbered dot per sample (subject to the density policy). Dot number `N` corresponds to the `N-1`-indexed sample in the sheet.

  ```python
  """Per-sheet PNG renderer for BuildCheck v3.1 visual-bridge codegen.

  Consumes explorationJson from dxf_explorer and the original DXF. Emits one PNG
  per logical sheet with:
    - geometry (LINE / POLYLINE / CIRCLE / ARC) drawn in black
    - numbered red dots at text_samples positions (density-capped)

  ORDERING INVARIANT: dot number N in the PNG ↔ text_samples[N-1] in the JSON
  (global per sheet, after cap applied). The renderer NEVER re-enumerates ezdxf
  for text ordering — it consumes exploration["blocks"][*]["text_samples"].
  """
  from __future__ import annotations

  import re
  import time
  from pathlib import Path
  from typing import Any

  import ezdxf
  import matplotlib
  matplotlib.use("Agg")  # headless
  import matplotlib.pyplot as plt
  from matplotlib.patches import Circle

  DOT_CAP_PER_SHEET = 100
  _NUMERIC_RE = re.compile(r"^[-+]?\d+(\.\d+)?%?$")


  def render_sheets(
      dxf_path: Path,
      exploration_json: dict[str, Any],
      thumbnail_dir: Path,
  ) -> list[dict[str, Any]]:
      """Render one PNG per sheet. Returns a list of {sheet_key, png_uri, dot_count}."""
      thumbnail_dir.mkdir(parents=True, exist_ok=True)
      doc = ezdxf.readfile(str(dxf_path))
      results: list[dict[str, Any]] = []
      for block in exploration_json["blocks"]:
          name = block["name"]
          bbox = block.get("bbox")
          if bbox is None:
              continue
          png_path = thumbnail_dir / f"{_safe_filename(name)}.png"
          dot_count = _render_block(doc, block, png_path)
          results.append({
              "sheet_key": name,
              "png_uri": str(png_path),
              "dot_count": dot_count,
          })
      return results


  def _render_block(doc, block: dict[str, Any], out_path: Path) -> int:
      name = block["name"]
      bbox = block["bbox"]
      fig, ax = plt.subplots(figsize=(12, 9), dpi=100)
      ax.set_aspect("equal")
      ax.set_axis_off()
      ax.set_xlim(bbox[0], bbox[2])
      ax.set_ylim(bbox[1], bbox[3])

      # Draw geometry from the actual block.
      try:
          blk = doc.blocks.get(name)
          for entity in blk:
              _draw_entity(ax, entity)
      except Exception:
          pass  # block may be missing or unreadable; PNG still emitted with dots

      # Overlay numbered dots in text_samples order.
      samples = block.get("text_samples", [])
      ordered = _apply_density_policy(samples, bbox)
      for n, s in ordered:
          ax.scatter([s["x"]], [s["y"]], c="red", s=25, zorder=10, edgecolors="white", linewidths=0.6)
          ax.annotate(
              str(n),
              (s["x"], s["y"]),
              color="red",
              fontsize=8,
              weight="bold",
              xytext=(4, 4),
              textcoords="offset points",
              zorder=11,
          )

      fig.tight_layout()
      fig.savefig(out_path, bbox_inches="tight", pad_inches=0.1)
      plt.close(fig)
      return len(ordered)


  def _apply_density_policy(
      samples: list[dict[str, Any]],
      bbox: list[float],
  ) -> list[tuple[int, dict[str, Any]]]:
      """Returns [(global_sample_index_1based, sample), ...] after dedup + cap.

      Priority: non-numeric first (length desc), numeric last. Drops near-coincident
      positions. Applied AFTER ordering, so skipped samples keep their global number.
      """
      diag = ((bbox[2] - bbox[0]) ** 2 + (bbox[3] - bbox[1]) ** 2) ** 0.5
      min_dist_sq = (diag / 200) ** 2 if diag > 0 else 0.0
      numbered = list(enumerate(samples, start=1))  # 1-based global index
      # Score: lower score = higher priority. Non-numeric first, longer first.
      def score(pair: tuple[int, dict[str, Any]]) -> tuple[int, int]:
          _, s = pair
          raw = s.get("raw") or ""
          is_numeric = 1 if _NUMERIC_RE.match(raw.strip()) else 0
          return (is_numeric, -len(raw))
      numbered.sort(key=score)
      kept: list[tuple[int, dict[str, Any]]] = []
      for n, s in numbered:
          if len(kept) >= DOT_CAP_PER_SHEET:
              break
          x, y = s["x"], s["y"]
          too_close = False
          for _, k in kept:
              dx = k["x"] - x
              dy = k["y"] - y
              if dx * dx + dy * dy < min_dist_sq:
                  too_close = True
                  break
          if not too_close:
              kept.append((n, s))
      # Re-sort by global index so dots appear in the invariant order.
      kept.sort(key=lambda pair: pair[0])
      return kept


  def _draw_entity(ax, entity) -> None:
      dxftype = entity.dxftype()
      try:
          if dxftype == "LINE":
              ax.plot(
                  [entity.dxf.start.x, entity.dxf.end.x],
                  [entity.dxf.start.y, entity.dxf.end.y],
                  color="black", linewidth=0.5,
              )
          elif dxftype == "LWPOLYLINE":
              pts = list(entity.get_points("xy"))
              xs = [p[0] for p in pts]
              ys = [p[1] for p in pts]
              if entity.closed and pts:
                  xs.append(pts[0][0]); ys.append(pts[0][1])
              ax.plot(xs, ys, color="black", linewidth=0.5)
          elif dxftype == "POLYLINE":
              pts = [(v.dxf.location.x, v.dxf.location.y) for v in entity.vertices]
              xs = [p[0] for p in pts]
              ys = [p[1] for p in pts]
              ax.plot(xs, ys, color="black", linewidth=0.5)
          elif dxftype == "CIRCLE":
              ax.add_patch(Circle((entity.dxf.center.x, entity.dxf.center.y), entity.dxf.radius, fill=False, color="black", linewidth=0.5))
          elif dxftype == "ARC":
              import numpy as np
              c = entity.dxf.center
              r = entity.dxf.radius
              a0 = np.deg2rad(entity.dxf.start_angle)
              a1 = np.deg2rad(entity.dxf.end_angle)
              if a1 < a0:
                  a1 += 2 * np.pi
              theta = np.linspace(a0, a1, 32)
              ax.plot(c.x + r * np.cos(theta), c.y + r * np.sin(theta), color="black", linewidth=0.5)
      except Exception:
          return


  def _safe_filename(name: str) -> str:
      return re.sub(r"[^A-Za-z0-9_\-]", "_", name) or "sheet"
  ```

- [ ] **0.14 Create `sidecar/tests/test_dxf_sheet_renderer.py`**:

  ```python
  from pathlib import Path
  import pytest
  from app.dxf_explorer import explore_dxf
  from app.dxf_sheet_renderer import render_sheets, DOT_CAP_PER_SHEET

  FIXTURE = Path(__file__).parent / "fixtures" / "small_test.dxf"


  def test_renders_one_png_per_bboxed_block(tmp_path):
      exploration = explore_dxf(FIXTURE)
      results = render_sheets(FIXTURE, exploration, tmp_path)
      bboxed = [b for b in exploration["blocks"] if b.get("bbox")]
      assert len(results) == len(bboxed)
      for r in results:
          assert Path(r["png_uri"]).exists()
          assert Path(r["png_uri"]).stat().st_size > 0

  def test_dot_count_respects_cap(tmp_path):
      exploration = explore_dxf(FIXTURE)
      results = render_sheets(FIXTURE, exploration, tmp_path)
      for r in results:
          assert r["dot_count"] <= DOT_CAP_PER_SHEET

  def test_dot_ordering_derived_from_exploration_samples(tmp_path, monkeypatch):
      # Spy: any ezdxf iteration over text entities in the renderer would be a bug.
      # We assert render_sheets NEVER needs doc.modelspace().query('TEXT MTEXT ATTRIB ATTDEF')
      # by monkeypatching that query and failing if called.
      import ezdxf
      original_readfile = ezdxf.readfile

      def guarded_readfile(path):
          doc = original_readfile(path)
          msp = doc.modelspace()
          orig_query = msp.query

          def guarded_query(q: str):
              if any(t in q.upper() for t in ("TEXT", "MTEXT", "ATTRIB", "ATTDEF")):
                  raise AssertionError(f"Renderer must not re-enumerate text entities (query={q!r})")
              return orig_query(q)
          msp.query = guarded_query
          return doc

      monkeypatch.setattr(ezdxf, "readfile", guarded_readfile)
      exploration = explore_dxf(FIXTURE)
      render_sheets(FIXTURE, exploration, tmp_path)  # must not raise
  ```

- [ ] **0.15 Run:** `pytest -q sidecar/tests/test_dxf_sheet_renderer.py` → green.

- [ ] **0.16 Commit:**

  ```bash
  cd sidecar
  git add app/dxf_sheet_renderer.py tests/test_dxf_sheet_renderer.py requirements.txt
  git commit -m "feat(renderer): dxf_sheet_renderer.py with dot-number invariant + density policy"
  ```

  (Add `matplotlib>=3.8` to `requirements.txt` as part of this commit.)

- [ ] **0.17 Add `/render-thumbnails` endpoint in `sidecar/app/main.py`**:

  ```python
  from app.dxf_sheet_renderer import render_sheets

  class RenderThumbnailsBody(BaseModel):
      stored_file_uri: str
      exploration_json: dict[str, Any]
      thumbnail_dir: str

  class RenderThumbnailsResponse(BaseModel):
      thumbnails: list[dict[str, Any]]
      ms: int

  @app.post("/render-thumbnails", response_model=RenderThumbnailsResponse)
  async def render_thumbnails_endpoint(body: RenderThumbnailsBody, request: Request) -> RenderThumbnailsResponse:
      req_id = request.headers.get("x-request-id", "")
      t0 = time.monotonic()
      dxf_path = _resolve_upload_path(body.stored_file_uri)
      thumb_dir = _resolve_upload_path(body.thumbnail_dir)
      thumbs = render_sheets(dxf_path, body.exploration_json, thumb_dir)
      ms = int((time.monotonic() - t0) * 1000)
      log.info("render_thumbnails.ok", req_id=req_id, sheet_count=len(thumbs), ms=ms)
      return RenderThumbnailsResponse(thumbnails=thumbs, ms=ms)
  ```

  Use the existing `_resolve_upload_path` helper (from phase 4a) to sandbox paths under `DEV_UPLOADS_ROOT`.

- [ ] **0.18 Create `sidecar/tests/test_render_thumbnails_endpoint.py`**:

  ```python
  from pathlib import Path
  from fastapi.testclient import TestClient
  from app.main import app
  from app.dxf_explorer import explore_dxf

  client = TestClient(app)
  FIXTURE = Path(__file__).parent / "fixtures" / "small_test.dxf"


  def test_render_thumbnails_endpoint_emits_pngs(tmp_uploads):
      # tmp_uploads fixture (from conftest.py) must point DEV_UPLOADS_ROOT at a tmp dir
      # and copy the fixture DXF into <tmp>/dxf/small_test.dxf.
      exploration = explore_dxf(FIXTURE)
      resp = client.post(
          "/render-thumbnails",
          json={
              "stored_file_uri": "dxf/small_test.dxf",
              "exploration_json": exploration,
              "thumbnail_dir": "tmp/thumbnails/test/",
          },
      )
      assert resp.status_code == 200
      data = resp.json()
      assert "thumbnails" in data
      for t in data["thumbnails"]:
          assert Path(tmp_uploads, t["png_uri"].lstrip("/")).exists()
  ```

  If `conftest.py` doesn't already have a `tmp_uploads` fixture, add one that (a) sets `DEV_UPLOADS_ROOT` env var to a tmp path, (b) creates `dxf/` + `tmp/thumbnails/` subdirs, (c) copies `small_test.dxf` into `dxf/`. Match the phase-4a `tmp_uploads` pattern if it exists there.

- [ ] **0.19 Run:** `pytest -q sidecar/tests/test_render_thumbnails_endpoint.py` → green.

- [ ] **0.20 Commit:**

  ```bash
  cd sidecar
  git add app/main.py tests/test_render_thumbnails_endpoint.py tests/conftest.py
  git commit -m "feat(sidecar): POST /render-thumbnails endpoint"
  ```

- [ ] **0.21 Add `/execute` endpoint in `sidecar/app/main.py`**. Runs the AI-generated script as a subprocess; returns either `{ok: true, ...}` or `{ok: false, traceback}` (both HTTP 200).

  ```python
  import asyncio
  import json
  import os

  class ExecuteBody(BaseModel):
      stored_file_uri: str
      script_uri: str
      output_dir: str

  @app.post("/execute")
  async def execute_endpoint(body: ExecuteBody, request: Request) -> dict[str, Any]:
      req_id = request.headers.get("x-request-id", "")
      t0 = time.monotonic()
      dxf_path = _resolve_upload_path(body.stored_file_uri)
      script_path = _resolve_upload_path(body.script_uri)
      out_dir = _resolve_upload_path(body.output_dir)
      out_dir.mkdir(parents=True, exist_ok=True)

      proc = await asyncio.create_subprocess_exec(
          "python3", str(script_path), str(dxf_path), str(out_dir),
          stdout=asyncio.subprocess.PIPE,
          stderr=asyncio.subprocess.PIPE,
          env={**os.environ, "PYTHONUNBUFFERED": "1"},
      )
      try:
          stdout_b, stderr_b = await asyncio.wait_for(proc.communicate(), timeout=110.0)
      except asyncio.TimeoutError:
          proc.kill()
          ms = int((time.monotonic() - t0) * 1000)
          return {"ok": False, "traceback": "timeout after 110s", "ms": ms}

      ms = int((time.monotonic() - t0) * 1000)
      stderr_s = stderr_b.decode("utf-8", errors="replace")
      stdout_s = stdout_b.decode("utf-8", errors="replace")

      if proc.returncode != 0:
          log.warning("execute.crash", req_id=req_id, returncode=proc.returncode, ms=ms)
          return {"ok": False, "traceback": stderr_s[-4000:], "ms": ms}

      try:
          payload = json.loads(stdout_s)
      except json.JSONDecodeError as e:
          return {"ok": False, "traceback": f"malformed stdout: {e}\n{stdout_s[:4000]}", "ms": ms}

      # Validate + annotate renders with size + warning
      renders = payload.get("renders", [])
      for r in renders:
          abs_render = _resolve_upload_path(r["filename"]) if not Path(r["filename"]).is_absolute() else Path(r["filename"])
          if not abs_render.exists():
              return {"ok": False, "traceback": f"render missing: {r['filename']}", "ms": ms}
          size = abs_render.stat().st_size
          r["size_bytes"] = size
          if size < 20_000:
              r["svg_warning"] = f"underfilled: {size // 1024}KB"
      log.info("execute.ok", req_id=req_id, sheet_count=len(renders), ms=ms)
      return {"ok": True, "complianceData": payload.get("complianceData", {}), "renders": renders, "ms": ms}
  ```

- [ ] **0.22 Create `sidecar/tests/test_execute_endpoint.py`** with three cases: success, script-crash, malformed-stdout. Use a tiny fixture script file (write it from the test):

  ```python
  import json
  from pathlib import Path
  from fastapi.testclient import TestClient
  from app.main import app

  client = TestClient(app)


  def _write_script(tmp_path, body: str) -> str:
      script = tmp_path / "scripts" / "fake_extract.py"
      script.parent.mkdir(parents=True, exist_ok=True)
      script.write_text(body)
      return "scripts/fake_extract.py"

  def test_execute_ok(tmp_uploads, tmp_path_factory):
      # Script writes a tiny SVG and prints a minimal compliance JSON
      script_body = '''
  import json, sys, pathlib
  _, dxf_path, out_dir = sys.argv
  out = pathlib.Path(out_dir)
  out.mkdir(parents=True, exist_ok=True)
  (out / "render_01.svg").write_text("<svg>" + "x"*30000 + "</svg>")
  print(json.dumps({"complianceData": {"setbacks": {}}, "renders": [{"filename": str(out/"render_01.svg"), "sheetIndex": 1, "displayName": "s1", "classification": "UNCLASSIFIED"}]}))
  '''
      script_uri = _write_script(tmp_uploads, script_body)
      resp = client.post("/execute", json={
          "stored_file_uri": "dxf/small_test.dxf",
          "script_uri": script_uri,
          "output_dir": "renders/test/",
      })
      assert resp.status_code == 200
      data = resp.json()
      assert data["ok"] is True
      assert data["complianceData"] == {"setbacks": {}}
      assert data["renders"][0]["size_bytes"] > 20_000

  def test_execute_script_crash(tmp_uploads):
      script_uri = _write_script(tmp_uploads, "raise RuntimeError('boom')\n")
      resp = client.post("/execute", json={
          "stored_file_uri": "dxf/small_test.dxf",
          "script_uri": script_uri,
          "output_dir": "renders/test/",
      })
      assert resp.status_code == 200
      data = resp.json()
      assert data["ok"] is False
      assert "RuntimeError" in data["traceback"]

  def test_execute_malformed_stdout(tmp_uploads):
      script_uri = _write_script(tmp_uploads, "print('not json at all')\n")
      resp = client.post("/execute", json={
          "stored_file_uri": "dxf/small_test.dxf",
          "script_uri": script_uri,
          "output_dir": "renders/test/",
      })
      assert resp.status_code == 200
      data = resp.json()
      assert data["ok"] is False
      assert "malformed stdout" in data["traceback"]
  ```

- [ ] **0.23 Run:** `pytest -q sidecar/tests/test_execute_endpoint.py` → green.

- [ ] **0.24 Update sidecar `Dockerfile`** — install matplotlib's system deps (fonts + libpng). Add before the app-copy stage:

  ```dockerfile
  RUN apt-get update && apt-get install -y --no-install-recommends \
        libfreetype6 libpng16-16 fonts-dejavu-core \
      && rm -rf /var/lib/apt/lists/*
  ```

  Run `docker build -t clearance-sidecar ./sidecar` → green.

- [ ] **0.25 Run the full sidecar suite:** `cd sidecar && pytest -q && ruff check .` → green.

- [ ] **0.26 Commit:**

  ```bash
  cd sidecar
  git add app/main.py tests/test_execute_endpoint.py Dockerfile
  git commit -m "feat(sidecar): POST /execute endpoint + dockerfile matplotlib deps"
  ```

- [ ] **0.27 Push sidecar branch + open PR:**

  ```bash
  cd sidecar
  git push -u origin feat/buildcheck-phase-4b
  gh pr create --title "feat: phase 4b — explorer rewrite + renderer + /render-thumbnails + /execute" \
    --body "$(cat <<'EOF'
  ## Summary
  - Explorer now emits `{raw, decoded?, x, y, block, handle, layer, entity_type}` samples across `TEXT|MTEXT|ATTRIB|ATTDEF`, cap 30→50
  - New encoding-signal flags per block: `has_unicode_escapes | has_native_hebrew | has_possible_shx | has_high_bytes`
  - Dual-viewport detection demoted to `hints.dual_viewport_pairs`; added `hints.dimension_unit_guess`
  - New `dxf_sheet_renderer.py` with dot-number invariant (dot `N` ↔ `text_samples[N-1]`) + density policy (non-numeric first, dedup, cap 100)
  - New endpoints: `POST /render-thumbnails` (called on cache miss only), `POST /execute` (runs generated script subprocess)
  - Dockerfile: add matplotlib system deps

  ## Test plan
  - [ ] `pytest -q` green
  - [ ] `ruff check .` green
  - [ ] `docker build -t clearance-sidecar .` green

  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  EOF
  )"
  cd -
  ```

---

## Cluster 1 — Server: Prisma migration (ExtractionScript + DxfFile.complianceData + data migration)

Directory: `server/` (branch `feat/buildcheck-phase-4b`).

**Files:**
- Modify: `server/prisma/schema.prisma`
- Generated: `server/prisma/migrations/<ts>_phase_4b_extraction_script/migration.sql`

### Steps

- [ ] **1.1 Add `complianceData` field to `DxfFile`** in `server/prisma/schema.prisma`:

  ```prisma
  model DxfFile {
    id                 String           @id @default(cuid())
    projectId          String
    project            Project          @relation(fields: [projectId], references: [id], onDelete: Cascade)
    storedFileId       String           @unique
    storedFile         StoredFile       @relation(fields: [storedFileId], references: [id])

    extractionStatus   ExtractionStatus @default(PENDING)
    extractionError    String?
    extractionJobId    String?

    explorationJson    Json?
    structuralHash     String?
    complianceData     Json?            // NEW — v3.1 extractor output (§3.4)
    extractionTrace    Json?

    deletedAt          DateTime?
    createdAt          DateTime         @default(now())

    @@index([projectId, createdAt])
    @@index([structuralHash])
  }
  ```

- [ ] **1.2 Add `ExtractionScript` model** after `DxfFile`:

  ```prisma
  model ExtractionScript {
    id                 String     @id @default(cuid())
    structuralHash     String
    storedFileId       String     @unique
    storedFile         StoredFile @relation(fields: [storedFileId], references: [id])

    generatedByModel   String
    generationCostUsd  Decimal    @db.Decimal(10, 4)
    generationMs       Int
    fixedFromScriptId  String?
    createdAt          DateTime   @default(now())

    @@index([structuralHash, createdAt])
  }
  ```

- [ ] **1.3 Add back-relation on `StoredFile`**:

  ```prisma
  model StoredFile {
    // ... existing fields ...
    dxfFile           DxfFile?
    extractionScript  ExtractionScript?    // NEW

    @@index([sha256])
  }
  ```

- [ ] **1.4 Generate and apply migration:**

  ```bash
  cd server
  npx prisma migrate dev --name phase_4b_extraction_script
  ```

  Expected: new migration file created under `prisma/migrations/<ts>_phase_4b_extraction_script/`. Prisma client regenerates automatically.

- [ ] **1.5 Verify generated SQL** contains (a) `ALTER TABLE "DxfFile" ADD COLUMN "complianceData" JSONB`, (b) `CREATE TABLE "ExtractionScript"`, (c) index on `(structuralHash, createdAt)`.

- [ ] **1.6 Append a data-migration statement** to the generated `migration.sql` (same migration, same transaction). This enforces the re-explore policy from spec §2.20:

  ```sql
  -- Phase 4b data migration: null old explorationJson on non-COMPLETED rows so
  -- they re-run through the v3.1 explorer (raw+decoded samples + encoding flags).
  UPDATE "DxfFile"
  SET "explorationJson" = NULL,
      "structuralHash" = NULL
  WHERE "extractionStatus" <> 'COMPLETED';
  ```

- [ ] **1.7 Re-apply the migration** to pick up the appended SQL:

  ```bash
  npx prisma migrate reset --force --skip-seed
  npx prisma migrate dev
  ```

  (`reset` drops the local dev DB and re-applies all migrations from scratch so the appended SQL runs. In production the migration hasn't been deployed yet; when it is, the data migration runs as part of the single migration transaction.)

- [ ] **1.8 Update `src/test-helpers/db.ts`** — add `await prisma.extractionScript.deleteMany({})` **before** `dxfFile.deleteMany` in the test-cleanup order.

- [ ] **1.9 Typecheck:** `npm run typecheck` → green.

- [ ] **1.10 Commit:**

  ```bash
  cd server
  git add prisma/schema.prisma prisma/migrations src/test-helpers/db.ts
  git commit -m "feat(db): phase 4b — ExtractionScript + DxfFile.complianceData + re-explore data migration"
  ```

---

## Cluster 2 — Server: integration clients

**Files:**
- Modify: `server/src/integrations/python-sidecar.client.ts`
- Modify: `server/src/integrations/python-sidecar.client.test.ts`
- Modify: `server/src/integrations/storage.client.ts` — add `saveBuffer` + `readText` + `removeDirIfExists`
- Create: `server/src/integrations/storage.client.test.ts` (if not present)
- Create: `server/src/integrations/anthropic.client.ts`
- Create: `server/src/integrations/anthropic.client.test.ts`
- Modify: `server/src/utils/env.ts` — add `ANTHROPIC_API_KEY`
- Modify: `server/package.json` — add `@anthropic-ai/sdk`

### Steps

- [ ] **2.1 Extend `python-sidecar.client.ts`** with two new methods. Keep the interface append-only so existing callers stay green:

  ```typescript
  import axios, { type AxiosInstance } from 'axios';
  import env from '../utils/env';

  export interface ExploreResult {
      explorationJson: unknown;
      structuralHash: string;
      ms: number;
  }

  export interface ThumbnailRef {
      sheetKey: string;
      pngUri: string;
      dotCount: number;
  }

  export interface RenderThumbnailsResult {
      thumbnails: ThumbnailRef[];
      ms: number;
  }

  export interface ExecuteRender {
      filename: string;
      sheetIndex: number;
      displayName: string;
      classification: string;
      geometryBlock?: string;
      annotationBlock?: string;
      sizeBytes: number;
      svgWarning?: string;
  }

  export type ExecuteResult =
      | { ok: true; complianceData: Record<string, unknown>; renders: ExecuteRender[]; ms: number }
      | { ok: false; traceback: string; ms: number };

  export interface PythonSidecarClient {
      explore(opts: { storedFileUri: string; reqId: string }): Promise<ExploreResult>;
      renderThumbnails(opts: { storedFileUri: string; explorationJson: unknown; thumbnailDir: string; reqId: string }): Promise<RenderThumbnailsResult>;
      execute(opts: { storedFileUri: string; scriptUri: string; outputDir: string; reqId: string }): Promise<ExecuteResult>;
  }

  export class HttpPythonSidecarClient implements PythonSidecarClient {
      private readonly http: AxiosInstance;

      constructor(baseURL: string) {
          this.http = axios.create({ baseURL, timeout: 130_000 }); // > /execute 120s
      }

      async explore(opts: { storedFileUri: string; reqId: string }): Promise<ExploreResult> {
          const res = await this.http.post<{ exploration_json: unknown; structural_hash: string; ms: number }>(
              '/explore',
              { stored_file_uri: opts.storedFileUri },
              { headers: { 'X-Request-Id': opts.reqId } },
          );
          return { explorationJson: res.data.exploration_json, structuralHash: res.data.structural_hash, ms: res.data.ms };
      }

      async renderThumbnails(opts: { storedFileUri: string; explorationJson: unknown; thumbnailDir: string; reqId: string }): Promise<RenderThumbnailsResult> {
          const res = await this.http.post<{ thumbnails: Array<{ sheet_key: string; png_uri: string; dot_count: number }>; ms: number }>(
              '/render-thumbnails',
              { stored_file_uri: opts.storedFileUri, exploration_json: opts.explorationJson, thumbnail_dir: opts.thumbnailDir },
              { headers: { 'X-Request-Id': opts.reqId } },
          );
          return {
              thumbnails: res.data.thumbnails.map(t => ({ sheetKey: t.sheet_key, pngUri: t.png_uri, dotCount: t.dot_count })),
              ms: res.data.ms,
          };
      }

      async execute(opts: { storedFileUri: string; scriptUri: string; outputDir: string; reqId: string }): Promise<ExecuteResult> {
          const res = await this.http.post<
              | { ok: true; complianceData: Record<string, unknown>; renders: Array<Record<string, unknown>>; ms: number }
              | { ok: false; traceback: string; ms: number }
          >(
              '/execute',
              { stored_file_uri: opts.storedFileUri, script_uri: opts.scriptUri, output_dir: opts.outputDir },
              { headers: { 'X-Request-Id': opts.reqId } },
          );
          if (!res.data.ok) return res.data;
          return {
              ok: true,
              complianceData: res.data.complianceData,
              renders: res.data.renders.map(r => ({
                  filename: String(r.filename),
                  sheetIndex: Number(r.sheetIndex),
                  displayName: String(r.displayName),
                  classification: String(r.classification ?? 'UNCLASSIFIED'),
                  geometryBlock: r.geometryBlock as string | undefined,
                  annotationBlock: r.annotationBlock as string | undefined,
                  sizeBytes: Number(r.size_bytes ?? r.sizeBytes ?? 0),
                  svgWarning: (r.svg_warning ?? r.svgWarning) as string | undefined,
              })),
              ms: res.data.ms,
          };
      }
  }

  export const sidecar: PythonSidecarClient = new HttpPythonSidecarClient(env.PYTHON_SIDECAR_URL);
  ```

- [ ] **2.2 Extend `python-sidecar.client.test.ts`** — add tests for `renderThumbnails` + `execute` (both ok + crash branches). Mock axios; assert URL + headers + body shape; assert the snake_case→camelCase mapping of the `execute` response.

  ```typescript
  import { HttpPythonSidecarClient } from './python-sidecar.client';
  import axios from 'axios';
  jest.mock('axios');
  const mockedAxios = axios as jest.Mocked<typeof axios>;

  describe('renderThumbnails', () => {
    it('posts to /render-thumbnails with snake_case body and maps response to camelCase', async () => {
      const post = jest.fn().mockResolvedValue({ data: { thumbnails: [{ sheet_key: 'VP1', png_uri: 'tmp/a.png', dot_count: 42 }], ms: 8123 } });
      mockedAxios.create.mockReturnValue({ post } as any);
      const client = new HttpPythonSidecarClient('http://x');
      const r = await client.renderThumbnails({ storedFileUri: 'u', explorationJson: {}, thumbnailDir: 'd', reqId: 'r' });
      expect(post).toHaveBeenCalledWith('/render-thumbnails', { stored_file_uri: 'u', exploration_json: {}, thumbnail_dir: 'd' }, { headers: { 'X-Request-Id': 'r' } });
      expect(r.thumbnails[0]).toEqual({ sheetKey: 'VP1', pngUri: 'tmp/a.png', dotCount: 42 });
      expect(r.ms).toBe(8123);
    });
  });

  describe('execute', () => {
    it('returns { ok: true, ... } on success with render fields normalized', async () => {
      const post = jest.fn().mockResolvedValue({ data: { ok: true, complianceData: { setbacks: {} }, renders: [{ filename: 'render_01.svg', sheetIndex: 1, displayName: 's1', classification: 'FLOOR_PLAN', size_bytes: 30000 }], ms: 4100 } });
      mockedAxios.create.mockReturnValue({ post } as any);
      const client = new HttpPythonSidecarClient('http://x');
      const r = await client.execute({ storedFileUri: 'u', scriptUri: 's', outputDir: 'o', reqId: 'r' });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.renders[0].sizeBytes).toBe(30000);
        expect(r.renders[0].classification).toBe('FLOOR_PLAN');
      }
    });

    it('returns { ok: false, traceback } on script crash', async () => {
      const post = jest.fn().mockResolvedValue({ data: { ok: false, traceback: 'RuntimeError: boom', ms: 3200 } });
      mockedAxios.create.mockReturnValue({ post } as any);
      const client = new HttpPythonSidecarClient('http://x');
      const r = await client.execute({ storedFileUri: 'u', scriptUri: 's', outputDir: 'o', reqId: 'r' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.traceback).toContain('RuntimeError');
    });
  });
  ```

- [ ] **2.3 Run:** `cd server && npm test -- python-sidecar.client` → green.

- [ ] **2.4 Extend `storage.client.ts`** with three new methods needed by the handler:

  ```typescript
  import { writeFile, readFile, rm } from 'node:fs/promises';
  // (add to the existing imports)

  export interface StorageClient {
      // ... existing methods ...
      saveBuffer(kind: FileKind, filename: string, data: Buffer): Promise<{ uri: string; sha256: string; sizeBytes: number }>;
      readText(uri: string): Promise<string>;
      removeDirIfExists(uri: string): Promise<void>;
  }

  // Inside LocalStorageClient:
  async saveBuffer(kind: FileKind, filename: string, data: Buffer): Promise<{ uri: string; sha256: string; sizeBytes: number }> {
      const uri = this.resolveUri(kind, filename);
      const abs = this.absolute(uri);
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, data);
      const sha256 = createHash('sha256').update(data).digest('hex');
      return { uri, sha256, sizeBytes: data.byteLength };
  }

  async readText(uri: string): Promise<string> {
      return (await readFile(this.absolute(uri))).toString('utf-8');
  }

  async removeDirIfExists(uri: string): Promise<void> {
      const abs = this.absolute(uri);
      await rm(abs, { recursive: true, force: true });
  }
  ```

  Add `createHash` import: `import { createHash } from 'node:crypto';`.

- [ ] **2.5 Add unit tests for storage extensions** — if `storage.client.test.ts` doesn't exist, create it:

  ```typescript
  import { storage } from './storage.client';

  describe('storage.saveBuffer', () => {
    it('writes the buffer and returns a stable sha256', async () => {
      const payload = Buffer.from('print("hello")\n', 'utf-8');
      const result = await storage.saveBuffer('EXTRACTION_SCRIPT', 'test-script.py', payload);
      expect(result.sizeBytes).toBe(payload.byteLength);
      expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
      const readBack = await storage.readText(result.uri);
      expect(readBack).toBe('print("hello")\n');
    });
  });

  describe('storage.removeDirIfExists', () => {
    it('is idempotent on missing paths', async () => {
      await expect(storage.removeDirIfExists('nonexistent/dir/' + Date.now())).resolves.toBeUndefined();
    });
  });
  ```

- [ ] **2.6 Run:** `npm test -- storage.client` → green. Commit:

  ```bash
  git add src/integrations/python-sidecar.client.ts src/integrations/python-sidecar.client.test.ts src/integrations/storage.client.ts src/integrations/storage.client.test.ts
  git commit -m "feat(integrations): sidecar renderThumbnails+execute; storage saveBuffer+readText+removeDir"
  ```

- [ ] **2.7 Install SDK:** `cd server && npm install @anthropic-ai/sdk`. Commit the `package.json` + lock update separately:

  ```bash
  git add package.json package-lock.json
  git commit -m "chore(deps): add @anthropic-ai/sdk for phase 4b codegen"
  ```

- [ ] **2.8 Add env var** in `src/utils/env.ts`:

  ```typescript
  ANTHROPIC_API_KEY: z.string().min(10, 'ANTHROPIC_API_KEY required'),
  ```

  Update `.env.example` with a placeholder `ANTHROPIC_API_KEY=sk-ant-...`.

- [ ] **2.9 Create `server/src/integrations/anthropic.client.ts`**. One choke-point for all Anthropic calls; exports `generateExtractionScript` + `fixExtractionScript` + the system-prompt constant.

  ```typescript
  import Anthropic from '@anthropic-ai/sdk';
  import { readFile } from 'node:fs/promises';
  import path from 'node:path';
  import env from '../utils/env';
  import logger from '../config/logger';

  const CODEGEN_MODEL = 'claude-opus-4-7';
  const CODEGEN_MAX_TOKENS = 16000;

  /**
   * Visual-bridge codegen system prompt. Describes the contract and the
   * visual-bridge protocol ONLY — no hardcoded Hebrew keyword tables, no
   * dual-viewport bbox-overlap heuristic, no spatial-correlation prose.
   * See spec §7.4.
   */
  export const EXTRACTION_CODEGEN_SYSTEM_PROMPT = `You generate a Python extraction script for a single Israeli building-permit DXF file.

  INPUTS YOU WILL RECEIVE
  - explorationJson: structural fingerprint of the DXF. Each block has an ORDERED text_samples list with {raw, decoded?, x, y, block, handle, layer, entityType}. raw is byte-exact ezdxf output — the file may store Hebrew as Unicode escapes, UTF-8, SHX Latin substitution (e.g. "eu cbhhi" = "קו בניין"), or a CP862/Win-1255 code page. decoded is a best-effort hint only — nullable and may be wrong for SHX files. Encoding flags per block: has_unicode_escapes | has_native_hebrew | has_possible_shx | has_high_bytes.
  - One PNG thumbnail per sheet: geometry in black, numbered red dots at text positions. Dot N in the PNG corresponds to text_samples[N-1] of that sheet (globally indexed after density-cap). You use the dots to decide what each raw string MEANS for THIS file.

  VISUAL-BRIDGE PROTOCOL
  1. Classify each sheet from its thumbnail (floor plan / elevation / cross-section / parking / survey / site plan / roof plan / index page / area calculation / unclassified).
  2. Look at dots on top of recognizable features (building edges, plot boundaries, room centers, dimension chains). Map each recognized dot back to text_samples[N-1].raw. That raw string IS this file's label for that feature. Record the raw form — never a decoded Hebrew literal.

  REQUIRED OUTPUT: a complete Python script (no fence, no commentary, no markdown). The script reads sys.argv[1] (dxf path) and sys.argv[2] (output directory), prints a JSON object to stdout with keys complianceData and renders, and writes one SVG per sheet to the output directory.

  The script MUST begin with a LABELS dict mapping semantic names to raw strings from THIS file:

      LABELS = {
          "building_line":  "<raw from text_samples>",   # e.g. "eu cbhhi"
          "plot_boundary":  "<raw from text_samples>",
          "kitchen":        "<raw from text_samples>",
          # ... only the labels needed for the schema below
      }

  All label matching MUST use LABELS (text.strip() == LABELS["building_line"], or "in" for substring). DO NOT write hardcoded Hebrew literals. Numbers are ASCII — match with regex directly.

  complianceData schema (omit any key with no data — do not invent placeholders):
    setbacks          object: {front, rear, left, right}, each {value_m: float, evidence: {sheet_key, dot_numbers: int[]}}
    heights           object: {ground_level, floors[], roof, parapet, max_height} with values in meters
    dimensions        object: {building_envelope: {width_m, depth_m}, dimension_chains[]}
    parking           object: {bay_count, bay_dimensions[], covered_count, uncovered_count}
    survey            object: {terrain_elevations[], boundary_edges[], curve_radii[]}
    labelCorrelations array of {label: string (semantic name), raw: string, sheet_key: string, dot_number: int}

  renders schema (one entry per sheet):
    {filename: "render_NN.svg", sheetIndex: int (1-based), displayName: string (Hebrew if decodable from exploration, else raw), classification: string (enum above), geometryBlock?: string, annotationBlock?: string}

  SVG RENDERING CONTRACT
  - Y-axis flip (DXF Y-up to SVG Y-down).
  - bounding-box fit with 5% margin.
  - stroke width scaled to diagonal/800.
  - Use ACI color table for entity stroke colors (default ACI 7 = black).
  - Text elements emitted as <text> with original raw content.

  OUTPUT CONSTRAINT: your entire response must be the Python script. No preamble, no postscript, no code fence.`;

  export interface ThumbnailInput {
      sheetKey: string;
      pngPath: string; // absolute path on disk
  }

  export interface CodegenResult {
      code: string;
      costUsd: number;
      ms: number;
  }

  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  // Opus 4.7 list pricing at v1 (USD per million tokens). Keep this constant
  // in one place so we update both generate + fix callers together.
  const OPUS_INPUT_USD_PER_MTOK = 15.0;
  const OPUS_OUTPUT_USD_PER_MTOK = 75.0;
  const OPUS_CACHE_READ_USD_PER_MTOK = 1.5;

  export async function generateExtractionScript(opts: {
      explorationJson: unknown;
      thumbnails: ThumbnailInput[];
      reqId: string;
  }): Promise<CodegenResult> {
      const t0 = Date.now();
      const imageBlocks = await Promise.all(
          opts.thumbnails.map(async t => ({
              type: 'image' as const,
              source: {
                  type: 'base64' as const,
                  media_type: 'image/png' as const,
                  data: (await readFile(t.pngPath)).toString('base64'),
              },
          })),
      );
      const userContent = [
          { type: 'text' as const, text: `sheet index:\n${opts.thumbnails.map((t, i) => `${i + 1}. ${t.sheetKey}`).join('\n')}\n\nexplorationJson:\n${JSON.stringify(opts.explorationJson)}` },
          ...imageBlocks,
      ];
      const resp = await anthropic.messages.create({
          model: CODEGEN_MODEL,
          max_tokens: CODEGEN_MAX_TOKENS,
          system: EXTRACTION_CODEGEN_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userContent }],
      });
      const ms = Date.now() - t0;
      const code = resp.content.map(b => (b.type === 'text' ? b.text : '')).join('').trim();
      const costUsd = computeCost(resp.usage);
      logger.info('anthropic.codegen.ok', {
          reqId: opts.reqId,
          model: CODEGEN_MODEL,
          inputTokens: resp.usage.input_tokens,
          outputTokens: resp.usage.output_tokens,
          ms,
          costUsd,
      });
      return { code, costUsd, ms };
  }

  export async function fixExtractionScript(opts: {
      explorationJson: unknown;
      brokenCode: string;
      traceback: string;
      reqId: string;
  }): Promise<CodegenResult> {
      const t0 = Date.now();
      const fixPrompt = `The previously generated extraction script crashed. Produce a minimal fix that preserves the rest of the script. DO NOT rewrite the LABELS dict unless the traceback directly implicates it.

  --- EXPLORATION JSON ---
  ${JSON.stringify(opts.explorationJson)}

  --- BROKEN SCRIPT ---
  ${opts.brokenCode}

  --- TRACEBACK ---
  ${opts.traceback.slice(-4000)}`;
      const resp = await anthropic.messages.create({
          model: CODEGEN_MODEL,
          max_tokens: CODEGEN_MAX_TOKENS,
          system: EXTRACTION_CODEGEN_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: fixPrompt }],
      });
      const ms = Date.now() - t0;
      const code = resp.content.map(b => (b.type === 'text' ? b.text : '')).join('').trim();
      const costUsd = computeCost(resp.usage);
      logger.info('anthropic.fix.ok', {
          reqId: opts.reqId,
          model: CODEGEN_MODEL,
          inputTokens: resp.usage.input_tokens,
          outputTokens: resp.usage.output_tokens,
          ms,
          costUsd,
      });
      return { code, costUsd, ms };
  }

  function computeCost(usage: Anthropic.Usage): number {
      const inputCost = (usage.input_tokens / 1_000_000) * OPUS_INPUT_USD_PER_MTOK;
      const outputCost = (usage.output_tokens / 1_000_000) * OPUS_OUTPUT_USD_PER_MTOK;
      const cacheRead = ((usage.cache_read_input_tokens ?? 0) / 1_000_000) * OPUS_CACHE_READ_USD_PER_MTOK;
      return Math.round((inputCost + outputCost + cacheRead) * 10_000) / 10_000;
  }
  ```

- [ ] **2.10 Create `server/src/integrations/anthropic.client.test.ts`**. Mock the SDK's `messages.create`; assert (a) the model name, (b) the system prompt is the exported constant, (c) multimodal content blocks are assembled correctly for `generateExtractionScript`, (d) `fixExtractionScript` is text-only (no image blocks), (e) cost calculation for a known usage shape.

  ```typescript
  import { generateExtractionScript, fixExtractionScript, EXTRACTION_CODEGEN_SYSTEM_PROMPT } from './anthropic.client';
  import { writeFile, mkdtemp } from 'node:fs/promises';
  import path from 'node:path';
  import os from 'node:os';

  jest.mock('@anthropic-ai/sdk', () => {
    const create = jest.fn();
    return { default: jest.fn().mockImplementation(() => ({ messages: { create } })) };
  });

  import Anthropic from '@anthropic-ai/sdk';
  const mockedCreate = (new (Anthropic as any)()).messages.create as jest.Mock;

  beforeEach(() => mockedCreate.mockReset());

  it('generateExtractionScript sends multimodal content with system prompt and Opus model', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ant-'));
    const pngPath = path.join(dir, 'sheet.png');
    await writeFile(pngPath, Buffer.from('fake-png-bytes'));
    mockedCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'print("hello")' }],
      usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0 },
    });
    const r = await generateExtractionScript({ explorationJson: { foo: 'bar' }, thumbnails: [{ sheetKey: 'VP1', pngPath }], reqId: 'r1' });
    expect(mockedCreate).toHaveBeenCalledTimes(1);
    const call = mockedCreate.mock.calls[0][0];
    expect(call.model).toBe('claude-opus-4-7');
    expect(call.system).toBe(EXTRACTION_CODEGEN_SYSTEM_PROMPT);
    const userContent = call.messages[0].content;
    expect(userContent[0].type).toBe('text');
    expect(userContent[1].type).toBe('image');
    expect(userContent[1].source.media_type).toBe('image/png');
    expect(r.code).toBe('print("hello")');
    expect(r.costUsd).toBeGreaterThan(0);
  });

  it('fixExtractionScript is text-only (no image blocks)', async () => {
    mockedCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'fixed code' }],
      usage: { input_tokens: 500, output_tokens: 300, cache_read_input_tokens: 0 },
    });
    await fixExtractionScript({ explorationJson: {}, brokenCode: 'bad', traceback: 'Traceback...', reqId: 'r2' });
    const call = mockedCreate.mock.calls[0][0];
    const userContent = call.messages[0].content;
    expect(typeof userContent).toBe('string');  // text-only prompt
  });
  ```

- [ ] **2.11 Run:** `npm test -- anthropic.client` → green.

- [ ] **2.12 Typecheck:** `npm run typecheck` → green.

- [ ] **2.13 Commit:**

  ```bash
  git add src/integrations/anthropic.client.ts src/integrations/anthropic.client.test.ts src/utils/env.ts .env.example
  git commit -m "feat(integrations): anthropic client (generateExtractionScript + fixExtractionScript)"
  ```

---

## Cluster 3 — Server: DXF_EXTRACTION handler full state machine

**Files:**
- Create: `server/src/api/data-access/extraction-script.da.ts`
- Create: `server/src/api/data-access/extraction-script.da.test.ts`
- Modify: `server/src/jobs/handlers/dxf-extraction.handler.ts`
- Modify: `server/src/jobs/handlers/dxf-extraction.handler.test.ts`

### Steps

- [ ] **3.1 Create data-access for `ExtractionScript`**:

  ```typescript
  // server/src/api/data-access/extraction-script.da.ts
  import prisma from '../../config/prisma';
  import type { ExtractionScript, StoredFile } from '../../generated/prisma/client';

  export type ExtractionScriptWithFile = ExtractionScript & { storedFile: StoredFile };

  export async function findLatestByHash(structuralHash: string): Promise<ExtractionScriptWithFile | null> {
      return prisma.extractionScript.findFirst({
          where: { structuralHash },
          orderBy: { createdAt: 'desc' },
          include: { storedFile: true },
      });
  }

  export interface CreateScriptInput {
      structuralHash: string;
      storedFileId: string;
      generatedByModel: string;
      generationCostUsd: number;
      generationMs: number;
      fixedFromScriptId?: string | null;
  }

  export async function createScript(input: CreateScriptInput): Promise<ExtractionScript> {
      return prisma.extractionScript.create({
          data: {
              structuralHash: input.structuralHash,
              storedFileId: input.storedFileId,
              generatedByModel: input.generatedByModel,
              generationCostUsd: input.generationCostUsd,
              generationMs: input.generationMs,
              fixedFromScriptId: input.fixedFromScriptId ?? null,
          },
      });
  }
  ```

- [ ] **3.2 Write data-access unit test** (`extraction-script.da.test.ts`) — standard Jest + prisma test pattern used elsewhere in the repo; asserts `findLatestByHash` returns newest by `createdAt DESC` when two rows share a hash. Use the existing `truncateAll` test helper.

- [ ] **3.3 Rewrite `dxf-extraction.handler.ts`** — full state machine per spec §7.3. Replace the file contents:

  ```typescript
  import { cuid } from '@paralleldrive/cuid2';
  import path from 'node:path';
  import prisma from '../../config/prisma';
  import logger from '../../config/logger';
  import { sidecar, type ExecuteResult } from '../../integrations/python-sidecar.client';
  import { generateExtractionScript, fixExtractionScript } from '../../integrations/anthropic.client';
  import { storage } from '../../integrations/storage.client';
  import { findLatestByHash, createScript } from '../../api/data-access/extraction-script.da';
  import env from '../../utils/env';
  import type { Job, Prisma } from '../../generated/prisma/client';

  const MAX_ATTEMPTS = 2;
  const CODEGEN_MODEL = 'claude-opus-4-7';

  type Phase =
      | { phase: 'explore'; ms: number }
      | { phase: 'render-thumbnails'; ms: number; sheetCount: number }
      | { phase: 'codegen'; ms: number; costUsd: number }
      | { phase: 'self-correct'; ms: number; costUsd: number }
      | { phase: 'execute'; attempt: number; ms: number; ok: boolean };

  interface Trace {
      cacheHit: boolean | null;
      attempts: number;
      phases: Phase[];
  }

  export async function dxfExtractionHandler(job: Job): Promise<void> {
      const dxfFileId = job.dxfFileId ?? (job.payload as { dxfFileId?: string } | null)?.dxfFileId;
      if (!dxfFileId) throw new Error('dxf-extraction: job missing dxfFileId');

      const dxf = await prisma.dxfFile.findUnique({
          where: { id: dxfFileId },
          include: { storedFile: true },
      });
      if (!dxf) throw new Error(`dxf-extraction: DxfFile ${dxfFileId} not found`);

      const reqId = `job:${job.id}`;
      const trace: Trace = { cacheHit: null, attempts: 0, phases: [] };
      const thumbnailDir = `tmp/thumbnails/${dxf.id}/`;

      await prisma.dxfFile.update({ where: { id: dxf.id }, data: { extractionStatus: 'EXTRACTING' } });

      try {
          // Phase 1 — explore
          const tExplore = Date.now();
          const { explorationJson, structuralHash } = await sidecar.explore({
              storedFileUri: dxf.storedFile.uri,
              reqId,
          });
          trace.phases.push({ phase: 'explore', ms: Date.now() - tExplore });

          // Phase 2 — cache lookup or codegen
          let script = await findLatestByHash(structuralHash);
          if (script) {
              trace.cacheHit = true;
              logger.info('dxf-extraction.cache-hit', { dxfFileId: dxf.id, structuralHash: structuralHash.slice(0, 12) });
          } else {
              trace.cacheHit = false;
              // Phase 1.5 — render thumbnails
              const tThumbs = Date.now();
              const { thumbnails } = await sidecar.renderThumbnails({
                  storedFileUri: dxf.storedFile.uri,
                  explorationJson,
                  thumbnailDir,
                  reqId,
              });
              trace.phases.push({ phase: 'render-thumbnails', ms: Date.now() - tThumbs, sheetCount: thumbnails.length });

              // Phase 2 — codegen
              const tCodegen = Date.now();
              const absThumbnails = thumbnails.map(t => ({
                  sheetKey: t.sheetKey,
                  pngPath: path.resolve(env.UPLOADS_DIR, t.pngUri),
              }));
              const { code, costUsd, ms } = await generateExtractionScript({
                  explorationJson,
                  thumbnails: absThumbnails,
                  reqId,
              });
              const saved = await storage.saveBuffer('EXTRACTION_SCRIPT', `extract_${cuid()}.py`, Buffer.from(code, 'utf-8'));
              const storedFile = await prisma.storedFile.create({
                  data: {
                      kind: 'EXTRACTION_SCRIPT',
                      uri: saved.uri,
                      sha256: saved.sha256,
                      sizeBytes: saved.sizeBytes,
                      originalName: path.basename(saved.uri),
                  },
              });
              await createScript({
                  structuralHash,
                  storedFileId: storedFile.id,
                  generatedByModel: CODEGEN_MODEL,
                  generationCostUsd: costUsd,
                  generationMs: ms,
              });
              script = await findLatestByHash(structuralHash);
              if (!script) throw new Error('dxf-extraction: script cache invariant violated');
              trace.phases.push({ phase: 'codegen', ms: Date.now() - tCodegen, costUsd });
          }

          // Phase 3+4 — execute, self-correct once on crash
          const outputDir = `renders/${dxf.id}/`;
          let result: ExecuteResult | null = null;
          for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
              trace.attempts = attempt;
              const tExec = Date.now();
              result = await sidecar.execute({
                  storedFileUri: dxf.storedFile.uri,
                  scriptUri: script.storedFile.uri,
                  outputDir,
                  reqId,
              });
              trace.phases.push({ phase: 'execute', attempt, ms: Date.now() - tExec, ok: result.ok });
              if (result.ok) break;
              if (attempt === 1) {
                  const tFix = Date.now();
                  const brokenCode = await storage.readText(script.storedFile.uri);
                  const { code, costUsd, ms } = await fixExtractionScript({
                      explorationJson,
                      brokenCode,
                      traceback: result.traceback,
                      reqId,
                  });
                  const savedFix = await storage.saveBuffer('EXTRACTION_SCRIPT', `extract_${cuid()}.py`, Buffer.from(code, 'utf-8'));
                  const fixedFile = await prisma.storedFile.create({
                      data: {
                          kind: 'EXTRACTION_SCRIPT',
                          uri: savedFix.uri,
                          sha256: savedFix.sha256,
                          sizeBytes: savedFix.sizeBytes,
                          originalName: path.basename(savedFix.uri),
                      },
                  });
                  await createScript({
                      structuralHash,
                      storedFileId: fixedFile.id,
                      generatedByModel: CODEGEN_MODEL,
                      generationCostUsd: costUsd,
                      generationMs: ms,
                      fixedFromScriptId: script.id,
                  });
                  script = await findLatestByHash(structuralHash);
                  if (!script) throw new Error('dxf-extraction: script cache invariant violated after fix');
                  trace.phases.push({ phase: 'self-correct', ms: Date.now() - tFix, costUsd });
              }
          }

          if (!result || !result.ok) {
              const traceback = result && !result.ok ? result.traceback : 'unknown failure';
              await prisma.dxfFile.update({
                  where: { id: dxf.id },
                  data: {
                      extractionStatus: 'FAILED',
                      extractionError: traceback.slice(-2000),
                      extractionTrace: trace as unknown as Prisma.InputJsonValue,
                      structuralHash,
                      explorationJson: explorationJson as Prisma.InputJsonValue,
                  },
              });
              throw new Error('dxf-extraction: exhausted retries');
          }

          // Phase 5 — persist complianceData (SheetRender rows deferred to 4c)
          await prisma.dxfFile.update({
              where: { id: dxf.id },
              data: {
                  explorationJson: explorationJson as Prisma.InputJsonValue,
                  structuralHash,
                  complianceData: result.complianceData as Prisma.InputJsonValue,
                  extractionTrace: trace as unknown as Prisma.InputJsonValue,
                  extractionStatus: 'COMPLETED',
              },
          });
          logger.info('dxf-extraction.completed', {
              dxfFileId: dxf.id,
              structuralHash: structuralHash.slice(0, 12),
              cacheHit: trace.cacheHit,
              attempts: trace.attempts,
          });
      } finally {
          await storage.removeDirIfExists(thumbnailDir);
      }
  }
  ```

  Add `@paralleldrive/cuid2` as a dependency (already in the project from phase 2; check `package.json` and add if missing).

- [ ] **3.4 Update `dxf-extraction.handler.test.ts`** — rewrite tests for the state machine. Mock `sidecar` and the anthropic client. Cover four paths:

  1. **Cache hit:** `findLatestByHash` returns a script → assert `renderThumbnails` + `generateExtractionScript` were NEVER called, and `execute` ran once.
  2. **Cache miss, first execute succeeds:** `findLatestByHash` returns null → assert `renderThumbnails` ran, `generateExtractionScript` ran, `execute` ran once, `ExtractionScript` row created, `DxfFile.complianceData` populated.
  3. **Cache miss, first execute crashes, fix succeeds:** assert `fixExtractionScript` ran, a second `ExtractionScript` row exists with `fixedFromScriptId`, `execute` ran twice, `DxfFile.extractionStatus === COMPLETED`.
  4. **Both attempts crash:** assert final `extractionStatus === 'FAILED'`, `extractionError` populated from the last traceback, `complianceData` is null, and the handler throws.

  Also assert in case (2) and (3) that `storage.removeDirIfExists` was called with `tmp/thumbnails/<dxfFileId>/` in the `finally`, even on the throw path (case 4).

  Standard mocking sketch:

  ```typescript
  jest.mock('../../integrations/python-sidecar.client');
  jest.mock('../../integrations/anthropic.client');
  jest.mock('../../integrations/storage.client');
  jest.mock('../../api/data-access/extraction-script.da');
  ```

  Provide per-test `mockReturnValue` / `mockResolvedValue` for `sidecar.explore / renderThumbnails / execute`, `generateExtractionScript`, `fixExtractionScript`, `storage.saveBuffer / readText / removeDirIfExists`, and the DA functions. Snapshot the final `extractionTrace` shape (phases + attempts + cacheHit).

- [ ] **3.5 Run:** `npm test -- dxf-extraction.handler` → green. Verify all 4 paths exercised.

- [ ] **3.6 Typecheck:** `npm run typecheck` → green.

- [ ] **3.7 Commit:**

  ```bash
  git add src/api/data-access/extraction-script.da.ts src/api/data-access/extraction-script.da.test.ts src/jobs/handlers/dxf-extraction.handler.ts src/jobs/handlers/dxf-extraction.handler.test.ts
  git commit -m "feat(dxf): v3.1 full state machine — explore→cache→thumbs+codegen→execute→self-correct"
  ```

---

## Cluster 4 — Server: integration tests

**Files:**
- Create: `server/src/jobs/handlers/dxf-extraction.handler.integration.test.ts`

### Steps

- [ ] **4.1 Write an integration test that exercises the full pipeline against a stubbed sidecar + stubbed Anthropic**. The test boots the Node handler against a real DB but replaces HTTP-dependent integrations with in-process fakes that return canned responses. Goal: prove the state machine wires up correctly end-to-end.

  ```typescript
  // server/src/jobs/handlers/dxf-extraction.handler.integration.test.ts
  import prisma from '../../config/prisma';
  import { dxfExtractionHandler } from './dxf-extraction.handler';
  import { truncateAll } from '../../test-helpers/db';

  jest.mock('../../integrations/python-sidecar.client', () => ({
    sidecar: {
      explore: jest.fn(),
      renderThumbnails: jest.fn(),
      execute: jest.fn(),
    },
  }));
  jest.mock('../../integrations/anthropic.client', () => ({
    generateExtractionScript: jest.fn(),
    fixExtractionScript: jest.fn(),
    EXTRACTION_CODEGEN_SYSTEM_PROMPT: 'stub',
  }));
  jest.mock('../../integrations/storage.client', () => ({
    storage: {
      saveBuffer: jest.fn(async (_k, f) => ({ uri: `uploads/scripts/${f}`, sha256: 'f'.repeat(64), sizeBytes: 100 })),
      readText: jest.fn(async () => 'broken script'),
      removeDirIfExists: jest.fn(async () => {}),
    },
  }));

  import { sidecar } from '../../integrations/python-sidecar.client';
  import { generateExtractionScript, fixExtractionScript } from '../../integrations/anthropic.client';
  import { storage } from '../../integrations/storage.client';

  beforeEach(async () => {
    await truncateAll();
    jest.clearAllMocks();
  });

  async function seedDxf() {
    const user = await prisma.user.create({ data: { email: 'x@y', name: 'x', passwordHash: 'h', role: 'USER' } });
    const project = await prisma.project.create({ data: { ownerId: user.id, name: 'p' } });
    const storedFile = await prisma.storedFile.create({ data: { kind: 'DXF', uri: 'uploads/dxf/test.dxf', originalName: 'test.dxf', sha256: 'a'.repeat(64), sizeBytes: 1000 } });
    const dxf = await prisma.dxfFile.create({ data: { projectId: project.id, storedFileId: storedFile.id } });
    const job = await prisma.job.create({ data: { type: 'DXF_EXTRACTION', dxfFileId: dxf.id, status: 'PROCESSING' } });
    return { dxf, job };
  }

  it('cache-miss path: runs thumbnails+codegen, caches script, populates complianceData', async () => {
    (sidecar.explore as jest.Mock).mockResolvedValue({ explorationJson: { blocks: [] }, structuralHash: 'h1', ms: 100 });
    (sidecar.renderThumbnails as jest.Mock).mockResolvedValue({ thumbnails: [{ sheetKey: 'VP1', pngUri: 'tmp/a.png', dotCount: 10 }], ms: 200 });
    (generateExtractionScript as jest.Mock).mockResolvedValue({ code: 'print("ok")', costUsd: 0.95, ms: 85000 });
    (sidecar.execute as jest.Mock).mockResolvedValue({ ok: true, complianceData: { setbacks: { front: { value_m: 3.0 } } }, renders: [], ms: 8000 });

    const { dxf, job } = await seedDxf();
    await dxfExtractionHandler(job);

    const updated = await prisma.dxfFile.findUniqueOrThrow({ where: { id: dxf.id } });
    expect(updated.extractionStatus).toBe('COMPLETED');
    expect(updated.structuralHash).toBe('h1');
    expect(updated.complianceData).toEqual({ setbacks: { front: { value_m: 3.0 } } });

    const cached = await prisma.extractionScript.findMany({ where: { structuralHash: 'h1' } });
    expect(cached).toHaveLength(1);
    expect(cached[0].generatedByModel).toBe('claude-opus-4-7');
    expect(storage.removeDirIfExists).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`tmp/thumbnails/${dxf.id}/`)));
  });

  it('cache-hit path: skips thumbnails and codegen', async () => {
    // seed one ExtractionScript + StoredFile for a known hash
    const scriptFile = await prisma.storedFile.create({ data: { kind: 'EXTRACTION_SCRIPT', uri: 'uploads/scripts/cached.py', originalName: 'cached.py', sha256: 'b'.repeat(64), sizeBytes: 500 } });
    await prisma.extractionScript.create({ data: { structuralHash: 'h1', storedFileId: scriptFile.id, generatedByModel: 'claude-opus-4-7', generationCostUsd: 1.0, generationMs: 80000 } });

    (sidecar.explore as jest.Mock).mockResolvedValue({ explorationJson: { blocks: [] }, structuralHash: 'h1', ms: 100 });
    (sidecar.execute as jest.Mock).mockResolvedValue({ ok: true, complianceData: { setbacks: {} }, renders: [], ms: 8000 });

    const { dxf, job } = await seedDxf();
    await dxfExtractionHandler(job);

    expect(sidecar.renderThumbnails).not.toHaveBeenCalled();
    expect(generateExtractionScript).not.toHaveBeenCalled();
    const trace = (await prisma.dxfFile.findUniqueOrThrow({ where: { id: dxf.id } })).extractionTrace as any;
    expect(trace.cacheHit).toBe(true);
  });

  it('self-correction path: first execute crashes, fix succeeds, two ExtractionScript rows', async () => {
    (sidecar.explore as jest.Mock).mockResolvedValue({ explorationJson: { blocks: [] }, structuralHash: 'h2', ms: 100 });
    (sidecar.renderThumbnails as jest.Mock).mockResolvedValue({ thumbnails: [], ms: 10 });
    (generateExtractionScript as jest.Mock).mockResolvedValue({ code: 'broken', costUsd: 1.0, ms: 80000 });
    (fixExtractionScript as jest.Mock).mockResolvedValue({ code: 'fixed', costUsd: 0.15, ms: 30000 });
    (sidecar.execute as jest.Mock)
      .mockResolvedValueOnce({ ok: false, traceback: 'RuntimeError: boom', ms: 2000 })
      .mockResolvedValueOnce({ ok: true, complianceData: {}, renders: [], ms: 7000 });

    const { dxf, job } = await seedDxf();
    await dxfExtractionHandler(job);

    const rows = await prisma.extractionScript.findMany({ where: { structuralHash: 'h2' }, orderBy: { createdAt: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows[1].fixedFromScriptId).toBe(rows[0].id);
    const updated = await prisma.dxfFile.findUniqueOrThrow({ where: { id: dxf.id } });
    expect(updated.extractionStatus).toBe('COMPLETED');
  });

  it('exhausted retries: both attempts crash → FAILED + no complianceData', async () => {
    (sidecar.explore as jest.Mock).mockResolvedValue({ explorationJson: { blocks: [] }, structuralHash: 'h3', ms: 100 });
    (sidecar.renderThumbnails as jest.Mock).mockResolvedValue({ thumbnails: [], ms: 10 });
    (generateExtractionScript as jest.Mock).mockResolvedValue({ code: 'broken', costUsd: 1.0, ms: 80000 });
    (fixExtractionScript as jest.Mock).mockResolvedValue({ code: 'still-broken', costUsd: 0.15, ms: 30000 });
    (sidecar.execute as jest.Mock).mockResolvedValue({ ok: false, traceback: 'RuntimeError: persistent', ms: 2000 });

    const { dxf, job } = await seedDxf();
    await expect(dxfExtractionHandler(job)).rejects.toThrow(/exhausted/);

    const updated = await prisma.dxfFile.findUniqueOrThrow({ where: { id: dxf.id } });
    expect(updated.extractionStatus).toBe('FAILED');
    expect(updated.complianceData).toBeNull();
    expect(updated.extractionError).toContain('persistent');
    expect(storage.removeDirIfExists).toHaveBeenCalled();  // finally ran even on throw
  });
  ```

- [ ] **4.2 Run integration tests:** `cd server && npm run test:integration -- dxf-extraction.handler.integration` → green.

- [ ] **4.3 Run the full server suite:** `npm run typecheck && npm test && npm run test:integration` → green.

- [ ] **4.4 Commit:**

  ```bash
  git add src/jobs/handlers/dxf-extraction.handler.integration.test.ts
  git commit -m "test(dxf): integration coverage for v3.1 state machine (4 paths)"
  ```

---

## Cluster 5 — Vault docs + Phase Status

Main repo (`docs/` tree) on branch `feat/buildcheck-phase-4b`.

**Files:**
- Modify: `docs/vault/00-Index/Phase Status.md` — flip to `in-progress` once branches are pushed; flip again to `in-review` when PRs open
- Modify: `docs/vault/30-Server/` pages covering the DXF pipeline (if a `DXF Pipeline.md` or similar exists; skim with `obsidian-cli` + grep)
- Create: `docs/vault/30-Server/DXF Codegen.md` — short page summarizing v3.1 flow + links to spec §7 + pipeline diagram §7.6

### Steps

- [ ] **5.1 Transition Phase Status to `in-progress`** the moment the sidecar PR is opened (cluster 0 step 0.27). Edit [Phase Status.md](../../docs/vault/00-Index/Phase Status.md):

  - Frontmatter: `current_status: in-progress`
  - "Current" callout: update status to `in-progress`, set branch to `feat/buildcheck-phase-4b`
  - Phase log row 4b: `Status = in-progress`, `Branch = feat/buildcheck-phase-4b`

- [ ] **5.2 After all three PRs open** (sidecar, server, main-repo), transition to `in-review` and add PR links to the log row.

- [ ] **5.3 Create `docs/vault/30-Server/DXF Codegen.md`** — one-page summary of the v3.1 flow with wikilinks to the spec and the handler file. Use the `obsidian:obsidian-markdown` skill to get frontmatter + callout syntax right.

  Template outline:

  ```markdown
  ---
  title: DXF Codegen (v3.1 visual bridge)
  tags: [server, dxf, codegen]
  ---

  # DXF Codegen (v3.1 visual bridge)

  > Generated per-file Python extraction scripts. See [[BuildCheck Redesign Spec]] §2.20, §7.

  ## Flow
  - explore → structural hash → findLatestByHash
  - cache miss: render-thumbnails → multimodal codegen (Opus+vision) → cache
  - execute; on crash → fix once → execute again
  - persist complianceData + extractionTrace

  ## Key files
  - [[../../../server/src/jobs/handlers/dxf-extraction.handler.ts]]
  - [[../../../server/src/integrations/anthropic.client.ts]]
  - [[../../../sidecar/app/dxf_sheet_renderer.py]]

  ## Why raw-string matching
  See spec §2.20 — Hebrew encoding varies per architect; visual bridge lets Claude build a per-file LABELS map.
  ```

- [ ] **5.4 Commit docs** on the main-repo branch:

  ```bash
  git add docs/vault
  git commit -m "docs(vault): DXF Codegen page + phase status transitions"
  ```

---

## Cluster 6 — Submodule bump + PRs

Main repo on branch `feat/buildcheck-phase-4b`.

### Steps

- [ ] **6.1 After sidecar PR merges to `sidecar`/`main`**, in the main repo:

  ```bash
  cd sidecar && git fetch origin && git switch main && git pull --ff-only && cd -
  git add sidecar
  git commit -m "chore(submodule): bump sidecar to phase 4b tip"
  ```

- [ ] **6.2 After server PR merges to `server`/`main`**:

  ```bash
  cd server && git fetch origin && git switch main && git pull --ff-only && cd -
  git add server
  git commit -m "chore(submodule): bump server to phase 4b tip"
  ```

- [ ] **6.3 Push main-repo branch + open PR against `integration/buildcheck`:**

  ```bash
  git push -u origin feat/buildcheck-phase-4b
  gh pr create --base integration/buildcheck --title "feat: phase 4b — codegen + execute + self-correct (v3.1 visual bridge)" \
    --body "$(cat <<'EOF'
  ## Summary
  - Sidecar: explorer rewrite (raw+decoded samples, encoding flags, broadened sampling), new `dxf_sheet_renderer.py`, new `POST /render-thumbnails` + `POST /execute`
  - Server: Prisma migration (ExtractionScript + DxfFile.complianceData + re-explore data migration), multimodal anthropic client, full DXF_EXTRACTION state machine (cache hit / miss / self-correct / exhausted-retries)
  - Model: claude-opus-4-7 + vision; Sonnet A/B deferred to §14

  ## Test plan
  - [ ] Sidecar: `pytest -q` + `ruff check .` + docker build green
  - [ ] Server: `npm run typecheck && npm test && npm run test:integration` green
  - [ ] Manual: upload a DXF from `dummy_data/`, observe cold run ~100–160s ~$1 → second upload of structurally-similar file ~15s $0 cache hit

  ## Linked PRs
  - sidecar: (fill in)
  - server: (fill in)

  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  EOF
  )"
  ```

- [ ] **6.4 Final Phase Status update** after all three PRs open — flip `current_status: in-review` and populate the three PR links in the log row. Commit in the same branch.

- [ ] **6.5 After review + merge:** on merge to `integration/buildcheck`, flip Phase Status row 4b to `merged` with the merge date.

---

## Self-review checklist (for the plan author)

Before handing off, confirm:

- [ ] Every spec §13 Phase 4b bullet has a task in this plan (cross-reference).
- [ ] Every file path in this plan is an absolute path relative to the repo root.
- [ ] Every code block compiles/runs as written (no `// ...` gaps inside bodies).
- [ ] Type names match across tasks (`ExecuteResult`, `ExtractionScriptWithFile`, `ThumbnailRef` etc.).
- [ ] Commit messages follow conventional-commits (feat:, fix:, chore:, docs:, test:).
- [ ] No task mentions "similar to Task N" — each repeats the code it needs.
- [ ] Migration order: schema edit → `migrate dev` → append SQL → `migrate reset` (cluster 1 steps 1.1-1.7) is explicit and reproducible.
- [ ] The dot-number invariant test (cluster 0 step 0.14's `test_dot_ordering_derived_from_exploration_samples`) is present — this is the contract test the spec §13 Phase 4b calls out.
- [ ] The handler's `finally` cleanup test (cluster 4 step 4.1 case 4) proves thumbnail removal runs even on throw.
