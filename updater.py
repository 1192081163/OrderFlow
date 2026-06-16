from __future__ import annotations

import json
import platform
import re
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable
from urllib.parse import unquote, urlparse

REPO_OWNER = "1192081163"
REPO_NAME = "r004-order-extraction-tool"
RELEASE_API_URL = f"https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}/releases/latest"
TAG_REF_API_URL = f"https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}/git/ref/tags"
WINDOWS_ASSET = "order-extraction-tool-windows.exe"
MACOS_ASSET = "order-extraction-tool-macos.dmg"


def current_platform_asset() -> str:
    system = platform.system().lower()
    if system == "windows":
        return WINDOWS_ASSET
    if system == "darwin":
        return MACOS_ASSET
    return ""


CURRENT_PLATFORM_ASSET = current_platform_asset()


@dataclass(frozen=True)
class UpdateCheckInput:
    current_version: str
    current_commit: str = ""
    platform_asset: str = CURRENT_PLATFORM_ASSET


@dataclass(frozen=True)
class UpdateCheckResult:
    update_available: bool
    current_version: str
    latest_version: str = ""
    current_commit: str = ""
    latest_commit: str = ""
    release_url: str = ""
    download_url: str = ""
    asset_name: str = ""
    reason: str = "current"
    error: str | None = None


@dataclass(frozen=True)
class UpdateDownloadResult:
    path: Path
    bytes_written: int


def _version_parts(version: str) -> tuple[int, ...]:
    cleaned = version.strip().lower()
    cleaned = cleaned[1:] if cleaned.startswith("v") else cleaned
    match = re.match(r"(\d+(?:\.\d+)*)", cleaned)
    if not match:
        return (0,)
    return tuple(int(part) for part in match.group(1).split("."))


def compare_versions(left: str, right: str) -> int:
    left_parts = list(_version_parts(left))
    right_parts = list(_version_parts(right))
    width = max(len(left_parts), len(right_parts))
    left_parts.extend([0] * (width - len(left_parts)))
    right_parts.extend([0] * (width - len(right_parts)))
    if left_parts < right_parts:
        return -1
    if left_parts > right_parts:
        return 1
    return 0


def choose_asset(release: dict[str, Any], platform_asset: str) -> dict[str, Any] | None:
    if not platform_asset:
        return None
    for asset in release.get("assets", []):
        if asset.get("name") == platform_asset:
            return asset
    return None


def read_json_url(
    url: str,
    timeout: float = 6.0,
    opener: Callable[..., Any] = urllib.request.urlopen,
) -> dict[str, Any]:
    request = urllib.request.Request(url, headers={"User-Agent": "order-extraction-tool"})
    with opener(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def default_update_download_dir() -> Path:
    return Path.home() / "Downloads" / "order-extraction-tool-updates"


def update_asset_filename(download_url: str, asset_name: str) -> str:
    candidate = Path(asset_name).name if asset_name else ""
    if not candidate:
        parsed = urlparse(download_url)
        candidate = Path(unquote(parsed.path)).name
    return candidate or "order-extraction-update"


def download_update_asset(
    download_url: str,
    asset_name: str,
    target_dir: Path | None = None,
    timeout: float = 30.0,
    opener: Callable[..., Any] = urllib.request.urlopen,
    chunk_size: int = 1024 * 1024,
) -> UpdateDownloadResult:
    if not download_url:
        raise ValueError("缺少更新下载链接")

    download_dir = target_dir or default_update_download_dir()
    download_dir.mkdir(parents=True, exist_ok=True)
    filename = update_asset_filename(download_url, asset_name)
    final_path = download_dir / filename
    temp_path = download_dir / f"{filename}.download"

    request = urllib.request.Request(download_url, headers={"User-Agent": "order-extraction-tool"})
    bytes_written = 0
    with opener(request, timeout=timeout) as response:
        with temp_path.open("wb") as output:
            while True:
                chunk = response.read(chunk_size)
                if not chunk:
                    break
                output.write(chunk)
                bytes_written += len(chunk)

    temp_path.replace(final_path)
    return UpdateDownloadResult(path=final_path, bytes_written=bytes_written)


def latest_tag_commit(release_tag: str, timeout: float = 6.0) -> str:
    if not release_tag:
        return ""
    payload = read_json_url(f"{TAG_REF_API_URL}/{release_tag}", timeout=timeout)
    obj = payload.get("object", {})
    if obj.get("type") == "commit":
        return str(obj.get("sha", ""))
    if obj.get("url"):
        tag_payload = read_json_url(str(obj["url"]), timeout=timeout)
        return str(tag_payload.get("object", {}).get("sha", ""))
    return ""


def decide_update(
    current: UpdateCheckInput,
    release: dict[str, Any],
    latest_tag_commit: str = "",
) -> UpdateCheckResult:
    latest_tag = str(release.get("tag_name", ""))
    latest_version = latest_tag[1:] if latest_tag.startswith("v") else latest_tag
    release_url = str(release.get("html_url", ""))
    asset = choose_asset(release, current.platform_asset)

    version_comparison = compare_versions(current.current_version, latest_version)
    same_version_new_commit = (
        version_comparison == 0
        and bool(current.current_commit)
        and bool(latest_tag_commit)
        and current.current_commit != latest_tag_commit
    )

    if version_comparison >= 0 and not same_version_new_commit:
        return UpdateCheckResult(
            update_available=False,
            current_version=current.current_version,
            latest_version=latest_version,
            current_commit=current.current_commit,
            latest_commit=latest_tag_commit,
            release_url=release_url,
            reason="current",
        )

    if asset is None:
        return UpdateCheckResult(
            update_available=False,
            current_version=current.current_version,
            latest_version=latest_version,
            current_commit=current.current_commit,
            latest_commit=latest_tag_commit,
            release_url=release_url,
            reason="missing_asset",
            error=f"未找到当前系统的下载文件：{current.platform_asset}",
        )

    return UpdateCheckResult(
        update_available=True,
        current_version=current.current_version,
        latest_version=latest_version,
        current_commit=current.current_commit,
        latest_commit=latest_tag_commit,
        release_url=release_url,
        download_url=str(asset.get("browser_download_url", release_url)),
        asset_name=str(asset.get("name", "")),
        reason="same_version_new_commit" if same_version_new_commit else "newer_version",
    )


def check_for_update(current: UpdateCheckInput, timeout: float = 6.0) -> UpdateCheckResult:
    try:
        release = read_json_url(RELEASE_API_URL, timeout=timeout)
        tag_commit = latest_tag_commit(str(release.get("tag_name", "")), timeout=timeout)
        return decide_update(current, release, latest_tag_commit=tag_commit)
    except Exception as exc:
        return UpdateCheckResult(
            update_available=False,
            current_version=current.current_version,
            current_commit=current.current_commit,
            reason="error",
            error=f"检查更新失败：{exc}",
        )
