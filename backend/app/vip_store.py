"""VIP accounts saved as JSON until a database is added."""

from __future__ import annotations

import json
import os
import threading
import uuid
from pathlib import Path
from typing import Any

from app.config import get_settings

_LOCK = threading.Lock()


def vip_path() -> Path:
    return get_settings().data_dir / "vips.json"


def _read() -> list[dict[str, Any]]:
    path = vip_path()
    if not path.exists():
        return []
    raw = json.loads(path.read_text(encoding="utf-8"))
    vips = raw.get("vips") if isinstance(raw, dict) else None
    return list(vips) if isinstance(vips, list) else []


def _write(vips: list[dict[str, Any]]) -> None:
    path = vip_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps({"vips": vips}, indent=2)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(payload, encoding="utf-8")
    os.replace(tmp, path)


def list_vips() -> list[dict[str, Any]]:
    with _LOCK:
        return _read()


def get_vip(vip_id: str) -> dict[str, Any] | None:
    with _LOCK:
        for vip in _read():
            if vip.get("id") == vip_id:
                return vip
    return None


def create_vip(name: str) -> dict[str, Any]:
    vip = {"id": str(uuid.uuid4()), "name": name.strip(), "lines": []}
    with _LOCK:
        vips = _read()
        vips.append(vip)
        _write(vips)
    return vip


def update_vip(
    vip_id: str,
    *,
    name: str | None = None,
    lines: list[dict[str, Any]] | None = None,
) -> dict[str, Any] | None:
    with _LOCK:
        vips = _read()
        for vip in vips:
            if vip.get("id") != vip_id:
                continue
            if name is not None:
                vip["name"] = name.strip()
            if lines is not None:
                vip["lines"] = lines
            _write(vips)
            return vip
    return None


def delete_vip(vip_id: str) -> bool:
    with _LOCK:
        vips = _read()
        kept = [vip for vip in vips if vip.get("id") != vip_id]
        if len(kept) == len(vips):
            return False
        _write(kept)
        return True
