#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

python3 -m pip install -r requirements-desktop.txt pyinstaller
rm -rf build dist "订单提取工具-macos.dmg"
python3 -m PyInstaller --clean --noconfirm order_extraction_tool.spec
hdiutil create -volname "订单提取工具" -srcfolder "dist/订单提取工具.app" -ov -format UDZO "订单提取工具-macos.dmg"

echo "Built dist/订单提取工具.app"
echo "Created 订单提取工具-macos.dmg"
