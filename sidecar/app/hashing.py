import hashlib
import json
from typing import Any


def canonical_sha256(obj: Any) -> str:
    """SHA-256 of a canonically-serialized JSON object.

    The same input (regardless of dict key order) produces the same hash, so
    structurally-identical explorationJson payloads yield identical
    ``structuralHash`` values. Used by phase 4b to cache AI-generated
    extraction scripts keyed by DXF structure.
    """
    encoded = json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode(
        "utf-8"
    )
    return hashlib.sha256(encoded).hexdigest()
