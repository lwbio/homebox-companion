"""Translation dictionaries for AI prompt localization.

This module provides multi-language support for AI prompts by translating
instructional text while keeping JSON field names in English for compatibility.

Usage:
    from homebox_companion.ai.translations import get_text

    text = get_text("role.inventory_assistant", "Chinese")
"""

from __future__ import annotations

# Translation keys organized by category
TRANSLATIONS: dict[str, dict[str, str]] = {
    "English": {
        # ── Role Descriptions ──────────────────────────────────────────
        "role.inventory_assistant": "You are an inventory assistant for the Homebox API.",
        "role.inventory_assistant_single": (
            "You are an inventory assistant for the Homebox API. "
            "Analyzing multiple images of the same item."
        ),
        "role.inventory_assistant_multi": (
            "You are an inventory assistant for the Homebox API. "
            "Analyzing multiple images - combine duplicates."
        ),
        "role.inventory_assistant_discriminatory": (
            "You are an inventory assistant. Identify items with MAXIMUM SPECIFICITY. "
            "Do NOT group similar items - list each distinct variant separately."
        ),
        "role.inventory_assistant_analyzing": "You are an inventory assistant analyzing images.",
        "role.inventory_assistant_correcting": "You are an inventory assistant correcting item detection errors.",
        # ── Output Format ──────────────────────────────────────────────
        "output.return_json_items": "Return a JSON object with an `items` array.",
        "output.return_json": "Return only JSON.",
        "output.return_json_with": "Return JSON with:",
        # ── Critical Constraints ───────────────────────────────────────
        "constraints.single_item": (
            "CRITICAL: Treat EVERYTHING in this image as ONE item type. "
            "Do NOT separate into multiple entries. Count how many are visible."
        ),
        "constraints.normal_rules": (
            "RULES:\n"
            "- Combine identical objects into one entry with correct quantity\n"
            "- Separate distinctly different items into separate entries\n"
            "- Do NOT guess or infer - only use what's visible or user-stated\n"
            "- Ignore background elements (floors, walls, shelves, packaging)"
        ),
        "constraints.no_guess": "Do NOT guess or infer - only use what's visible or user-stated.",
        # ── Specificity Rules ──────────────────────────────────────────
        "specificity.header": "SPECIFICITY RULES:",
        "specificity.variant": "- Each distinct variant = separate entry (80 Grit vs 120 Grit = 2 items)",
        "specificity.details": "- Include size, color, brand, model in names when visible",
        "specificity.visible": "- Only use what's visible - do NOT guess",
        # ── Schema Headers ─────────────────────────────────────────────
        "schema.output_schema": "OUTPUT SCHEMA - Each item must include:",
        "schema.optional_fields": "OPTIONAL FIELDS (include only when visible or user-provided):",
        "schema.custom_fields": "CUSTOM FIELDS (always populate these for every item):",
        # ── Field Labels ───────────────────────────────────────────────
        "field.name": "name: string",
        "field.quantity": "quantity: integer",
        "field.description": "description: string",
        "field.tagIds": "tagIds: array of matching tag IDs",
        "field.manufacturer": "manufacturer: string or null",
        "field.modelNumber": "modelNumber: string or null",
        "field.serialNumber": "serialNumber: string or null",
        "field.purchasePrice": "purchasePrice: number or null",
        "field.purchaseFrom": "purchaseFrom: string or null",
        "field.notes": "notes: string or null",
        # ── Naming Examples ────────────────────────────────────────────
        "naming.header": "Examples:",
        "naming.user_preference": "USER NAMING PREFERENCE (takes priority):",
        "naming.default_examples": (
            '"Ball Bearing 6900-2RS 10x22x6mm", '
            '"Acrylic Paint Vallejo Game Color Bone White", '
            '"LED Strip COB Green 5V 1M"'
        ),
        "naming.example_label": "Example: ",
        # ── Tag Instructions ───────────────────────────────────────────
        "tags.available": "TAGS - Assign matching IDs to each item:",
        "tags.none": "No tags available; omit tagIds.",
        # ── User Prompt Instructions ───────────────────────────────────
        "user.list_items": "List items that are the focus of this image.",
        "user.context": 'USER CONTEXT: "{instructions}"',
        "user.extract_fields": (
            "Extract any price→purchasePrice, serial→serialNumber, "
            "model→modelNumber, store→purchaseFrom, brand→manufacturer from this text."
        ),
        # ── JSON Example (for few-shot learning) ─────────────────────
        "example.item_name": "Claw Hammer",
        "example.item_desc": "Steel claw hammer",
        # ── Multi-image Instructions ───────────────────────────────────
        "multi.same_item": "Multiple images of the SAME item. Combine all details into one entry.",
        "multi.different_items": "Multiple images - identify all distinct items, avoiding duplicates.",
        # ── Discriminatory Instructions ────────────────────────────────
        "discriminatory.identify": (
            "Identify ALL DISTINCT items. Be MORE DISCRIMINATORY - "
            "different sizes/colors/brands/grits = separate items."
        ),
        "discriminatory.examples": (
            "Examples: '80 Grit Sandpaper' + '120 Grit Sandpaper', "
            "'M3 Phillips Screw' + 'M5 Phillips Screw'."
        ),
        # ── Analysis Instructions ──────────────────────────────────────
        "analysis.extract": (
            "Extract ALL visible details: serial numbers, model numbers, brand, "
            "price tags, condition issues. Only use what's visible."
        ),
        "analysis.item_label": "Item: '{name}'",
        # ── Correction Rules ───────────────────────────────────────────
        "correction.header": "CORRECTION RULES:",
        "correction.separate": "- 'separate items' → return multiple items in array",
        "correction.fix_name": "- Name/description fix → return single corrected item",
        "correction.extract_fields": "- Extract price→purchasePrice, store→purchaseFrom, brand→manufacturer",
        "correction.verify": "- Always verify against the image",
        "correction.apply": "Apply the correction and return JSON with corrected item(s).",
        "correction.current_item": "Current: {name} (qty: {quantity})",
        "correction.user_input": 'User correction: "{instructions}"',
        # ── Default Field Instructions ─────────────────────────────────
        "default.name": "Title Case, max 255 characters",
        "default.quantity": ">= 1, count of identical items",
        "default.description": "max 1000 chars, condition/attributes only",
        "default.manufacturer": "brand name when visible",
        "default.model_number": "product code when visible",
        "default.serial_number": "S/N when visible",
        "default.purchase_price": "price from tag, just the number",
        "default.purchase_from": "store name when visible",
        "default.notes": "ONLY for defects/damage",
        "default.unknown": "Unknown",
        # ── Language Instruction ────────────────────────────────────────
        "language.instruction": (
            "IMPORTANT - OUTPUT LANGUAGE: You MUST write all item names, "
            "descriptions, and notes in English. "
            "Keep JSON field names (name, description, etc.) in English for compatibility."
        ),
        "language.example": "",
    },
    "Chinese": {
        # ── 角色描述 ───────────────────────────────────────────────────
        "role.inventory_assistant": "你是 Homebox API 的库存助手。",
        "role.inventory_assistant_single": "你是 Homebox API 的库存助手。正在分析同一物品的多张图像。",
        "role.inventory_assistant_multi": "你是 Homebox API 的库存助手。正在分析多张图像 - 请合并重复项。",
        "role.inventory_assistant_discriminatory": (
            "你是库存助手。请以最高精确度识别物品。不要将相似物品分组 - 请分别列出每个不同的变体。"
        ),
        "role.inventory_assistant_analyzing": "你是正在分析图像的库存助手。",
        "role.inventory_assistant_correcting": "你是正在纠正物品检测错误的库存助手。",
        # ── 输出格式 ───────────────────────────────────────────────────
        "output.return_json_items": "返回一个包含 `items` 数组的 JSON 对象。",
        "output.return_json": "仅返回 JSON。",
        "output.return_json_with": "返回 JSON，包含：",
        # ── 关键约束 ───────────────────────────────────────────────────
        "constraints.single_item": "重要：将此图像中的所有内容视为一种物品类型。不要分成多个条目。数一数可见数量。",
        "constraints.normal_rules": (
            "规则：\n"
            "- 将相同物品合并为一个条目，数量相加\n"
            "- 将明显不同的物品分成单独条目\n"
            "- 不要猜测或推断 - 仅使用可见内容或用户说明\n"
            "- 忽略背景元素（地板、墙壁、架子、包装）"
        ),
        "constraints.no_guess": "不要猜测或推断 - 仅使用可见内容或用户说明。",
        # ── 精确度规则 ─────────────────────────────────────────────────
        "specificity.header": "精确度规则：",
        "specificity.variant": "- 每个不同的变体 = 单独条目（80目 vs 120目 = 2个物品）",
        "specificity.details": "- 在名称中包含尺寸、颜色、品牌、型号（如可见）",
        "specificity.visible": "- 仅使用可见内容 - 不要猜测",
        # ── Schema 标题 ────────────────────────────────────────────────
        "schema.output_schema": "输出 Schema - 每个物品必须包含：",
        "schema.optional_fields": "可选字段（仅在可见或用户提供时包含）：",
        "schema.custom_fields": "自定义字段（为每个物品填写这些字段）：",
        # ── 字段标签 ───────────────────────────────────────────────────
        "field.name": "name: 字符串",
        "field.quantity": "quantity: 整数",
        "field.description": "description: 字符串",
        "field.tagIds": "tagIds: 匹配标签ID的数组",
        "field.manufacturer": "manufacturer: 字符串或 null",
        "field.modelNumber": "modelNumber: 字符串或 null",
        "field.serialNumber": "serialNumber: 字符串或 null",
        "field.purchasePrice": "purchasePrice: 数字或 null",
        "field.purchaseFrom": "purchaseFrom: 字符串或 null",
        "field.notes": "notes: 字符串或 null",
        # ── 命名示例 ───────────────────────────────────────────────────
        "naming.header": "示例：",
        "naming.user_preference": "用户命名偏好（优先级最高）：",
        "naming.default_examples": (
            '"深沟球轴承 6900-2RS 10x22x6mm", '
            '"丙烯颜料 Vallejo Game Color 骨白色", '
            '"LED灯条 COB 绿色 5V 1米"'
        ),
        "naming.example_label": "示例：",
        # ── 标签说明 ───────────────────────────────────────────────────
        "tags.available": "标签 - 为每个物品分配匹配的ID：",
        "tags.none": "无可用标签；省略 tagIds。",
        # ── 用户提示说明 ───────────────────────────────────────────────
        "user.list_items": "列出此图像中的主要物品。",
        "user.context": '用户上下文："{instructions}"',
        "user.extract_fields": (
            "从此文本中提取：价格→purchasePrice、序列号→serialNumber、"
            "型号→modelNumber、商店→purchaseFrom、品牌→manufacturer。"
        ),
        # ── JSON示例 (用于few-shot学习) ─────────────────────────────
        "example.item_name": "羊角锤",
        "example.item_desc": "钢制羊角锤",
        # ── 多图说明 ───────────────────────────────────────────────────
        "multi.same_item": "同一物品的多张图像。将所有详情合并为一个条目。",
        "multi.different_items": "多张图像 - 识别所有不同的物品，避免重复。",
        # ── 精确识别说明 ───────────────────────────────────────────────
        "discriminatory.identify": "识别所有不同的物品。更加精确 - 不同尺寸/颜色/品牌/型号 = 单独物品。",
        "discriminatory.examples": "示例：'80目砂纸' + '120目砂纸'，'M3十字螺丝' + 'M5十字螺丝'。",
        # ── 分析说明 ───────────────────────────────────────────────────
        "analysis.extract": "提取所有可见细节：序列号、型号、品牌、价格标签、状况问题。仅使用可见内容。",
        "analysis.item_label": "物品：'{name}'",
        # ── 纠正规则 ───────────────────────────────────────────────────
        "correction.header": "纠正规则：",
        "correction.separate": "- '分开物品' → 返回数组中的多个物品",
        "correction.fix_name": "- 名称/描述修正 → 返回单个修正后的物品",
        "correction.extract_fields": "- 提取价格→purchasePrice、商店→purchaseFrom、品牌→manufacturer",
        "correction.verify": "- 始终对照图像验证",
        "correction.apply": "应用纠正并返回包含修正物品的 JSON。",
        "correction.current_item": "当前：{name}（数量：{quantity}）",
        "correction.user_input": '用户纠正："{instructions}"',
        # ── 默认字段说明 ───────────────────────────────────────────────
        "default.name": "首字母大写，最多255个字符",
        "default.quantity": ">= 1，相同物品的数量",
        "default.description": "最多1000字符，仅限状况/属性",
        "default.manufacturer": "仅在品牌/标志可见时",
        "default.model_number": "仅在型号/零件号文字清晰可见时",
        "default.serial_number": "仅在标签/贴纸/铭牌上可见序列号文字时",
        "default.purchase_price": "仅从可见的价格标签/收据。仅数字。",
        "default.purchase_from": "仅从可见的包装/收据或用户指定",
        "default.notes": "仅用于可见问题：损坏、缺件、安全隐患",
        "default.unknown": "未知",
        # ── 语言指令 ───────────────────────────────────────────────────
        "language.instruction": (
            "重要 - 输出语言：你必须用中文编写所有物品名称、描述和备注。"
            "JSON字段名（name、description等）保持英文以确保兼容性。"
        ),
        "language.example": "示例：name='羊角锤', description='钢制羊角锤'",
    },
}

# Supported language names
SUPPORTED_LANGUAGES = list(TRANSLATIONS.keys())


def get_text(key: str, language: str = "English") -> str:
    """Get translated text for a given key and language.

    Falls back to English if the key or language is not found.

    Args:
        key: Translation key (e.g., "role.inventory_assistant").
        language: Target language name (e.g., "English", "Chinese").

    Returns:
        Translated text string, or English fallback if not found.
    """
    lang_dict = TRANSLATIONS.get(language, TRANSLATIONS["English"])
    return lang_dict.get(key, TRANSLATIONS["English"].get(key, key))
