import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { LocalMailCredentialStore, type SafeStorageOperations } from "./localMailCredentialStore.js";

const roots: string[] = [];
afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("local mail credential store", () => {
  test("persists the authorization code only as safeStorage ciphertext", async () => {
    const settingsPath = await tempSettingsPath();
    const store = new LocalMailCredentialStore({ settingsPath, safeStorage: fakeSafeStorage() });

    await store.save({ email: " orders@example.com ", authCode: "mail-secret", startAtLogin: true });

    expect(await store.loadView()).toEqual({ email: "orders@example.com", hasAuthCode: true, startAtLogin: true });
    expect(await store.loadCredentials()).toEqual({ email: "orders@example.com", authCode: "mail-secret" });
    const raw = await readFile(settingsPath, "utf8");
    expect(raw).not.toContain("mail-secret");
    expect(JSON.parse(raw)).toMatchObject({ email: "orders@example.com", encryptedAuthCode: expect.any(String) });
  });

  test("migrates a legacy plaintext authorization code once", async () => {
    const settingsPath = await tempSettingsPath();
    await writeFile(settingsPath, JSON.stringify({ email: "orders@example.com", authCode: "legacy-secret" }), "utf8");
    const store = new LocalMailCredentialStore({ settingsPath, safeStorage: fakeSafeStorage() });

    expect(await store.loadCredentials()).toEqual({ email: "orders@example.com", authCode: "legacy-secret" });
    const raw = await readFile(settingsPath, "utf8");
    expect(raw).not.toContain("legacy-secret");
    expect(raw).not.toContain("authCode");
  });

  test("never falls back to plaintext when encryption is unavailable", async () => {
    const settingsPath = await tempSettingsPath();
    const store = new LocalMailCredentialStore({
      settingsPath,
      safeStorage: { ...fakeSafeStorage(), isEncryptionAvailable: () => false },
    });

    await expect(store.save({ email: "orders@example.com", authCode: "mail-secret", startAtLogin: true })).rejects.toThrow(
      "Windows 安全存储不可用",
    );
    await expect(readFile(settingsPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("preserves an existing encrypted code when only non-secret settings change", async () => {
    const settingsPath = await tempSettingsPath();
    const store = new LocalMailCredentialStore({ settingsPath, safeStorage: fakeSafeStorage() });
    await store.save({ email: "orders@example.com", authCode: "mail-secret", startAtLogin: true });

    await store.save({ email: "orders@example.com", startAtLogin: false });

    expect(await store.loadCredentials()).toEqual({ email: "orders@example.com", authCode: "mail-secret" });
    expect(await store.loadView()).toMatchObject({ startAtLogin: false });
  });
});

async function tempSettingsPath(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-mail-credentials-"));
  roots.push(root);
  return path.join(root, "email_settings.json");
}

function fakeSafeStorage(): SafeStorageOperations {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
    decryptString: (value) => value.toString("utf8").replace(/^encrypted:/, ""),
  };
}
