"""Per-sheet PNG renderer for BuildCheck v3.1 visual-bridge codegen.

Consumes explorationJson from dxf_explorer and the original DXF. Emits one PNG
per logical sheet with:
  - geometry (LINE / POLYLINE / CIRCLE / ARC) drawn in black
  - numbered red dots at text_samples positions (density-capped)

ORDERING INVARIANT: dot number N in the PNG <-> text_samples[N-1] in the JSON
(global per sheet, after cap applied). The renderer NEVER re-enumerates ezdxf
for text ordering -- it consumes exploration["blocks"][*]["text_samples"].
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import ezdxf
import matplotlib

matplotlib.use("Agg")  # headless
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import Circle  # noqa: E402

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
        # Explorer marks candidates; for backward-compat with older
        # explorationJson payloads that lack the flag, fall back to
        # bbox-present (the prior rendering gate).
        is_candidate = block.get("is_sheet_candidate", block.get("bbox") is not None)
        if not is_candidate:
            continue
        name = block["name"]
        bbox = block.get("bbox")
        if bbox is None:
            continue
        png_path = thumbnail_dir / f"{_safe_filename(name)}.png"
        dot_count = _render_block(doc, block, png_path)
        results.append(
            {
                "sheet_key": name,
                "png_uri": str(png_path),
                "dot_count": dot_count,
            }
        )
    return results


def _render_block(doc: Any, block: dict[str, Any], out_path: Path) -> int:
    name = block["name"]
    bbox = block["bbox"]
    fig, ax = plt.subplots(figsize=(12, 9), dpi=100)
    ax.set_aspect("equal")
    ax.set_axis_off()
    ax.set_xlim(bbox[0], bbox[2])
    ax.set_ylim(bbox[1], bbox[3])

    try:
        blk = doc.blocks.get(name)
        for entity in blk:
            _draw_entity(ax, entity)
    except Exception:
        pass

    samples = block.get("text_samples", [])
    ordered = _apply_density_policy(samples, bbox)
    for n, s in ordered:
        ax.scatter(
            [s["x"]], [s["y"]],
            c="red", s=25, zorder=10,
            edgecolors="white", linewidths=0.6,
        )
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
    """Returns ``[(global_sample_index_1based, sample), ...]`` after dedup + cap.

    Priority: non-numeric first (length desc), numeric last. Drops near-coincident
    positions. Applied AFTER ordering, so skipped samples keep their global number
    (i.e. the global 1-based index is preserved in the returned tuple).
    """
    diag = ((bbox[2] - bbox[0]) ** 2 + (bbox[3] - bbox[1]) ** 2) ** 0.5
    min_dist_sq = (diag / 200) ** 2 if diag > 0 else 0.0
    numbered = list(enumerate(samples, start=1))

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
    kept.sort(key=lambda pair: pair[0])
    return kept


def _draw_entity(ax: Any, entity: Any) -> None:
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
                xs.append(pts[0][0])
                ys.append(pts[0][1])
            ax.plot(xs, ys, color="black", linewidth=0.5)
        elif dxftype == "POLYLINE":
            pts = [(v.dxf.location.x, v.dxf.location.y) for v in entity.vertices]
            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            ax.plot(xs, ys, color="black", linewidth=0.5)
        elif dxftype == "CIRCLE":
            ax.add_patch(
                Circle(
                    (entity.dxf.center.x, entity.dxf.center.y),
                    entity.dxf.radius,
                    fill=False,
                    color="black",
                    linewidth=0.5,
                )
            )
        elif dxftype == "ARC":
            import numpy as np

            c = entity.dxf.center
            r = entity.dxf.radius
            a0 = np.deg2rad(entity.dxf.start_angle)
            a1 = np.deg2rad(entity.dxf.end_angle)
            if a1 < a0:
                a1 += 2 * np.pi
            theta = np.linspace(a0, a1, 32)
            ax.plot(
                c.x + r * np.cos(theta),
                c.y + r * np.sin(theta),
                color="black",
                linewidth=0.5,
            )
    except Exception:
        return


def _safe_filename(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9_\-]", "_", name) or "sheet"
