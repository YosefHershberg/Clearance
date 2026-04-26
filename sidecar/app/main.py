"""FastAPI entry point for the BuildCheck Python sidecar.

Phase 4a: /health + /explore.
Phase 4b (cluster 0): /render-thumbnails + /execute.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from pathlib import Path
from typing import Any

import ezdxf
import structlog
from fastapi import FastAPI, Header, HTTPException, Request
from pydantic import BaseModel, Field

from app.dxf_explorer import explore_dxf, structural_hash_for
from app.dxf_sheet_renderer import render_sheets
from app.logging_config import bind_request_id, configure_logging

configure_logging()
log = structlog.get_logger()

app = FastAPI(title="clearance-sidecar")

# The server writes files to <server-root>/uploads/dxf/<cuid>.dxf and sends
# stored_file_uri="uploads/dxf/<cuid>.dxf" (relative to the server root). The
# sidecar needs UPLOADS_PARENT_DIR to be the directory whose child is "uploads/".
# Dev default: ../server (sidecar runs from sidecar/, server root is ../server).
# Docker: set to /data, where a shared volume mounts "uploads/" at /data/uploads.
UPLOADS_PARENT_DIR = os.environ.get("UPLOADS_PARENT_DIR", "../server")

# Below this byte count, a rendered SVG is flagged as underfilled (the AI-
# generated script likely produced dot-soup instead of a real floor plan).
SVG_UNDERFILL_BYTES = 20_000


class HealthResponse(BaseModel):
    ok: bool = True
    ezdxf_version: str


class ExploreRequest(BaseModel):
    stored_file_uri: str = Field(..., description="Relative or absolute path to the DXF on the shared volume")


class ExploreResponse(BaseModel):
    exploration_json: dict[str, Any]
    structural_hash: str
    ms: int


class RenderThumbnailsBody(BaseModel):
    stored_file_uri: str
    exploration_json: dict[str, Any]
    thumbnail_dir: str


class RenderThumbnailsResponse(BaseModel):
    thumbnails: list[dict[str, Any]]
    ms: int


class ExecuteBody(BaseModel):
    stored_file_uri: str
    script_uri: str
    output_dir: str


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(ezdxf_version=ezdxf.__version__)


@app.post("/explore", response_model=ExploreResponse)
def explore(
    payload: ExploreRequest,
    x_request_id: str | None = Header(default=None, alias="X-Request-Id"),
) -> ExploreResponse:
    bind_request_id(x_request_id)
    path = _resolve_upload_path(payload.stored_file_uri)
    if not path.is_file():
        log.error("explore.file_missing", path=str(path))
        raise HTTPException(status_code=500, detail=f"file not found: {payload.stored_file_uri}")

    log.info("explore.begin", stored_file_uri=payload.stored_file_uri)
    try:
        exploration = explore_dxf(path)
    except Exception as exc:
        log.error("explore.failed", error=str(exc))
        raise HTTPException(status_code=500, detail=f"explorer crashed: {exc}") from exc

    structural_hash = structural_hash_for(exploration)
    log.info(
        "explore.ok",
        blocks=len(exploration.get("blocks", [])),
        ms=exploration["meta"]["ms"],
        structural_hash=structural_hash[:12],
    )
    return ExploreResponse(
        exploration_json=exploration,
        structural_hash=structural_hash,
        ms=exploration["meta"]["ms"],
    )


@app.post("/render-thumbnails", response_model=RenderThumbnailsResponse)
async def render_thumbnails_endpoint(
    body: RenderThumbnailsBody,
    request: Request,
) -> RenderThumbnailsResponse:
    req_id = request.headers.get("x-request-id", "")
    bind_request_id(req_id or None)
    t0 = time.monotonic()
    dxf_path = _resolve_upload_path(body.stored_file_uri)
    if not dxf_path.is_file():
        log.error("render_thumbnails.file_missing", path=str(dxf_path))
        raise HTTPException(
            status_code=500, detail=f"file not found: {body.stored_file_uri}"
        )
    thumb_dir = _resolve_upload_path(body.thumbnail_dir)
    try:
        thumbs = render_sheets(dxf_path, body.exploration_json, thumb_dir)
    except Exception as exc:
        log.error("render_thumbnails.failed", error=str(exc))
        raise HTTPException(status_code=500, detail=f"renderer crashed: {exc}") from exc
    # render_sheets returns absolute filesystem paths in ``png_uri`` so the
    # renderer can operate on concrete paths, but the server consumes URIs
    # relative to its own uploads dir (its bind-mount point differs from ours).
    # Rewrite to ``body.thumbnail_dir + filename`` so the server can resolve.
    uri_prefix = body.thumbnail_dir if body.thumbnail_dir.endswith("/") else body.thumbnail_dir + "/"
    for t in thumbs:
        t["png_uri"] = uri_prefix + Path(t["png_uri"]).name
    ms = int((time.monotonic() - t0) * 1000)
    log.info("render_thumbnails.ok", req_id=req_id, sheet_count=len(thumbs), ms=ms)
    return RenderThumbnailsResponse(thumbnails=thumbs, ms=ms)


@app.post("/execute")
async def execute_endpoint(
    body: ExecuteBody,
    request: Request,
) -> dict[str, Any]:
    req_id = request.headers.get("x-request-id", "")
    bind_request_id(req_id or None)
    t0 = time.monotonic()
    dxf_path = _resolve_upload_path(body.stored_file_uri)
    script_path = _resolve_upload_path(body.script_uri)
    out_dir = _resolve_upload_path(body.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    proc = await asyncio.create_subprocess_exec(
        "python3",
        str(script_path),
        str(dxf_path),
        str(out_dir),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env={**os.environ, "PYTHONUNBUFFERED": "1"},
        cwd=str(out_dir),
    )
    try:
        stdout_b, stderr_b = await asyncio.wait_for(proc.communicate(), timeout=110.0)
    except TimeoutError:
        proc.kill()
        ms = int((time.monotonic() - t0) * 1000)
        return {"ok": False, "traceback": "timeout after 110s", "ms": ms}

    ms = int((time.monotonic() - t0) * 1000)
    stderr_s = stderr_b.decode("utf-8", errors="replace")
    stdout_s = stdout_b.decode("utf-8", errors="replace")

    if proc.returncode != 0:
        log.warning("execute.crash", req_id=req_id, returncode=proc.returncode, ms=ms)
        return {"ok": False, "traceback": stderr_s[-4000:], "ms": ms}

    try:
        payload = json.loads(stdout_s)
    except json.JSONDecodeError as e:
        return {
            "ok": False,
            "traceback": f"malformed stdout: {e}\n{stdout_s[:4000]}",
            "ms": ms,
        }

    renders = payload.get("renders", [])
    # Scripts emit bare filenames (e.g. "render_01.svg") because they run with
    # cwd=out_dir. Resolve under out_dir and rewrite filename to a URI the
    # server can read (body.output_dir + filename).
    uri_prefix = body.output_dir if body.output_dir.endswith("/") else body.output_dir + "/"
    for r in renders:
        raw_name = r["filename"]
        abs_render = (
            Path(raw_name) if Path(raw_name).is_absolute() else out_dir / raw_name
        )
        if not abs_render.exists():
            return {"ok": False, "traceback": f"render missing: {raw_name}", "ms": ms}
        size = abs_render.stat().st_size
        r["filename"] = uri_prefix + Path(raw_name).name
        r["size_bytes"] = size
        if size < SVG_UNDERFILL_BYTES:
            r["svg_warning"] = f"underfilled: {size // 1024}KB"
    log.info("execute.ok", req_id=req_id, sheet_count=len(renders), ms=ms)
    return {
        "ok": True,
        "complianceData": payload.get("complianceData", {}),
        "renders": renders,
        "ms": ms,
    }


def _resolve_upload_path(uri: str) -> Path:
    """Resolve a URI under ``UPLOADS_PARENT_DIR``, rejecting any escape.

    Callers may pass either a relative path (e.g. ``"dxf/foo.dxf"``) or the
    absolute form of the same file. Any path that resolves outside the sandbox
    raises ``HTTPException(400, "path escape")``. This is especially important
    for ``/execute``, which launches the pointed-at script as a subprocess.

    Non-existent targets (e.g. a freshly-requested ``output_dir``) are allowed
    as long as their closest existing ancestor lives inside the sandbox — we
    resolve that ancestor and re-join the remaining tail so symlink tricks on
    missing parents cannot bypass the check.
    """
    root = Path(UPLOADS_PARENT_DIR).resolve()
    candidate = Path(uri)
    if not candidate.is_absolute():
        candidate = root / candidate

    # Walk up to the closest existing ancestor, resolve that, then re-join
    # the remaining non-existent tail. Path.resolve() on Windows with a
    # non-existent parent chain can return the literal path without
    # following symlinks on intermediate components, so this is safer.
    existing = candidate
    tail_parts: list[str] = []
    while not existing.exists():
        tail_parts.append(existing.name)
        parent = existing.parent
        if parent == existing:  # reached filesystem root without finding anything
            break
        existing = parent
    resolved_existing = existing.resolve()
    resolved = resolved_existing
    for part in reversed(tail_parts):
        resolved = resolved / part

    if resolved != root and root not in resolved.parents:
        raise HTTPException(status_code=400, detail=f"path escape: {uri!r}")
    return resolved
