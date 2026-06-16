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
