"""Unit tests for items API endpoints.

Tests thumbnail selection and parent type handling using mocked HomeboxClient.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from server.app import create_app
from server.dependencies import client_holder


@pytest.fixture
def mock_client() -> MagicMock:
    """Create a mock HomeboxClient."""
    client = MagicMock()
    client.get_item = AsyncMock()
    client.get_item_path = AsyncMock(return_value=[])
    client.list_items = AsyncMock()
    return client


@pytest_asyncio.fixture
async def app_with_mock(mock_client: MagicMock):
    """Create a FastAPI test client with mocked dependencies."""
    app = create_app()
    client_holder.set(mock_client)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield app, ac, mock_client
    client_holder.reset()


def _auth_headers() -> dict[str, str]:
    return {"Authorization": "Bearer test-token"}


# =============================================================================
# Thumbnail selection tests (get_item endpoint)
# =============================================================================


@pytest.mark.asyncio
async def test_get_item_uses_thumbnail_id(app_with_mock):
    """When item has thumbnailId set, the endpoint returns that value."""
    _app, client, mock = app_with_mock
    mock.get_item.return_value = {
        "id": "item-1",
        "name": "Test Item",
        "quantity": 1,
        "thumbnailId": "thumb-from-api",
        "attachments": [{"id": "first-attachment"}],
        "tags": [],
    }

    resp = await client.get("/api/items/item-1", headers=_auth_headers())
    assert resp.status_code == 200
    assert resp.json()["thumbnailId"] == "thumb-from-api"


@pytest.mark.asyncio
async def test_get_item_falls_back_to_first_attachment(app_with_mock):
    """When item has no thumbnailId but has attachments, returns first attachment id."""
    _app, client, mock = app_with_mock
    mock.get_item.return_value = {
        "id": "item-2",
        "name": "Test Item",
        "quantity": 1,
        "attachments": [{"id": "fallback-attachment"}],
        "tags": [],
    }

    resp = await client.get("/api/items/item-2", headers=_auth_headers())
    assert resp.status_code == 200
    assert resp.json()["thumbnailId"] == "fallback-attachment"


@pytest.mark.asyncio
async def test_get_item_no_thumbnail(app_with_mock):
    """When item has neither thumbnailId nor attachments, returns null."""
    _app, client, mock = app_with_mock
    mock.get_item.return_value = {
        "id": "item-3",
        "name": "Test Item",
        "quantity": 1,
        "tags": [],
    }

    resp = await client.get("/api/items/item-3", headers=_auth_headers())
    assert resp.status_code == 200
    assert resp.json()["thumbnailId"] is None


# =============================================================================
# Parent type in list endpoint tests
# =============================================================================


@pytest.mark.asyncio
async def test_list_items_location_parent(app_with_mock):
    """When parent has isLocation: true, it shows as location."""
    _app, client, mock = app_with_mock
    mock.list_items.return_value = {
        "items": [
            {
                "id": "item-loc",
                "name": "Located Item",
                "quantity": 1,
                "tags": [],
                "parent": {
                    "id": "loc-1",
                    "name": "Garage",
                    "entityType": {"isLocation": True},
                },
            }
        ],
        "total": 1,
    }

    resp = await client.get("/api/items", headers=_auth_headers())
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) == 1
    assert items[0]["location"] == {"id": "loc-1", "name": "Garage"}


@pytest.mark.asyncio
async def test_list_items_item_parent(app_with_mock):
    """When parent has isLocation: false, location is null."""
    _app, client, mock = app_with_mock
    mock.list_items.return_value = {
        "items": [
            {
                "id": "item-child",
                "name": "Nested Item",
                "quantity": 1,
                "tags": [],
                "parent": {
                    "id": "parent-item",
                    "name": "Parent Item",
                    "entityType": {"isLocation": False},
                },
            }
        ],
        "total": 1,
    }

    resp = await client.get("/api/items", headers=_auth_headers())
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) == 1
    assert items[0]["location"] is None
