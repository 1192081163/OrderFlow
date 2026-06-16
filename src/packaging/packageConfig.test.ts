import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";

const root = process.cwd();

describe("Electron packaging configuration", () => {
  test("package scripts build the Windows artifact with electron-builder", async () => {
    const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as {
      author?: string;
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
      build?: unknown;
    };

    expect(packageJson.author).toBe("AUSMET");
    expect(packageJson.devDependencies).toHaveProperty("electron-builder");
    expect(packageJson.scripts.dist).toBe("npm run dist:win");
    expect(packageJson.scripts["dist:win"]).toBe("npm run build && electron-builder --win nsis");
    expect(packageJson.scripts).not.toHaveProperty("dist:mac");
    expect(packageJson.build).toMatchObject({
      appId: "com.ausmet.order-organizer-assistant",
      productName: "订单整理助手",
      directories: { output: "release" },
      files: ["dist/**/*", "package.json"],
      extraResources: [
        { from: "python-helper", to: "python-helper" },
        { from: "python_extraction_bridge.py", to: "python/python_extraction_bridge.py" },
        { from: "desktop_runner.py", to: "python/desktop_runner.py" },
        { from: "extract.py", to: "python/extract.py" },
        { from: "rules", to: "python/rules" },
      ],
      win: {
        target: ["nsis"],
        icon: "assets/app_icon.ico",
      },
      nsis: {
        artifactName: "order-organizer-assistant-windows.${ext}",
      },
    });
  });

  test("release workflow builds only the Windows Electron artifact", async () => {
    const workflow = await readFile(path.join(root, ".github/workflows/release.yml"), "utf8");

    expect(workflow).toContain("npm ci");
    expect(workflow).toContain("actions/setup-python");
    expect(workflow).toContain("requirements-python-runner.txt");
    expect(workflow).toContain("scripts/build-python-runner-win.ps1");
    expect(workflow).toContain("npm run dist:win");
    expect(workflow).not.toContain("npm run dist:mac");
    expect(workflow).not.toContain("build-macos");
    expect(workflow).not.toContain("macos-dmg");
    expect(workflow).not.toContain("macos.dmg");
    expect(workflow).not.toContain("requirements-desktop.txt");
    expect(workflow).not.toContain("desktop_app.py");
  });
});
