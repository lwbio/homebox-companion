"""Active task tracker for cancellation support.

Tracks running asyncio tasks grouped by session_id so they can be
cancelled per-session (e.g., when the user clicks "Cancel Analysis"
for a specific scan session without affecting other sessions).
"""

from __future__ import annotations

import asyncio
from typing import Any

from loguru import logger

# session_id -> {task_id -> asyncio.Task}
_sessions: dict[str, dict[str, asyncio.Task[Any]]] = {}


def register(session_id: str, task_id: str, task: asyncio.Task[Any]) -> None:
    """Register an active task for a session."""
    if session_id not in _sessions:
        _sessions[session_id] = {}
    _sessions[session_id][task_id] = task
    total = sum(len(tasks) for tasks in _sessions.values())
    logger.debug(f"Task registered: session={session_id} task={task_id} (total: {total})")


def unregister(session_id: str, task_id: str) -> None:
    """Unregister a task (called when it completes naturally)."""
    if session_id in _sessions:
        _sessions[session_id].pop(task_id, None)
        if not _sessions[session_id]:
            del _sessions[session_id]
    total = sum(len(tasks) for tasks in _sessions.values())
    logger.debug(f"Task unregistered: session={session_id} task={task_id} (total: {total})")


def cancel_session(session_id: str) -> int:
    """Cancel all active tasks for a specific session. Returns the number cancelled."""
    tasks = _sessions.pop(session_id, {})
    count = 0
    for task_id, task in tasks.items():
        if not task.done():
            task.cancel()
            count += 1
            logger.info(f"Cancelled task: session={session_id} task={task_id}")
    logger.info(f"Cancelled {count} task(s) for session {session_id}")
    return count
