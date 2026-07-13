import { access, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import type { UpdateCheckResult } from "../shared/types.js";
import { CURRENT_RELEASE_TAG } from "./buildInfo.js";

const require = createRequire(import.meta.url);
const packageJson = require("../../package.json") as { version?: string };

export const RELEASE_API_URL = "https://api.github.com/repos/1192081163/orderflow-desktop/releases/latest";
export const WINDOWS_ASSET_NAME = "orderflow-desktop-windows.exe";

interface ReleaseAsset {
  name?: unknown;
  browser_download_url?: unknown;
}

interface ReleasePayload {
  tag_name?: unknown;
  html_url?: unknown;
  assets?: unknown;
}

type UpdateComparisonOptions =
  | string
  | {
      currentVersion?: string;
      currentReleaseTag?: string;
    };

export function updateInfoFromReleasePayload(
  payload: ReleasePayload,
  options: UpdateComparisonOptions = {
    currentVersion: packageJson.version ?? "1.0.0",
    currentReleaseTag: CURRENT_RELEASE_TAG,
  },
): UpdateCheckResult {
  const { currentVersion, currentReleaseTag } = normalizeUpdateOptions(options);
  const latestTag = String(payload.tag_name ?? "").trim();
  const latestVersion = latestTag.replace(/^v/i, "");
  const releaseUrl = String(payload.html_url ?? "");
  const asset = selectWindowsAsset(payload.assets);

  if (!isNewerRelease(latestTag, latestVersion, currentReleaseTag, currentVersion)) {
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
      headers: { "User-Agent": `orderflow-desktop/${currentVersion}` },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = (await response.json()) as ReleasePayload;
    return updateInfoFromReleasePayload(payload, { currentVersion, currentReleaseTag: CURRENT_RELEASE_TAG });
  } catch (error) {
    return {
      updateAvailable: false,
      currentVersion,
      reason: "error",
      error: `检查更新失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function downloadUpdateExecutable(
  update: UpdateCheckResult,
  downloadDir: string,
  fetchImpl = fetch,
): Promise<string> {
  if (!update.updateAvailable || !update.downloadUrl || !update.assetName) {
    throw new Error("更新文件不存在，请稍后重试或手动下载新版 exe。");
  }
  if (update.assetName !== WINDOWS_ASSET_NAME) {
    throw new Error("更新文件名不正确，已拒绝下载。");
  }
  assertOfficialDownloadUrl(update.downloadUrl);

  await mkdir(downloadDir, { recursive: true });
  const executablePath = await uniquePath(path.join(downloadDir, update.assetName));
  const tempPath = `${executablePath}.download`;
  const currentVersion = packageJson.version ?? "1.0.0";

  const response = await fetchImpl(update.downloadUrl, {
    headers: { "User-Agent": `orderflow-desktop/${currentVersion}` },
  });
  if (!response.ok || !response.body) {
    throw new Error(`新版 exe 下载失败：HTTP ${response.status}`);
  }

  try {
    await writeFile(tempPath, Buffer.from(await response.arrayBuffer()));
    await rename(tempPath, executablePath);
  } finally {
    await rm(tempPath, { force: true });
  }

  return executablePath;
}

function normalizeUpdateOptions(options: UpdateComparisonOptions): { currentVersion: string; currentReleaseTag: string } {
  if (typeof options === "string") {
    return { currentVersion: options, currentReleaseTag: "" };
  }
  return {
    currentVersion: options.currentVersion ?? packageJson.version ?? "1.0.0",
    currentReleaseTag: options.currentReleaseTag ?? CURRENT_RELEASE_TAG,
  };
}

function selectWindowsAsset(assets: unknown): ReleaseAsset | null {
  if (!Array.isArray(assets)) {
    return null;
  }
  return (
    (assets as ReleaseAsset[]).find((asset) => {
      const name = String(asset.name ?? "");
      return name === WINDOWS_ASSET_NAME;
    }) ?? null
  );
}

function assertOfficialDownloadUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("更新下载地址无效，已拒绝下载。");
  }
  const officialPath = /^\/1192081163\/(?:orderflow-desktop|OrderFlow)\/releases\/download\//i;
  if (url.protocol !== "https:" || url.hostname !== "github.com" || !officialPath.test(url.pathname)) {
    throw new Error("更新文件来自非官方地址，已拒绝下载。");
  }
}

async function uniquePath(filePath: string): Promise<string> {
  if (!(await pathExists(filePath))) {
    return filePath;
  }

  const parsed = path.parse(filePath);
  for (let index = 1; index < 100; index += 1) {
    const candidate = path.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`);
    if (!(await pathExists(candidate))) {
      return candidate;
    }
  }

  throw new Error("下载目录中存在过多同名新版 exe。");
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isNewerRelease(
  latestTag: string,
  latestVersion: string,
  currentReleaseTag: string,
  currentVersion: string,
): boolean {
  if (!latestTag) {
    return false;
  }

  if (currentReleaseTag === "dev") {
    return false;
  }

  if (currentReleaseTag) {
    if (latestTag === currentReleaseTag) {
      return false;
    }

    const latestBuild = parseBuildTag(latestTag);
    const currentBuild = parseBuildTag(currentReleaseTag);
    if (latestBuild !== null && currentBuild !== null) {
      return latestBuild > currentBuild;
    }

    const latestSemver = parseSemver(latestTag);
    const currentSemver = parseSemver(currentReleaseTag) ?? parseSemver(currentVersion);
    if (latestSemver && currentSemver) {
      return compareSemver(latestSemver, currentSemver) > 0;
    }

    return latestTag !== currentReleaseTag;
  }

  return compareVersions(currentVersion, latestVersion) < 0;
}

function parseBuildTag(tag: string): number | null {
  const match = tag.trim().match(/^build-(\d+)$/);
  return match ? Number(match[1]) : null;
}

function parseSemver(tag: string): [number, number, number] | null {
  const match = tag.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function compareSemver(left: [number, number, number], right: [number, number, number]): number {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }
  return 0;
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
