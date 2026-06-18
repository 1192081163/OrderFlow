import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";

const root = process.cwd();

describe("Electron packaging configuration", () => {
  test("package scripts build the Windows artifact with electron-builder", async () => {
    const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as {
      name?: string;
      description?: string;
      author?: string;
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
      license?: string;
      repository?: { type?: string; url?: string };
      homepage?: string;
      bugs?: { url?: string };
      keywords?: string[];
      overrides?: Record<string, string>;
      build?: unknown;
    };
    const tsconfigBuild = JSON.parse(
      await readFile(path.join(root, "tsconfig.build.json"), "utf8"),
    ) as {
      extends?: string;
      include?: string[];
      exclude?: string[];
    };

    expect(packageJson.name).toBe("orderflow-desktop");
    expect(packageJson.description).toBe("Electron TypeScript orderflow desktop application");
    expect(packageJson.author).toBe("AUSMET");
    expect(packageJson.license).toBe("MIT");
    expect(packageJson.repository).toMatchObject({
      type: "git",
      url: "git+https://github.com/1192081163/orderflow-desktop.git",
    });
    expect(packageJson.homepage).toBe("https://github.com/1192081163/orderflow-desktop#readme");
    expect(packageJson.bugs).toMatchObject({
      url: "https://github.com/1192081163/orderflow-desktop/issues",
    });
    expect(packageJson.keywords).toEqual(
      expect.arrayContaining(["electron", "order-extraction", "excel", "imap"]),
    );
    expect(packageJson.overrides).toMatchObject({ uuid: "11.1.1" });
    expect(packageJson.devDependencies).toHaveProperty("electron-builder");
    expect(packageJson.scripts["clean:dist"]).toContain("rmSync('dist'");
    expect(packageJson.scripts.build).toBe("npm run clean:dist && npm run build:main && npm run build:renderer");
    expect(packageJson.scripts["build:main"]).toBe("tsc -p tsconfig.build.json");
    expect(packageJson.scripts.dist).toBe("npm run dist:win");
    expect(packageJson.scripts["dist:win"]).toBe("npm run build && electron-builder --win portable");
    expect(packageJson.scripts["dist:win:ci"]).toBe(
      "npm run build && electron-builder --win portable --publish never",
    );
    expect(packageJson.scripts["pack:win"]).toBe("electron-builder --win portable --publish never");
    expect(packageJson.scripts).not.toHaveProperty("dist:mac");
    expect(packageJson.build).toMatchObject({
      appId: "com.ausmet.orderflow.desktop",
      productName: "订单整理助手",
      directories: { output: "release" },
      files: ["dist/**/*", "!dist/**/*.test.js", "package.json"],
      extraResources: [
        { from: "python-helper", to: "python-helper" },
        { from: "python_extraction_bridge.py", to: "python/python_extraction_bridge.py" },
        { from: "desktop_runner.py", to: "python/desktop_runner.py" },
        { from: "extract.py", to: "python/extract.py" },
        { from: "rules", to: "python/rules" },
      ],
    win: {
      target: ["portable"],
      icon: "assets/app_icon.ico",
    },
      portable: {
        artifactName: "orderflow-desktop-windows.${ext}",
      },
    });
    expect(tsconfigBuild).toMatchObject({
      extends: "./tsconfig.json",
      include: ["src/core/**/*.ts", "src/main/**/*.ts", "src/preload/**/*.cts", "src/shared/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    });
  });

  test("release workflow builds only the Windows Electron artifact", async () => {
  const workflow = await readFile(path.join(root, ".github/workflows/release.yml"), "utf8");

  expect(workflow).toContain("branches:");
  expect(workflow).toContain("- main");
  expect(workflow).toContain("pull_request:");
  expect(workflow).toContain("cancel-in-progress: true");
  expect(workflow).toContain("permissions:\n  contents: read");
  expect(workflow).toContain("permissions:\n      contents: write");
  expect(workflow).toContain("FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true");
    expect(workflow).toContain('NODE_VERSION: "24"');
    expect(workflow).toContain("actions/checkout@v6");
    expect(workflow).toContain("actions/setup-node@v6");
    expect(workflow).toContain("actions/setup-python@v6");
    expect(workflow).toContain("cache: pip");
    expect(workflow).toContain("npm ci");
    expect(workflow).toContain("actions/setup-python");
    expect(workflow).toContain("requirements-python-runner.txt");
    expect(workflow).toContain("Write release build info");
    expect(workflow).toContain('export const CURRENT_RELEASE_TAG = "build-${{ github.run_number }}"');
    expect(workflow.indexOf("Write release build info")).toBeLessThan(workflow.indexOf("npm run dist:win:ci"));
    expect(workflow).toContain("Cache Electron downloads");
    expect(workflow).toContain("~\\AppData\\Local\\electron\\Cache");
    expect(workflow).toContain("~\\AppData\\Local\\electron-builder\\Cache");
    expect(workflow).toContain("Cache Python rules runner");
    expect(workflow).toContain("id: cache-python-runner");
    expect(workflow).toContain("if: steps.cache-python-runner.outputs.cache-hit != 'true'");
    expect(workflow).toContain("scripts/build-python-runner-win.ps1");
    expect(workflow).toContain("npm run dist:win:ci");
    expect(workflow).not.toContain("--win nsis");
    expect(workflow).not.toContain("build-windows:\n    name: Build Windows Installer\n    runs-on: windows-latest\n    needs: test");
    expect(workflow).toContain("needs:\n      - test\n      - build-windows");
    expect(workflow).toContain('tag="build-${GITHUB_RUN_NUMBER}"');
    expect(workflow).toContain("gh release create");
    expect(workflow).toContain("Windows 便携版已自动生成");
    expect(workflow).toContain("直接下载 orderflow-desktop-windows.exe");
    expect(workflow).toContain("--latest");
    expect(workflow).not.toContain("npm run dist:mac");
    expect(workflow).not.toContain("build-macos");
    expect(workflow).not.toContain("macos-dmg");
    expect(workflow).not.toContain("macos.dmg");
  expect(workflow).not.toContain("requirements-desktop.txt");
  expect(workflow).not.toContain("desktop_app.py");
});

test("open source metadata documents license, contributions, and data safety", async () => {
  const license = await readFile(path.join(root, "LICENSE"), "utf8");
  const security = await readFile(path.join(root, "SECURITY.md"), "utf8");
  const contributing = await readFile(path.join(root, "CONTRIBUTING.md"), "utf8");
  const readme = await readFile(path.join(root, "README.md"), "utf8");

  expect(license).toContain("MIT License");
  expect(license).toContain("Copyright (c) 2026 AUSMET");
  expect(security).toContain("不要提交真实订单");
  expect(security).toContain("邮箱授权码");
  expect(security).toContain("email_settings.json");
  expect(contributing).toContain("npm run typecheck");
  expect(contributing).toContain("python -m pytest tests");
  expect(readme).toContain("## 开源与许可证");
  expect(readme).toContain("MIT");
  expect(readme).toContain("邮箱授权码会保存在本机");
  expect(readme).toContain("不要提交真实订单");
});
});
