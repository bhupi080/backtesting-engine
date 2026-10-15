from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from app.config import Settings, get_settings
from app import duckdb_client as db

_DEFAULT_BROKER_TZ = "Europe/Bucharest"
_TZ_NAME_RE = re.compile(r"^[A-Za-z0-9_+\-/]+$")


def broker_tz_name(settings: Settings | None = None) -> str:
    """IANA broker TZ from tick manifest; safe fallback for SQL embedding."""
    tz = (load_manifest(settings).get("broker_tz") or _DEFAULT_BROKER_TZ).strip()
    if not _TZ_NAME_RE.fullmatch(tz):
        return _DEFAULT_BROKER_TZ
    return tz


def _fmt_utc(expr: str) -> str:
    """DuckDB: format timestamptz/timestamp as UTC wall clock."""
    return f"strftime(timezone('UTC', {expr}), '%Y-%m-%d %H:%M:%S.%g')"


def _fmt_broker(expr: str, tz: str) -> str:
    """DuckDB: format timestamptz/timestamp as broker wall clock."""
    return f"strftime(timezone('{tz}', {expr}), '%Y-%m-%d %H:%M:%S.%g')"


def _symbol_dirs(settings: Settings) -> list[Path]:
    if not settings.ticks_dir.exists():
        return []
    return sorted(
        p for p in settings.ticks_dir.iterdir() if p.is_dir() and not p.name.startswith("_")
    )


def _duck_path(path: Path) -> str:
    return str(path.resolve()).replace("\\", "/")


def parquet_glob(symbol: str, settings: Settings | None = None) -> str:
    settings = settings or get_settings()
    return _duck_path(settings.ticks_dir / symbol / "*.parquet")


def parquet_source(
    symbol: str,
    from_ts: str | None = None,
    to_ts: str | None = None,
    settings: Settings | None = None,
) -> str:
    """Prefer a single day file when range is unset or same calendar day (broker)."""
    settings = settings or get_settings()
    sym_dir = settings.ticks_dir / symbol
    if not from_ts and not to_ts:
        manifest = load_manifest(settings)
        last_day = (manifest.get("symbols") or {}).get(symbol, {}).get("last_day")
        if last_day:
            day_file = sym_dir / f"{last_day}.parquet"
            if day_file.exists():
                return _duck_path(day_file)
    # Same UTC date in from/to → try that day file
    if from_ts and to_ts and from_ts[:10] == to_ts[:10]:
        day_file = sym_dir / f"{from_ts[:10]}.parquet"
        if day_file.exists():
            return _duck_path(day_file)
    return parquet_glob(symbol, settings)


def list_datasets(settings: Settings | None = None) -> list[dict[str, Any]]:
    settings = settings or get_settings()
    db.init()
    out: list[dict[str, Any]] = []
    for sym_dir in _symbol_dirs(settings):
        symbol = sym_dir.name
        files = sorted(sym_dir.glob("*.parquet"))
        if not files:
            continue
        glob = parquet_glob(symbol, settings)
        tz = broker_tz_name(settings)
        stats = db.query_one(
            f"""
            SELECT
              count(*)::BIGINT AS row_count,
              {_fmt_utc("min(time_utc)")} AS min_time_utc,
              {_fmt_utc("max(time_utc)")} AS max_time_utc,
              {_fmt_broker("min(time_broker)", tz)} AS min_time_broker,
              {_fmt_broker("max(time_broker)", tz)} AS max_time_broker
            FROM read_parquet(?)
            """,
            [glob],
        ) or {}
        out.append(
            {
                "id": symbol,
                "symbol": symbol,
                "path_glob": glob,
                "file_count": len(files),
                "row_count": int(stats.get("row_count") or 0),
                "min_time_utc": stats.get("min_time_utc"),
                "max_time_utc": stats.get("max_time_utc"),
                "min_time_broker": stats.get("min_time_broker"),
                "max_time_broker": stats.get("max_time_broker"),
            }
        )
    return out


def dataset_schema(dataset_id: str, settings: Settings | None = None) -> dict[str, Any]:
    settings = settings or get_settings()
    glob = parquet_glob(dataset_id, settings)
    if not list((settings.ticks_dir / dataset_id).glob("*.parquet")):
        raise FileNotFoundError(dataset_id)
    db.init()
    rows = db.query(f"DESCRIBE SELECT * FROM read_parquet(?) LIMIT 0", [glob])
    return {
        "id": dataset_id,
        "fields": [{"name": r["column_name"], "type": r["column_type"]} for r in rows],
    }


def _time_filters(
    from_ts: str | None,
    to_ts: str | None,
    side: str | None,
    symbol: str | None,
) -> tuple[str, list[Any]]:
    clauses: list[str] = []
    params: list[Any] = []
    if symbol:
        clauses.append("symbol = ?")
        params.append(symbol)
    if side and side.upper() in {"BID", "ASK"}:
        clauses.append("side = ?")
        params.append(side.upper())
    if from_ts:
        clauses.append("time_utc >= CAST(? AS TIMESTAMPTZ)")
        params.append(from_ts)
    if to_ts:
        clauses.append("time_utc <= CAST(? AS TIMESTAMPTZ)")
        params.append(to_ts)
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    return where, params


def _finite(v: Any) -> float | None:
    if v is None:
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    if x != x or x in (float("inf"), float("-inf")):  # NaN / inf
        return None
    return x


def overview(
    symbol: str,
    from_ts: str | None = None,
    to_ts: str | None = None,
    side: str | None = None,
    max_points: int = 3000,
    settings: Settings | None = None,
) -> dict[str, Any]:
    settings = settings or get_settings()
    source = parquet_source(symbol, from_ts, to_ts, settings)
    db.init()
    where, params = _time_filters(from_ts, to_ts, side, symbol)
    metrics = db.query_one(
        f"""
        SELECT
          count(*)::BIGINT AS tick_count,
          count(*) FILTER (WHERE side = 'BID')::BIGINT AS bid_count,
          count(*) FILTER (WHERE side = 'ASK')::BIGINT AS ask_count,
          min(price) AS min_price,
          max(price) AS max_price,
          avg(price) AS avg_price,
          arg_max(price, timestamp_ms) AS last_price
        FROM read_parquet(?)
        {where}
        """,
        [source, *params],
    ) or {}

    # Downsample via equal-width timestamp buckets (~max_points)
    series = db.query(
        f"""
        WITH base AS (
          SELECT time_utc, price, side, timestamp_ms
          FROM read_parquet(?)
          {where}
        ),
        bounds AS (
          SELECT
            min(timestamp_ms) AS t0,
            max(timestamp_ms) AS t1,
            count(*)::BIGINT AS n
          FROM base
        ),
        bucketed AS (
          SELECT
            CASE
              WHEN (SELECT n FROM bounds) <= ? OR (SELECT t1 - t0 FROM bounds) = 0
                THEN timestamp_ms
              ELSE t0 + cast(
                floor(
                  (timestamp_ms - t0) * ?::DOUBLE
                  / greatest((t1 - t0), 1)
                ) * (t1 - t0) / ? AS BIGINT
              )
            END AS bucket_ms,
            avg(price) AS price,
            avg(CASE WHEN side = 'ASK' THEN price END)
              - avg(CASE WHEN side = 'BID' THEN price END) AS spread
          FROM base, bounds
          GROUP BY 1
        )
        SELECT
          cast(to_timestamp(bucket_ms / 1000.0) AS VARCHAR) AS t,
          price,
          spread
        FROM bucketed
        WHERE bucket_ms IS NOT NULL
        ORDER BY bucket_ms
        LIMIT ?
        """,
        [source, *params, max_points, max_points, max_points, max_points],
    )

    return {
        "metrics": {
            "symbol": symbol,
            "side": side,
            "from_ts": from_ts,
            "to_ts": to_ts,
            "tick_count": int(metrics.get("tick_count") or 0),
            "bid_count": int(metrics.get("bid_count") or 0),
            "ask_count": int(metrics.get("ask_count") or 0),
            "min_price": _finite(metrics.get("min_price")),
            "max_price": _finite(metrics.get("max_price")),
            "avg_price": _finite(metrics.get("avg_price")),
            "last_price": _finite(metrics.get("last_price")),
        },
        "series": [
            {
                "t": r["t"],
                "price": _finite(r["price"]) or 0.0,
                "spread": _finite(r["spread"]),
            }
            for r in series
            if _finite(r["price"]) is not None
        ],
    }


ALLOWED_SORT = {
    "timestamp_ms",
    "time_utc",
    "time_broker",
    "side",
    "price",
    "symbol",
}


def list_ticks(
    symbol: str,
    from_ts: str | None = None,
    to_ts: str | None = None,
    side: str | None = None,
    sort: str = "timestamp_ms",
    order: str = "asc",
    page: int = 1,
    page_size: int = 100,
    settings: Settings | None = None,
) -> dict[str, Any]:
    settings = settings or get_settings()
    glob = parquet_glob(symbol, settings)
    db.init()
    where, params = _time_filters(from_ts, to_ts, side, symbol)
    sort_col = sort if sort in ALLOWED_SORT else "timestamp_ms"
    sort_dir = "DESC" if order.lower() == "desc" else "ASC"
    page = max(1, page)
    page_size = min(max(1, page_size), 500)
    offset = (page - 1) * page_size

    total_row = db.query_one(
        f"SELECT count(*)::BIGINT AS total FROM read_parquet(?){where}",
        [glob, *params],
    ) or {"total": 0}

    tz = broker_tz_name(settings)
    rows = db.query(
        f"""
        SELECT
          timestamp_ms,
          {_fmt_utc("time_utc")} AS time_utc,
          {_fmt_broker("time_broker", tz)} AS time_broker,
          side,
          price,
          symbol
        FROM read_parquet(?)
        {where}
        ORDER BY {sort_col} {sort_dir}
        LIMIT ? OFFSET ?
        """,
        [glob, *params, page_size, offset],
    )
    return {
        "total": int(total_row["total"]),
        "page": page,
        "page_size": page_size,
        "rows": rows,
    }


def load_manifest(settings: Settings | None = None) -> dict[str, Any]:
    settings = settings or get_settings()
    path = settings.manifest_path
    if not path.exists():
        return {"broker_tz": "Europe/Bucharest", "symbols": {}}
    return json.loads(path.read_text(encoding="utf-8"))
