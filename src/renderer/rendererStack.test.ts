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

    expect(packageJson.dependencies).not.toHaveProperty("react");
    expect(packageJson.dependencies).not.toHaveProperty("react-dom");
    expect(packageJson.dependencies).not.toHaveProperty("@fluentui/react-components");
    expect(packageJson.dependencies).not.toHaveProperty("@fluentui/web-components");
    expect(packageJson.devDependencies).toHaveProperty("react");
    expect(packageJson.devDependencies).toHaveProperty("react-dom");
    expect(packageJson.devDependencies).toHaveProperty("@fluentui/react-components");
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
    expect(appSource).toContain("<h1>订单提取</h1>");
    expect(appSource).not.toContain("<h1>订单快读</h1>");
  });

  test("renders day email list controls for selective extraction", async () => {
    const [appSource, stylesSource, preloadSource, ipcSource] = await Promise.all([
      readFile(path.join(root, "src/renderer/app.tsx"), "utf8"),
      readFile(path.join(root, "src/renderer/styles.css"), "utf8"),
      readFile(path.join(root, "src/preload/preload.cts"), "utf8"),
      readFile(path.join(root, "src/main/ipcHandlers.ts"), "utf8"),
    ]);

    expect(appSource).toContain("formatMailDayTitle");
    expect(appSource).toContain("回到今天");
    expect(appSource).toContain("上一天");
    expect(appSource).toContain("下一天");
    expect(appSource).toContain("请先登录企业邮箱");
    expect(appSource).toContain("近一周扫描");
    expect(appSource).toContain("订单邮件");
    expect(appSource).toContain("Excel 附件");
    expect(appSource).toContain("提取选中 ${selectedExtractableUids.length} 封");
    expect(appSource).toContain("正在下载选中邮件附件");
    expect(appSource).toContain("失败原因");
    expect(appSource).toContain("resultFailures");
    expect(appSource).toContain("订单提取结果");
    expect(appSource).toContain("订单提取");
    expect(appSource).not.toContain("处理结果");
    expect(appSource).not.toContain("处理任务");
    expect(appSource).toContain("message.extracted");
    expect(appSource).toContain("applyLocalMailEvent");
    expect(appSource).not.toContain("window.localStorage");
    expect(appSource).not.toContain("loadExtractedMessageUids");
    expect(appSource).toContain("secondary-command-actions");
    expect(appSource).toContain("quiet-command-button");
    expect(appSource).toContain("local-extraction-actions");
    expect(appSource).not.toContain("local-extraction-details");
    expect(appSource).not.toContain("<details");
    expect(appSource).not.toContain("<summary>本地提取</summary>");
    expect(appSource).toContain("selectLocalInputs");
    expect(appSource).toContain("onDrop={handleLocalDrop}");
    expect(appSource).toContain("拖入 Excel 文件或文件夹");
    expect(appSource).toContain("onClick={selectLocalInputs}");
    expect(appSource.indexOf("刷新邮件")).toBeLessThan(appSource.indexOf("secondary-command-actions"));
    expect(appSource.indexOf("onClick={selectLocalInputs}")).toBeGreaterThan(appSource.indexOf("primary-actions"));
    expect(appSource).toContain("inferManual: true");
    expect(appSource).not.toContain("自动标记需人工复核");
    expect(appSource).not.toContain("setInferManual");
    expect(appSource).not.toContain("文件夹包含子目录");
    expect(appSource).not.toContain("setRecursive");
    expect(appSource).not.toContain("选择 Excel 并提取");
    expect(appSource).not.toContain("选择文件夹并提取");
    expect(appSource).not.toContain("selectFiles");
    expect(appSource).not.toContain("selectFolder");
    expect(preloadSource).toContain("selectLocalInputs");
    expect(preloadSource).toContain("dialog:select-local-inputs");
    expect(preloadSource).not.toContain("selectFiles");
    expect(preloadSource).not.toContain("selectFolder");
    expect(ipcSource).toContain("dialog:select-local-inputs");
    expect(ipcSource).not.toContain("dialog:select-files");
    expect(ipcSource).not.toContain("dialog:select-folder");
    expect(appSource).not.toContain('<div className="section-title">近一周邮件</div>');
    expect(appSource).not.toContain("保存邮箱后加载近一周邮件");
    expect(appSource).not.toContain("保存邮箱后会自动加载邮件");
    expect(appSource).not.toContain("提取今日");
    expect(appSource).toContain("固定显示最近 7 天，本机后台实时监听");
    expect(appSource).toContain("Windows DPAPI");
    expect(appSource).toContain("messageUids");
    expect(appSource).toContain("listEmails");
    expect(appSource).toContain("onLocalMailEvent");
    expect(appSource).toContain("本地邮箱初始化失败");
    expect(appSource).not.toContain("subscribeEmailUpdates");
    expect(appSource).not.toContain("onEmailUpdate");
    expect(appSource).toContain("正在下载新版程序");
expect(appSource).toContain("api.downloadAndOpenUpdate()");
expect(appSource).toContain("新版程序已启动");
expect(appSource).not.toContain("下载地址：");
    expect(stylesSource).toContain(".failure-list");
    expect(stylesSource).toContain(".secondary-command-actions");
    expect(stylesSource).toContain(".local-extraction-actions");
    expect(stylesSource).not.toContain(".local-extraction-details");
    expect(stylesSource).toContain(".mail-row.pending");
    expect(stylesSource).toContain(".mail-runtime-banner");
    expect(preloadSource).toContain("local-mail:list");
    expect(preloadSource).toContain("downloadAndOpenUpdate");
    expect(preloadSource).toContain("updates:download-and-open");
    expect(ipcSource).toContain("local-mail:list");
    expect(ipcSource).toContain("updates:download-and-open");
  });

  test("only keeps the output folder and Excel buttons in the result panel", async () => {
    const appSource = await readFile(path.join(root, "src/renderer/app.tsx"), "utf8");

    expect(appSource).toContain("打开输出目录");
    expect(appSource).toContain("打开 Excel");
    expect(appSource).not.toContain("打开 CSV");
    expect(appSource).not.toContain("打开复核表");
    expect(appSource).toContain("hasOutputPaths");
    expect(appSource).not.toContain('openLatest("csvOutput")');
    expect(appSource).not.toContain('openLatest("auditOutput")');
  });
});
