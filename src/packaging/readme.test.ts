import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, test } from "vitest";

const root = process.cwd();

describe("README desktop download guidance", () => {
  test("starts direct desktop download guidance before developer setup", async () => {
    const readme = await readFile(path.join(root, "README.md"), "utf8");
    const downloadIndex = readme.indexOf("下载桌面版");
    const localRunIndex = readme.indexOf("本地开发运行");

    expect(downloadIndex).toBeGreaterThanOrEqual(0);
    expect(localRunIndex).toBeGreaterThan(downloadIndex);
    expect(readme).toContain("orderflow-desktop-windows.exe");
    expect(readme).toContain("orderflow-desktop-mac.dmg");
    expect(readme).toContain("https://gitee.com/wei-dongyu_1_0/OrderFlow/releases/latest");
    expect(readme).toContain("应用检查更新时优先访问 Gitee");
    expect(readme).toContain("双击 exe 就会直接打开软件");
    expect(readme).toContain("Mac 下载 DMG 后拖入 Applications 打开");
    expect(readme).not.toContain("下载 Windows 安装包");
    expect(readme).not.toContain("双击安装");
    expect(readme).not.toContain("order-extraction-tool-windows.exe");
    expect(readme).not.toContain("order-organizer-assistant-windows.exe");
    expect(readme).not.toContain("r004-order-extraction-tool");
    expect(readme).toContain("企业微信邮箱地址和客户端授权码");
    expect(readme).toContain("授权码使用 Windows DPAPI 加密保存在本机");
    expect(readme).toContain("关闭窗口后软件继续在系统托盘监听");
    expect(readme).not.toContain("远程邮件 API");
    expect(readme).not.toContain("ORDERFLOW_EMAIL_API");
  });
});
