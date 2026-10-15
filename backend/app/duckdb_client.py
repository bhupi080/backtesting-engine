from __future__ import annotations

import threading
from typing import Any

import duckdb

_conn: duckdb.DuckDBPyConnection | None = None
_lock = threading.Lock()


def init() -> None:
    global _conn
    with _lock:
        if _conn is None:
            _conn = duckdb.connect(database=":memory:")


def get_conn() -> duckdb.DuckDBPyConnection:
    if _conn is None:
        init()
    assert _conn is not None
    return _conn


def query(sql: str, params: list[Any] | tuple[Any, ...] | None = None) -> list[dict[str, Any]]:
    with _lock:
        conn = get_conn()
        if params is None:
            rel = conn.execute(sql)
        else:
            rel = conn.execute(sql, params)
        cols = [d[0] for d in rel.description]
        rows = rel.fetchall()
        return [dict(zip(cols, row)) for row in rows]


def query_one(sql: str, params: list[Any] | tuple[Any, ...] | None = None) -> dict[str, Any] | None:
    rows = query(sql, params)
    return rows[0] if rows else None
