import { readFile } from "node:fs/promises";
import path from "node:path";

import { appConfigDir } from "./settings.js";
import type { EmailExtractionRequest, EmailExtractionResult, EmailListRequest } from "./extractionService.js";
import type { EmailListResult, EmailNewMessagesEvent, OutputPaths } from "../shared/types.js";

export interface RemoteEmailApiConfig {
  baseUrl: string;
  token?: string;
}

type EnvLike = Record<string, string | undefined>;

const REMOTE_API_SETTINGS_FILE = "email_api_client.json";
const PACKAGED_REMOTE_API_SETTINGS_FILE = path.join("config", "remote-email-api.json");
const EMPTY_OUTPUTS: OutputPaths = {
  outputDir: "",
  csvOutput: "",
  xlsxOutput: "",
  auditOutput: "",
};

export function defaultRemoteEmailApiSettingsPath(): string {
  return path.join(appConfigDir(), REMOTE_API_SETTINGS_FILE);
}

export function defaultPackagedRemoteEmailApiSettingsPath(): string | undefined {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resourcesPath) {
    return path.join(resourcesPath, PACKAGED_REMOTE_API_SETTINGS_FILE);
  }

  return path.join(process.cwd(), "resources", "remote-email-api.json");
}

export async function loadRemoteEmailApiConfig(
  env: EnvLike = process.env,
  settingsPath = defaultRemoteEmailApiSettingsPath(),
  packagedSettingsPath = defaultPackagedRemoteEmailApiSettingsPath(),
): Promise<RemoteEmailApiConfig | undefined> {
  const envBaseUrl = env.ORDERFLOW_EMAIL_API_URL?.trim();
  if (envBaseUrl) {
    return {
      baseUrl: envBaseUrl,
      token: optionalTrimmed(env.ORDERFLOW_EMAIL_API_TOKEN),
    };
  }

  const userConfig = await readRemoteEmailApiConfig(settingsPath);
  if (userConfig) {
    return userConfig;
  }

  return packagedSettingsPath ? readRemoteEmailApiConfig(packagedSettingsPath) : undefined;
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

  async subscribeNewMessages(
    onEvent: (event: EmailNewMessagesEvent) => void,
    options: { signal?: AbortSignal } = {},
  ): Promise<void> {
    const headers: Record<string, string> = {};
    if (this.token) {
      headers.authorization = `Bearer ${this.token}`;
    }
    const response = await fetch(`${this.baseUrl}/api/email/events`, {
      method: "GET",
      headers,
      signal: options.signal,
    });
    if (!response.ok) {
      throw new Error(response.statusText || `远程邮件服务事件订阅失败：${response.status}`);
    }
    if (!response.body) {
      throw new Error("远程邮件服务事件流不可读。");
    }

    await readSseEvents(response.body, (eventName, data) => {
      if (eventName !== "new-messages" || !data) {
        return;
      }
      onEvent(JSON.parse(data) as EmailNewMessagesEvent);
    });
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

async function readSseEvents(
  body: ReadableStream<Uint8Array>,
  onEvent: (eventName: string, data: string) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let eventEnd = buffer.indexOf("\n\n");
      while (eventEnd !== -1) {
        const eventText = buffer.slice(0, eventEnd);
        buffer = buffer.slice(eventEnd + 2);
        dispatchSseEvent(eventText, onEvent);
        eventEnd = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function dispatchSseEvent(eventText: string, onEvent: (eventName: string, data: string) => void): void {
  let eventName = "message";
  const dataLines: string[] = [];
  for (const line of eventText.split("\n")) {
    if (!line || line.startsWith(":")) {
      continue;
    }
    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    const value = separator === -1 ? "" : line.slice(separator + 1).replace(/^ /, "");
    if (field === "event") {
      eventName = value;
    } else if (field === "data") {
      dataLines.push(value);
    }
  }
  if (dataLines.length > 0) {
    onEvent(eventName, dataLines.join("\n"));
  }
}

async function readRemoteEmailApiConfig(settingsPath: string): Promise<RemoteEmailApiConfig | undefined> {
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
