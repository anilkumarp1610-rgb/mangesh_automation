import os
import re
from datetime import datetime

import yaml

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIELD_MAPS_PATH = os.path.join(PROJECT_ROOT, "config", "field_maps.yml")

with open(FIELD_MAPS_PATH, "r", encoding="utf-8") as f:
    _raw = yaml.safe_load(f)

SUMMARY_FIELD_MAP = _raw["Summary"]
DETAIL_FIELD_MAP = _raw["Detail"]
SERVICE_FIELD_MAP = _raw["Service"]
CHARGE_FIELD_MAP = _raw["Charge"]

# API dates come back as ISO 8601, e.g. "2026-05-07T00:00:00Z" or
# "2026-08-25T09:28:01.099Z" -- MySQL DATETIME columns reject that format
# outright (error 1292), so convert to a naive datetime before insert.
_ISO_DATETIME_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$"
)


def _convert_value(value):
    if isinstance(value, str) and _ISO_DATETIME_RE.match(value):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError:
            return value
    return value


def map_record(record: dict, field_map: dict) -> dict:
    return {
        db_col: _convert_value(record.get(api_field))
        for api_field, db_col in field_map.items()
    }
