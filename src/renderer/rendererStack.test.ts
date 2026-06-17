import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";

const root = process.cwd();

describe("renderer React stack", () => {
  test("uses React with Fluent UI React instead of Fluent web components", async () => {
    const [packageJsonText, indexHtml, viteConfig, tsConfig, appSource] = await Promise.all([
      readFile(path.join(root, "package.json"), "utf8"),
      readFile(path.join(root, "src/renderer/index.html"), "utf8"),
      readFile(path.join(root, "vite.config.ts"), "utf8"),
      readFile(path.join(root, "tsconfig.json"), "utf8"),
      readFile(path.join(root, "src/renderer/app.tsx"), "utf8"),
    ]);
    const packageJson = JSON.parse(packageJsonText) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const tsConfigJson = JSON.parse(tsConfig) as { include: string[] };

    expect(packageJson.dependencies).toHaveProperty("react");
    expect(packageJson.dependencies).toHaveProperty("react-dom");
    expect(packageJson.dependencies).toHaveProperty("@fluentui/react-components");
    expect(packageJson.dependencies).not.toHaveProperty("@fluentui/web-components");
    expect(packageJson.devDependencies).toHaveProperty("@vitejs/plugin-react");
    expect(packageJson.devDependencies).toHaveProperty("@types/react");
    expect(packageJson.devDependencies).toHaveProperty("@types/react-dom");
    expect(indexHtml).toContain('id="root"');
    expect(indexHtml).toContain('src="./app.tsx"');
    expect(viteConfig).toContain("@vitejs/plugin-react");
    expect(viteConfig).toContain("react()");
    expect(tsConfigJson.include).toContain("src/**/*.tsx");
    expect(appSource).toContain("createRoot");
    expect(appSource).toContain("FluentProvider");
  });

  test("renders one-week email list controls for selective extraction", async () => {
    const [appSource, stylesSource, preloadSource, ipcSource] = await Promise.all([
      readFile(path.join(root, "src/renderer/app.tsx"), "utf8"),
      readFile(path.join(root, "src/renderer/styles.css"), "utf8"),
      readFile(path.join(root, "src/preload/preload.cts"), "utf8"),
      readFile(path.join(root, "src/main/ipcHandlers.ts"), "utf8"),
    ]);

    expect(appSource).toContain("近一周邮件");
    expect(appSource).toContain("每 5 分钟自动刷新");
    expect(appSource).toContain("提取今日");
    expect(appSource).toContain("筛出");
    expect(appSource).toContain("订单附件");
    expect(appSource).toContain("messageUids");
    expect(appSource).toContain("listEmails");
    expect(stylesSource).toContain(".mail-row.pending");
    expect(preloadSource).toContain("emails:list");
    expect(ipcSource).toContain("emails:list");
  });

  test("only keeps the output folder and Excel buttons in the result panel", async () => {
    const appSource = await readFile(path.join(root, "src/renderer/app.tsx"), "utf8");

    expect(appSource).toContain("打开输出目录");
    expect(appSource).toContain("打开 Excel");
    expect(appSource).not.toContain("打开 CSV");
    expect(appSource).not.toContain("打开复核表");
    expect(appSource).not.toContain('openLatest("csvOutput")');
    expect(appSource).not.toContain('openLatest("auditOutput")');
  });
});
