"""Item detection from images using LLM vision."""

from __future__ import annotations

import asyncio
import time
from typing import TYPE_CHECKING

from loguru import logger

from ...ai.images import encode_image_bytes_to_data_uri
from ...ai.llm import vision_completion
from ...ai.response_models import get_items_response_model
from .models import DetectedItem, get_items_adapter
from .prompts import (
    build_detection_system_prompt,
    build_detection_user_prompt,
    build_multi_image_system_prompt,
)

if TYPE_CHECKING:
    from ...core.persistent_settings import CustomFieldDefinition


async def detect_items_from_bytes(
    image_bytes: bytes,
    mime_type: str = "image/jpeg",
    tags: list[dict[str, str]] | None = None,
    single_item: bool = False,
    extra_instructions: str | None = None,
    extract_extended_fields: bool = False,
    additional_images: list[tuple[bytes, str]] | None = None,
    field_preferences: dict[str, str] | None = None,
    output_language: str | None = None,
    custom_fields: list[CustomFieldDefinition] | None = None,
) -> list[DetectedItem]:
    """Use LLM vision model to detect items from raw image bytes.

    Args:
        image_bytes: Raw image data for the primary image.
        mime_type: MIME type of the primary image.
        tags: Optional list of Homebox tags to suggest for items.
        single_item: If True, treat everything in the image as a single item.
        extra_instructions: Optional user hint about what's in the image.
        extract_extended_fields: If True, also attempt to extract extended fields.
        additional_images: Optional list of (bytes, mime_type) tuples for
            additional images showing the same item(s) from different angles.
        field_preferences: Optional dict of field customization instructions.
        output_language: Target language for AI output (default: English).
        custom_fields: Optional list of custom field definitions.

    Returns:
        List of detected items with quantities, descriptions, and optionally
        extended fields when extract_extended_fields is True.
    """
    # Build list of all image data URIs
    encode_started = time.perf_counter()
    images = [(image_bytes, mime_type), *(additional_images or [])]
    image_data_uris = await asyncio.gather(
        *(asyncio.to_thread(encode_image_bytes_to_data_uri, data, mime) for data, mime in images)
    )

    logger.debug(
        f"[VISION TIMING] Image data URIs encoded | duration={time.perf_counter() - encode_started:.2f}s | "
        f"images={len(image_data_uris)}"
    )

    return await _detect_items_from_data_uris(
        image_data_uris,
        tags,
        single_item=single_item,
        extra_instructions=extra_instructions,
        extract_extended_fields=extract_extended_fields,
        field_preferences=field_preferences,
        output_language=output_language,
        custom_fields=custom_fields,
    )


async def _detect_items_from_data_uris(
    image_data_uris: list[str],
    tags: list[dict[str, str]] | None = None,
    single_item: bool = False,
    extra_instructions: str | None = None,
    extract_extended_fields: bool = False,
    field_preferences: dict[str, str] | None = None,
    output_language: str | None = None,
    custom_fields: list[CustomFieldDefinition] | None = None,
) -> list[DetectedItem]:
    """Core detection logic supporting multiple images.

    Args:
        image_data_uris: List of base64-encoded image data URIs.
        tags: Optional list of Homebox tags for item tagging.
        single_item: If True, treat everything as a single item.
        extra_instructions: User-provided hint about image contents.
        extract_extended_fields: If True, also extract manufacturer, etc.
        field_preferences: Optional dict of field customization instructions.
        output_language: Target language for AI output (default: English).
        custom_fields: Optional list of custom field definitions.
    """
    if not image_data_uris:
        return []

    multi_image = len(image_data_uris) > 1

    logger.debug(f"Starting {'multi-image' if multi_image else 'single-image'} detection")
    logger.debug(f"Single item: {single_item}")
    logger.debug(f"Extract extended fields: {extract_extended_fields}")
    logger.debug(f"Tags provided: {len(tags) if tags else 0}")
    logger.debug(f"Field preferences: {len(field_preferences) if field_preferences else 0}")
    logger.debug(f"Output language: {output_language or 'English (default)'}")
    logger.debug(f"Custom fields: {len(custom_fields) if custom_fields else 0}")

    # Build prompts
    prompt_started = time.perf_counter()
    if multi_image:
        system_prompt = build_multi_image_system_prompt(
            tags,
            single_item,
            extract_extended_fields,
            field_preferences,
            output_language,
            custom_fields=custom_fields,
        )
    else:
        system_prompt = build_detection_system_prompt(
            tags,
            single_item,
            extract_extended_fields,
            field_preferences,
            output_language,
            custom_fields=custom_fields,
        )

    user_prompt = build_detection_user_prompt(
        extra_instructions, extract_extended_fields, multi_image, single_item, output_language
    )
    logger.debug(
        f"[VISION TIMING] Prompts built | duration={time.perf_counter() - prompt_started:.2f}s | "
        f"system_chars={len(system_prompt)} | user_chars={len(user_prompt)}"
    )

    # Call LLM (with structured output when supported)
    response_model = get_items_response_model(custom_fields)
    llm_started_at = time.perf_counter()
    try:
        parsed_content = await vision_completion(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            image_data_uris=image_data_uris,
            expected_keys=["items"],
            response_model=response_model,
        )
    except asyncio.CancelledError:
        llm_duration = time.perf_counter() - llm_started_at
        logger.info(
            f"[VISION TIMING] LLM image detection cancelled | duration={llm_duration:.2f}s | "
            f"images={len(image_data_uris)}"
        )
        raise
    except Exception:
        llm_duration = time.perf_counter() - llm_started_at
        logger.warning(
            f"[VISION TIMING] LLM image detection failed | duration={llm_duration:.2f}s | "
            f"images={len(image_data_uris)}"
        )
        raise

    llm_duration = time.perf_counter() - llm_started_at
    logger.info(
        f"[VISION TIMING] LLM image detection completed | duration={llm_duration:.2f}s | "
        f"images={len(image_data_uris)} | raw_items={len(parsed_content.get('items', []))}"
    )

    # Validate LLM output with Pydantic (dynamic model if custom fields configured)
    adapter = get_items_adapter(custom_fields)
    validate_started = time.perf_counter()
    items = adapter.validate_python(parsed_content.get("items", []))
    logger.debug(
        f"[VISION TIMING] Items validated | duration={time.perf_counter() - validate_started:.2f}s | "
        f"items={len(items)}"
    )

    logger.info(f"Detected {len(items)} items from {len(image_data_uris)} image(s)")
    for item in items:
        logger.debug(f"  Item: {item.name}, qty: {item.quantity}, tags: {item.tag_ids}")
        if extract_extended_fields and item.has_extended_fields():
            logger.debug(
                f"    Extended: manufacturer={item.manufacturer}, "
                f"model={item.model_number}, serial={item.serial_number}"
            )

    return items
