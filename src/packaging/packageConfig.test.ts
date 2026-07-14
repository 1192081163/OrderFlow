import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, test } from "vitest";

const root = process.cwd();

describe("Electron packaging configuration", () => {
  test("package scripts build Windows and macOS artifacts with electron-builder", async () => {
    const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as {
      name?: string;
      description?: string;
      author?: string;
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
      license?: string;
      repository?: { type?: string; url?: string };
      homepage?: string;
      bugs?: { url?: string };
      keywords?: string[];
      overrides?: Record<string, string>;
      build?: unknown;
    };
    const tsconfigBuild = JSON.parse(await readFile(path.join(root, "tsconfig.build.json"), "utf8")) as {
      extends?: string;
      include?: string[];
      exclude?: string[];
    };
    const macSignScript = await readFile(path.join(root, "scripts/sign-mac-app.mjs"), "utf8");

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
    expect(packageJson.keywords).toEqual(expect.arrayContaining(["electron", "order-extraction", "excel", "imap"]));
    expect(packageJson.overrides).toMatchObject({ uuid: "11.1.1" });
    expect(packageJson.devDependencies).toHaveProperty("electron-builder");
    expect(packageJson.scripts["clean:dist"]).toContain("rmSync('dist'");
    expect(packageJson.scripts.build).toBe("npm run clean:dist && npm run build:main && npm run build:renderer");
    expect(packageJson.scripts["build:main"]).toBe("tsc -p tsconfig.build.json");
    expect(packageJson.scripts.dist).toBe("npm run dist:win");
    expect(packageJson.scripts["dist:win"]).toBe("npm run build && electron-builder --win portable");
    expect(packageJson.scripts["dist:win:ci"]).toBe("npm run build && electron-builder --win portable --publish never");
    expect(packageJson.scripts["pack:win"]).toBe("electron-builder --win portable --publish never");
    expect(packageJson.scripts["dist:mac"]).toBe("npm run build && electron-builder --mac dmg");
    expect(packageJson.scripts["dist:mac:ci"]).toBe("npm run build && electron-builder --mac dmg --publish never");
    expect(packageJson.scripts["pack:mac"]).toBe("electron-builder --mac dmg --publish never");
    expect(packageJson.scripts).not.toHaveProperty("serve:email-api");
    expect(packageJson.dependencies).not.toHaveProperty("mailparser");
    expect(packageJson.build).toMatchObject({
      appId: "com.ausmet.orderflow.desktop",
      productName: "订单整理助手",
      compression: "maximum",
      electronLanguages: ["en", "zh-CN"],
      directories: { output: "release" },
      afterPack: "scripts/sign-mac-app.mjs",
      files: ["dist/**/*", "!dist/**/*.test.js", "package.json"],
      extraResources: [
        { from: "python-helper", to: "python-helper" },
        { from: "python_extraction_bridge.py", to: "python/python_extraction_bridge.py" },
        { from: "desktop_runner.py", to: "python/desktop_runner.py" },
        { from: "extract.py", to: "python/extract.py" },
        { from: "rules", to: "python/rules" },
        { from: "assets/app_icon.png", to: "assets/app_icon.png" },
      ],
      win: {
        target: ["portable"],
        icon: "assets/app_icon.ico",
      },
      mac: {
        target: ["dmg"],
        icon: "assets/app_icon.icns",
        category: "public.app-category.productivity",
        identity: null,
      },
      portable: {
        artifactName: "orderflow-desktop-windows.${ext}",
      },
      dmg: {
        artifactName: "orderflow-desktop-mac.${ext}",
      },
    });
    expect(tsconfigBuild).toMatchObject({
      extends: "./tsconfig.json",
      include: ["src/core/**/*.ts", "src/localMail/**/*.ts", "src/main/**/*.ts", "src/preload/**/*.cts", "src/shared/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    });
    expect(macSignScript).toContain('electronPlatformName !== "darwin"');
    expect(macSignScript).toContain('execFileSync("codesign"');
    expect(macSignScript).toContain('"--force", "--deep", "--sign", "-"');
  });

  test("release workflow builds Windows and macOS Electron artifacts", async () => {
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
    expect(workflow).toContain("requirements-python-runner.txt");
    expect(workflow).toContain("python -m pytest -q tests/test_desktop_runner.py tests/test_hardware_rules.py tests/test_jobtrack_compare.py");
    expect(workflow).toContain("Write release build info");
    expect(workflow).toContain('export const CURRENT_RELEASE_TAG = "build-${{ github.run_number }}"');
    expect(workflow).not.toContain("Write packaged remote email API config");
    expect(workflow).not.toContain("ORDERFLOW_EMAIL_API_URL");
    expect(workflow).not.toContain("ORDERFLOW_EMAIL_API_TOKEN");
    expect(workflow).not.toContain("write-remote-email-api-config.mjs");
    expect(workflow).toContain("Run local-only invariant");
    expect(workflow.indexOf("Write release build info")).toBeLessThan(workflow.indexOf("npm run dist:win:ci"));
    expect(workflow.indexOf("Write release build info", workflow.indexOf("build-macos:"))).toBeLessThan(
      workflow.indexOf("npm run dist:mac:ci"),
    );
    expect(workflow).toContain("Cache Electron downloads");
    expect(workflow).toContain("~\\AppData\\Local\\electron\\Cache");
    expect(workflow).toContain("~\\AppData\\Local\\electron-builder\\Cache");
    expect(workflow).toContain("~/Library/Caches/electron");
    expect(workflow).toContain("~/Library/Caches/electron-builder");
    expect(workflow).toContain("Cache Python rules runner");
    expect(workflow).toContain("id: cache-python-runner");
    expect(workflow).toContain("if: steps.cache-python-runner.outputs.cache-hit != 'true'");
    expect(workflow).toContain("scripts/build-python-runner-win.ps1");
    expect(workflow).toContain("scripts/build-python-runner-mac.sh");
    expect(workflow).toContain("npm run dist:win:ci");
    expect(workflow).toContain("npm run dist:mac:ci");
    expect(workflow).toContain("build-macos:");
    expect(workflow).toContain("runs-on: macos-latest");
    expect(workflow).toContain("orderflow-desktop-windows.exe");
    expect(workflow).toContain("Enforce Gitee 100 MB asset limit");
    expect(workflow).toContain("100MB");
    expect(workflow).toContain("orderflow-desktop-mac.dmg");
    expect(workflow).not.toContain("--win nsis");
    expect(workflow).not.toContain("build-windows:\n    name: Build Windows Installer\n    runs-on: windows-latest\n    needs: test");
    expect(workflow).toContain("needs:\n      - test\n      - build-windows\n      - build-macos");
    expect(workflow).toContain('tag="build-${GITHUB_RUN_NUMBER}"');
    expect(workflow).toContain("gh release create");
    expect(workflow).toContain("Windows 便携版和 macOS DMG 已自动生成");
    expect(workflow).toContain("Windows 下载 orderflow-desktop-windows.exe");
    expect(workflow).toContain("Mac 下载 orderflow-desktop-mac.dmg");
    expect(workflow).toContain("--latest");
    expect(workflow).toContain("publish-gitee-release:");
    expect(workflow).toContain("GITEE_TOKEN: ${{ secrets.GITEE_TOKEN }}");
    expect(workflow).toContain("git -c http.version=HTTP/1.1 push gitee HEAD:main --tags --force");
    expect(workflow).toContain("timeout 180s");
    expect(workflow).toContain("scripts/publish-gitee-release.sh");
    expect(workflow).toContain("split --bytes=16M");
    expect(workflow).toContain("orderflow-desktop-windows.exe.sha256");
    expect(workflow).not.toContain("macos-dmg");
    expect(workflow).not.toContain("macos.dmg");
    expect(workflow).not.toContain("requirements-desktop.txt");
  });
});
