import { readFile } from "node:fs/promises";
import path from "node:path";

import { appConfigDir } from "./settings.js";
import type { EmailExtractionRequest, EmailExtractionResult, EmailListRequest } from "./extractionService.js";
import type { EmailListResult, OutputPaths } from "../shared/types.js";

export interface RemoteEmailApiConfig {
  baseUrl: string;
  token?: string;
}

type EnvLike = Record<string, string | undefined>;

const REMOTE_API_SETTINGS_FILE = "email_api_client.json";
const EMPTY_OUTPUTS: OutputPaths = {
  outputDir: "",
  csvOutput: "",
  xlsxOutput: "",
  auditOutput: "",
};

export function defaultRemoteEmailApiSettingsPath(): string {
  return path.join(appConfigDir(), REMOTE_API_SETTINGS_FILE);
}

export async function loadRemoteEmailApiConfig(
  env: EnvLike = process.env,
  settingsPath = defaultRemoteEmailApiSettingsPath(),
): Promise<RemoteEmailApiConfig | undefined> {
  const envBaseUrl = env.ORDERFLOW_EMAIL_API_URL?.trim();
  if (envBaseUrl) {
    return {
      baseUrl: envBaseUrl,
      token: optionalTrimmed(env.ORDERFLOW_EMAIL_API_TOKEN),
    };
  }

  try {
    const raw = JSON.parse(await readFile(settingsPath, "utf8")) as Partial<Record<keyof RemoteEmailApiConfig, unknown>>;
    const baseUrl = typeof raw.baseUrl === "string" ? raw.baseUrl.trim() : "";
    if (!baseUrl) {
      return undefined;
    }
    return {
      baseUrl,
      token: typeof raw.token === "string" ? optionalTrimmed(raw.token) : undefined,
    };
  } catch {
    return undefined;
  }
}

export class RemoteEmailApiClient {
  private readonly baseUrl: string;
  private readonly token?: string;

  constructor(config: RemoteEmailApiConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.token = optionalTrimmed(config.token);
  }

  async listEmails(request: EmailListRequest): Promise<EmailListResult> {
    return this.post<EmailListResult>("/api/email/messages", request);
  }

  async extractEmail(request: EmailExtractionRequest): Promise<EmailExtractionResult> {
    const result = await this.post<EmailExtractionResult>("/api/email/extract", request);
    return {
      ...result,
      extraction: {
        ...result.extraction,
        outputs: { ...EMPTY_OUTPUTS },
      },
    };
  }

  private async post<T>(pathname: string, body: unknown): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    const response = await fetch(`${this.baseUrl}${pathname}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : undefined;

    if (!response.ok) {
      const message =
        payload && typeof payload === "object" && "error" in payload ? String((payload as { error: unknown }).error) : response.statusText;
      throw new Error(message || `远程邮件服务请求失败：${response.status}`);
    }

    return payload as T;
  }
}

function optionalTrimmed(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}
