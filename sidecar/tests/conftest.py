import shutil
from pathlib import Path

import pytest

FIXTURES_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture()
def small_test_dxf() -> Path:
    path = FIXTURES_DIR / "small_test.dxf"
    assert path.exists(), (
        f"{path} missing — run `python tests/fixtures/build_fixture.py` to regenerate"
    )
    return path


@pytest.fixture()
def tmp_uploads(tmp_path: Path, monkeypatch) -> Path:
    """Stage a sandboxed uploads root for endpoints that resolve paths under
    ``UPLOADS_PARENT_DIR``.

    Layout::

        <tmp_uploads>/
          dxf/small_test.dxf   # copied from tests/fixtures/small_test.dxf
          tmp/thumbnails/      # empty; /render-thumbnails writes here
          renders/             # empty; /execute writes here
          scripts/             # empty; /execute consumes scripts written here
    """
    (tmp_path / "dxf").mkdir()
    (tmp_path / "tmp" / "thumbnails").mkdir(parents=True)
    (tmp_path / "renders").mkdir()
    (tmp_path / "scripts").mkdir()

    shutil.copy(FIXTURES_DIR / "small_test.dxf", tmp_path / "dxf" / "small_test.dxf")

    # Point both the app module's module-level constant and the env var at the
    # sandbox so _resolve_upload_path resolves relative URIs under tmp_path.
    from app import main as app_module

    monkeypatch.setattr(app_module, "UPLOADS_PARENT_DIR", str(tmp_path))
    monkeypatch.setenv("UPLOADS_PARENT_DIR", str(tmp_path))
    return tmp_path
