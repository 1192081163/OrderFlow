# Network Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a GitHub Release based update check for the desktop app.

**Architecture:** Add a pure `updater.py` module that can be tested without Qt, then call it from `desktop_app.py` through a `QThread`. Generate `build_info.py` during packaging so the running app can detect both newer versions and same-version overwritten releases.

**Tech Stack:** Python 3.12, PySide6, urllib, pytest, PyInstaller, GitHub Actions.

---

### File Structure

- Create `build_info.py`: committed default version metadata for local development.
- Create `updater.py`: pure update checking, GitHub API parsing, and version comparison.
- Create `tests/test_updater.py`: TDD coverage for update decisions and asset selection.
- Modify `desktop_app.py`: add version label, manual check button, startup check, and update prompt.
- Modify `.github/workflows/release.yml`: generate `build_info.py` in Windows and macOS packaging jobs.
- Modify `build_mac.sh` and `build_windows.bat`: generate `build_info.py` for local packaging.
- Modify `README.md`: document update behavior.

### Task 1: Core Update Logic

- [ ] **Step 1: Write failing tests in `tests/test_updater.py`**

```python
from updater import (
    CURRENT_PLATFORM_ASSET,
    UpdateCheckInput,
    choose_asset,
    compare_versions,
    decide_update,
)


def test_compare_versions_handles_v_prefix_and_numeric_parts():
    assert compare_versions("v1.2.0", "1.10.0") < 0
    assert compare_versions("1.0.0", "v1.0.0") == 0
    assert compare_versions("1.2.1", "1.2.0") > 0


def test_choose_asset_selects_current_platform_package():
    release = {
        "assets": [
            {"name": "order-organizer-assistant-windows.exe", "browser_download_url": "https://example/win.exe"},
            {"name": "order-organizer-assistant-macos.dmg", "browser_download_url": "https://example/mac.dmg"},
        ]
    }
    assert choose_asset(release, CURRENT_PLATFORM_ASSET)["name"] == CURRENT_PLATFORM_ASSET


def test_decide_update_detects_newer_version():
    result = decide_update(
        UpdateCheckInput(current_version="1.0.0", current_commit="abc"),
        {
            "tag_name": "v1.1.0",
            "html_url": "https://example/release",
            "assets": [{"name": CURRENT_PLATFORM_ASSET, "browser_download_url": "https://example/download"}],
        },
        latest_tag_commit="def",
    )
    assert result.update_available is True
    assert result.download_url == "https://example/download"


def test_decide_update_detects_same_version_new_commit():
    result = decide_update(
        UpdateCheckInput(current_version="1.0.0", current_commit="abc"),
        {
            "tag_name": "v1.0.0",
            "html_url": "https://example/release",
            "assets": [{"name": CURRENT_PLATFORM_ASSET, "browser_download_url": "https://example/download"}],
        },
        latest_tag_commit="def",
    )
    assert result.update_available is True
    assert result.reason == "same_version_new_commit"


def test_decide_update_no_update_when_version_and_commit_match():
    result = decide_update(
        UpdateCheckInput(current_version="1.0.0", current_commit="abc"),
        {
            "tag_name": "v1.0.0",
            "html_url": "https://example/release",
            "assets": [{"name": CURRENT_PLATFORM_ASSET, "browser_download_url": "https://example/download"}],
        },
        latest_tag_commit="abc",
    )
    assert result.update_available is False
```

- [ ] **Step 2: Verify red**

Run: `python3 -m pytest tests/test_updater.py -q`

Expected: import failure because `updater.py` does not exist yet.

- [ ] **Step 3: Implement `updater.py`**

Create dataclasses for update input/result, version comparison helpers, asset selection, GitHub JSON fetch, tag commit fetch, and `check_for_update`.

- [ ] **Step 4: Verify green**

Run: `python3 -m pytest tests/test_updater.py -q`

Expected: all tests in `tests/test_updater.py` pass.

### Task 2: Desktop Integration

- [ ] **Step 1: Add update worker and UI controls**

Modify `desktop_app.py` to import `APP_VERSION`, `APP_BUILD_COMMIT`, `APP_RELEASE_TAG`, `check_for_update`, and `UpdateCheckResult`. Add a header label and `检查更新` button. Add `UpdateCheckWorker(QThread)` and use `QTimer.singleShot` for the startup check.

- [ ] **Step 2: Manual and automatic behavior**

Manual checks append a log line and show success/failure dialogs. Automatic checks only show a dialog when an update is available.

- [ ] **Step 3: Smoke test**

Run: `QT_QPA_PLATFORM=offscreen python3 desktop_app.py --smoke-test`

Expected: prints `订单提取工具` and exits 0.

### Task 3: Build Metadata

- [ ] **Step 1: Add default `build_info.py`**

The committed defaults are:

```python
APP_VERSION = "0.0.0-dev"
APP_RELEASE_TAG = "dev"
APP_BUILD_COMMIT = ""
```

- [ ] **Step 2: Generate build info in GitHub Actions**

Before PyInstaller runs in both platform jobs, write `build_info.py` using the release tag and `github.sha`.

- [ ] **Step 3: Generate build info in local scripts**

Update `build_mac.sh` and `build_windows.bat` to write `build_info.py` from the current git tag/commit before packaging.

### Task 4: Documentation and Verification

- [ ] **Step 1: Update README**

Document that the app checks GitHub Releases and opens the matching EXE/DMG download.

- [ ] **Step 2: Run full tests**

Run: `python3 -m pytest -q`

Expected: all tests pass.

- [ ] **Step 3: Run local macOS package smoke**

Run:

```bash
./build_mac.sh
"dist/订单提取工具.app/Contents/MacOS/订单提取工具" --smoke-test
```

Expected: DMG is created and smoke test prints `订单提取工具`.

- [ ] **Step 4: Commit and release**

Commit the code, push `main`, and verify GitHub Actions publishes `order-organizer-assistant-windows.exe` as the direct Windows installer.
