import os from "node:os";
import path from "node:path";

export function appConfigDir(): string {
  return path.join(os.homedir(), ".order_organizer_assistant");
}

export function defaultEmailSettingsPath(): string {
  return path.join(appConfigDir(), "email_settings.json");
}

export function defaultEmailDownloadRoot(): string {
  return path.join(appConfigDir(), "email_attachments");
}
