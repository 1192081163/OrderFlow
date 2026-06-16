@echo off
setlocal

cd /d "%~dp0"

py -m pip install -r requirements-desktop.txt pyinstaller
if exist build rmdir /s /q build
if exist dist rmdir /s /q dist
if exist "订单提取工具-windows.exe" del /q "订单提取工具-windows.exe"
py -m PyInstaller --clean --noconfirm --onefile --windowed --name "订单提取工具" --add-data "rules;rules" desktop_app.py
copy /y "dist\订单提取工具.exe" "订单提取工具-windows.exe"

echo Built dist\订单提取工具.exe
echo Created 订单提取工具-windows.exe
