#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

APP_NAME="订单整理助手"
ASSET_BASENAME="order-organizer-assistant"

BUILD_INFO_BACKUP="$(mktemp)"
cp build_info.py "$BUILD_INFO_BACKUP"
restore_build_info() {
  cp "$BUILD_INFO_BACKUP" build_info.py
  rm -f "$BUILD_INFO_BACKUP"
}
trap restore_build_info EXIT

TAG_NAME="$(git describe --tags --exact-match 2>/dev/null || git describe --tags --abbrev=0 2>/dev/null || echo v0.0.0-dev)"
VERSION="${TAG_NAME#v}"
BUILD_COMMIT="$(git rev-parse HEAD 2>/dev/null || echo "")"
{
  printf '%s\n' 'from __future__ import annotations'
  printf '\n'
  printf 'APP_VERSION = "%s"\n' "$VERSION"
  printf 'APP_RELEASE_TAG = "%s"\n' "$TAG_NAME"
  printf 'APP_BUILD_COMMIT = "%s"\n' "$BUILD_COMMIT"
} > build_info.py

python3 -m pip install -r requirements-desktop.txt pyinstaller
rm -rf build dist "${ASSET_BASENAME}-macos.dmg" "order-extraction-tool-macos.dmg"
python3 -m PyInstaller --clean --noconfirm order_extraction_tool.spec
hdiutil create -volname "$APP_NAME" -srcfolder "dist/${APP_NAME}.app" -ov -format UDZO "${ASSET_BASENAME}-macos.dmg"

echo "Built dist/${APP_NAME}.app"
echo "Created ${ASSET_BASENAME}-macos.dmg"
