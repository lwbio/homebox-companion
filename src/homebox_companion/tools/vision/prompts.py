"""Vision-specific prompt templates."""

from __future__ import annotations

from typing import TYPE_CHECKING

from ...ai.prompts import (
    build_critical_constraints,
    build_custom_fields_schema,
    build_extended_fields_schema,
    build_item_schema,
    build_language_instruction,
    build_naming_examples,
    build_tag_prompt,
)
from ...ai.translations import get_text

if TYPE_CHECKING:
    from ...core.persistent_settings import CustomFieldDefinition


def build_detection_system_prompt(
    tags: list[dict[str, str]] | None = None,
    single_item: bool = False,
    extract_extended_fields: bool = False,
    field_preferences: dict[str, str] | None = None,
    output_language: str | None = None,
    custom_fields: list[CustomFieldDefinition] | None = None,
) -> str:
    """Build the system prompt for item detection.

    Prompt order optimized for LLM attention:
    1. Role + output format
    2. Language instruction (if not English)
    3. Critical constraints (front-loaded)
    4. Schema (what to output)
    5. Naming guidelines (how to format)
    6. Tags (reference data)

    Args:
        tags: Optional list of tag dicts for assignment.
        single_item: If True, treat all items as one grouped item.
        extract_extended_fields: If True, include extended fields schema.
        field_preferences: Optional dict of field customization instructions.
        output_language: Target language for output (default: English).
        custom_fields: Optional list of custom field definitions.

    Returns:
        Complete system prompt string.
    """
    lang = output_language or "English"

    # Ensure field_preferences is a dict (empty dict if None)
    field_preferences = field_preferences or {}

    # Build components with customizations
    language_instr = build_language_instruction(output_language)
    critical = build_critical_constraints(single_item, lang)
    item_schema = build_item_schema(field_preferences, lang)
    extended_schema = build_extended_fields_schema(field_preferences, lang) if extract_extended_fields else ""
    custom_schema = build_custom_fields_schema(custom_fields or [], lang)
    naming_examples = build_naming_examples(field_preferences, lang)
    tag_prompt = build_tag_prompt(tags, lang)

    role = get_text("role.inventory_assistant", lang)
    output_instr = get_text("output.return_json_items", lang)

    return (
        # 1. Role + output format
        f"{role} {output_instr}\n"
        # 2. Language instruction (if not English)
        f"{language_instr}\n"
        # 3. Critical constraints FIRST
        f"{critical}\n\n"
        # 4. Schema
        f"{item_schema}"
        f"{extended_schema}"
        f"{custom_schema}\n\n"
        # 5. Naming examples
        f"{naming_examples}\n\n"
        # 6. Tags
        f"{tag_prompt}"
    )


def build_detection_user_prompt(
    extra_instructions: str | None = None,
    extract_extended_fields: bool = False,
    multi_image: bool = False,
    single_item: bool = False,
    output_language: str | None = None,
) -> str:
    """Build the user prompt for item detection.

    Args:
        extra_instructions: Optional user hint about image contents.
        extract_extended_fields: If True, include extended field example.
        multi_image: If True, use multi-image phrasing.
        single_item: If True, use single-item phrasing for multi-image.
        output_language: Target language for output (default: English).

    Returns:
        Complete user prompt string.
    """
    lang = output_language or "English"
    extended_example = ""
    if extract_extended_fields:
        extended_example = ',"manufacturer":"DeWalt","modelNumber":"DCD771C2"'

    user_hint = ""
    if extra_instructions and extra_instructions.strip():
        context_label = get_text("user.context", lang).format(instructions=extra_instructions.strip())
        extract_text = get_text("user.extract_fields", lang)
        user_hint = f"\n\n{context_label}\n{extract_text}"

    if multi_image:
        if single_item:
            multi_image_hint = get_text("multi.same_item", lang) + " "
        else:
            multi_image_hint = get_text("multi.different_items", lang) + " "
    else:
        multi_image_hint = ""

    # Use translated example names for few-shot learning
    example_name = get_text("example.item_name", lang)
    example_desc = get_text("example.item_desc", lang)

    list_items = get_text("user.list_items", lang)
    return_json = get_text("output.return_json", lang)
    example_label = get_text("naming.example_label", lang)
    return (
        f"{multi_image_hint}"
        f"{list_items} {return_json} "
        f"{example_label}"
        f'{{"items":[{{"name":"{example_name}","quantity":2,'
        f'"description":"{example_desc}","tagIds":["id1"]{extended_example}'
        "]}]}." + user_hint
    )


def build_multi_image_system_prompt(
    tags: list[dict[str, str]] | None = None,
    single_item: bool = False,
    extract_extended_fields: bool = False,
    field_preferences: dict[str, str] | None = None,
    output_language: str | None = None,
    custom_fields: list[CustomFieldDefinition] | None = None,
) -> str:
    """Build system prompt for multi-image detection.

    Args:
        tags: Optional list of tag dicts for assignment.
        single_item: If True, treat all images as showing one item.
        extract_extended_fields: If True, include extended fields schema.
        field_preferences: Optional dict of field customization instructions.
        output_language: Target language for output (default: English).
        custom_fields: Optional list of custom field definitions.

    Returns:
        Complete system prompt string.
    """
    lang = output_language or "English"

    # Ensure field_preferences is a dict (empty dict if None)
    field_preferences = field_preferences or {}

    # Build components with customizations
    language_instr = build_language_instruction(output_language)
    critical = build_critical_constraints(single_item, lang)
    item_schema = build_item_schema(field_preferences, lang)
    extended_schema = build_extended_fields_schema(field_preferences, lang) if extract_extended_fields else ""
    custom_schema = build_custom_fields_schema(custom_fields or [], lang)
    naming_examples = build_naming_examples(field_preferences, lang)
    tag_prompt = build_tag_prompt(tags, lang)

    role = get_text("role.inventory_assistant", lang)
    if single_item:
        multi_note = get_text("role.inventory_assistant_single", lang)
    else:
        multi_note = get_text("role.inventory_assistant_multi", lang)
    output_instr = get_text("output.return_json_items", lang)

    return (
        # 1. Role + output format
        f"{role} {multi_note} {output_instr}\n"
        # 2. Language instruction (if not English)
        f"{language_instr}\n"
        # 3. Critical constraints FIRST
        f"{critical}\n\n"
        # 4. Schema
        f"{item_schema}"
        f"{extended_schema}"
        f"{custom_schema}\n\n"
        # 5. Naming examples
        f"{naming_examples}\n\n"
        # 6. Tags
        f"{tag_prompt}"
    )


def build_discriminatory_system_prompt(
    tags: list[dict[str, str]] | None = None,
    extract_extended_fields: bool = True,
    field_preferences: dict[str, str] | None = None,
    output_language: str | None = None,
    custom_fields: list[CustomFieldDefinition] | None = None,
) -> str:
    """Build system prompt for discriminatory (detailed) detection.

    This is used when "unmerging" items to get more specific results.

    Args:
        tags: Optional list of tag dicts for assignment.
        extract_extended_fields: If True, include extended fields schema.
        field_preferences: Optional dict of field customization instructions.
        output_language: Target language for output (default: English).
        custom_fields: Optional list of custom field definitions.

    Returns:
        Complete system prompt string.
    """
    lang = output_language or "English"

    # Ensure field_preferences is a dict (empty dict if None)
    field_preferences = field_preferences or {}

    # Build components with customizations
    language_instr = build_language_instruction(output_language)
    item_schema = build_item_schema(field_preferences, lang)
    extended_schema = build_extended_fields_schema(field_preferences, lang) if extract_extended_fields else ""
    custom_schema = build_custom_fields_schema(custom_fields or [], lang)
    naming_examples = build_naming_examples(field_preferences, lang)
    tag_prompt = build_tag_prompt(tags, lang)

    role = get_text("role.inventory_assistant_discriminatory", lang)
    specificity_header = get_text("specificity.header", lang)
    specificity_variant = get_text("specificity.variant", lang)
    specificity_details = get_text("specificity.details", lang)
    specificity_visible = get_text("specificity.visible", lang)

    return (
        # 1. Role + critical constraint
        f"{role}\n"
        # 2. Language instruction (if not English)
        f"{language_instr}\n"
        # 3. Specificity rules (critical for this mode)
        f"{specificity_header}\n"
        f"{specificity_variant}\n"
        f"{specificity_details}\n"
        f"{specificity_visible}\n\n"
        # 4. Schema
        f"{item_schema}"
        f"{extended_schema}"
        f"{custom_schema}\n\n"
        # 5. Naming examples
        f"{naming_examples}\n\n"
        # 6. Tags
        f"{tag_prompt}"
    )


def build_discriminatory_user_prompt(output_language: str | None = None) -> str:
    """Build user prompt for discriminatory detection.

    Args:
        output_language: Target language for output (default: English).

    Returns:
        User prompt string for detailed item separation.
    """
    lang = output_language or "English"
    identify = get_text("discriminatory.identify", lang)
    examples = get_text("discriminatory.examples", lang)
    return_json = get_text("output.return_json", lang)

    return f"{identify}\n{examples}\n{return_json}"


def build_analysis_system_prompt(
    item_name: str,
    item_description: str | None,
    tags: list[dict[str, str]] | None = None,
    field_preferences: dict[str, str] | None = None,
    output_language: str | None = None,
    custom_fields: list[CustomFieldDefinition] | None = None,
) -> str:
    """Build system prompt for detailed item analysis from multiple images.

    This is used by analyzer.py to extract detailed information from
    multiple images of the same item.

    Args:
        item_name: The name of the item being analyzed.
        item_description: Optional initial description of the item.
        tags: Optional list of tag dicts for assignment.
        field_preferences: Optional dict of field customization instructions.
        output_language: Target language for output (default: English).
        custom_fields: Optional list of custom field definitions.

    Returns:
        Complete system prompt string.
    """
    lang = output_language or "English"

    # Build components with customizations (with safe defaults if None)
    field_preferences = field_preferences or {}
    language_instr = build_language_instruction(output_language)
    naming_examples = build_naming_examples(field_preferences, lang)
    tag_prompt = build_tag_prompt(tags, lang)
    custom_schema = build_custom_fields_schema(custom_fields or [], lang)

    # Build item context
    item_label = get_text("analysis.item_label", lang).format(name=item_name)
    item_context = item_label
    if item_description:
        item_context += f" - {item_description}"

    # Build extended field schema for analysis (always include extended fields)
    name_instr = field_preferences.get("name", get_text("default.name", lang))
    desc_instr = field_preferences.get("description", get_text("default.description", lang))
    serial_instr = field_preferences.get("serial_number", get_text("default.serial_number", lang))
    model_instr = field_preferences.get("model_number", get_text("default.model_number", lang))
    mfr_instr = field_preferences.get("manufacturer", get_text("default.manufacturer", lang))
    price_instr = field_preferences.get("purchase_price", get_text("default.purchase_price", lang))
    notes_instr = field_preferences.get("notes", get_text("default.notes", lang))

    role = get_text("role.inventory_assistant_analyzing", lang)
    extract_text = get_text("analysis.extract", lang)
    return_json_with = get_text("output.return_json_with", lang)
    name_label = get_text("field.name", lang)
    desc_label = get_text("field.description", lang)
    serial_label = get_text("field.serialNumber", lang)
    model_label = get_text("field.modelNumber", lang)
    mfr_label = get_text("field.manufacturer", lang)
    price_label = get_text("field.purchasePrice", lang)
    notes_label = get_text("field.notes", lang)
    tag_label = get_text("field.tagIds", lang)

    return (
        # 1. Role + task
        f"{role} {item_context}\n"
        # 2. Language instruction (if not English)
        f"{language_instr}\n"
        # 3. Critical instruction
        f"{extract_text}\n\n"
        # 4. Output schema
        f"{return_json_with}\n"
        f"- {name_label} ({name_instr})\n"
        f"- {desc_label} ({desc_instr})\n"
        f"- {serial_label} ({serial_instr})\n"
        f"- {model_label} ({model_instr})\n"
        f"- {mfr_label} ({mfr_instr})\n"
        f"- {price_label} ({price_instr})\n"
        f"- {notes_label} ({notes_instr})\n"
        f"- {tag_label}\n"
        f"{custom_schema}\n\n"
        # 5. Naming
        f"{naming_examples}\n\n"
        # 6. Tags
        f"{tag_prompt}"
    )
