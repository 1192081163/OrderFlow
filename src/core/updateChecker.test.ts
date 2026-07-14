import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  checkForUpdates,
  downloadUpdateExecutable,
  GITEE_RELEASE_API_URL,
  GITHUB_RELEASE_API_URL,
  updateInfoFromReleasePayload,
  WINDOWS_ASSET_NAME,
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

  test("returns an error result when release request fails", async () => {
    const result = await checkForUpdates(async () => {
      throw new Error("network down");
    });

    expect(result.updateAvailable).toBe(false);
    expect(result.reason).toBe("error");
    expect(result.error).toContain("network down");
  });

  test("checks Gitee before GitHub", async () => {
    const urls: string[] = [];
    const result = await checkForUpdates(async (url) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ tag_name: "v1.0.0", assets: [] }), {
        headers: { "Content-Type": "application/json" },
      });
    });

    expect(urls).toEqual([GITEE_RELEASE_API_URL]);
    expect(result.reason).toBe("current");
  });

  test("falls back to GitHub when Gitee is unavailable", async () => {
    const urls: string[] = [];
    const result = await checkForUpdates(async (url) => {
      urls.push(String(url));
      if (String(url) === GITEE_RELEASE_API_URL) {
        return new Response("unavailable", { status: 503 });
      }
      return new Response(JSON.stringify({ tag_name: "v1.0.0", assets: [] }), {
        headers: { "Content-Type": "application/json" },
      });
    });

    expect(urls).toEqual([GITEE_RELEASE_API_URL, GITHUB_RELEASE_API_URL]);
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
