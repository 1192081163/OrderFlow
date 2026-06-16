from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_app_icon_assets_exist() -> None:
    assert (ROOT / "assets" / "app_icon.svg").exists()
    assert (ROOT / "assets" / "app_icon.ico").exists()
    assert (ROOT / "assets" / "app_icon.icns").exists()


def test_pyinstaller_spec_uses_app_name_and_icon() -> None:
    spec = (ROOT / "order_extraction_tool.spec").read_text(encoding="utf-8")

    assert 'APP_NAME = "订单整理助手"' in spec
    assert "name=APP_NAME" in spec
    assert 'name=f"{APP_NAME}.app"' in spec
    assert 'icon=str(ROOT / "assets" / "app_icon.icns")' in spec
    assert '"CFBundleDisplayName": APP_NAME' in spec
