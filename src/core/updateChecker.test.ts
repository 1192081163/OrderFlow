import { describe, expect, test } from "vitest";

import { checkForUpdates, updateInfoFromReleasePayload, WINDOWS_ASSET_NAME } from "./updateChecker.js";

describe("update checker", () => {
  test("detects a newer Windows release asset", () => {
    const result = updateInfoFromReleasePayload(
      {
        tag_name: "v1.2.0",
        html_url: "https://github.com/1192081163/r004-order-extraction-tool/releases/tag/v1.2.0",
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

  test("reports missing asset for newer releases without installer", () => {
    const result = updateInfoFromReleasePayload({ tag_name: "v2.0.0", assets: [] }, "1.0.0");

    expect(result.updateAvailable).toBe(false);
    expect(result.reason).toBe("missing_asset");
    expect(result.error).toContain(WINDOWS_ASSET_NAME);
  });

  test("returns an error result when the release request fails", async () => {
    const result = await checkForUpdates(async () => {
      throw new Error("network down");
    });

    expect(result.updateAvailable).toBe(false);
    expect(result.reason).toBe("error");
    expect(result.error).toContain("network down");
  });
});
