"""DXF structural fingerprinter for BuildCheck.

Produces a canonical ``explorationJson`` describing the file's blocks, entities,
layers, text content (raw + best-effort decoded), encoding signals, and a
handful of heuristics that phase 4b's codegen prompts consume. Never calls
Claude; never touches Postgres.

Version bumps (``explorer_version``) should be backward-compatible wherever
possible — adding keys changes ``structuralHash`` which invalidates phase 4b's
cache entries, which is fine; removing keys is not.

v4b (visual-bridge codegen): text samples are now structured records
(``{raw, decoded, x, y, block, handle, layer, entity_type}``) so the downstream
thumbnail renderer can place numbered dots at each sample's position, enforcing
the dot-number invariant (dot ``N`` in the PNG ↔ ``text_samples[N-1]``).
Encoding flags surface per-block signals (Unicode escapes, native Hebrew,
possible SHX Latin substitution, high bytes) so codegen can pick the right
decoder strategy without hardcoded heuristics. Dual-viewport detection was
demoted into ``hints``; a coarse ``dimension_unit_guess`` was added alongside.
"""

from __future__ import annotations

import hashlib
import re
import time
from collections import Counter
from pathlib import Path
from typing import Any

import ezdxf

from app.hashing import canonical_sha256

EXPLORER_VERSION = "4c.1"

# Entity types we count per block. Broadened in 4b to include ATTRIB/ATTDEF so
# title-block metadata (which is almost always ATTRIB under an INSERT) is
# sampled for text + encoding-flag computation.
ENTITY_TYPES = (
    "LINE", "POLYLINE", "LWPOLYLINE", "ARC", "CIRCLE", "INSERT",
    "TEXT", "MTEXT", "ATTRIB", "ATTDEF",
)
TEXT_LIKE = ("TEXT", "MTEXT", "ATTRIB", "ATTDEF")
GEOMETRY_LIKE = ("LINE", "POLYLINE", "LWPOLYLINE", "ARC", "CIRCLE")
MAX_SAMPLES_PER_BLOCK = 50

# Sheet-candidate heuristics. A real architectural DXF's block table is mostly
# library primitives (furniture, door/window symbols, title cartouches); only
# a handful of those blocks are actual "sheets". We mark a block as a sheet
# candidate if ANY of these signals fire; the renderer filters on this flag
# so a 8k-block file produces ~20 PNGs, not 8k.
SHEET_GEOMETRY_MIN = 50  # drawing-entity count (LINE+POLYLINE+LWPOLYLINE+ARC+CIRCLE)
SHEET_TEXT_MIN = 10      # annotation count (TEXT+MTEXT+ATTRIB+ATTDEF)

# Per-category Hebrew keyword lists. Matched via substring.
CLASSIFICATION_KEYWORDS: dict[str, tuple[str, ...]] = {
    "floor_plan": ("תכנית", "קומה", "תקרה", "רצפה"),
    "elevation": ("חזית", "מפלס", "גובה"),
    "section": ("חתך", "מבט"),
    "survey": ("מדידה", "מפלסים", "קואורדינטות"),
    "parking": ("חנייה", "חניה", "מכונית", "דרך גישה"),
}

# Heuristic thresholds for dual-viewport pairing.
GEOMETRY_VP_MIN_LINES = 500
ANNOTATION_VP_MIN_TEXTS = 10
MIN_BBOX_IOU = 0.5

# Encoding-signal regexes.
_UNICODE_ESCAPE_RE = re.compile(r"\\U\+[0-9A-Fa-f]{4}")
_SHX_PAIR_HINT_RE = re.compile(r"[a-zA-Z]{3,}")


def explore_dxf(path: Path) -> dict[str, Any]:
    """Produce the explorationJson for a DXF file.

    Returns a plain dict suitable for ``json.dumps(..., sort_keys=True)``. The
    caller hashes the canonical form (minus ``meta`` and ``source``) to produce
    ``structuralHash``.
    """
    t0 = time.monotonic()
    doc = ezdxf.readfile(str(path))

    insert_referenced = _collect_insert_referenced_names(doc)
    blocks = _explore_blocks(doc, insert_referenced)
    layers = sorted({layer.dxf.name for layer in doc.layers})
    pairs = _detect_dual_viewport_pairs(blocks)
    source = _compute_source(path)

    hints = {
        "dual_viewport_pairs": pairs,
        "dimension_unit_guess": _guess_dimension_unit(blocks),
    }

    elapsed_ms = int((time.monotonic() - t0) * 1000)

    return {
        "source": source,
        "blocks": blocks,
        "layers": layers,
        "hints": hints,
        "meta": {
            "ezdxf_version": ezdxf.__version__,
            "explorer_version": EXPLORER_VERSION,
            "ms": elapsed_ms,
        },
    }


def structural_hash_for(exploration_json: dict[str, Any]) -> str:
    """Hash the structure-bearing keys only (drop meta + source)."""
    canonical = {k: v for k, v in exploration_json.items() if k not in ("meta", "source")}
    return canonical_sha256(canonical)


def _compute_source(path: Path) -> dict[str, Any]:
    sha = hashlib.sha256()
    size = 0
    with path.open("rb") as f:
        while True:
            chunk = f.read(65536)
            if not chunk:
                break
            sha.update(chunk)
            size += len(chunk)
    return {
        "filename": path.name,
        "size_bytes": size,
        "sha256": sha.hexdigest(),
    }


def _explore_blocks(
    doc: ezdxf.document.Drawing,
    insert_referenced: set[str],
) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    for block in doc.blocks:
        name = block.name
        if name.startswith(("*Model_Space", "*Paper_Space")):
            continue

        counts: Counter[str] = Counter()
        layers_in_block: set[str] = set()
        text_samples: list[dict[str, Any]] = []
        bbox: list[float] | None = None

        for entity in block:
            dxftype = entity.dxftype()
            if dxftype in ENTITY_TYPES:
                counts[dxftype] += 1
            if hasattr(entity.dxf, "layer"):
                layers_in_block.add(entity.dxf.layer)

            if dxftype in TEXT_LIKE and len(text_samples) < MAX_SAMPLES_PER_BLOCK:
                record = _extract_text_record(entity, name)
                if record is not None:
                    text_samples.append(record)

            bbox = _extend_bbox(bbox, entity)

        keywords = _count_keywords(text_samples)

        blocks.append(
            {
                "name": name,
                "entity_counts": {t: counts.get(t, 0) for t in ENTITY_TYPES},
                "bbox": bbox,
                "layers": sorted(layers_in_block),
                "text_samples": text_samples,
                "text_flags": _text_flags(text_samples),
                "encoding_flags": _encoding_flags(text_samples),
                "classification_keywords": keywords,
                "is_sheet_candidate": _is_sheet_candidate(
                    name, counts, insert_referenced,
                ),
            }
        )
    blocks.sort(key=lambda b: b["name"])
    _ensure_non_empty_candidates(blocks)
    return blocks


def _collect_insert_referenced_names(doc: ezdxf.document.Drawing) -> set[str]:
    """Unique block names referenced by INSERT entities in modelspace and every
    paperspace layout. These are authoritative sheet candidates: the author
    of the DXF explicitly placed them in a viewable layout."""
    names: set[str] = set()
    for layout_name in doc.layout_names():
        try:
            layout = doc.layouts.get(layout_name)
        except Exception:
            continue
        for entity in layout:
            if entity.dxftype() == "INSERT":
                try:
                    names.add(entity.dxf.name)
                except Exception:
                    continue
    return names


def _is_sheet_candidate(
    name: str,
    counts: Counter[str],
    insert_referenced: set[str],
) -> bool:
    if name in insert_referenced:
        return True
    geometry_total = sum(counts.get(t, 0) for t in GEOMETRY_LIKE)
    if geometry_total >= SHEET_GEOMETRY_MIN:
        return True
    text_total = sum(counts.get(t, 0) for t in TEXT_LIKE)
    if text_total >= SHEET_TEXT_MIN:
        return True
    return False


def _ensure_non_empty_candidates(blocks: list[dict[str, Any]]) -> None:
    """Fallback: if the heuristic produced zero candidates (pathological DXF
    with no INSERTs, no big blocks, no annotation-heavy blocks), mark every
    block with a non-null bbox as a candidate. Better to over-render and let
    the AI sort it out than to codegen on zero thumbnails."""
    if any(b.get("is_sheet_candidate") for b in blocks):
        return
    for b in blocks:
        if b.get("bbox") is not None:
            b["is_sheet_candidate"] = True


def _detect_dual_viewport_pairs(blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    geometry: list[dict[str, Any]] = []
    annotation: list[dict[str, Any]] = []
    for block in blocks:
        if block["bbox"] is None:
            continue
        counts = block["entity_counts"]
        if counts.get("LINE", 0) > GEOMETRY_VP_MIN_LINES:
            geometry.append(block)
        if counts.get("TEXT", 0) + counts.get("MTEXT", 0) > ANNOTATION_VP_MIN_TEXTS:
            annotation.append(block)

    pairs: list[dict[str, Any]] = []
    for g in geometry:
        for a in annotation:
            if g["name"] == a["name"]:
                continue
            iou = _bbox_iou(g["bbox"], a["bbox"])
            if iou >= MIN_BBOX_IOU:
                pairs.append(
                    {
                        "geometry_block": g["name"],
                        "annotation_block": a["name"],
                        "iou": round(iou, 4),
                    }
                )
    pairs.sort(key=lambda p: (p["geometry_block"], p["annotation_block"]))
    return pairs


def _extract_text_record(entity: Any, block_name: str) -> dict[str, Any] | None:
    """Return a structured text record for a TEXT/MTEXT/ATTRIB/ATTDEF entity.

    Emits byte-exact ``raw`` plus best-effort ``decoded`` (nullable). The
    downstream thumbnail renderer uses the ``x``/``y`` fields to place numbered
    dots; Claude correlates the PNG dot numbers with ``text_samples[N-1]`` at
    codegen time to pick the right decoding strategy.
    """
    dxftype = entity.dxftype()
    raw = ""
    if dxftype == "TEXT":
        raw = entity.dxf.text or ""
    elif dxftype == "MTEXT":
        # For MTEXT, `raw` is the result of plain_text() -- MTEXT formatting codes
        # (e.g. {\fArial;...}) are stripped, but text content (Unicode escapes,
        # SHX glyph bytes) passes through verbatim. This is the right raw form
        # for codegen label matching; "byte-exact" applies to content, not MTEXT
        # formatting control sequences.
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
    loc = (
        getattr(entity.dxf, "insert", None)
        or getattr(entity.dxf, "location", None)
        or getattr(entity.dxf, "align_point", None)
    )
    x = float(loc.x) if loc is not None else 0.0
    y = float(loc.y) if loc is not None else 0.0
    try:
        decoded_val = _combine_and_scrub_surrogates(raw).strip()
        decoded: str | None = decoded_val if decoded_val != raw.strip() else raw.strip()
    except Exception:
        decoded = None
    return {
        "raw": _json_safe(raw),
        "decoded": _json_safe(decoded) if decoded is not None else None,
        "x": round(x, 4),
        "y": round(y, 4),
        "block": block_name,
        "handle": getattr(entity.dxf, "handle", ""),
        "layer": getattr(entity.dxf, "layer", ""),
        "entity_type": dxftype,
    }


def _json_safe(text: str) -> str:
    # ezdxf occasionally hands back strings containing lone UTF-16 surrogates
    # (e.g. \udc81 from SHX glyph bytes or a mis-decoded CP1255 stream). Those
    # blow up FastAPI's JSONResponse, which encodes with ensure_ascii=False +
    # strict utf-8. Round-tripping through utf-8 with backslashreplace keeps
    # the byte pattern visible to downstream codegen as a literal escape
    # (e.g. "\\udc81") while guaranteeing the string is utf-8 encodable.
    return text.encode("utf-8", errors="backslashreplace").decode("utf-8")


def _combine_and_scrub_surrogates(text: str) -> str:
    """Normalize CP1255/CP1252-mis-decoded Hebrew into UTF-8.

    ezdxf sometimes returns Hebrew strings that were encoded CP1255 but decoded
    as latin1. Re-encoding as latin1 and decoding as CP1255 recovers them; if
    that fails we fall through and return the raw text.
    """
    if not text:
        return ""
    try:
        as_latin1 = text.encode("latin-1", errors="strict")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return text
    for enc in ("cp1255", "utf-8", "cp1252"):
        try:
            return as_latin1.decode(enc)
        except UnicodeDecodeError:
            continue
    return text


def _text_flags(samples: list[dict[str, Any]]) -> dict[str, bool]:
    joined = " ".join((s.get("decoded") or s.get("raw") or "") for s in samples)
    return {
        "has_hebrew": any("\u0590" <= c <= "\u05FF" for c in joined),
        "has_integers": _matches(joined, r"\b\d+\b"),
        "has_decimals": _matches(joined, r"\b\d+\.\d+\b"),
        "has_heights": _matches(joined, r"[+\-]\d+\.\d+"),
        "has_coordinates": _matches(joined, r"\b\d{5,}\b"),
    }


def _encoding_flags(samples: list[dict[str, Any]]) -> dict[str, bool]:
    """Per-block signals the codegen prompt uses to choose a decoder strategy.

    - ``has_unicode_escapes``: ``\\U+XXXX`` sequences (AutoCAD high-codepoint escape)
    - ``has_native_hebrew``: any U+0590–U+05FF codepoint in the raw bytes
    - ``has_possible_shx``: runs of Latin letters with no native Hebrew (SHX Latin
      substitution — e.g. ``"eu cbhhi"`` rendering as ``"קו בניין"``)
    - ``has_high_bytes``: non-Hebrew codepoints >127 (legacy code pages / mojibake)
    """
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
        if _SHX_PAIR_HINT_RE.search(raw) and not any("\u0590" <= c <= "\u05FF" for c in raw):
            has_possible_shx = True
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


def _matches(haystack: str, pattern: str) -> bool:
    return bool(re.search(pattern, haystack))


def _count_keywords(samples: list[dict[str, Any]]) -> dict[str, int]:
    joined = " ".join((s.get("decoded") or s.get("raw") or "") for s in samples)
    return {
        category: sum(1 for kw in keywords if kw in joined)
        for category, keywords in CLASSIFICATION_KEYWORDS.items()
    }


def _extend_bbox(bbox: list[float] | None, entity: Any) -> list[float] | None:
    try:
        points = _entity_points(entity)
    except Exception:
        return bbox
    for x, y in points:
        if bbox is None:
            bbox = [x, y, x, y]
        else:
            if x < bbox[0]:
                bbox[0] = x
            if y < bbox[1]:
                bbox[1] = y
            if x > bbox[2]:
                bbox[2] = x
            if y > bbox[3]:
                bbox[3] = y
    return bbox


def _entity_points(entity: Any) -> list[tuple[float, float]]:
    dxftype = entity.dxftype()
    if dxftype == "LINE":
        return [(entity.dxf.start.x, entity.dxf.start.y), (entity.dxf.end.x, entity.dxf.end.y)]
    if dxftype in ("CIRCLE", "ARC"):
        c = entity.dxf.center
        r = entity.dxf.radius
        return [(c.x - r, c.y - r), (c.x + r, c.y + r)]
    if dxftype == "POLYLINE":
        return [(v.dxf.location.x, v.dxf.location.y) for v in entity.vertices]
    if dxftype == "LWPOLYLINE":
        return [(p[0], p[1]) for p in entity.get_points("xy")]
    if dxftype in ("TEXT", "MTEXT", "INSERT"):
        loc = getattr(entity.dxf, "insert", None) or getattr(entity.dxf, "location", None)
        if loc is not None:
            return [(loc.x, loc.y)]
    return []


def _bbox_iou(a: list[float], b: list[float]) -> float:
    ix1, iy1, ix2, iy2 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    if ix1 >= ix2 or iy1 >= iy2:
        return 0.0
    inter = (ix2 - ix1) * (iy2 - iy1)
    area_a = max(1e-9, (a[2] - a[0]) * (a[3] - a[1]))
    area_b = max(1e-9, (b[2] - b[0]) * (b[3] - b[1]))
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def _guess_dimension_unit(blocks: list[dict[str, Any]]) -> str:
    """Guess the DXF's dimension unit from the largest block extent.

    Israeli architectural DXFs are almost always in millimeters (extents in the
    tens of thousands); site plans sometimes come in centimeters; small
    schematic fixtures land in meters.
    """
    max_extent = 0.0
    for b in blocks:
        bbox = b.get("bbox")
        if not bbox:
            continue
        extent = max(bbox[2] - bbox[0], bbox[3] - bbox[1])
        if extent > max_extent:
            max_extent = extent
    if max_extent > 20000:
        return "mm"
    if max_extent > 200:
        return "cm"
    return "m"
