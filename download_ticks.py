"""Day-wise cTrader tick store for backtesting.

Layout (broker / MT5 server calendar days):
  data/ticks/{SYMBOL}/YYYY-MM-DD.parquet
  data/ticks/_manifest.json

Symbols & sessions come from market_hours.yml (times are broker clock).
cTrader still serves UTC epoch ms; we convert for day files and store both.

Commands:
  uv run python download_ticks.py bootstrap USDJPY --from 2026-04-01
  uv run python download_ticks.py bootstrap --from 2026-04-01          # all symbols in yaml
  uv run python download_ticks.py update USDJPY
  uv run python download_ticks.py update                               # every bootstrapped symbol

Limits: max 1 week per API request, ~10k ticks/page, 5 hist req/s.
"""
from __future__ import annotations

import argparse
import json
import os
import threading
import time
from collections import defaultdict
from datetime import UTC, date, datetime, timedelta, time as dtime
from pathlib import Path
from zoneinfo import ZoneInfo

import pyarrow as pa
import pyarrow.parquet as pq
import yaml
from ctrader_open_api import Client, EndPoints, Protobuf, TcpProtocol
from ctrader_open_api.messages.OpenApiMessages_pb2 import (
    ProtoOAAccountAuthReq,
    ProtoOAAccountAuthRes,
    ProtoOAApplicationAuthReq,
    ProtoOAApplicationAuthRes,
    ProtoOAErrorRes,
    ProtoOAGetAccountListByAccessTokenReq,
    ProtoOAGetAccountListByAccessTokenRes,
    ProtoOAGetTickDataReq,
    ProtoOAGetTickDataRes,
    ProtoOASymbolByIdReq,
    ProtoOASymbolByIdRes,
    ProtoOASymbolsListReq,
    ProtoOASymbolsListRes,
)
from ctrader_open_api.messages.OpenApiModelMessages_pb2 import ProtoOAQuoteType
from dotenv import load_dotenv
from twisted.internet import reactor

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data" / "ticks"
MARKET_HOURS_FILE = ROOT / "market_hours.yml"
MANIFEST_PATH = DATA_DIR / "_manifest.json"

# Pepperstone MT5 / market_hours.yml server clock (UTC+2 winter, UTC+3 DST).
DEFAULT_BROKER_TZ = "Europe/Bucharest"
WEEK_MS = 7 * 86_400_000
SLEEP = 0.22
SCALE = 100_000.0
MAX_RETRIES = 5
WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")


# ---- cTrader session ---------------------------------------------------------------------------

class CTraderError(Exception):
    def __init__(self, code, description=""):
        self.code = code
        super().__init__(f"{code}: {description}" if description else str(code))


class Session:
    def __init__(self, client_id, client_secret, access_token, host="demo"):
        self._client_id = client_id
        self._client_secret = client_secret
        self._access_token = access_token
        ep = (EndPoints.PROTOBUF_LIVE_HOST if host.lower() == "live"
              else EndPoints.PROTOBUF_DEMO_HOST)
        self.client = Client(ep, EndPoints.PROTOBUF_PORT, TcpProtocol)
        self._connected = threading.Event()
        self._app_authed = False
        self._accounts: set[int] = set()
        self._auth_lock = threading.RLock()
        self._pending: dict = {}
        self._pending_lock = threading.Lock()
        self._counter = 0
        self.client.setConnectedCallback(lambda _c: self._connected.set())
        self.client.setDisconnectedCallback(self._on_disconnected)
        self.client.setMessageReceivedCallback(lambda *_a: None)

    def _on_disconnected(self, _c, reason):
        self._connected.clear()
        with self._auth_lock:
            self._app_authed = False
            self._accounts.clear()
        with self._pending_lock:
            items = list(self._pending.values())
            self._pending.clear()
        for event, outcome in items:
            outcome["error"] = RuntimeError(f"disconnected: {reason}")
            event.set()

    def start(self, timeout=30):
        if not getattr(Session, "_reactor", False):
            threading.Thread(target=reactor.run, kwargs={"installSignalHandlers": False},
                             daemon=True).start()
            Session._reactor = True
            time.sleep(0.2)
        reactor.callFromThread(self.client.startService)
        if not self._connected.wait(timeout):
            raise RuntimeError("timed out connecting to cTrader")

    def ensure_ready(self, account_ids):
        if not self._connected.is_set():
            raise RuntimeError("not connected")
        with self._auth_lock:
            if not self._app_authed:
                req = ProtoOAApplicationAuthReq()
                req.clientId = self._client_id
                req.clientSecret = self._client_secret
                self.request(req, (ProtoOAApplicationAuthRes,))
                self._app_authed = True
            for account_id in account_ids:
                if account_id in self._accounts:
                    continue
                req = ProtoOAAccountAuthReq()
                req.ctidTraderAccountId = account_id
                req.accessToken = self._access_token
                try:
                    self.request(req, (ProtoOAAccountAuthRes,))
                except CTraderError as exc:
                    if exc.code != "ALREADY_LOGGED_IN":
                        raise
                self._accounts.add(account_id)

    def request(self, message, expected, timeout=90):
        event = threading.Event()
        outcome: dict = {}
        with self._pending_lock:
            self._counter += 1
            key = self._counter
            self._pending[key] = (event, outcome)

        def _send():
            deferred = self.client.send(message, responseTimeoutInSeconds=timeout)
            deferred.addCallbacks(
                lambda r: self._settle(key, "response", Protobuf.extract(r)),
                lambda f: self._settle(key, "error", RuntimeError(str(f))),
            )

        reactor.callFromThread(_send)
        if not event.wait(timeout + 5):
            with self._pending_lock:
                self._pending.pop(key, None)
            raise RuntimeError(f"timed out waiting for {type(message).__name__}")
        if "error" in outcome:
            raise outcome["error"]
        payload = outcome["response"]
        if isinstance(payload, ProtoOAErrorRes):
            raise CTraderError(payload.errorCode, payload.description)
        if expected and not isinstance(payload, tuple(expected)):
            raise RuntimeError(f"unexpected {type(payload).__name__}")
        return payload

    def _settle(self, key, kind, value):
        with self._pending_lock:
            item = self._pending.pop(key, None)
        if not item:
            return
        event, outcome = item
        outcome[kind] = value
        event.set()


# ---- market hours / calendar -------------------------------------------------------------------

def broker_tz() -> ZoneInfo:
    name = (os.environ.get("TICKS_BROKER_TZ")
            or os.environ.get("CTRADER_TIMEZONE")
            or DEFAULT_BROKER_TZ)
    return ZoneInfo(name)


def load_market_hours() -> dict:
    if not MARKET_HOURS_FILE.exists():
        raise SystemExit(f"missing {MARKET_HOURS_FILE}")
    raw = yaml.safe_load(MARKET_HOURS_FILE.read_text(encoding="utf-8")) or {}
    return {str(k): v for k, v in raw.items() if isinstance(v, dict)}


def sessions_for_day(hours: dict, day: date) -> list[tuple[dtime, dtime]]:
    """Parse market_hours sessions for one calendar day. Empty = closed."""
    key = WEEKDAYS[day.weekday()]
    raw = hours.get(key)
    if not raw:
        return []
    if isinstance(raw, str):
        raw = [raw]
    out = []
    for piece in raw:
        piece = str(piece).strip()
        if not piece or "-" not in piece:
            continue
        a, b = piece.split("-", 1)
        hh, mm = map(int, a.split(":"))
        hh2, mm2 = map(int, b.split(":"))
        out.append((dtime(hh, mm), dtime(hh2, mm2)))
    return out


def is_open_day(hours: dict, day: date) -> bool:
    return bool(sessions_for_day(hours, day))


def day_bounds_ms(day: date, tz: ZoneInfo) -> tuple[int, int]:
    """[start, end) of a broker calendar day in UTC epoch ms."""
    start = datetime.combine(day, dtime(0, 0), tzinfo=tz)
    end = start + timedelta(days=1)
    return int(start.timestamp() * 1000), int(end.timestamp() * 1000)


def iter_days(start: date, end: date):
    """Inclusive start, exclusive end (end = day after last wanted)."""
    d = start
    while d < end:
        yield d
        d += timedelta(days=1)


def group_days(days: list[date], max_span: int = 7) -> list[tuple[date, date]]:
    """Group consecutive dates into inclusive ranges, each spanning at most max_span days."""
    if not days:
        return []
    days = sorted(days)
    ranges = []
    a = b = days[0]
    for d in days[1:]:
        if d == b + timedelta(days=1) and (d - a).days + 1 <= max_span:
            b = d
        else:
            ranges.append((a, b))
            a = b = d
    ranges.append((a, b))
    return ranges


# ---- manifest / files --------------------------------------------------------------------------

def load_manifest() -> dict:
    if not MANIFEST_PATH.exists():
        return {"broker_tz": DEFAULT_BROKER_TZ, "symbols": {}}
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


def save_manifest(manifest: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    manifest["broker_tz"] = str(broker_tz())
    tmp = MANIFEST_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    tmp.replace(MANIFEST_PATH)


def symbol_dir(symbol: str) -> Path:
    return DATA_DIR / symbol


def day_path(symbol: str, day: date) -> Path:
    return symbol_dir(symbol) / f"{day.isoformat()}.parquet"


def existing_days(symbol: str) -> set[date]:
    d = symbol_dir(symbol)
    if not d.exists():
        return set()
    out = set()
    for p in d.glob("????-??-??.parquet"):
        try:
            out.add(date.fromisoformat(p.stem))
        except ValueError:
            continue
    return out


def schema():
    return pa.schema([
        ("timestamp_ms", pa.int64()),
        ("time_utc", pa.timestamp("ms", tz="UTC")),
        ("time_broker", pa.timestamp("ms", tz=str(broker_tz()))),
        ("side", pa.dictionary(pa.int8(), pa.string())),
        ("price", pa.float64()),
        ("symbol", pa.dictionary(pa.int8(), pa.string())),
    ])


def write_day(symbol: str, day: date, rows: list[tuple[int, float, str]]) -> int:
    """rows: (utc_ms, price, side). Overwrites the day file."""
    if not rows:
        return 0
    rows = sorted(rows, key=lambda r: (r[0], r[2]))
    # de-dupe exact duplicates from overlapping fetches
    deduped = []
    seen = set()
    for r in rows:
        key = (r[0], r[2], r[1])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(r)
    ts_ms = [r[0] for r in deduped]
    tz = broker_tz()
    table = pa.table({
        "timestamp_ms": ts_ms,
        "time_utc": pa.array(ts_ms, type=pa.timestamp("ms", tz="UTC")),
        "time_broker": pa.array(ts_ms, type=pa.timestamp("ms", tz=str(tz))),
        "side": pa.array([r[2] for r in deduped], type=pa.dictionary(pa.int8(), pa.string())),
        "price": [r[1] for r in deduped],
        "symbol": pa.array([symbol] * len(deduped), type=pa.dictionary(pa.int8(), pa.string())),
    }, schema=schema())
    path = day_path(symbol, day)
    path.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(table, path, compression="zstd")
    return len(deduped)


# ---- fetch -------------------------------------------------------------------------------------

def decode_chunk(tick_data, digits: int) -> list[tuple[int, float]]:
    if not tick_data:
        return []
    rows, ts, px = [], 0, 0
    for t in tick_data:
        ts += t.timestamp
        px += t.tick
        rows.append((ts, round(px / SCALE, digits)))
    rows.reverse()
    return rows


def fetch(session, account_id, symbol_id, quote_type, frm, to):
    last = None
    for attempt in range(1, MAX_RETRIES + 1):
        req = ProtoOAGetTickDataReq()
        req.ctidTraderAccountId = account_id
        req.symbolId = symbol_id
        req.type = quote_type
        req.fromTimestamp = int(frm)
        req.toTimestamp = int(to)
        time.sleep(SLEEP)
        try:
            session.ensure_ready([account_id])
            return session.request(req, (ProtoOAGetTickDataRes,), timeout=90)
        except Exception as exc:  # noqa: BLE001
            last = exc
            wait = min(30, 2 ** attempt)
            print(f"    retry {attempt}/{MAX_RETRIES}: {type(exc).__name__}: {exc} (sleep {wait}s)")
            time.sleep(wait)
    raise RuntimeError(f"tick fetch failed: {last}")


def fetch_range(session, account_id, symbol_id, quote_type, side, frm, to, digits):
    out = []
    cursor_to = to
    pages = 0
    while cursor_to > frm:
        res = fetch(session, account_id, symbol_id, quote_type, frm, cursor_to)
        pages += 1
        chunk = decode_chunk(res.tickData, digits)
        if not chunk:
            break
        out.extend((ts, px, side) for ts, px in chunk)
        oldest = chunk[0][0]
        if not res.hasMore:
            break
        cursor_to = oldest - 1
        if pages % 25 == 0:
            print(f"    ... {side} pages={pages} ticks={len(out):,} "
                  f"back_to={datetime.fromtimestamp(oldest / 1000, UTC)}")
    return out


def bucket_by_broker_day(rows: list[tuple[int, float, str]], tz: ZoneInfo) -> dict[date, list]:
    buckets: dict[date, list] = defaultdict(list)
    for ts, px, side in rows:
        day = datetime.fromtimestamp(ts / 1000, tz).date()
        buckets[day].append((ts, px, side))
    return buckets


def connect() -> tuple[Session, int]:
    load_dotenv()
    client_id = os.environ.get("CTRADER_CLIENT_ID", "").strip()
    client_secret = os.environ.get("CTRADER_CLIENT_SECRET", "").strip()
    access_token = os.environ.get("CTRADER_ACCESS_TOKEN", "").strip()
    host = os.environ.get("CTRADER_HOST", "demo").strip()
    if not (client_id and client_secret and access_token):
        raise SystemExit("Set CTRADER_CLIENT_ID / CTRADER_CLIENT_SECRET / CTRADER_ACCESS_TOKEN in .env")

    session = Session(client_id, client_secret, access_token, host)
    session.start()
    app = ProtoOAApplicationAuthReq()
    app.clientId = client_id
    app.clientSecret = client_secret
    session.request(app, (ProtoOAApplicationAuthRes,))
    session._app_authed = True

    acc_req = ProtoOAGetAccountListByAccessTokenReq()
    acc_req.accessToken = access_token
    acc_res = session.request(acc_req, (ProtoOAGetAccountListByAccessTokenRes,))
    accounts = [a.ctidTraderAccountId for a in acc_res.ctidTraderAccount]
    if not accounts:
        raise SystemExit("access token grants no accounts")
    forced = os.environ.get("CTRADER_ACCOUNT_ID", "").strip()
    account_id = int(forced) if forced else accounts[0]
    if account_id not in accounts:
        raise SystemExit(f"CTRADER_ACCOUNT_ID={account_id} not in token accounts {accounts}")
    session.ensure_ready([account_id])
    return session, account_id


def resolve_symbol(session, account_id, symbol: str) -> tuple[int, int]:
    """Return (symbol_id, digits). Match yaml name case-insensitively."""
    req = ProtoOASymbolsListReq()
    req.ctidTraderAccountId = account_id
    res = session.request(req, (ProtoOASymbolsListRes,))
    want = symbol.upper()
    hit = next((s for s in res.symbol if s.symbolName.upper() == want), None)
    if hit is None:
        # try without dots / common aliases
        hit = next((s for s in res.symbol if s.symbolName.upper().replace(".", "") == want.replace(".", "")), None)
    if hit is None:
        raise SystemExit(f"{symbol} not listed on account {account_id}")
    det = ProtoOASymbolByIdReq()
    det.ctidTraderAccountId = account_id
    det.symbolId.append(hit.symbolId)
    digits = int(session.request(det, (ProtoOASymbolByIdRes,)).symbol[0].digits)
    return hit.symbolId, digits


# ---- core download -----------------------------------------------------------------------------

def download_ranges(
    session, account_id, symbol: str, symbol_id: int, digits: int,
    ranges: list[tuple[date, date]], sides: list[tuple[str, int]], tz: ZoneInfo,
) -> tuple[int, int | None]:
    """Fetch inclusive broker-day ranges; write day parquets. Returns (ticks_written, last_ts)."""
    written = 0
    last_ts = None
    for a, b in ranges:
        frm, _ = day_bounds_ms(a, tz)
        _, to = day_bounds_ms(b, tz)  # exclusive end of last day
        # cTrader wants toTimestamp inside the window; use last ms of last day
        to_inclusive = to - 1
        label = f"{a.isoformat()}" if a == b else f"{a.isoformat()}..{b.isoformat()}"
        print(f"  fetch {label}")
        rows = []
        for side, qtype in sides:
            got = fetch_range(session, account_id, symbol_id, qtype, side, frm, to_inclusive, digits)
            print(f"    {side}: {len(got):,}")
            rows.extend(got)
        if not rows:
            print("    (no ticks)")
            continue
        buckets = bucket_by_broker_day(rows, tz)
        for day in sorted(buckets):
            # only write days inside the requested inclusive range
            if day < a or day > b:
                continue
            existing_rows = []
            path = day_path(symbol, day)
            if path.exists():
                old = pq.read_table(path, columns=["timestamp_ms", "price", "side"])
                existing_rows = list(zip(
                    old["timestamp_ms"].to_pylist(),
                    old["price"].to_pylist(),
                    old["side"].to_pylist(),
                ))
            merged = existing_rows + buckets[day]
            n = write_day(symbol, day, merged)
            written += n
            day_last = max(r[0] for r in merged)
            last_ts = day_last if last_ts is None else max(last_ts, day_last)
            print(f"    wrote {day.isoformat()} ({n:,})")
    return written, last_ts


def sides_from_arg(side: str) -> list[tuple[str, int]]:
    out = []
    if side in ("BOTH", "BID"):
        out.append(("BID", ProtoOAQuoteType.BID))
    if side in ("BOTH", "ASK"):
        out.append(("ASK", ProtoOAQuoteType.ASK))
    return out


def update_manifest_symbol(manifest: dict, symbol: str, last_ts: int | None, digits: int, symbol_id: int):
    tz = broker_tz()
    entry = manifest.setdefault("symbols", {}).setdefault(symbol, {})
    entry["digits"] = digits
    entry["symbol_id"] = symbol_id
    if last_ts is not None:
        prev = entry.get("last_ts_ms") or 0
        entry["last_ts_ms"] = max(int(prev), int(last_ts))
        entry["last_day"] = datetime.fromtimestamp(entry["last_ts_ms"] / 1000, tz).date().isoformat()
    # also bump from files on disk
    days = existing_days(symbol)
    if days:
        latest = max(days)
        path = day_path(symbol, latest)
        table = pq.read_table(path, columns=["timestamp_ms"])
        file_last = max(table["timestamp_ms"].to_pylist())
        entry["last_ts_ms"] = max(int(entry.get("last_ts_ms") or 0), file_last)
        entry["last_day"] = datetime.fromtimestamp(entry["last_ts_ms"] / 1000, tz).date().isoformat()


def cmd_bootstrap(args):
    hours_all = load_market_hours()
    tz = broker_tz()
    symbols = ([args.symbol] if args.symbol
               else sorted(hours_all.keys()))
    if args.symbol and args.symbol not in hours_all:
        # allow symbol not in yaml but warn
        print(f"warning: {args.symbol} not in market_hours.yml — treating every weekday as open")
        hours_all[args.symbol] = {d: "00:00-23:59" for d in WEEKDAYS[:5]}

    start = date.fromisoformat(args.from_date)
    end_day = (date.fromisoformat(args.to_date) if args.to_date
               else datetime.now(tz).date())
    # end_day inclusive for user; convert to exclusive for iter
    end_excl = end_day + timedelta(days=1)
    sides = sides_from_arg(args.side)

    print(f"bootstrap {len(symbols)} symbol(s)  {start} -> {end_day}  tz={tz}")
    print(f"store {DATA_DIR}")

    session, account_id = connect()
    print(f"account {account_id}")
    manifest = load_manifest()

    for symbol in symbols:
        hours = hours_all.get(symbol) or hours_all.get(symbol.upper()) or {}
        # yaml keys preserve dots; match case from file
        yaml_name = next((k for k in hours_all if k.upper() == symbol.upper()), symbol)
        hours = hours_all[yaml_name]
        symbol = yaml_name

        print(f"\n=== {symbol} ===")
        try:
            symbol_id, digits = resolve_symbol(session, account_id, symbol)
        except SystemExit as exc:
            print(f"  SKIP: {exc}")
            continue
        print(f"  symbolId={symbol_id} digits={digits}")

        have = existing_days(symbol)
        today_broker = datetime.now(tz).date()
        need = []
        for d in iter_days(start, end_excl):
            if not is_open_day(hours, d):
                continue
            if d in have and d < today_broker and not args.force:
                continue  # complete past day
            need.append(d)
        if not need:
            print("  nothing to do (all open days present)")
            update_manifest_symbol(manifest, symbol, None, digits, symbol_id)
            save_manifest(manifest)
            continue

        ranges = group_days(need, max_span=7)
        print(f"  {len(need)} day(s) in {len(ranges)} fetch window(s)")
        written, last_ts = download_ranges(
            session, account_id, symbol, symbol_id, digits, ranges, sides, tz)
        update_manifest_symbol(manifest, symbol, last_ts, digits, symbol_id)
        save_manifest(manifest)
        print(f"  done {symbol}: wrote {written:,} tick-rows; "
              f"last_ts={manifest['symbols'][symbol].get('last_ts_ms')}")


def cmd_update(args):
    hours_all = load_market_hours()
    tz = broker_tz()
    manifest = load_manifest()
    known = list(manifest.get("symbols") or {})
    if args.symbol:
        symbols = [args.symbol]
    elif known:
        symbols = known
    else:
        raise SystemExit("nothing to update — run bootstrap first, or pass a symbol")

    sides = sides_from_arg(args.side)
    now = datetime.now(tz)
    print(f"update {len(symbols)} symbol(s) -> {now:%Y-%m-%d %H:%M} {tz}")

    session, account_id = connect()
    print(f"account {account_id}")

    for symbol in symbols:
        yaml_name = next((k for k in hours_all if k.upper() == symbol.upper()), symbol)
        symbol = yaml_name
        hours = hours_all.get(symbol, {d: "00:00-23:59" for d in WEEKDAYS[:5]})
        print(f"\n=== {symbol} ===")
        try:
            symbol_id, digits = resolve_symbol(session, account_id, symbol)
        except SystemExit as exc:
            print(f"  SKIP: {exc}")
            continue

        entry = (manifest.get("symbols") or {}).get(symbol) or {}
        last_ts = entry.get("last_ts_ms")
        if last_ts is None:
            # fall back to newest day file
            days = existing_days(symbol)
            if not days:
                print("  no data yet — run: bootstrap SYMBOL --from YYYY-MM-DD")
                continue
            latest = max(days)
            last_ts = max(pq.read_table(day_path(symbol, latest),
                                        columns=["timestamp_ms"])["timestamp_ms"].to_pylist())

        frm = int(last_ts) + 1
        to = int(now.timestamp() * 1000)
        if frm >= to:
            print("  already up to date")
            continue

        start_day = datetime.fromtimestamp(frm / 1000, tz).date()
        end_day = now.date()
        need = [d for d in iter_days(start_day, end_day + timedelta(days=1)) if is_open_day(hours, d)]
        if not need:
            print("  no open days in gap")
            continue
        ranges = group_days(need, max_span=7)
        print(f"  from ts {frm} ({datetime.fromtimestamp(frm/1000, tz)})")
        print(f"  {len(need)} day(s) in {len(ranges)} window(s)")

        # For update, fetch exact ms range but still bucket to day files
        written = 0
        new_last = int(last_ts)
        for a, b in ranges:
            day_frm, _ = day_bounds_ms(a, tz)
            _, day_to = day_bounds_ms(b, tz)
            window_frm = max(frm, day_frm)
            window_to = min(to, day_to) - 1
            if window_frm > window_to:
                continue
            print(f"  fetch {a}..{b}  ({window_frm} -> {window_to})")
            rows = []
            for side, qtype in sides:
                got = fetch_range(session, account_id, symbol_id, qtype, side,
                                  window_frm, window_to, digits)
                print(f"    {side}: {len(got):,}")
                rows.extend(got)
            if not rows:
                continue
            for day, bucket in sorted(bucket_by_broker_day(rows, tz).items()):
                existing_rows = []
                path = day_path(symbol, day)
                if path.exists():
                    old = pq.read_table(path, columns=["timestamp_ms", "price", "side"])
                    existing_rows = list(zip(
                        old["timestamp_ms"].to_pylist(),
                        old["price"].to_pylist(),
                        old["side"].to_pylist(),
                    ))
                n = write_day(symbol, day, existing_rows + bucket)
                written += n
                new_last = max(new_last, max(r[0] for r in existing_rows + bucket))
                print(f"    wrote {day.isoformat()} ({n:,})")

        update_manifest_symbol(manifest, symbol, new_last, digits, symbol_id)
        save_manifest(manifest)
        print(f"  done {symbol}: {written:,} rows; last_ts={manifest['symbols'][symbol]['last_ts_ms']}")


def build_parser():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    b = sub.add_parser("bootstrap", help="fill missing day files from --from to --to/now")
    b.add_argument("symbol", nargs="?", help="one symbol; omit = all in market_hours.yml")
    b.add_argument("--from", dest="from_date", required=True, help="broker-date YYYY-MM-DD")
    b.add_argument("--to", dest="to_date", default=None, help="broker-date YYYY-MM-DD (default: today)")
    b.add_argument("--side", choices=("BOTH", "BID", "ASK"), default="BOTH")
    b.add_argument("--force", action="store_true", help="re-download days that already exist")

    u = sub.add_parser("update", help="append ticks from each symbol's last tick to now")
    u.add_argument("symbol", nargs="?", help="one symbol; omit = all in manifest")
    u.add_argument("--side", choices=("BOTH", "BID", "ASK"), default="BOTH")
    return p


def main():
    load_dotenv()
    args = build_parser().parse_args()
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if args.cmd == "bootstrap":
        cmd_bootstrap(args)
    elif args.cmd == "update":
        cmd_update(args)
    else:
        raise SystemExit(f"unknown command {args.cmd}")


if __name__ == "__main__":
    main()
