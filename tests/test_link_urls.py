"""Tests for user-facing links generated from HBC_LINK_BASE_URL."""

from __future__ import annotations

from homebox_companion.core.config import Settings, settings
from homebox_companion.homebox.views import (
    CompactItemView,
    CompactTagView,
    ItemView,
    LocationView,
    ParentItemView,
    add_tree_urls,
)


def test_link_base_url_configuration_replaces_companion_base_url(monkeypatch) -> None:
    monkeypatch.setenv("HBC_HOMEBOX_URL", "https://homebox.example.com")
    monkeypatch.setenv("HBC_LINK_BASE_URL", "https://links.example.com/")
    monkeypatch.setenv("HBC_COMPANION_BASE_URL", "https://ignored.example.com")

    configured = Settings(_env_file=None)

    assert configured.effective_link_base_url == "https://links.example.com"
    assert "companion_base_url" not in Settings.model_fields


def test_views_use_link_base_url_with_existing_paths(monkeypatch) -> None:
    monkeypatch.setattr(settings, "link_base_url", "https://links.example.com/")

    assert LocationView(id="location-1", name="Office").url == (
        "https://links.example.com/items?location_id=location-1"
    )
    assert CompactTagView(id="tag-1", name="Electronics").url == "https://links.example.com/items?tag=tag-1"
    assert CompactItemView(id="item-1", name="Laptop").url == "https://links.example.com/items/item-1"
    assert ParentItemView(id="item-2", name="Bag").url == "https://links.example.com/items/item-2"
    assert ItemView(id="item-3", name="Charger").url == "https://links.example.com/items/item-3"


def test_tree_urls_use_link_base_url_recursively(monkeypatch) -> None:
    monkeypatch.setattr(settings, "link_base_url", "https://links.example.com/")
    tree = {
        "id": "location-1",
        "entityType": {"isLocation": True},
        "children": [{"id": "item-1", "entityType": {"isLocation": False}}],
    }

    result = add_tree_urls(tree)

    assert result["url"] == "https://links.example.com/items?location_id=location-1"
    assert result["children"][0]["url"] == "https://links.example.com/items/item-1"
