"""Regenerate tests/fixtures/small_test.dxf.

Run once to (re)generate the committed fixture. The fixture contains three
named blocks (two geometric/annotation blocks and one TitleBlock with ATTDEF),
a handful of entities across two layers, and one Hebrew text string so tests
exercise the text-decoding path. Keep the output deterministic.
"""

from __future__ import annotations

from pathlib import Path

import ezdxf


def build() -> None:
    doc = ezdxf.new("R2010")
    doc.layers.add("GEOMETRY", color=7)
    doc.layers.add("TEXT_LAYER", color=1)

    floor = doc.blocks.new(name="FLOOR_PLAN_01")
    floor.add_line((0, 0), (100, 0), dxfattribs={"layer": "GEOMETRY"})
    floor.add_line((100, 0), (100, 50), dxfattribs={"layer": "GEOMETRY"})
    floor.add_line((100, 50), (0, 50), dxfattribs={"layer": "GEOMETRY"})
    floor.add_line((0, 50), (0, 0), dxfattribs={"layer": "GEOMETRY"})
    floor.add_circle((50, 25), radius=5, dxfattribs={"layer": "GEOMETRY"})
    floor.add_text(
        "תכנית קומה 1",
        dxfattribs={"layer": "TEXT_LAYER", "height": 2},
    ).set_placement((10, 10))

    elevation = doc.blocks.new(name="ELEVATION_NORTH")
    elevation.add_line((0, 0), (50, 0), dxfattribs={"layer": "GEOMETRY"})
    elevation.add_line((50, 0), (50, 30), dxfattribs={"layer": "GEOMETRY"})
    elevation.add_text(
        "חזית צפונית +3.50",
        dxfattribs={"layer": "TEXT_LAYER", "height": 2},
    ).set_placement((5, 5))

    # TitleBlock exercises the ATTDEF / ATTRIB path of _extract_text_record.
    title_block = doc.blocks.new(name="TitleBlock")
    title_block.add_attdef(
        "OWNER",
        insert=(0, 0),
        text="Owner:",
        dxfattribs={"layer": "TEXT_LAYER", "height": 2},
    )

    msp = doc.modelspace()
    msp.add_blockref("FLOOR_PLAN_01", (0, 0))
    msp.add_blockref("ELEVATION_NORTH", (200, 0))
    msp.add_blockref("TitleBlock", (10, 10)).add_attrib("OWNER", "Test Owner")

    output = Path(__file__).parent / "small_test.dxf"
    doc.saveas(str(output))
    print(f"wrote {output}")


if __name__ == "__main__":
    build()
