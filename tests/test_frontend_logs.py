"""Security and input bounds for the shared frontend log endpoint."""

from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI

from server.api import logs
from server.dependencies import get_client

pytestmark = pytest.mark.unit


@pytest.mark.asyncio
async def test_frontend_logs_require_valid_homebox_token(monkeypatch: pytest.MonkeyPatch) -> None:
    app = FastAPI()
    app.include_router(logs.router, prefix="/api")
    client = AsyncMock()
    client.validate_token.return_value = False
    app.dependency_overrides[get_client] = lambda: client
    recorded: list[str] = []
    monkeypatch.setattr(logs, "_log_frontend_entry", lambda level, message, timestamp: recorded.append(message))

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as http:
        response = await http.post(
            "/api/logs/frontend",
            headers={"Authorization": "Bearer bogus"},
            json={"logs": [{"timestamp": "2026-01-01T00:00:00Z", "level": "INFO", "module": "App", "message": "ok"}]},
        )
        assert response.status_code == 401
        assert recorded == []

        client.validate_token.return_value = True
        response = await http.post(
            "/api/logs/frontend",
            headers={"Authorization": "Bearer valid"},
            json={"logs": [{
                "timestamp": "2026-01-01T00:00:00Z", "level": "INFO",
                "module": "App", "message": "[VISION TIMING] detection completed | duration=1.20s",
            }]},
        )
        assert response.status_code == 200
        assert recorded == ["[Frontend][App] [VISION TIMING] detection completed | duration=1.20s"]

        response = await http.post(
            "/api/logs/frontend",
            headers={"Authorization": "Bearer valid"},
            json={"logs": [{
                "timestamp": "now", "level": "INFO", "module": "App\nforged",
                "message": "[VISION TIMING] detection completed | duration=1.20s",
            }]},
        )
        assert response.status_code == 400

        response = await http.post(
            "/api/logs/frontend",
            headers={"Authorization": "Bearer valid"},
            json={"logs": [{"timestamp": "now", "level": "INFO", "module": "App", "message": "item name"}]},
        )
        assert response.status_code == 400
        assert len(recorded) == 1

        response = await http.post(
            "/api/logs/frontend",
            headers={"Authorization": "Bearer valid"},
            json={"logs": [{"timestamp": "now", "level": "INFO", "module": "App", "message": "x" * 1025}]},
        )
        assert response.status_code == 422
        assert len(recorded) == 1

        client.validate_token.return_value = False
        response = await http.get("/api/logs", headers={"Authorization": "Bearer bogus"})
        assert response.status_code == 401
