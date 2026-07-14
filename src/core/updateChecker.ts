import { createHash } from "node:crypto";
import { access, appendFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import type { UpdateCheckResult } from "../shared/types.js";
import { CURRENT_RELEASE_TAG } from "./buildInfo.js";

const require = createRequire(import.meta.url);
const packageJson = require("../../package.json") as { version?: string };

export const GITEE_RELEASE_API_URL = "https://gitee.com/api/v5/repos/wei-dongyu_1_0/OrderFlow/releases/latest";
export const GITHUB_RELEASE_API_URL = "https://api.github.com/repos/1192081163/OrderFlow/releases/latest";
export const RELEASE_API_URL = GITEE_RELEASE_API_URL;
export const RELEASE_API_URLS = [GITEE_RELEASE_API_URL, GITHUB_RELEASE_API_URL] as const;
export const WINDOWS_ASSET_NAME = "orderflow-desktop-windows.exe";
export const WINDOWS_CHECKSUM_ASSET_NAME = `${WINDOWS_ASSET_NAME}.sha256`;
export const WINDOWS_PART_ASSET_PREFIX = `${WINDOWS_ASSET_NAME}.part-`;

const RELEASE_SOURCES = [
  {
    name: "Gitee",
    apiUrl: GITEE_RELEASE_API_URL,
    releaseUrl: (tag: string) => `https://gitee.com/wei-dongyu_1_0/OrderFlow/releases/tag/${encodeURIComponent(tag)}`,
  },
  {
    name: "GitHub",
    apiUrl: GITHUB_RELEASE_API_URL,
    releaseUrl: (tag: string) => `https://github.com/1192081163/OrderFlow/releases/tag/${encodeURIComponent(tag)}`,
  },
] as const;

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
  const multipart = asset ? null : selectWindowsMultipart(payload.assets);

  if (!isNewerRelease(latestTag, latestVersion, currentReleaseTag, currentVersion)) {
    return {
      updateAvailable: false,
      currentVersion,
      latestVersion,
      releaseUrl,
      reason: "current",
    };
  }

  if (!asset && !multipart) {
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
    assetName: asset ? String(asset.name ?? "") : WINDOWS_ASSET_NAME,
    ...(asset
      ? { downloadUrl: String(asset.browser_download_url ?? releaseUrl) }
      : {
          downloadParts: multipart?.parts.map((part) => ({
            assetName: String(part.name ?? ""),
            downloadUrl: String(part.browser_download_url ?? ""),
          })),
          checksumUrl: String(multipart?.checksum.browser_download_url ?? ""),
        }),
    reason: "newer_version",
  };
}

export async function checkForUpdates(fetchImpl = fetch): Promise<UpdateCheckResult> {
  const currentVersion = packageJson.version ?? "1.0.0";
  const errors: string[] = [];

  for (const source of RELEASE_SOURCES) {
    try {
      const response = await fetchImpl(source.apiUrl, {
        headers: { "User-Agent": `orderflow-desktop/${currentVersion}` },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = (await response.json()) as ReleasePayload;
      const latestTag = String(payload.tag_name ?? "").trim();
      const result = updateInfoFromReleasePayload(
        {
          ...payload,
          html_url: payload.html_url || (latestTag ? source.releaseUrl(latestTag) : ""),
        },
        { currentVersion, currentReleaseTag: CURRENT_RELEASE_TAG },
      );
      if (result.reason !== "missing_asset") {
        return result;
      }
      errors.push(`${source.name}: ${result.error ?? "未找到更新文件"}`);
    } catch (error) {
      errors.push(`${source.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    updateAvailable: false,
    currentVersion,
    reason: "error",
    error: `检查更新失败：${errors.join("；")}`,
  };
}

export async function downloadUpdateExecutable(
  update: UpdateCheckResult,
  downloadDir: string,
  fetchImpl = fetch,
): Promise<string> {
  const hasDirectDownload = Boolean(update.downloadUrl);
  const hasMultipartDownload = Boolean(update.downloadParts?.length && update.checksumUrl);
  if (!update.updateAvailable || !update.assetName || (!hasDirectDownload && !hasMultipartDownload)) {
    throw new Error("更新文件不存在，请稍后重试或手动下载新版 exe。");
  }
  if (update.assetName !== WINDOWS_ASSET_NAME) {
    throw new Error("更新文件名不正确，已拒绝下载。");
  }

  await mkdir(downloadDir, { recursive: true });
  const executablePath = await uniquePath(path.join(downloadDir, update.assetName));
  const tempPath = `${executablePath}.download`;
  const currentVersion = packageJson.version ?? "1.0.0";

  try {
    if (update.downloadUrl) {
      assertOfficialDownloadUrl(update.downloadUrl);
      const executable = await fetchUpdateBuffer(update.downloadUrl, currentVersion, fetchImpl);
      await writeFile(tempPath, executable);
    } else {
      await downloadMultipartExecutable(update, tempPath, currentVersion, fetchImpl);
    }
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

function selectWindowsMultipart(assets: unknown): { parts: ReleaseAsset[]; checksum: ReleaseAsset } | null {
  if (!Array.isArray(assets)) {
    return null;
  }
  const releaseAssets = assets as ReleaseAsset[];
  const parts = releaseAssets
    .filter((asset) => String(asset.name ?? "").startsWith(WINDOWS_PART_ASSET_PREFIX))
    .sort((left, right) => String(left.name ?? "").localeCompare(String(right.name ?? "")));
  const checksum = releaseAssets.find((asset) => String(asset.name ?? "") === WINDOWS_CHECKSUM_ASSET_NAME);
  const partsAreComplete =
    parts.length >= 2 &&
    parts.every(
      (part, index) =>
        String(part.name ?? "") === `${WINDOWS_PART_ASSET_PREFIX}${String(index).padStart(2, "0")}` &&
        Boolean(String(part.browser_download_url ?? "")),
    );
  if (!checksum || !String(checksum.browser_download_url ?? "") || !partsAreComplete) {
    return null;
  }
  return { parts, checksum };
}

async function downloadMultipartExecutable(
  update: UpdateCheckResult,
  tempPath: string,
  currentVersion: string,
  fetchImpl: typeof fetch,
): Promise<void> {
  const parts = update.downloadParts ?? [];
  if (!update.checksumUrl || parts.length < 2) {
    throw new Error("更新分片不完整，请稍后重试或手动下载新版 exe。");
  }
  const partsAreComplete = parts.every(
    (part, index) => part.assetName === `${WINDOWS_PART_ASSET_PREFIX}${String(index).padStart(2, "0")}`,
  );
  if (!partsAreComplete) {
    throw new Error("更新分片顺序不正确，已拒绝下载。");
  }

  assertOfficialDownloadUrl(update.checksumUrl);
  const checksumPayload = await fetchUpdateBuffer(update.checksumUrl, currentVersion, fetchImpl);
  const expectedChecksum = checksumPayload.toString("utf8").trim().match(/^([a-f0-9]{64})(?:\s|$)/i)?.[1]?.toLowerCase();
  if (!expectedChecksum) {
    throw new Error("更新校验文件无效，已拒绝下载。");
  }

  const hash = createHash("sha256");
  for (const [index, part] of parts.entries()) {
    assertOfficialDownloadUrl(part.downloadUrl);
    const content = await fetchUpdateBuffer(part.downloadUrl, currentVersion, fetchImpl);
    hash.update(content);
    if (index === 0) {
      await writeFile(tempPath, content);
    } else {
      await appendFile(tempPath, content);
    }
  }

  if (hash.digest("hex") !== expectedChecksum) {
    throw new Error("更新文件校验失败，已拒绝打开。");
  }
}

async function fetchUpdateBuffer(url: string, currentVersion: string, fetchImpl: typeof fetch): Promise<Buffer> {
  const response = await fetchImpl(url, {
    headers: { "User-Agent": `orderflow-desktop/${currentVersion}` },
  });
  if (!response.ok || !response.body) {
    throw new Error(`新版 exe 下载失败：HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function assertOfficialDownloadUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("更新下载地址无效，已拒绝下载。");
  }
  const isOfficialGitHub =
    url.hostname === "github.com" && /^\/1192081163\/(?:orderflow-desktop|OrderFlow)\/releases\/download\//i.test(url.pathname);
  const isOfficialGitee =
    url.hostname === "gitee.com" &&
    (/^\/wei-dongyu_1_0\/OrderFlow\/releases\/download\//i.test(url.pathname) ||
      /^\/api\/v5\/repos\/wei-dongyu_1_0\/OrderFlow\/releases\/\d+\/attach_files\/\d+\/download$/i.test(url.pathname));
  if (url.protocol !== "https:" || (!isOfficialGitHub && !isOfficialGitee)) {
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
