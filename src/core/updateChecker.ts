import { createRequire } from "node:module";

import type { UpdateCheckResult } from "../shared/types.js";

const require = createRequire(import.meta.url);
const packageJson = require("../../package.json") as { version?: string };

export const RELEASE_API_URL = "https://api.github.com/repos/1192081163/r004-order-extraction-tool/releases/latest";
export const WINDOWS_ASSET_NAME = "order-organizer-assistant-windows.exe";

interface ReleaseAsset {
  name?: unknown;
  browser_download_url?: unknown;
}

interface ReleasePayload {
  tag_name?: unknown;
  html_url?: unknown;
  assets?: unknown;
}

export function updateInfoFromReleasePayload(
  payload: ReleasePayload,
  currentVersion = packageJson.version ?? "1.0.0",
): UpdateCheckResult {
  const latestVersion = String(payload.tag_name ?? "").trim().replace(/^v/i, "");
  const releaseUrl = String(payload.html_url ?? "");
  const asset = selectWindowsAsset(payload.assets);

  if (!latestVersion || compareVersions(currentVersion, latestVersion) >= 0) {
    return {
      updateAvailable: false,
      currentVersion,
      latestVersion,
      releaseUrl,
      reason: "current",
    };
  }

  if (!asset) {
    return {
      updateAvailable: false,
      currentVersion,
      latestVersion,
      releaseUrl,
      reason: "missing_asset",
      error: `未找到下载文件：${WINDOWS_ASSET_NAME}`,
    };
  }

  return {
    updateAvailable: true,
    currentVersion,
    latestVersion,
    releaseUrl,
    assetName: String(asset.name ?? ""),
    downloadUrl: String(asset.browser_download_url ?? releaseUrl),
    reason: "newer_version",
  };
}

export async function checkForUpdates(fetchImpl = fetch): Promise<UpdateCheckResult> {
  const currentVersion = packageJson.version ?? "1.0.0";
  try {
    const response = await fetchImpl(RELEASE_API_URL, {
      headers: { "User-Agent": `order-organizer-assistant/${currentVersion}` },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return updateInfoFromReleasePayload((await response.json()) as ReleasePayload, currentVersion);
  } catch (error) {
    return {
      updateAvailable: false,
      currentVersion,
      reason: "error",
      error: `检查更新失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function selectWindowsAsset(assets: unknown): ReleaseAsset | null {
  if (!Array.isArray(assets)) {
    return null;
  }
  return (
    assets.find((asset): asset is ReleaseAsset => {
      if (!asset || typeof asset !== "object") {
        return false;
      }
      return String((asset as ReleaseAsset).name ?? "") === WINDOWS_ASSET_NAME;
    }) ?? null
  );
}

function compareVersions(left: string, right: string): number {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

function versionParts(version: string): number[] {
  const match = version.trim().match(/(\d+(?:\.\d+)*)/);
  return match ? match[1].split(".").map((part) => Number(part)) : [0];
}
