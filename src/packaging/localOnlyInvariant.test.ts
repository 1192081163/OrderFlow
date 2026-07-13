import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vitest";

const root = process.cwd();

test("ships no remote mail service, remote config, listener, or native sqlite package", async () => {
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
    dependencies: Record<string, string>;
    build: { extraResources: Array<{ from: string; to: string }> };
  };
  expect(packageJson.scripts).not.toHaveProperty("serve:email-api");
  expect(packageJson.dependencies).not.toHaveProperty("mailparser");
  for (const name of ["sqlite3", "better-sqlite3", "@libsql/client"]) expect(packageJson.dependencies).not.toHaveProperty(name);
  expect(packageJson.build.extraResources).not.toContainEqual(expect.objectContaining({ from: "resources/remote-email-api.json" }));
  await expect(access(path.join(root, "src/server"))).rejects.toMatchObject({ code: "ENOENT" });
  await expect(access(path.join(root, "services/orderflow-email-api"))).rejects.toMatchObject({ code: "ENOENT" });
  await expect(access(path.join(root, "src/core/remoteEmailApi.ts"))).rejects.toMatchObject({ code: "ENOENT" });
  const productionFiles = [
    "src/main/main.ts",
    "src/main/ipcHandlers.ts",
    "src/main/localMailServices.ts",
    "src/localMail/localMailService.ts",
    "src/core/extractionService.ts",
    "src/shared/types.ts",
  ];
  const source = (await Promise.all(productionFiles.map((file) => readFile(path.join(root, file), "utf8")))).join("\n");
  expect(source).not.toMatch(/createServer|WebSocketServer|orderflow\.ausmet\.ai|RemoteEmailApiClient/);
  expect(source).not.toMatch(/\bproxy\b/);
});
