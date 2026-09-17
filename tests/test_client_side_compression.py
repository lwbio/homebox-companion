"""Tests for client-side image compression support.

When HBC_CLIENT_SIDE_IMAGE_COMPRESSION is enabled, the frontend compresses
images before upload and the backend must not re-optimize them. The backend
signals this through encode_image_bytes_to_data_uri(optimize=False), which
must pass the received bytes through unchanged instead of resizing them.
"""

from __future__ import annotations

import base64
import io
from pathlib import Path

from PIL import Image

from homebox_companion.ai.images import encode_image_bytes_to_data_uri

LARGE_ASSET = Path(__file__).parent / "assets" / "single_item_single_image.jpg"


def _decode_data_uri(data_uri: str) -> bytes:
    payload = data_uri.split(",", 1)[1]
    return base64.b64decode(payload)


def _dimensions(jpeg_bytes: bytes) -> tuple[int, int]:
    return Image.open(io.BytesIO(jpeg_bytes)).size


def test_optimize_false_passes_bytes_through_unchanged() -> None:
    original = LARGE_ASSET.read_bytes()
    data_uri = encode_image_bytes_to_data_uri(original, "image/jpeg", optimize=False)

    decoded = _decode_data_uri(data_uri)
    assert decoded == original, "optimize=False must not alter the uploaded bytes"
    assert data_uri.startswith("data:image/jpeg;base64,")


def test_optimize_true_resizes_large_image() -> None:
    original = LARGE_ASSET.read_bytes()
    data_uri = encode_image_bytes_to_data_uri(original, "image/jpeg", optimize=True)

    decoded = _decode_data_uri(data_uri)
    assert decoded != original
    assert max(_dimensions(decoded)) <= 2048
