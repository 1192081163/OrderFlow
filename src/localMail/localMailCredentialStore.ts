import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { defaultEmailSettingsPath } from "../core/settings.js";
import type { EmailSettings, LocalMailSettingsView, SaveLocalMailSettingsInput } from "../shared/types.js";

export interface SafeStorageOperations {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

interface StoredLocalMailSettings {
  email: string;
  encryptedAuthCode?: string;
  startAtLogin: boolean;
  authCode?: string;
}

interface LocalMailCredentialStoreOptions {
  safeStorage: SafeStorageOperations;
  settingsPath?: string;
}

export class LocalMailCredentialStore {
  private readonly safeStorage: SafeStorageOperations;
  private readonly settingsPath: string;

  constructor(options: LocalMailCredentialStoreOptions) {
    this.safeStorage = options.safeStorage;
    this.settingsPath = options.settingsPath ?? defaultEmailSettingsPath();
  }

  async loadView(): Promise<LocalMailSettingsView> {
    const record = await this.loadAndMigrate();
    return viewOf(record);
  }

  async loadCredentials(): Promise<EmailSettings> {
    const record = await this.loadAndMigrate();
    if (!record.email || !record.encryptedAuthCode) {
      return { email: record.email, authCode: "" };
    }
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new Error("Windows 安全存储不可用，请重新登录邮箱。");
    }
    return {
      email: record.email,
      authCode: this.safeStorage.decryptString(Buffer.from(record.encryptedAuthCode, "base64")),
    };
  }

  async save(input: SaveLocalMailSettingsInput): Promise<LocalMailSettingsView> {
    const current = await this.readRecord();
    const email = input.email.trim();
    let encryptedAuthCode = current.encryptedAuthCode;
    if (input.authCode !== undefined) {
      const authCode = input.authCode.trim();
      if (!authCode) {
        encryptedAuthCode = undefined;
      } else {
        if (!this.safeStorage.isEncryptionAvailable()) {
          throw new Error("Windows 安全存储不可用，无法安全保存邮箱授权码。");
        }
        encryptedAuthCode = this.safeStorage.encryptString(authCode).toString("base64");
      }
    }
    const next: StoredLocalMailSettings = { email, encryptedAuthCode, startAtLogin: input.startAtLogin };
    await this.writeRecord(next);
    return viewOf(next);
  }

  private async loadAndMigrate(): Promise<StoredLocalMailSettings> {
    const record = await this.readRecord();
    if (!record.authCode) {
      return record;
    }
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new Error("Windows 安全存储不可用，无法迁移旧邮箱授权码。");
    }
    const migrated: StoredLocalMailSettings = {
      email: record.email,
      encryptedAuthCode: this.safeStorage.encryptString(record.authCode).toString("base64"),
      startAtLogin: record.startAtLogin,
    };
    await this.writeRecord(migrated);
    return migrated;
  }

  private async readRecord(): Promise<StoredLocalMailSettings> {
    try {
      const raw = JSON.parse(await readFile(this.settingsPath, "utf8")) as Partial<StoredLocalMailSettings>;
      return {
        email: typeof raw.email === "string" ? raw.email.trim() : "",
        encryptedAuthCode: typeof raw.encryptedAuthCode === "string" ? raw.encryptedAuthCode : undefined,
        authCode: typeof raw.authCode === "string" ? raw.authCode : undefined,
        startAtLogin: typeof raw.startAtLogin === "boolean" ? raw.startAtLogin : true,
      };
    } catch (error) {
      if (isMissingFile(error) || error instanceof SyntaxError) {
        return { email: "", startAtLogin: true };
      }
      throw error;
    }
  }

  private async writeRecord(record: StoredLocalMailSettings): Promise<void> {
    await mkdir(path.dirname(this.settingsPath), { recursive: true });
    const temporaryPath = `${this.settingsPath}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(record, null, 2), "utf8");
    await rename(temporaryPath, this.settingsPath);
  }
}

function viewOf(record: StoredLocalMailSettings): LocalMailSettingsView {
  return {
    email: record.email,
    hasAuthCode: Boolean(record.encryptedAuthCode),
    startAtLogin: record.startAtLogin,
  };
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
