from __future__ import annotations

import os
import sys

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtWidgets import QApplication

from desktop_app import OrderExtractionWindow, run_smoke_test


def test_order_extraction_window_can_be_constructed() -> None:
    app = QApplication.instance() or QApplication(sys.argv)

    window = OrderExtractionWindow()

    assert window.windowTitle() == "订单整理助手"
    assert app is not None


def test_run_smoke_test_prints_window_title(capsys) -> None:
    result = run_smoke_test()

    assert result == 0
    assert "订单整理助手" in capsys.readouterr().out


def test_order_extraction_window_has_email_controls() -> None:
    app = QApplication.instance() or QApplication(sys.argv)

    window = OrderExtractionWindow()

    assert window.email_input.placeholderText() == "企业微信邮箱"
    assert window.auth_code_input.placeholderText() == "邮箱授权码"
    assert window.fetch_email_button.text() == "从邮箱提取订单"
    assert window.edit_email_settings_button.text() == "修改邮箱设置"
    assert app is not None


def test_order_extraction_window_prioritizes_email_single_page_flow() -> None:
    app = QApplication.instance() or QApplication(sys.argv)

    window = OrderExtractionWindow()

    assert window.status_label.text() == "等待从邮箱提取订单"
    assert window.fetch_email_button.objectName() == "primaryActionButton"
    assert window.select_files_button.objectName() == "secondaryActionButton"
    assert window.select_folder_button.objectName() == "secondaryActionButton"
    assert window.drop_zone.minimumHeight() <= 90
    assert window.drop_zone.title_label.text() == "也可以拖入 Excel 或文件夹"
    assert window.advanced_settings_panel.objectName() == "settingsPanel"
    assert app is not None
