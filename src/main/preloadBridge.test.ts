import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, test } from "vitest";

const root = process.cwd();

describe("Electron preload bridge", () => {
  test("loads a CommonJS preload script from the main process", async () => {
    const [mainSource, tsConfigText] = await Promise.all([
      readFile(path.join(root, "src/main/main.ts"), "utf8"),
      readFile(path.join(root, "tsconfig.json"), "utf8"),
    ]);
    const tsConfig = JSON.parse(tsConfigText) as { include: string[] };

    await expect(access(path.join(root, "src/preload/preload.cts"))).resolves.toBeUndefined();
    expect(mainSource).toContain("../preload/preload.cjs");
    expect(tsConfig.include).toContain("src/**/*.cts");
  });

  test("does not use the preview API in packaged file windows", async () => {
    const appSource = await readFile(path.join(root, "src/renderer/app.tsx"), "utf8");

    expect(appSource).toContain('window.location.protocol === "file:"');
    expect(appSource).toContain("bridgeMissing");
    expect(appSource).toContain("桌面接口加载失败");
  });

  test("exposes native new-order-email notifications through preload and IPC", async () => {
    const [preloadSource, ipcSource] = await Promise.all([
      readFile(path.join(root, "src/preload/preload.cts"), "utf8"),
      readFile(path.join(root, "src/main/ipcHandlers.ts"), "utf8"),
    ]);

    expect(preloadSource).toContain("notifyNewOrderEmails");
    expect(preloadSource).toContain("notifications:new-order-emails");
    expect(ipcSource).toContain("notifications:new-order-emails");
  });
});
