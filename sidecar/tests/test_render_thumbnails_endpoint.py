from pathlib import Path

from fastapi.testclient import TestClient

from app.dxf_explorer import explore_dxf
from app.main import app


def test_render_thumbnails_endpoint_emits_pngs(tmp_uploads: Path) -> None:
    dxf = tmp_uploads / "dxf" / "small_test.dxf"
    exploration = explore_dxf(dxf)
    client = TestClient(app)
    resp = client.post(
        "/render-thumbnails",
        json={
            "stored_file_uri": "dxf/small_test.dxf",
            "exploration_json": exploration,
            "thumbnail_dir": "tmp/thumbnails/test/",
        },
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert "thumbnails" in data
    assert isinstance(data["ms"], int)
    # Candidates are the blocks the sheet-candidate filter keeps AND that have
    # a bbox — both are prerequisites for rendering.
    candidates = [
        b for b in exploration["blocks"]
        if b.get("is_sheet_candidate") and b.get("bbox")
    ]
    assert len(data["thumbnails"]) == len(candidates)
    for t in data["thumbnails"]:
        # png_uri is URI-relative (thumbnail_dir + basename) since phase 4c so
        # the server can resolve it under its own UPLOADS_PARENT_DIR.
        p = tmp_uploads / t["png_uri"]
        assert p.exists()
        assert p.stat().st_size > 0


def test_render_thumbnails_missing_file_returns_500(tmp_uploads: Path) -> None:
    client = TestClient(app)
    resp = client.post(
        "/render-thumbnails",
        json={
            "stored_file_uri": "dxf/does-not-exist.dxf",
            "exploration_json": {"blocks": []},
            "thumbnail_dir": "tmp/thumbnails/test/",
        },
    )
    assert resp.status_code == 500
    assert "not found" in resp.json()["detail"]
