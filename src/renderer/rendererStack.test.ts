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
    expect(appSource).toContain("webLightTheme");
  });
});
