from __future__ import annotations

import subprocess
import threading
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

import yaml

JobCmd = Literal["update", "bootstrap"]
JobSide = Literal["BOTH", "BID", "ASK"]
JobStatus = Literal["queued", "running", "done", "failed", "cancelled"]

SCRIPT_PATH = Path(__file__).resolve().parent / "download_ticks.py"
REPO_ROOT = Path(__file__).resolve().parents[3]
MARKET_HOURS_FILE = REPO_ROOT / "market_hours.yml"
MAX_LOG_LINES = 2_000


def _market_hours_symbols() -> dict[str, str]:
    """Map UPPER -> canonical yaml key."""
    if not MARKET_HOURS_FILE.exists():
        raise ValueError(f"missing market_hours.yml at {MARKET_HOURS_FILE}")
    raw = yaml.safe_load(MARKET_HOURS_FILE.read_text(encoding="utf-8")) or {}
    out: dict[str, str] = {}
    for key, val in raw.items():
        if isinstance(val, dict):
            out[str(key).upper()] = str(key)
    return out


def resolve_market_hours_symbol(symbol: str) -> str:
    """Return canonical symbol from market_hours.yml or raise ValueError."""
    symbols = _market_hours_symbols()
    hit = symbols.get(symbol.strip().upper())
    if hit is None:
        raise ValueError(
            f"{symbol!r} is not in market_hours.yml — add a sessions block there first"
        )
    return hit


def list_market_hours_symbols() -> list[str]:
    """Canonical symbol keys from market_hours.yml, sorted."""
    return sorted(_market_hours_symbols().values(), key=str.upper)


def require_symbols_in_market_hours(req: TickJobCreate) -> TickJobCreate:
    """Reject jobs for symbols missing from market_hours.yml."""
    if req.symbol:
        canonical = resolve_market_hours_symbol(req.symbol)
        req.symbol = canonical
        return req
    # No symbol = all yaml symbols (bootstrap) or all manifest (update) — OK
    return req


@dataclass
class TickJobCreate:
    cmd: JobCmd
    symbol: str | None = None
    from_date: str | None = None  # bootstrap required
    to_date: str | None = None
    side: JobSide = "BOTH"
    force: bool = False


@dataclass
class TickJob:
    id: str
    cmd: JobCmd
    symbol: str | None
    from_date: str | None
    to_date: str | None
    side: JobSide
    force: bool
    status: JobStatus = "queued"
    created_at: str = field(default_factory=lambda: datetime.now(UTC).isoformat())
    started_at: str | None = None
    finished_at: str | None = None
    return_code: int | None = None
    error: str | None = None
    log_lines: list[str] = field(default_factory=list)
    argv: list[str] = field(default_factory=list)

    def to_dict(self, *, log_tail: int | None = 200) -> dict[str, Any]:
        lines = self.log_lines
        if log_tail is not None and log_tail >= 0:
            lines = lines[-log_tail:]
        return {
            "id": self.id,
            "cmd": self.cmd,
            "symbol": self.symbol,
            "from_date": self.from_date,
            "to_date": self.to_date,
            "side": self.side,
            "force": self.force,
            "status": self.status,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "return_code": self.return_code,
            "error": self.error,
            "argv": self.argv,
            "log": lines,
            "log_truncated": log_tail is not None and len(self.log_lines) > len(lines),
            "log_total_lines": len(self.log_lines),
        }


_lock = threading.Lock()
_jobs: dict[str, TickJob] = {}
_active_id: str | None = None
_active_proc: subprocess.Popen[str] | None = None


def _build_argv(req: TickJobCreate) -> list[str]:
    # Run via uv from repo root so ctrader/pyarrow come from workspace pyproject,
    # not the FastAPI venv alone.
    argv = ["uv", "run", "python", str(SCRIPT_PATH), req.cmd]
    if req.symbol:
        argv.append(req.symbol)
    if req.cmd == "bootstrap":
        if not req.from_date:
            raise ValueError("bootstrap requires from_date (YYYY-MM-DD)")
        argv.extend(["--from", req.from_date])
        if req.to_date:
            argv.extend(["--to", req.to_date])
        if req.force:
            argv.append("--force")
    argv.extend(["--side", req.side])
    return argv


def _append_log(job: TickJob, line: str) -> None:
    job.log_lines.append(line.rstrip("\n"))
    if len(job.log_lines) > MAX_LOG_LINES:
        overflow = len(job.log_lines) - MAX_LOG_LINES
        job.log_lines = job.log_lines[overflow:]


def _run_job(job_id: str) -> None:
    global _active_id, _active_proc

    with _lock:
        job = _jobs[job_id]
        job.status = "running"
        job.started_at = datetime.now(UTC).isoformat()
        argv = list(job.argv)

    try:
        proc = subprocess.Popen(
            argv,
            cwd=str(REPO_ROOT),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
        with _lock:
            _active_proc = proc

        assert proc.stdout is not None
        for line in proc.stdout:
            with _lock:
                _append_log(_jobs[job_id], line)

        code = proc.wait()
        with _lock:
            job = _jobs[job_id]
            job.return_code = code
            job.finished_at = datetime.now(UTC).isoformat()
            if job.status == "cancelled":
                pass
            elif code == 0:
                job.status = "done"
            else:
                job.status = "failed"
                job.error = f"process exited with code {code}"
    except Exception as exc:  # noqa: BLE001
        with _lock:
            job = _jobs[job_id]
            if job.status != "cancelled":
                job.status = "failed"
                job.error = f"{type(exc).__name__}: {exc}"
            job.finished_at = datetime.now(UTC).isoformat()
            _append_log(job, f"[runner] {job.error}")
    finally:
        with _lock:
            if _active_id == job_id:
                _active_id = None
                _active_proc = None


def start_job(req: TickJobCreate) -> TickJob:
    global _active_id

    req = require_symbols_in_market_hours(req)
    argv = _build_argv(req)
    job_id = uuid.uuid4().hex[:12]
    job = TickJob(
        id=job_id,
        cmd=req.cmd,
        symbol=req.symbol,
        from_date=req.from_date,
        to_date=req.to_date,
        side=req.side,
        force=req.force,
        argv=argv,
    )

    with _lock:
        if _active_id is not None:
            active = _jobs.get(_active_id)
            status = active.status if active else "running"
            raise RuntimeError(
                f"another tick job is already {status} (id={_active_id})"
            )
        _jobs[job_id] = job
        _active_id = job_id

    thread = threading.Thread(target=_run_job, args=(job_id,), daemon=True)
    thread.start()
    return job


def get_job(job_id: str) -> TickJob | None:
    with _lock:
        return _jobs.get(job_id)


def list_jobs(*, limit: int = 20) -> list[TickJob]:
    with _lock:
        jobs = sorted(_jobs.values(), key=lambda j: j.created_at, reverse=True)
        return jobs[: max(1, min(limit, 100))]


def cancel_job(job_id: str) -> TickJob:
    global _active_id, _active_proc

    with _lock:
        job = _jobs.get(job_id)
        if job is None:
            raise KeyError(job_id)
        if job.status in ("done", "failed", "cancelled"):
            return job
        job.status = "cancelled"
        job.error = "cancelled by user"
        job.finished_at = datetime.now(UTC).isoformat()
        _append_log(job, "[runner] cancel requested")
        proc = _active_proc if _active_id == job_id else None

    if proc is not None and proc.poll() is None:
        proc.terminate()
    return job


def active_job_id() -> str | None:
    with _lock:
        return _active_id
