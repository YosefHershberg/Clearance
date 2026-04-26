from pathlib import Path

from fastapi.testclient import TestClient

from app.main import SVG_UNDERFILL_BYTES, app

client = TestClient(app)


def _write_script(tmp_uploads: Path, body: str) -> str:
    script = tmp_uploads / "scripts" / "fake_extract.py"
    script.parent.mkdir(parents=True, exist_ok=True)
    script.write_text(body)
    return "scripts/fake_extract.py"


def test_execute_ok(tmp_uploads: Path) -> None:
    # Pad the SVG safely above the underfill threshold so we don't silently
    # break when SVG_UNDERFILL_BYTES moves.
    svg_size = SVG_UNDERFILL_BYTES + 10_000
    script_body = f"""
import json, sys, pathlib
_, dxf_path, out_dir = sys.argv
out = pathlib.Path(out_dir)
out.mkdir(parents=True, exist_ok=True)
(out / "render_01.svg").write_text("<svg>" + "x"*{svg_size} + "</svg>")
print(json.dumps({{
    "complianceData": {{"setbacks": {{}}}},
    "renders": [{{
        "filename": str(out / "render_01.svg"),
        "sheetIndex": 1,
        "displayName": "s1",
        "classification": "UNCLASSIFIED",
    }}],
}}))
"""
    script_uri = _write_script(tmp_uploads, script_body)
    resp = client.post(
        "/execute",
        json={
            "stored_file_uri": "dxf/small_test.dxf",
            "script_uri": script_uri,
            "output_dir": "renders/test/",
        },
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["ok"] is True, data
    assert data["complianceData"] == {"setbacks": {}}
    assert data["renders"][0]["size_bytes"] > SVG_UNDERFILL_BYTES
    assert "svg_warning" not in data["renders"][0]


def test_execute_relative_write_lands_in_out_dir(tmp_uploads: Path) -> None:
    # Unqualified open()/write calls in AI-generated scripts must land inside
    # the sandboxed output directory, not next to the sidecar process.
    script_body = f"""
import sys, pathlib
_, dxf, out = sys.argv
pathlib.Path(out).mkdir(parents=True, exist_ok=True)
# Intentionally relative -- no out prefix. Must land in cwd (= out_dir).
pathlib.Path("sentinel.txt").write_text("hello")
# Still produce a valid payload so /execute returns ok=True.
(pathlib.Path(out) / "render_01.svg").write_text("<svg>" + "x"*{SVG_UNDERFILL_BYTES + 10_000} + "</svg>")
import json
print(json.dumps({{
    "complianceData": {{}},
    "renders": [{{
        "filename": str(pathlib.Path(out) / "render_01.svg"),
        "sheetIndex": 1,
        "displayName": "s1",
        "classification": "UNCLASSIFIED",
    }}],
}}))
"""
    script_uri = _write_script(tmp_uploads, script_body)
    resp = client.post(
        "/execute",
        json={
            "stored_file_uri": "dxf/small_test.dxf",
            "script_uri": script_uri,
            "output_dir": "renders/cwd-test/",
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["ok"] is True, resp.json()
    sentinel = tmp_uploads / "renders" / "cwd-test" / "sentinel.txt"
    assert sentinel.exists(), (
        f"expected {sentinel} to exist; cwd not set to out_dir"
    )
    assert sentinel.read_text() == "hello"


def test_execute_script_crash(tmp_uploads: Path) -> None:
    script_uri = _write_script(tmp_uploads, "raise RuntimeError('boom')\n")
    resp = client.post(
        "/execute",
        json={
            "stored_file_uri": "dxf/small_test.dxf",
            "script_uri": script_uri,
            "output_dir": "renders/test/",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is False
    assert "RuntimeError" in data["traceback"]


def test_execute_malformed_stdout(tmp_uploads: Path) -> None:
    script_uri = _write_script(tmp_uploads, "print('not json at all')\n")
    resp = client.post(
        "/execute",
        json={
            "stored_file_uri": "dxf/small_test.dxf",
            "script_uri": script_uri,
            "output_dir": "renders/test/",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is False
    assert "malformed stdout" in data["traceback"]
