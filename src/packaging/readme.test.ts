import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, test } from "vitest";

const root = process.cwd();

describe("README installation guidance", () => {
  test("starts with direct Windows installer download guidance before developer setup", async () => {
    const readme = await readFile(path.join(root, "README.md"), "utf8");
    const downloadIndex = readme.indexOf("下载 Windows 安装包");
    const localRunIndex = readme.indexOf("本地开发运行");

    expect(downloadIndex).toBeGreaterThanOrEqual(0);
    expect(localRunIndex).toBeGreaterThan(downloadIndex);
    expect(readme).toContain("order-organizer-assistant-windows.exe");
    expect(readme).not.toContain("order-extraction-tool-windows.exe");
  });
});
