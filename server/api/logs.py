"""Logs API routes for debugging and reference."""

from __future__ import annotations

import os
import re
from collections import deque
from datetime import datetime
from glob import glob
from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from loguru import logger
from pydantic import BaseModel, Field

from homebox_companion.homebox.client import HomeboxClient

from ..dependencies import get_client, get_token

if TYPE_CHECKING:
    import loguru

router = APIRouter()

# Allowed frontend log levels (must match loguru level names)
_ALLOWED_LEVELS = {"TRACE", "DEBUG", "INFO", "SUCCESS", "WARNING", "ERROR", "CRITICAL"}

# Maximum number of log entries accepted per request
_MAX_BATCH_SIZE = 100
_TIMING_MESSAGE = re.compile(
    r"^\[(?:ANALYZE|PERSIST|VISION) TIMING\] [A-Za-z0-9_ ()]+ \| "
    r"(?:duration|t|total)=\d+(?:\.\d+)?s$"
)


async def require_valid_token(token: str = Depends(get_token), client: HomeboxClient = Depends(get_client)) -> None:
    """Logs contain shared data; verify credentials before reading or writing."""
    if not await client.validate_token(token):
        raise HTTPException(status_code=401, detail="Invalid or expired token")


# Strict date format validation: YYYY-MM-DD
_DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# Logs directory - resolved once at module load relative to project root
_LOGS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "logs"))


def _get_log_files(date: str | None) -> list[str]:
    """Get log files matching the optional date filter.

    Args:
        date: Optional date string in YYYY-MM-DD format (already validated).

    Returns:
        List of matching log file paths, sorted newest first.
    """
    if date:
        pattern = os.path.join(_LOGS_DIR, f"homebox_companion_{date}.log")
        return glob(pattern)
    else:
        pattern = os.path.join(_LOGS_DIR, "homebox_companion_*.log")
        return sorted(glob(pattern), reverse=True)


def _get_llm_debug_log_files(date: str | None) -> list[str]:
    """Get LLM debug log files matching the optional date filter.

    Args:
        date: Optional date string in YYYY-MM-DD format (already validated).

    Returns:
        List of matching log file paths, sorted newest first.
    """
    if date:
        pattern = os.path.join(_LOGS_DIR, f"llm_debug_{date}.log")
        return glob(pattern)
    else:
        pattern = os.path.join(_LOGS_DIR, "llm_debug_*.log")
        return sorted(glob(pattern), reverse=True)


def _validate_date_format(date: str | None) -> None:
    """Validate date format to prevent path traversal.

    Raises:
        HTTPException: If date format is invalid.
    """
    if date and not _DATE_PATTERN.match(date):
        raise HTTPException(
            status_code=400,
            detail="Invalid date format. Expected YYYY-MM-DD.",
        )


def _parse_client_timestamp(timestamp: str) -> datetime | None:
    """Parse the ISO timestamp supplied by the browser."""
    try:
        return datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def _log_frontend_entry(level: str, message: str, timestamp: str) -> None:
    """Write a frontend log entry using the browser event time."""
    client_time = _parse_client_timestamp(timestamp)
    if client_time is None:
        logger.log(level, message)
        return

    # Loguru uses a datetime subclass that understands its ``YYYY`` formatting
    # tokens. Preserve that type when replacing the record time.
    def use_client_time(record: loguru.Record) -> None:
        record_time_type = type(record["time"])
        record["time"] = record_time_type.fromtimestamp(client_time.timestamp(), client_time.tzinfo)

    logger.patch(use_client_time).log(level, message)


class LogsResponse(BaseModel):
    """Response containing log entries."""

    logs: str
    filename: str | None
    total_lines: int
    truncated: bool


@router.get("/logs", response_model=LogsResponse, dependencies=[Depends(require_valid_token)])
async def get_logs(
    lines: int = Query(default=200, ge=1, le=2000, description="Number of lines to return"),
    date: str | None = Query(default=None, description="Log date in YYYY-MM-DD format"),
) -> LogsResponse:
    """Return recent application logs.

    Reads from the most recent log file (or a specific date if provided).
    Returns the last N lines for display in the Settings page.

    Requires authentication to prevent exposure of sensitive log data.
    """
    _validate_date_format(date)
    log_files = _get_log_files(date)

    if not log_files:
        return LogsResponse(
            logs="No log files found.",
            filename=None,
            total_lines=0,
            truncated=False,
        )

    # Read the most recent log file
    log_file = log_files[0]
    filename = os.path.basename(log_file)

    try:
        with open(log_file, encoding="utf-8") as f:
            # Use deque to keep only the last N lines in memory
            recent_lines: deque[str] = deque(maxlen=lines)
            total_lines = 0
            for line in f:
                recent_lines.append(line)
                total_lines += 1

        truncated = total_lines > lines
        logs_content = "".join(recent_lines)

        return LogsResponse(
            logs=logs_content,
            filename=filename,
            total_lines=total_lines,
            truncated=truncated,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error reading log file: {e}",
        ) from e


@router.get("/logs/download", dependencies=[Depends(require_valid_token)])
async def download_logs(
    date: str | None = Query(default=None, description="Log date in YYYY-MM-DD format"),
) -> FileResponse:
    """Download the full log file.

    Returns the complete log file for the most recent date (or a specific date if provided).

    Requires authentication to prevent exposure of sensitive log data.
    """
    _validate_date_format(date)
    log_files = _get_log_files(date)

    if not log_files:
        raise HTTPException(status_code=404, detail="No log files found")

    log_file = log_files[0]
    filename = os.path.basename(log_file)

    if not os.path.exists(log_file):
        raise HTTPException(status_code=404, detail="Log file not found")

    return FileResponse(
        path=log_file,
        filename=filename,
        media_type="text/plain",
    )


@router.get("/logs/llm-debug", response_model=LogsResponse, dependencies=[Depends(require_valid_token)])
async def get_llm_debug_logs(
    lines: int = Query(default=200, ge=1, le=2000, description="Number of lines to return"),
    date: str | None = Query(default=None, description="Log date in YYYY-MM-DD format"),
) -> LogsResponse:
    """Return recent LLM debug logs.

    Reads from the most recent LLM debug log file (or a specific date if provided).
    Returns the last N lines for display in the Settings page.

    Requires authentication to prevent exposure of sensitive log data.
    """
    _validate_date_format(date)
    log_files = _get_llm_debug_log_files(date)

    if not log_files:
        return LogsResponse(
            logs="No LLM debug log files found.",
            filename=None,
            total_lines=0,
            truncated=False,
        )

    # Read the most recent log file
    log_file = log_files[0]
    filename = os.path.basename(log_file)

    try:
        with open(log_file, encoding="utf-8") as f:
            # Use deque to keep only the last N lines in memory
            recent_lines: deque[str] = deque(maxlen=lines)
            total_lines = 0
            for line in f:
                recent_lines.append(line)
                total_lines += 1

        truncated = total_lines > lines
        logs_content = "".join(recent_lines)

        return LogsResponse(
            logs=logs_content,
            filename=filename,
            total_lines=total_lines,
            truncated=truncated,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error reading LLM debug log file: {e}",
        ) from e


@router.get("/logs/llm-debug/download", dependencies=[Depends(require_valid_token)])
async def download_llm_debug_logs(
    date: str | None = Query(default=None, description="Log date in YYYY-MM-DD format"),
) -> FileResponse:
    """Download the full LLM debug log file.

    Returns the complete LLM debug log file for the most recent date (or a specific date if provided).

    Requires authentication to prevent exposure of sensitive log data.
    """
    _validate_date_format(date)
    log_files = _get_llm_debug_log_files(date)

    if not log_files:
        raise HTTPException(status_code=404, detail="No LLM debug log files found")

    log_file = log_files[0]
    filename = os.path.basename(log_file)

    if not os.path.exists(log_file):
        raise HTTPException(status_code=404, detail="LLM debug log file not found")

    return FileResponse(
        path=log_file,
        filename=filename,
        media_type="text/plain",
    )


class FrontendLogEntry(BaseModel):
    """A single log entry forwarded from the frontend logger."""

    timestamp: str = Field(max_length=64, description="ISO 8601 timestamp from the client")
    level: str = Field(max_length=16, description="Log level (TRACE..CRITICAL)")
    module: str = Field(max_length=64, description="Frontend logger module/prefix")
    message: str = Field(max_length=1024, description="Log message")
    error: str | None = Field(default=None, max_length=1024, description="Serialized error/stack")


class FrontendLogsRequest(BaseModel):
    """Batch of frontend log entries to ingest."""

    logs: list[FrontendLogEntry] = Field(default_factory=list, max_length=_MAX_BATCH_SIZE)


@router.post("/logs/frontend", dependencies=[Depends(require_valid_token)])
async def ingest_frontend_logs(payload: FrontendLogsRequest) -> dict[str, int]:
    """Ingest frontend log entries into the unified server log.

    Frontend logs are forwarded here in batches and written through loguru
    so they land in the same daily `homebox_companion_*.log` file as server
    logs, enabling unified analysis. Entries are prefixed with `[Frontend]`
    and their source module to distinguish them from server-side logs.

    Requires authentication to prevent abuse.
    """
    logs = payload.logs
    if len(logs) > _MAX_BATCH_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"Too many log entries. Maximum is {_MAX_BATCH_SIZE} per request.",
        )

    if any(
        not _TIMING_MESSAGE.fullmatch(entry.message)
        or not re.fullmatch(r"[A-Za-z][A-Za-z0-9]{0,63}", entry.module)
        or entry.error is not None
        for entry in logs
    ):
        raise HTTPException(status_code=400, detail="Only fixed-format timing diagnostics are accepted")

    ingested = 0
    for entry in logs:
        level = entry.level.strip().upper()
        if level not in _ALLOWED_LEVELS:
            level = "INFO"

        message = f"[Frontend][{entry.module}] {entry.message}"

        _log_frontend_entry(level, message, entry.timestamp)
        ingested += 1

    return {"ingested": ingested}
