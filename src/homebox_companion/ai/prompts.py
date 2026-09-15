"""Shared prompt templates and constants for AI interactions.

Note on customizations:
    The `customizations` parameter in prompt builder functions contains
    the effective values for all fields (user overrides merged with defaults).

    The source of truth for defaults is FieldPreferencesDefaults in
    field_preferences.py, which handles env var overrides via HBC_AI_* variables.

    All prompt builder functions require customizations to be passed explicitly
    via get_effective_customizations() - there are no fallback defaults here.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from .translations import get_text

if TYPE_CHECKING:
    from ..core.persistent_settings import CustomFieldDefinition


def build_custom_fields_schema(
    custom_fields: list[CustomFieldDefinition],
    output_language: str = "English",
) -> str:
    """Build custom fields schema section for the AI prompt.

    Args:
        custom_fields: User-defined custom field definitions with AI instructions.
        output_language: Target language for output.

    Returns:
        Custom fields schema string, or empty string if no custom fields.
    """
    if not custom_fields:
        return ""

    header = get_text("schema.custom_fields", output_language)
    lines = [f"\n{header}"]
    for cf in custom_fields:
        # Use camelCase key to match default fields (modelNumber, serialNumber, etc.)
        lines.append(f"- {cf.prompt_key}: string or null ({cf.ai_instruction})")

    return "\n".join(lines)


def build_critical_constraints(
    single_item: bool = False,
    output_language: str = "English",
) -> str:
    """Build critical constraints that MUST appear early in prompt.

    These are the most important rules that should be front-loaded
    to ensure the LLM prioritizes them.

    Args:
        single_item: If True, enforce single-item grouping mode.
        output_language: Target language for output.

    Returns:
        Critical constraints string.
    """
    if single_item:
        return get_text("constraints.single_item", output_language)
    return get_text("constraints.normal_rules", output_language)


def build_naming_examples(
    customizations: dict[str, str],
    output_language: str = "English",
) -> str:
    """Build naming examples with optional user override.

    Args:
        customizations: Dict with effective values for all fields (required).
            Must contain 'naming_examples' for examples. If 'name' contains
            a custom instruction, adds a user preference note.
        output_language: Target language for output.

    Returns:
        Naming examples string with optional user preference.
    """
    # Get examples from customizations
    examples = customizations.get("naming_examples", "").strip()
    if not examples:
        examples = get_text("naming.default_examples", output_language)

    # Build base with examples
    header = get_text("naming.header", output_language)
    result = f"{header} {examples}"

    # Add user naming preference if it's a custom instruction
    name_instruction = customizations.get("name", "").strip()
    if name_instruction and not name_instruction.startswith("[Type]"):
        # This is a custom instruction, not the default format
        preference_label = get_text("naming.user_preference", output_language)
        result += f"\n\n{preference_label}\n{name_instruction}"

    return result


def build_item_schema(
    customizations: dict[str, str],
    output_language: str = "English",
) -> str:
    """Build item schema with field instructions integrated inline.

    Args:
        customizations: Dict with effective values for fields (name, quantity,
            description). Required - must contain values for all fields.
        output_language: Target language for output.

    Returns:
        Item schema string with field instructions.
    """
    name_instr = customizations.get("name", get_text("default.name", output_language))
    qty_instr = customizations.get("quantity", get_text("default.quantity", output_language))
    desc_instr = customizations.get("description", get_text("default.description", output_language))

    header = get_text("schema.output_schema", output_language)
    name_label = get_text("field.name", output_language)
    qty_label = get_text("field.quantity", output_language)
    desc_label = get_text("field.description", output_language)
    tag_label = get_text("field.tagIds", output_language)

    return f"""{header}
- {name_label} ({name_instr})
- {qty_label} ({qty_instr})
- {desc_label} ({desc_instr})
- {tag_label}"""


def build_extended_fields_schema(
    customizations: dict[str, str],
    output_language: str = "English",
) -> str:
    """Build extended fields schema with field instructions integrated inline.

    Args:
        customizations: Dict with effective values for extended fields
            (manufacturer, model_number, serial_number, purchase_price,
            purchase_from, notes). Required - must contain values for all fields.
        output_language: Target language for output.

    Returns:
        Extended fields schema string with field instructions.
    """
    mfr_instr = customizations.get("manufacturer", get_text("default.manufacturer", output_language))
    model_instr = customizations.get("model_number", get_text("default.model_number", output_language))
    serial_instr = customizations.get("serial_number", get_text("default.serial_number", output_language))
    price_instr = customizations.get("purchase_price", get_text("default.purchase_price", output_language))
    from_instr = customizations.get("purchase_from", get_text("default.purchase_from", output_language))
    notes_instr = customizations.get("notes", get_text("default.notes", output_language))

    header = get_text("schema.optional_fields", output_language)
    mfr_label = get_text("field.manufacturer", output_language)
    model_label = get_text("field.modelNumber", output_language)
    serial_label = get_text("field.serialNumber", output_language)
    price_label = get_text("field.purchasePrice", output_language)
    from_label = get_text("field.purchaseFrom", output_language)
    notes_label = get_text("field.notes", output_language)

    return f"""
{header}
- {mfr_label} ({mfr_instr})
- {model_label} ({model_instr})
- {serial_label} ({serial_instr})
- {price_label} ({price_instr})
- {from_label} ({from_instr})
- {notes_label} ({notes_instr})"""


def build_tag_prompt(
    tags: list[dict[str, str]] | None,
    output_language: str = "English",
) -> str:
    """Build the tag assignment prompt section.

    Args:
        tags: List of tag dicts with 'id' and 'name' keys, or None.
        output_language: Target language for output.

    Returns:
        Prompt text instructing the AI how to handle tags.
    """
    if not tags:
        return get_text("tags.none", output_language)

    tag_lines = [f"- {tag['name']} (id: {tag['id']})" for tag in tags if tag.get("id") and tag.get("name")]

    if not tag_lines:
        return get_text("tags.none", output_language)

    header = get_text("tags.available", output_language)
    return header + "\n" + "\n".join(tag_lines)


def build_language_instruction(output_language: str | None) -> str:
    """Build language output instruction.

    Args:
        output_language: Target language for output. If None or "English",
            returns empty string (English is default).

    Returns:
        Language instruction string, or empty string if English/default.
    """
    if not output_language or output_language.strip().lower() == "english":
        return ""

    lang = output_language.strip()
    instruction = get_text("language.instruction", lang)
    example = get_text("language.example", lang)

    if example:
        return f"\n{instruction}\n{example}\n"
    return f"\n{instruction}\n"
