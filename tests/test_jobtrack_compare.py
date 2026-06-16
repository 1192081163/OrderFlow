from __future__ import annotations

import importlib.util
from decimal import Decimal
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "tools" / "regenerate_jobtrack_compare.py"
SPEC = importlib.util.spec_from_file_location("regenerate_jobtrack_compare", MODULE_PATH)
assert SPEC and SPEC.loader
compare = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(compare)


def test_col20_normalized_uses_zero_decimal_excel_display() -> None:
    assert compare.normalized(Decimal("12.5"), 20) == "13"
    assert compare.normalized(Decimal("3.6"), 20) == "4"


def test_col20_reason_describes_blank_zero_mitre_difference() -> None:
    reason = compare.reason_for(
        {"col": "20", "track_norm": "", "generated_norm": "0", "job": "29294"},
        {},
    )

    assert "空/0" in reason


def test_col24_reason_describes_kd_quantity_rule() -> None:
    reason = compare.reason_for(
        {"col": "24", "track_norm": "", "generated_norm": "16", "job": "29954"},
        {},
    )

    assert "KD" in reason
    assert "数量*4" in reason


def test_address_normalized_ignores_loop_abbreviation_and_customer_prefix() -> None:
    assert compare.normalized("2 Volcanic Loop, Wangara", 6) == compare.normalized(
        "Danze Mining, 2 Volcanic Lp Wangara",
        6,
    )


def test_explained_category_marks_blank_po_as_job_track_missing() -> None:
    category = compare.explained_category_for(
        {"col": "2", "track": "", "generated": "PO-123", "track_norm": "", "generated_norm": "PO-123"},
        [None] * 24,
        [None] * 24,
    )

    assert category == "Job Track漏填PO"


def test_explained_category_marks_kd_old_bucket_style() -> None:
    track_values = [None] * 24
    generated_values = [None] * 24
    track_values[21] = 80
    track_values[23] = None
    generated_values[11] = "KD"
    generated_values[21] = 40
    generated_values[23] = 40

    category = compare.explained_category_for(
        {"col": "22", "track": "80", "generated": "40", "track_norm": "80", "generated_norm": "40"},
        track_values,
        generated_values,
    )

    assert category == "KD旧填法：第24列混在第22列"
