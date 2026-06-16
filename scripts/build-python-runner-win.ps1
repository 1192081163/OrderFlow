$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$helperDir = Join-Path $repoRoot "python-helper"
$workDir = Join-Path $repoRoot "build/python-runner"
$specDir = Join-Path $repoRoot "build"

if (Test-Path $helperDir) {
    Remove-Item $helperDir -Recurse -Force
}
New-Item -ItemType Directory -Path $helperDir | Out-Null
New-Item -ItemType Directory -Path $specDir -Force | Out-Null

python -m PyInstaller `
    --clean `
    --noconfirm `
    --onefile `
    --console `
    --name "order-python-runner" `
    --distpath $helperDir `
    --workpath $workDir `
    --specpath $specDir `
    --add-data "rules;rules" `
    "python_extraction_bridge.py"
