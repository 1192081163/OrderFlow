from __future__ import annotations

import urllib.error

import updater
from updater import (
    UpdateCheckInput,
    WINDOWS_ASSET,
    check_for_update,
    choose_asset,
    compare_versions,
    decide_update,
    read_json_url,
)

TEST_PLATFORM_ASSET = WINDOWS_ASSET


def test_compare_versions_handles_v_prefix_and_numeric_parts() -> None:
    assert compare_versions("v1.2.0", "1.10.0") < 0
    assert compare_versions("1.0.0", "v1.0.0") == 0
    assert compare_versions("1.2.1", "1.2.0") > 0
    assert compare_versions("0.0.0-dev", "v1.0.0") < 0


def test_choose_asset_selects_current_platform_package() -> None:
    release = {
        "assets": [
            {
                "name": "order-extraction-tool-windows.exe",
                "browser_download_url": "https://example.test/win.exe",
            },
            {
                "name": "order-extraction-tool-macos.dmg",
                "browser_download_url": "https://example.test/mac.dmg",
            },
        ]
    }

    asset = choose_asset(release, TEST_PLATFORM_ASSET)

    assert asset is not None
    assert asset["name"] == TEST_PLATFORM_ASSET


def test_decide_update_detects_newer_version() -> None:
    result = decide_update(
        UpdateCheckInput(
            current_version="1.0.0",
            current_commit="abc123",
            platform_asset=TEST_PLATFORM_ASSET,
        ),
        {
            "tag_name": "v1.1.0",
            "html_url": "https://example.test/release",
            "assets": [
                {
                    "name": TEST_PLATFORM_ASSET,
                    "browser_download_url": "https://example.test/download",
                }
            ],
        },
        latest_tag_commit="def456",
    )

    assert result.update_available is True
    assert result.reason == "newer_version"
    assert result.download_url == "https://example.test/download"


def test_decide_update_detects_same_version_new_commit() -> None:
    result = decide_update(
        UpdateCheckInput(
            current_version="1.0.0",
            current_commit="abc123",
            platform_asset=TEST_PLATFORM_ASSET,
        ),
        {
            "tag_name": "v1.0.0",
            "html_url": "https://example.test/release",
            "assets": [
                {
                    "name": TEST_PLATFORM_ASSET,
                    "browser_download_url": "https://example.test/download",
                }
            ],
        },
        latest_tag_commit="def456",
    )

    assert result.update_available is True
    assert result.reason == "same_version_new_commit"


def test_decide_update_no_update_when_version_and_commit_match() -> None:
    result = decide_update(
        UpdateCheckInput(
            current_version="1.0.0",
            current_commit="abc123",
            platform_asset=TEST_PLATFORM_ASSET,
        ),
        {
            "tag_name": "v1.0.0",
            "html_url": "https://example.test/release",
            "assets": [
                {
                    "name": TEST_PLATFORM_ASSET,
                    "browser_download_url": "https://example.test/download",
                }
            ],
        },
        latest_tag_commit="abc123",
    )

    assert result.update_available is False
    assert result.reason == "current"


def test_decide_update_reports_missing_platform_asset() -> None:
    result = decide_update(
        UpdateCheckInput(
            current_version="1.0.0",
            current_commit="abc123",
            platform_asset=TEST_PLATFORM_ASSET,
        ),
        {
            "tag_name": "v1.1.0",
            "html_url": "https://example.test/release",
            "assets": [{"name": "other.zip", "browser_download_url": "https://example.test/other"}],
        },
        latest_tag_commit="def456",
    )

    assert result.update_available is False
    assert result.error == f"未找到当前系统的下载文件：{TEST_PLATFORM_ASSET}"


def test_check_for_update_returns_error_when_network_fails(monkeypatch) -> None:
    def failing_read_json_url(url: str, timeout: float = 6.0) -> dict:
        raise urllib.error.URLError("offline")

    monkeypatch.setattr("updater.read_json_url", failing_read_json_url)

    result = check_for_update(UpdateCheckInput(current_version="1.0.0", current_commit="abc123"))

    assert result.update_available is False
    assert "检查更新失败" in (result.error or "")


def test_read_json_url_uses_injected_opener() -> None:
    class Response:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def read(self) -> bytes:
            return b'{"tag_name":"v1.0.0"}'

    def opener(request, timeout: float):
        assert request.full_url == "https://example.test/latest"
        assert timeout == 2.5
        return Response()

    assert read_json_url("https://example.test/latest", timeout=2.5, opener=opener) == {
        "tag_name": "v1.0.0"
    }


def test_download_update_asset_writes_package_to_target_dir(tmp_path) -> None:
    class Response:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def read(self, size: int = -1) -> bytes:
            if getattr(self, "_done", False):
                return b""
            self._done = True
            return b"installer"

    def opener(request, timeout: float):
        assert request.full_url == "https://example.test/tool.exe"
        assert timeout == 4.0
        return Response()

    assert hasattr(updater, "download_update_asset")

    result = updater.download_update_asset(
        "https://example.test/tool.exe",
        "order-extraction-tool-windows.exe",
        target_dir=tmp_path,
        timeout=4.0,
        opener=opener,
    )

    assert result.path == tmp_path / "order-extraction-tool-windows.exe"
    assert result.path.read_bytes() == b"installer"
    assert result.bytes_written == len(b"installer")


def test_download_update_asset_replaces_existing_file_atomically(tmp_path) -> None:
    existing = tmp_path / "order-extraction-tool-windows.exe"
    existing.write_bytes(b"old")

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def read(self, size: int = -1) -> bytes:
            return b"new-version" if not hasattr(self, "read_once") else b""

    def opener(request, timeout: float):
        response = Response()

        def read_once(size: int = -1) -> bytes:
            if getattr(response, "_done", False):
                return b""
            response._done = True
            return b"new-version"

        response.read = read_once
        return response

    assert hasattr(updater, "download_update_asset")

    result = updater.download_update_asset(
        "https://example.test/tool.exe",
        "order-extraction-tool-windows.exe",
        target_dir=tmp_path,
        opener=opener,
    )

    assert result.path == existing
    assert existing.read_bytes() == b"new-version"
    assert not (tmp_path / "order-extraction-tool-windows.exe.download").exists()


def test_download_update_asset_uses_url_filename_when_asset_name_missing(tmp_path) -> None:
    class Response:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def read(self, size: int = -1) -> bytes:
            if getattr(self, "_done", False):
                return b""
            self._done = True
            return b"dmg"

    def opener(request, timeout: float):
        return Response()

    assert hasattr(updater, "download_update_asset")

    result = updater.download_update_asset(
        "https://example.test/downloads/order-extraction-tool-macos.dmg?token=abc",
        "",
        target_dir=tmp_path,
        opener=opener,
    )

    assert result.path == tmp_path / "order-extraction-tool-macos.dmg"
    assert result.path.read_bytes() == b"dmg"
