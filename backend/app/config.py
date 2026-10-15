from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path


@lru_cache
def get_settings() -> "Settings":
    return Settings()


class Settings:
    def __init__(self) -> None:
        backend_dir = Path(__file__).resolve().parents[1]
        repo_root = backend_dir.parent
        default_data = repo_root / "data"
        raw = os.environ.get("DATA_DIR", str(default_data))
        self.data_dir = Path(raw).expanduser().resolve()
        self.ticks_dir = self.data_dir / "ticks"
        self.trades_dir = self.data_dir / "trades"
        self.tv_trades_tz = os.environ.get("TV_TRADES_TZ", "Europe/Bucharest")
        self.cors_origins = [
            o.strip()
            for o in os.environ.get(
                "CORS_ORIGINS",
                ",".join(
                    [
                        "http://localhost:5173",
                        "http://localhost:5174",
                        "http://127.0.0.1:5173",
                        "http://127.0.0.1:5174",
                    ]
                ),
            ).split(",")
            if o.strip()
        ]

    @property
    def manifest_path(self) -> Path:
        return self.ticks_dir / "_manifest.json"
