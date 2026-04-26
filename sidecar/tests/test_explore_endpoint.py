from pathlib import Path

from fastapi.testclient import TestClient

from app import main as app_module
from app.main import app


def test_explore_happy_path(small_test_dxf: Path, monkeypatch) -> None:
    monkeypatch.setattr(app_module, "UPLOADS_PARENT_DIR", str(small_test_dxf.parent))
    client = TestClient(app)
    r = client.post(
        "/explore",
        json={"stored_file_uri": small_test_dxf.name},
        headers={"X-Request-Id": "req-test-1"},
    )
    assert r.status_code == 200
    body = r.json()
    assert "exploration_json" in body
    assert isinstance(body["structural_hash"], str)
    assert len(body["structural_hash"]) == 64
    assert isinstance(body["ms"], int)


def test_explore_missing_file_returns_500() -> None:
    client = TestClient(app)
    r = client.post(
        "/explore",
        json={"stored_file_uri": "uploads/dxf/does-not-exist.dxf"},
    )
    assert r.status_code == 500
    assert "not found" in r.json()["detail"]
