from __future__ import annotations

from pathlib import Path

from openpyxl import Workbook

import extract


def save_workbook(wb: Workbook, path: Path) -> Path:
    wb.save(path)
    return path


def worksheet_book() -> Workbook:
    wb = Workbook()
    ws = wb.active
    ws.title = "Worksheet"
    wb.create_sheet("Data")
    ws["C1"] = 99999
    ws["C2"] = "Test Builder"
    ws["C5"] = "2026-06-15"
    headers = [
        "Material",
        "Stock",
        "Qty",
        "Profile",
        "B/O",
        "Reveal Height",
        "Reveal Width",
        "Hand",
        "Hinge Qty",
        "Hinge Type",
        "Striker Type",
        "Striker Height",
        "Sill",
        "Slider",
        "Double",
        "CL1",
        "CL3",
        "Striker Type2",
    ]
    for col, value in enumerate(headers, start=1):
        ws.cell(9, col).value = value
    return wb


def test_standard_worksheet_plain_hinge_stays_in_v_bucket(tmp_path: Path) -> None:
    wb = worksheet_book()
    ws = wb["Worksheet"]
    values = [
        "1.05mm Zincanneal",
        "",
        1,
        "Split",
        "85-125",
        2060,
        923,
        "RIGHT",
        "3",
        "HINGE PREP",
        "S1+RDL",
        "1000",
        "NO",
        "NO",
        "NO",
        "Split",
        "85-125",
        "S1+S1",
    ]
    for col, value in enumerate(values, start=1):
        ws.cell(11, col).value = value

    row = extract.extract_workbook(save_workbook(wb, tmp_path / "plain.xlsx"), infer_manual=True)

    assert row.values[19:24] == [2, 5, 5, None, None]


def test_standard_worksheet_screw_fixed_prep_uses_w_bucket_and_skips_other_rows(tmp_path: Path) -> None:
    wb = worksheet_book()
    ws = wb["Worksheet"]
    rows = {
        11: [
            "1.05mm Zincanneal",
            "",
            1,
            "Modern",
            "95",
            2360,
            823,
            "LEFT WC",
            "3",
            "SCREW FIXED PREP",
            "S1+ZANDA 10421",
            "1000 + 1150",
            "NO",
            "NO",
            "NO",
            "Modern",
            "95",
            1,
        ],
        12: [
            "1.05mm Zincanneal",
            "",
            1,
            "Modern",
            "95",
            2360,
            823,
            "LEFT",
            "3",
            "SCREW FIXED PREP",
            "S1",
            "1000",
            "NO",
            "NO",
            "NO",
            "Modern",
            "95",
            1,
        ],
        14: [
            "Other",
            "",
            1,
            "Single Elec with Lock & View (Non-Rebated)",
            None,
            0,
            0,
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            None,
            None,
            1,
        ],
    }
    for row_idx, values in rows.items():
        for col, value in enumerate(values, start=1):
            ws.cell(row_idx, col).value = value

    row = extract.extract_workbook(save_workbook(wb, tmp_path / "screw-fixed.xlsx"), infer_manual=True)

    assert row.values[10:12] == [2, "MODERN"]
    assert row.values[19:24] == [2, 9, 3, 6, None]


def sheet1_profile_book() -> Workbook:
    wb = Workbook()
    ws = wb.active
    ws.title = "Sheet1"
    ws["A1"] = "Job 30095"
    headers = ["QTY", "PROFILE", "HEIGHT", "WIDTH", "HAND", "QTY", "HINGES", "TYPE", "HEIGHT", "HOLES"]
    for col, value in enumerate(headers, start=1):
        ws.cell(12, col).value = value
    return wb


def test_sheet1_hinges_quantity_goes_to_v_bucket(tmp_path: Path) -> None:
    wb = sheet1_profile_book()
    ws = wb["Sheet1"]
    values = [1, "Split 180B/O (35 Door)", 2060, 923, "RIGHT", 3, "100X75X1.6", "S1", 1000, "12 + 6"]
    for col, value in enumerate(values, start=1):
        ws.cell(13, col).value = value

    row = extract.extract_workbook(save_workbook(wb, tmp_path / "sheet1.xlsx"), infer_manual=True)

    assert row.values[10:12] == [1, "SPLIT"]
    assert row.values[19:24] == [2, 5, 4, None, None]


def main_sheet_book() -> Workbook:
    wb = Workbook()
    ws = wb.active
    ws.title = "Main Sheet"
    wb.create_sheet("Profiles")
    ws["A1"] = "Job No 30354"
    ws["B2"] = "Fire Door Maintenance"
    headers = ["Door #", "PROFILE", "HEIGHT", "WIDTH", "HAND", "QTY", "TO SUIT", "GUARDS", "TYPE", "HEIGHT", "BOLT", "BRICK TIES"]
    for col, value in enumerate(headers, start=1):
        ws.cell(12, col).value = value
    return wb


def test_main_sheet_commercial_double_adds_mitre_and_only_double_counts_oversize(tmp_path: Path) -> None:
    wb = main_sheet_book()
    ws = wb["Main Sheet"]
    rows = {
        13: ["D.4", "A", 2410, 1920, "DOUBLE", "8 (4 EACH SIDE)", "100X100X2.5", "YES", "-", "-", "-", 10],
        14: ["D.3", "A", 2110, 1030, "RIGHT", 4, "100X100X2.5", "YES", "S1", 1020, "-", 8],
    }
    for row_idx, values in rows.items():
        for col, value in enumerate(values, start=1):
            ws.cell(row_idx, col).value = value

    row = extract.extract_workbook(save_workbook(wb, tmp_path / "main-profile.xlsx"), infer_manual=True)

    assert row.values[7] == 1
    assert row.values[10:12] == [2, "COMMERCIAL"]
    assert row.values[19:24] == [3, 18, 1, 12, None]


def test_main_sheet_profileless_table_extracts_commercial_hardware(tmp_path: Path) -> None:
    wb = main_sheet_book()
    ws = wb["Main Sheet"]
    headers = ["Door #", "TYPE", "THICKNESS", "HEIGHT", "WIDTH", "HAND", "QTY", "TO SUIT", "TYPE", "HEIGHT", "HOLES", "BRACKETS"]
    for col, value in enumerate(headers, start=1):
        ws.cell(12, col).value = value
    values = [
        "MAIL ROOM",
        "SPLIT 85-125B/O ",
        "40mm",
        2060,
        923,
        "RIGHT",
        4,
        "100X75X2.5",
        "MORTICE LOCK (S1)",
        1032,
        "12 + 6",
        "NOT REQUIRED",
    ]
    for col, value in enumerate(values, start=1):
        ws.cell(13, col).value = value

    row = extract.extract_workbook(save_workbook(wb, tmp_path / "main-profileless.xlsx"), infer_manual=True)

    assert row.values[10:12] == [1, "COMMERCIAL"]
    assert row.values[19:24] == [1, 5, 1, 4, None]
