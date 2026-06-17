# Network Update Design

## Goal

Add an online update check to the desktop order extraction tool. The app should check GitHub Releases for a newer downloadable package and let the user download it without blocking normal order extraction.

## User Experience

- The app checks for updates shortly after startup.
- A `检查更新` button lets the user manually check at any time.
- If an update is available, the app shows the current version, the latest version, and asks whether to open the matching download.
- Windows users get `order-organizer-assistant-windows.exe`.
- macOS packages are not published in the current release workflow.
- Network errors, GitHub rate limits, or missing assets do not interrupt extraction. Manual checks show the error; automatic checks fail quietly.

## Update Semantics

The app compares both release version and release commit:

- If the latest GitHub release version is greater than the running app version, an update is available.
- If the version is the same but the release tag points at a different commit, an update is also available. This supports the current release model where the same version can be overwritten with refreshed assets.
- If the app is a local development build with no embedded commit, only version comparison is reliable.

## Architecture

- `build_info.py` stores embedded version metadata. The committed file is a development default; packaging scripts overwrite it before PyInstaller runs.
- `updater.py` is a pure Python module for GitHub API calls, version comparison, asset selection, and update decision making.
- `desktop_app.py` owns UI behavior. It runs update checks on a background `QThread` and opens the chosen download URL through the system browser.
- `.github/workflows/release.yml`, `build_mac.sh`, and `build_windows.bat` generate `build_info.py` so packaged apps know their version, tag, and commit.

## Error Handling

Update checks use a short timeout. Any exception becomes a structured result instead of crashing the app. The UI only displays errors for manual checks.

## Testing

Unit tests cover semantic version comparison, platform asset selection, same-version commit updates, network payload parsing, and missing asset behavior. Desktop smoke tests continue to verify the window can be constructed in offscreen mode.
