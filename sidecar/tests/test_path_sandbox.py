"""Sandbox-containment tests for ``_resolve_upload_path``.

These guard against path-escape attacks on all three endpoints that resolve
caller-provided URIs under ``UPLOADS_PARENT_DIR``: ``/explore``,
``/render-thumbnails``, and ``/execute``. Any path that resolves outside the
sandbox root must be rejected with a 400 so we never read from, write to, or
execute a file the caller picked arbitrarily on disk.
"""

from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_explore_rejects_absolute_outside_sandbox(tmp_uploads: Path) -> None:
    resp = client.post("/explore", json={"stored_file_uri": "/etc/passwd"})
    assert resp.status_code == 400, resp.text
    assert "escape" in resp.json()["detail"]


def test_explore_rejects_parent_escape(tmp_uploads: Path) -> None:
    resp = client.post(
        "/explore", json={"stored_file_uri": "../../etc/passwd"}
    )
    assert resp.status_code == 400, resp.text
    assert "escape" in resp.json()["detail"]


def test_render_thumbnails_rejects_thumbnail_dir_escape(tmp_uploads: Path) -> None:
    resp = client.post(
        "/render-thumbnails",
        json={
            "stored_file_uri": "dxf/small_test.dxf",
            "exploration_json": {"blocks": []},
            "thumbnail_dir": "/tmp/escape/",
        },
    )
    assert resp.status_code == 400, resp.text
    assert "escape" in resp.json()["detail"]


def test_render_thumbnails_rejects_stored_file_escape(tmp_uploads: Path) -> None:
    resp = client.post(
        "/render-thumbnails",
        json={
            "stored_file_uri": "../../etc/passwd",
            "exploration_json": {"blocks": []},
            "thumbnail_dir": "tmp/thumbnails/test/",
        },
    )
    assert resp.status_code == 400, resp.text
    assert "escape" in resp.json()["detail"]


def test_execute_rejects_script_uri_outside_sandbox(tmp_uploads: Path) -> None:
    resp = client.post(
        "/execute",
        json={
            "stored_file_uri": "dxf/small_test.dxf",
            "script_uri": "/usr/bin/python3",
            "output_dir": "renders/test/",
        },
    )
    assert resp.status_code == 400, resp.text
    assert "escape" in resp.json()["detail"]


def test_execute_rejects_output_dir_escape(tmp_uploads: Path) -> None:
    resp = client.post(
        "/execute",
        json={
            "stored_file_uri": "dxf/small_test.dxf",
            "script_uri": "scripts/whatever.py",
            "output_dir": "../../escape/",
        },
    )
    assert resp.status_code == 400, resp.text
    assert "escape" in resp.json()["detail"]
