import json

from app.core.utils import normalize_positive_int_ids


def parse_selected_variant_ids(
    variant_ids_json: str | None,
    preferred_variant_id: int | None = None,
) -> list[int]:
    if variant_ids_json:
        try:
            payload = json.loads(variant_ids_json)
        except Exception:
            payload = None
        if isinstance(payload, list):
            parsed = normalize_positive_int_ids(payload)
            if parsed:
                return parsed

    if preferred_variant_id is not None and int(preferred_variant_id) > 0:
        return [int(preferred_variant_id)]
    return []


def serialize_selected_variant_ids(variant_ids: list[int]) -> str | None:
    normalized = normalize_positive_int_ids(variant_ids)
    return json.dumps(normalized) if normalized else None
