"""Canonical display-unit normalization for household vital-sign surfaces."""

from __future__ import annotations

VITAL_DISPLAY_UNITS = {
    "weight": "kg",
    "temperature": "°C",
}


def normalize_vital_value_for_display(metric_id: str, value: float) -> float:
    """Convert one stored vital value to the household display contract."""

    numeric = float(value)
    if metric_id == "weight":
        return round(numeric * 0.45359237, 1)
    if metric_id == "temperature":
        return round((numeric - 32) * 5 / 9, 1)
    return numeric
