import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  checkForUpdates,
  DOWNLOAD_RELEASE_API_URL,
  downloadUpdateExecutable,
  GITEE_RELEASE_API_URL,
  GITHUB_RELEASE_API_URL,
  updateInfoFromReleasePayload,
  WINDOWS_ASSET_NAME,
  WINDOWS_CHECKSUM_ASSET_NAME,
  WINDOWS_PART_ASSET_PREFIX,
} from "./updateChecker.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("update checker", () => {
  test("detects newer Windows release asset", () => {
    const result = updateInfoFromReleasePayload(
      {
        tag_name: "v1.2.0",
        html_url: "https://github.com/1192081163/orderflow-desktop/releases/tag/v1.2.0",
        assets: [{ name: WINDOWS_ASSET_NAME, browser_download_url: "https://download.example/app.exe" }],
      },
      "1.0.0",
    );

    expect(result).toMatchObject({
      updateAvailable: true,
      latestVersion: "1.2.0",
      assetName: WINDOWS_ASSET_NAME,
      downloadUrl: "https://download.example/app.exe",
      reason: "newer_version",
    });
  });

  test("uses a checksum asset for direct Windows downloads", () => {
    const result = updateInfoFromReleasePayload(
      {
        tag_name: "build-124",
        assets: [
          {
            name: WINDOWS_ASSET_NAME,
            browser_download_url:
              "https://download.ausmet.ai/releases/build-124/orderflow-desktop-windows.exe",
          },
          {
            name: WINDOWS_CHECKSUM_ASSET_NAME,
            browser_download_url:
              "https://download.ausmet.ai/releases/build-124/orderflow-desktop-windows.exe.sha256",
          },
        ],
      },
      { currentVersion: "1.0.0", currentReleaseTag: "build-123" },
    );

    expect(result).toMatchObject({
      updateAvailable: true,
      downloadUrl: "https://download.ausmet.ai/releases/build-124/orderflow-desktop-windows.exe",
      checksumUrl: "https://download.ausmet.ai/releases/build-124/orderflow-desktop-windows.exe.sha256",
    });
  });

  test("reports current when local version is not older", () => {
    const result = updateInfoFromReleasePayload({ tag_name: "v1.0.0", assets: [] }, "1.0.0");

    expect(result.updateAvailable).toBe(false);
    expect(result.reason).toBe("current");
  });

  test("reports current when latest release tag matches the packaged build tag", () => {
    const result = updateInfoFromReleasePayload(
      {
        tag_name: "build-123",
        assets: [{ name: WINDOWS_ASSET_NAME, browser_download_url: "https://download.example/app.exe" }],
      },
      { currentVersion: "1.0.0", currentReleaseTag: "build-123" },
    );

    expect(result.updateAvailable).toBe(false);
    expect(result.reason).toBe("current");
  });

  test("detects newer build release tag for packaged builds", () => {
    const result = updateInfoFromReleasePayload(
      {
        tag_name: "build-124",
        assets: [{ name: WINDOWS_ASSET_NAME, browser_download_url: "https://download.example/app.exe" }],
      },
      { currentVersion: "1.0.0", currentReleaseTag: "build-123" },
    );

    expect(result.updateAvailable).toBe(true);
    expect(result.latestVersion).toBe("build-124");
  });

  test("reports missing asset for newer releases without installer", () => {
    const result = updateInfoFromReleasePayload({ tag_name: "v2.0.0", assets: [] }, "1.0.0");

    expect(result.updateAvailable).toBe(false);
    expect(result.reason).toBe("missing_asset");
    expect(result.error).toContain(WINDOWS_ASSET_NAME);
  });

  test("detects a multipart Windows release with checksum", () => {
    const result = updateInfoFromReleasePayload(
      {
        tag_name: "v2.0.0",
        assets: [
          {
            name: `${WINDOWS_PART_ASSET_PREFIX}01`,
            browser_download_url: "https://gitee.com/wei-dongyu_1_0/OrderFlow/releases/download/v2.0.0/part-01",
          },
          {
            name: WINDOWS_CHECKSUM_ASSET_NAME,
            browser_download_url: "https://gitee.com/wei-dongyu_1_0/OrderFlow/releases/download/v2.0.0/checksum",
          },
          {
            name: `${WINDOWS_PART_ASSET_PREFIX}00`,
            browser_download_url: "https://gitee.com/wei-dongyu_1_0/OrderFlow/releases/download/v2.0.0/part-00",
          },
        ],
      },
      "1.0.0",
    );

    expect(result).toMatchObject({
      updateAvailable: true,
      assetName: WINDOWS_ASSET_NAME,
      checksumUrl: "https://gitee.com/wei-dongyu_1_0/OrderFlow/releases/download/v2.0.0/checksum",
      downloadParts: [
        { assetName: `${WINDOWS_PART_ASSET_PREFIX}00` },
        { assetName: `${WINDOWS_PART_ASSET_PREFIX}01` },
      ],
    });
  });

  test("returns an error result when release request fails", async () => {
    const result = await checkForUpdates(async () => {
      throw new Error("network down");
    });

    expect(result.updateAvailable).toBe(false);
    expect(result.reason).toBe("error");
    expect(result.error).toContain("network down");
  });

  test("checks every release source and selects the newest valid build", async () => {
    const urls: string[] = [];
    const result = await checkForUpdates(async (url) => {
      urls.push(String(url));
      const sourceUrl = String(url);
      const tag = sourceUrl === GITHUB_RELEASE_API_URL ? "build-124" : sourceUrl === DOWNLOAD_RELEASE_API_URL ? "build-122" : "build-123";
      const downloadUrl =
        sourceUrl === GITHUB_RELEASE_API_URL
          ? `https://github.com/1192081163/OrderFlow/releases/download/${tag}/${WINDOWS_ASSET_NAME}`
          : `https://download.ausmet.ai/releases/${tag}/${WINDOWS_ASSET_NAME}`;
      return new Response(JSON.stringify({
        tag_name: tag,
        assets: [{ name: WINDOWS_ASSET_NAME, browser_download_url: downloadUrl }],
      }), {
        headers: { "Content-Type": "application/json" },
      });
    }, { currentVersion: "1.0.0", currentReleaseTag: "build-120" });

    expect(urls).toEqual([DOWNLOAD_RELEASE_API_URL, GITHUB_RELEASE_API_URL, GITEE_RELEASE_API_URL]);
    expect(result).toMatchObject({
      updateAvailable: true,
      latestVersion: "build-124",
      downloadUrl: `https://github.com/1192081163/OrderFlow/releases/download/build-124/${WINDOWS_ASSET_NAME}`,
    });
  });

  test("prefers the download server when sources publish the same newest build", async () => {
    const urls: string[] = [];
    const result = await checkForUpdates(async (url) => {
      urls.push(String(url));
      const sourceUrl = String(url);
      const tag = sourceUrl === GITEE_RELEASE_API_URL ? "build-123" : "build-124";
      const origin = sourceUrl === DOWNLOAD_RELEASE_API_URL
        ? "https://download.ausmet.ai/releases/build-124"
        : "https://github.com/1192081163/OrderFlow/releases/download/build-124";
      return new Response(JSON.stringify({
        tag_name: tag,
        assets: [{ name: WINDOWS_ASSET_NAME, browser_download_url: `${origin}/${WINDOWS_ASSET_NAME}` }],
      }), {
        headers: { "Content-Type": "application/json" },
      });
    }, { currentVersion: "1.0.0", currentReleaseTag: "build-120" });

    expect(urls).toEqual([DOWNLOAD_RELEASE_API_URL, GITHUB_RELEASE_API_URL, GITEE_RELEASE_API_URL]);
    expect(result.downloadUrl).toBe(
      `https://download.ausmet.ai/releases/build-124/${WINDOWS_ASSET_NAME}`,
    );
  });

  test("falls back when the download server is unavailable", async () => {
    const urls: string[] = [];
    const result = await checkForUpdates(async (url) => {
      urls.push(String(url));
      if (String(url) === DOWNLOAD_RELEASE_API_URL) {
        return new Response("unavailable", { status: 503 });
      }
      return new Response(JSON.stringify({ tag_name: "build-123", assets: [] }), {
        headers: { "Content-Type": "application/json" },
      });
    }, { currentVersion: "1.0.0", currentReleaseTag: "build-123" });

    expect(urls).toEqual([DOWNLOAD_RELEASE_API_URL, GITHUB_RELEASE_API_URL, GITEE_RELEASE_API_URL]);
    expect(result.reason).toBe("current");
  });

  test("downloads update executable to a unique local path", async () => {
    const downloadDir = await mkdtemp(path.join(os.tmpdir(), "orderflow-update-"));
    tempDirs.push(downloadDir);
    await writeFile(path.join(downloadDir, WINDOWS_ASSET_NAME), "old executable");

    const executablePath = await downloadUpdateExecutable(
      {
        updateAvailable: true,
        currentVersion: "1.0.0",
        latestVersion: "1.2.0",
        assetName: WINDOWS_ASSET_NAME,
        downloadUrl: "https://github.com/1192081163/OrderFlow/releases/download/build-124/orderflow-desktop-windows.exe",
        reason: "newer_version",
      },
      downloadDir,
      async (url, init) => {
        expect(url).toBe("https://github.com/1192081163/OrderFlow/releases/download/build-124/orderflow-desktop-windows.exe");
      expect(JSON.stringify(init?.headers)).toContain("orderflow-desktop/");
        return new Response(new TextEncoder().encode("new executable"));
      },
    );

    expect(path.basename(executablePath)).toBe("orderflow-desktop-windows-1.exe");
    expect(await readFile(executablePath, "utf8")).toBe("new executable");
    await expect(access(`${executablePath}.download`)).rejects.toBeTruthy();
  });

  test("downloads an update executable from the official Gitee repository", async () => {
    const downloadDir = await mkdtemp(path.join(os.tmpdir(), "orderflow-update-"));
    tempDirs.push(downloadDir);
    const downloadUrl =
      "https://gitee.com/wei-dongyu_1_0/OrderFlow/releases/download/build-42/orderflow-desktop-windows.exe";

    const executablePath = await downloadUpdateExecutable(
      {
        updateAvailable: true,
        currentVersion: "1.0.0",
        latestVersion: "build-42",
        assetName: WINDOWS_ASSET_NAME,
        downloadUrl,
        reason: "newer_version",
      },
      downloadDir,
      async (url) => {
        expect(url).toBe(downloadUrl);
        return new Response(new TextEncoder().encode("gitee executable"));
      },
    );

    expect(await readFile(executablePath, "utf8")).toBe("gitee executable");
  });

  test("downloads and verifies a direct update from the AUSMET download server", async () => {
    const downloadDir = await mkdtemp(path.join(os.tmpdir(), "orderflow-update-"));
    tempDirs.push(downloadDir);
    const executable = Buffer.from("verified executable");
    const checksum = createHash("sha256").update(executable).digest("hex");
    const baseUrl = "https://download.ausmet.ai/releases/build-124";
    const downloadUrl = `${baseUrl}/${WINDOWS_ASSET_NAME}`;
    const checksumUrl = `${baseUrl}/${WINDOWS_CHECKSUM_ASSET_NAME}`;

    const executablePath = await downloadUpdateExecutable(
      {
        updateAvailable: true,
        currentVersion: "1.0.0",
        latestVersion: "build-124",
        assetName: WINDOWS_ASSET_NAME,
        downloadUrl,
        checksumUrl,
        reason: "newer_version",
      },
      downloadDir,
      async (url) =>
        new Response(String(url) === checksumUrl ? `${checksum}  ${WINDOWS_ASSET_NAME}\n` : executable),
    );

    expect(await readFile(executablePath)).toEqual(executable);
  });

  test("rejects a direct AUSMET download when its checksum does not match", async () => {
    const downloadDir = await mkdtemp(path.join(os.tmpdir(), "orderflow-update-"));
    tempDirs.push(downloadDir);
    const baseUrl = "https://download.ausmet.ai/releases/build-124";

    await expect(downloadUpdateExecutable(
      {
        updateAvailable: true,
        currentVersion: "1.0.0",
        latestVersion: "build-124",
        assetName: WINDOWS_ASSET_NAME,
        downloadUrl: `${baseUrl}/${WINDOWS_ASSET_NAME}`,
        checksumUrl: `${baseUrl}/${WINDOWS_CHECKSUM_ASSET_NAME}`,
        reason: "newer_version",
      },
      downloadDir,
      async (url) => new Response(String(url).endsWith(".sha256") ? `${"0".repeat(64)}  ${WINDOWS_ASSET_NAME}\n` : "tampered"),
    )).rejects.toThrow("校验失败");

    await expect(access(path.join(downloadDir, WINDOWS_ASSET_NAME))).rejects.toBeTruthy();
    await expect(access(path.join(downloadDir, `${WINDOWS_ASSET_NAME}.download`))).rejects.toBeTruthy();
  });

  test("downloads, joins, and verifies multipart Gitee updates", async () => {
    const downloadDir = await mkdtemp(path.join(os.tmpdir(), "orderflow-update-"));
    tempDirs.push(downloadDir);
    const partContents = [Buffer.from("gitee "), Buffer.from("executable")];
    const expectedChecksum = createHash("sha256").update(Buffer.concat(partContents)).digest("hex");
    const baseUrl = "https://gitee.com/wei-dongyu_1_0/OrderFlow/releases/download/build-44";
    const checksumUrl = `${baseUrl}/${WINDOWS_CHECKSUM_ASSET_NAME}`;
    const downloadParts = partContents.map((_content, index) => ({
      assetName: `${WINDOWS_PART_ASSET_PREFIX}${String(index).padStart(2, "0")}`,
      downloadUrl: `${baseUrl}/${WINDOWS_PART_ASSET_PREFIX}${String(index).padStart(2, "0")}`,
    }));

    const executablePath = await downloadUpdateExecutable(
      {
        updateAvailable: true,
        currentVersion: "1.0.0",
        latestVersion: "build-44",
        assetName: WINDOWS_ASSET_NAME,
        downloadParts,
        checksumUrl,
        reason: "newer_version",
      },
      downloadDir,
      async (url) => {
        if (String(url) === checksumUrl) {
          return new Response(`${expectedChecksum}  ${WINDOWS_ASSET_NAME}\n`);
        }
        const index = downloadParts.findIndex((part) => part.downloadUrl === String(url));
        return new Response(partContents[index]);
      },
    );

    expect(await readFile(executablePath, "utf8")).toBe("gitee executable");
  });

  test("rejects executable download when release has no downloadable asset", async () => {
    const downloadDir = await mkdtemp(path.join(os.tmpdir(), "orderflow-update-"));
    tempDirs.push(downloadDir);

    await expect(
      downloadUpdateExecutable(
        {
          updateAvailable: false,
          currentVersion: "1.0.0",
          reason: "missing_asset",
          error: `未找到下载文件：${WINDOWS_ASSET_NAME}`,
        },
        downloadDir,
      ),
    ).rejects.toThrow("更新文件不存在");
  });

  test("rejects update downloads outside the official GitHub repository", async () => {
    const downloadDir = await mkdtemp(path.join(os.tmpdir(), "orderflow-update-"));
    tempDirs.push(downloadDir);

    await expect(downloadUpdateExecutable({
      updateAvailable: true,
      currentVersion: "1.0.0",
      assetName: WINDOWS_ASSET_NAME,
      downloadUrl: "https://download.example/app.exe",
      reason: "newer_version",
    }, downloadDir, async () => new Response("unsafe"))).rejects.toThrow("非官方地址");
  });

  test("rejects update downloads with an unexpected executable name", async () => {
    const downloadDir = await mkdtemp(path.join(os.tmpdir(), "orderflow-update-"));
    tempDirs.push(downloadDir);

    await expect(downloadUpdateExecutable({
      updateAvailable: true,
      currentVersion: "1.0.0",
      assetName: "other.exe",
      downloadUrl: "https://github.com/1192081163/OrderFlow/releases/download/build-124/other.exe",
      reason: "newer_version",
    }, downloadDir, async () => new Response("unsafe"))).rejects.toThrow("文件名不正确");
  });
});
