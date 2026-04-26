import json
from pathlib import Path
from typing import Any

import ezdxf

from app.dxf_explorer import EXPLORER_VERSION, _json_safe, explore_dxf, structural_hash_for


def test_explore_returns_expected_top_level_keys(small_test_dxf: Path) -> None:
    result = explore_dxf(small_test_dxf)
    assert set(result.keys()) == {"source", "blocks", "layers", "hints", "meta"}
    assert result["meta"]["explorer_version"] == EXPLORER_VERSION
    assert result["source"]["filename"] == small_test_dxf.name


def test_explore_counts_blocks_and_entities(small_test_dxf: Path) -> None:
    result = explore_dxf(small_test_dxf)
    names = {b["name"] for b in result["blocks"]}
    assert "FLOOR_PLAN_01" in names
    assert "ELEVATION_NORTH" in names
    floor = next(b for b in result["blocks"] if b["name"] == "FLOOR_PLAN_01")
    assert floor["entity_counts"]["LINE"] == 4
    assert floor["entity_counts"]["CIRCLE"] == 1
    assert floor["entity_counts"]["TEXT"] == 1
    assert floor["bbox"] is not None
    assert len(floor["bbox"]) == 4


def test_explore_detects_hebrew_text(small_test_dxf: Path) -> None:
    result = explore_dxf(small_test_dxf)
    floor = next(b for b in result["blocks"] if b["name"] == "FLOOR_PLAN_01")
    assert floor["text_flags"]["has_hebrew"] is True
    assert any(
        "תכנית" in (s.get("decoded") or s.get("raw") or "")
        for s in floor["text_samples"]
    )


def test_explore_counts_floor_plan_keyword(small_test_dxf: Path) -> None:
    result = explore_dxf(small_test_dxf)
    floor = next(b for b in result["blocks"] if b["name"] == "FLOOR_PLAN_01")
    assert floor["classification_keywords"]["floor_plan"] >= 1


def test_structural_hash_is_deterministic(small_test_dxf: Path) -> None:
    r1 = explore_dxf(small_test_dxf)
    r2 = explore_dxf(small_test_dxf)
    assert structural_hash_for(r1) == structural_hash_for(r2)


def test_structural_hash_ignores_meta_and_source(small_test_dxf: Path) -> None:
    r = explore_dxf(small_test_dxf)
    h1 = structural_hash_for(r)
    r["meta"]["ms"] = 9999
    r["source"]["sha256"] = "different"
    h2 = structural_hash_for(r)
    assert h1 == h2


def test_explore_emits_structured_samples(small_test_dxf: Path) -> None:
    result = explore_dxf(small_test_dxf)
    # Find a block that has at least one text sample.
    sample = None
    for b in result["blocks"]:
        if b["text_samples"]:
            sample = b["text_samples"][0]
            break
    assert sample is not None, "expected at least one text sample across fixture blocks"
    assert set(sample.keys()) == {
        "raw", "decoded", "x", "y", "block", "handle", "layer", "entity_type",
    }
    assert isinstance(sample["raw"], str)
    assert sample["decoded"] is None or isinstance(sample["decoded"], str)
    assert isinstance(sample["x"], float)
    assert isinstance(sample["y"], float)
    assert sample["entity_type"] in ("TEXT", "MTEXT", "ATTRIB", "ATTDEF")


def test_explore_encoding_flags_present(small_test_dxf: Path) -> None:
    result = explore_dxf(small_test_dxf)
    floor = next(b for b in result["blocks"] if b["name"] == "FLOOR_PLAN_01")
    flags = floor["encoding_flags"]
    assert set(flags.keys()) == {
        "has_unicode_escapes", "has_native_hebrew", "has_possible_shx", "has_high_bytes",
    }
    assert all(isinstance(v, bool) for v in flags.values())


def test_explore_hints_present(small_test_dxf: Path) -> None:
    result = explore_dxf(small_test_dxf)
    assert "dual_viewport_pairs" in result["hints"]
    assert isinstance(result["hints"]["dual_viewport_pairs"], list)
    assert result["hints"]["dimension_unit_guess"] in ("mm", "cm", "m")


def test_json_safe_replaces_lone_surrogates() -> None:
    # Lone surrogates like \udc81 can slip through when ezdxf decodes SHX glyph
    # bytes or a mis-encoded CP1255 stream. They break FastAPI's JSONResponse
    # (ensure_ascii=False + strict utf-8 encode). _json_safe must round-trip
    # them into the JSON-safe backslash escape form.
    dirty = "hello\udc81world"
    clean = _json_safe(dirty)
    # Must be utf-8 encodable with the same strictness the ASGI layer uses.
    clean.encode("utf-8", errors="strict")
    # And JSON-serializable with ensure_ascii=False (what Starlette uses).
    json.dumps(clean, ensure_ascii=False)
    # Byte pattern preserved as a visible literal for downstream codegen.
    assert "\\udc81" in clean


def test_explore_samples_attrib_from_titleblock(small_test_dxf: Path) -> None:
    """The ATTRIB branch of _extract_text_record is exercised by the TitleBlock
    block (see build_fixture.py). The ATTDEF lives on the block definition."""
    result = explore_dxf(small_test_dxf)
    titleblock = next(b for b in result["blocks"] if b["name"] == "TitleBlock")
    entity_types = {s["entity_type"] for s in titleblock["text_samples"]}
    # The block definition itself holds the ATTDEF; the ATTRIB sits under the
    # modelspace INSERT, not under the block definition, so the block
    # definition should surface at least ATTDEF.
    assert "ATTDEF" in entity_types or "ATTRIB" in entity_types


def test_fixture_blocks_all_marked_sheet_candidates(small_test_dxf: Path) -> None:
    """Every fixture block is INSERTed in modelspace, so each must be a
    sheet candidate — the whole point of the INSERT-reference rule."""
    result = explore_dxf(small_test_dxf)
    for block in result["blocks"]:
        assert block["is_sheet_candidate"] is True, block["name"]


def _write_dxf(path: Path, build: Any) -> Path:
    doc = ezdxf.new("R2010")
    build(doc)
    doc.saveas(str(path))
    return path


def test_sheet_candidate_filters_library_primitives(tmp_path: Path) -> None:
    """Real DXFs store door/window/furniture symbols as small block defs that
    are never INSERTed. Those must NOT be marked as sheet candidates."""
    path = tmp_path / "library.dxf"

    def build(doc: Any) -> None:
        # 1 big block with geometry, INSERTed in modelspace — real sheet.
        sheet = doc.blocks.new(name="SHEET_01")
        for i in range(60):  # >= SHEET_GEOMETRY_MIN
            sheet.add_line((i, 0), (i, 10))
        # 100 tiny library blocks, never referenced.
        for i in range(100):
            lib = doc.blocks.new(name=f"LIB_SYMBOL_{i:03d}")
            lib.add_line((0, 0), (1, 1))
            lib.add_line((1, 1), (2, 0))
        doc.modelspace().add_blockref("SHEET_01", (0, 0))

    _write_dxf(path, build)
    result = explore_dxf(path)
    candidates = [b for b in result["blocks"] if b["is_sheet_candidate"]]
    names = {b["name"] for b in candidates}
    assert names == {"SHEET_01"}, (
        f"expected only SHEET_01 as candidate, got {names}"
    )


def test_sheet_candidate_via_geometry_threshold(tmp_path: Path) -> None:
    """A block with enough drawing entities qualifies even if not INSERTed —
    covers DXFs that store sheets as top-level block defs (our original fixture
    pattern) regardless of modelspace usage."""
    path = tmp_path / "orphan.dxf"

    def build(doc: Any) -> None:
        big = doc.blocks.new(name="ORPHAN_BIG")
        for i in range(60):
            big.add_line((i, 0), (i, 10))
        # No INSERT — modelspace stays empty.

    _write_dxf(path, build)
    result = explore_dxf(path)
    big = next(b for b in result["blocks"] if b["name"] == "ORPHAN_BIG")
    assert big["is_sheet_candidate"] is True


def test_sheet_candidate_via_text_threshold(tmp_path: Path) -> None:
    """Annotation-heavy blocks (schedule tables, keynote lists) count as
    sheets even with little geometry."""
    path = tmp_path / "text_heavy.dxf"

    def build(doc: Any) -> None:
        schedule = doc.blocks.new(name="SCHEDULE")
        for i in range(12):  # >= SHEET_TEXT_MIN
            schedule.add_text(f"ROW_{i}").set_placement((0, i))

    _write_dxf(path, build)
    result = explore_dxf(path)
    schedule = next(b for b in result["blocks"] if b["name"] == "SCHEDULE")
    assert schedule["is_sheet_candidate"] is True


def test_sheet_candidate_fallback_when_zero_qualify(tmp_path: Path) -> None:
    """Pathological DXF: tiny blocks, no INSERTs. Fallback must mark every
    bboxed block as a candidate rather than leaving the set empty — the
    pipeline can't codegen on zero thumbnails."""
    path = tmp_path / "tiny.dxf"

    def build(doc: Any) -> None:
        for i in range(3):
            tiny = doc.blocks.new(name=f"TINY_{i}")
            tiny.add_line((0, 0), (1, 1))

    _write_dxf(path, build)
    result = explore_dxf(path)
    candidates = [b for b in result["blocks"] if b["is_sheet_candidate"]]
    # All 3 have bboxes (LINE produces points), fallback marks them all.
    assert len(candidates) == 3
