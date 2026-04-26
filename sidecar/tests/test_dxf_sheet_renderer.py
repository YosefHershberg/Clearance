from pathlib import Path

from app.dxf_explorer import explore_dxf
from app.dxf_sheet_renderer import DOT_CAP_PER_SHEET, render_sheets

FIXTURE = Path(__file__).parent / "fixtures" / "small_test.dxf"


def test_renders_one_png_per_sheet_candidate(tmp_path: Path) -> None:
    exploration = explore_dxf(FIXTURE)
    results = render_sheets(FIXTURE, exploration, tmp_path)
    candidates_with_bbox = [
        b for b in exploration["blocks"]
        if b.get("is_sheet_candidate") and b.get("bbox")
    ]
    assert len(results) == len(candidates_with_bbox)
    for r in results:
        assert Path(r["png_uri"]).exists()
        assert Path(r["png_uri"]).stat().st_size > 0


def test_renderer_skips_non_sheet_candidates(tmp_path: Path) -> None:
    """Flip every fixture block to is_sheet_candidate=False and verify nothing
    renders. Guards against the renderer regressing to the old "render every
    bboxed block" behavior, which blew up on the 8509-block real-world DXF."""
    exploration = explore_dxf(FIXTURE)
    for block in exploration["blocks"]:
        block["is_sheet_candidate"] = False
    results = render_sheets(FIXTURE, exploration, tmp_path)
    assert results == []


def test_dot_count_respects_cap(tmp_path: Path) -> None:
    exploration = explore_dxf(FIXTURE)
    results = render_sheets(FIXTURE, exploration, tmp_path)
    for r in results:
        assert r["dot_count"] <= DOT_CAP_PER_SHEET


def test_dot_ordering_matches_text_samples_order(tmp_path: Path, monkeypatch) -> None:
    """Dot N in the PNG must correspond to text_samples[N-1] in the injected order.

    Injects a known samples list with unique positions, spies on ax.annotate to
    capture (label, (x, y)) for every dot plotted, and asserts the label->coord
    mapping matches the injected order one-for-one. This proves (1) the renderer
    plots exactly len(text_samples) dots (below cap), (2) dot labels are the
    1-based global index of each sample, and (3) positions come from the sample
    records rather than from any ezdxf re-enumeration. Removing the final
    kept.sort(key=...) inside _apply_density_policy breaks this test.
    """
    exploration = explore_dxf(FIXTURE)
    block = next(b for b in exploration["blocks"] if b.get("bbox"))
    bbox = block["bbox"]
    # Place 5 synthetic samples at unique positions inside the bbox, well above
    # the density-policy coincidence threshold (diag / 200). Labels have
    # deliberately varying lengths AND mix numeric with non-numeric values so
    # that the density-policy score sort (non-numeric first, length desc,
    # numeric last) reorders them away from the input sequence. That makes
    # the final `kept.sort(key=pair[0])` in _apply_density_policy load-bearing:
    # removing it leaves dots in score order, not global-index order, and
    # this test fails.
    xs = [bbox[0] + (i + 1) * (bbox[2] - bbox[0]) / 6.0 for i in range(5)]
    ys = [bbox[1] + (i + 1) * (bbox[3] - bbox[1]) / 6.0 for i in range(5)]
    raws = ["short", "a_much_longer_label", "42", "mid_length_label", "7.5"]
    block["text_samples"] = [
        {
            "raw": raws[i],
            "decoded": raws[i],
            "x": xs[i],
            "y": ys[i],
            "block": block["name"],
            "handle": str(i),
            "layer": "0",
            "entity_type": "TEXT",
        }
        for i in range(5)
    ]

    # Capture ax.annotate() invocations: (label_text, (x, y)).
    captured: list[tuple[str, tuple[float, float]]] = []
    import matplotlib.axes

    orig_annotate = matplotlib.axes.Axes.annotate

    def spy_annotate(self, text, xy, *args, **kwargs):  # type: ignore[no-untyped-def]
        captured.append((str(text), (float(xy[0]), float(xy[1]))))
        return orig_annotate(self, text, xy, *args, **kwargs)

    monkeypatch.setattr(matplotlib.axes.Axes, "annotate", spy_annotate)

    # Render only the injected block so no other annotate() calls are captured.
    single_block_exploration = {**exploration, "blocks": [block]}
    render_sheets(FIXTURE, single_block_exploration, tmp_path)

    assert len(captured) == 5, f"expected 5 dots, got {len(captured)}"
    for i, (label, (x, y)) in enumerate(captured):
        assert label == str(i + 1), f"dot {i} labeled {label!r}, expected {i + 1!r}"
        assert abs(x - xs[i]) < 1e-6 and abs(y - ys[i]) < 1e-6, (
            f"dot {i + 1} plotted at ({x}, {y}), expected ({xs[i]}, {ys[i]})"
        )
