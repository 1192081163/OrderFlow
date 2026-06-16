import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { EmailSettings } from "../shared/types.js";

export function appConfigDir(): string {
  return path.join(os.homedir(), ".order_organizer_assistant");
}

export function defaultEmailSettingsPath(): string {
  return path.join(appConfigDir(), "email_settings.json");
}

export function defaultEmailDownloadRoot(): string {
  return path.join(appConfigDir(), "email_attachments");
}

export async function loadEmailSettings(settingsPath = defaultEmailSettingsPath()): Promise<EmailSettings> {
  try {
    const raw = JSON.parse(await readFile(settingsPath, "utf8")) as Partial<Record<keyof EmailSettings, unknown>>;
    return {
      email: typeof raw.email === "string" ? raw.email.trim() : "",
      authCode: typeof raw.authCode === "string" ? raw.authCode : "",
    };
  } catch {
    return { email: "", authCode: "" };
  }
}

export async function saveEmailSettings(settings: EmailSettings, settingsPath = defaultEmailSettingsPath()): Promise<void> {
  await mkdir(path.dirname(settingsPath), { recursive: true });
  await writeFile(
    settingsPath,
    JSON.stringify({ email: settings.email.trim(), authCode: settings.authCode }, null, 2),
    "utf8",
  );
}
