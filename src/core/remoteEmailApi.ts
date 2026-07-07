import { readFile } from "node:fs/promises";
import path from "node:path";

import { resolveInputPaths } from "./fileScanner.js";
import { defaultOutputPaths } from "./outputPaths.js";
import { sortExtractedRowsByIdealDate } from "./rowSorting.js";
import { appConfigDir, defaultEmailDownloadRoot } from "./settings.js";
import type { EmailExtractionRequest, EmailExtractionResult, EmailListRequest, LocalExtractionRequest } from "./extractionService.js";
import { writeResultWorkbook } from "./writers.js";
import type { EmailListResult, EmailNewMessagesEvent, ExtractionResult } from "../shared/types.js";

export interface RemoteEmailApiConfig {
  baseUrl: string;
  token?: string;
}

interface RemoteEmailApiClientOptions {
  emailOutputRoot?: string;
  now?: () => Date;
}

type EnvLike = Record<string, string | undefined>;

const REMOTE_API_SETTINGS_FILE = "email_api_client.json";
const PACKAGED_REMOTE_API_SETTINGS_FILE = path.join("config", "remote-email-api.json");

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
  private readonly emailOutputRoot?: string;
  private readonly now: () => Date;

  constructor(config: RemoteEmailApiConfig, options: RemoteEmailApiClientOptions = {}) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.token = optionalTrimmed(config.token);
    this.emailOutputRoot = options.emailOutputRoot;
    this.now = options.now ?? (() => new Date());
  }

  async listEmails(request: EmailListRequest): Promise<EmailListResult> {
    return this.post<EmailListResult>("/api/email/messages", request);
  }

  async extractEmail(request: EmailExtractionRequest): Promise<EmailExtractionResult> {
    const result = await this.post<EmailExtractionResult>("/api/email/extract", request);
    const rows = sortExtractedRowsByIdealDate(result.extraction.rows);
    const outputs = defaultOutputPaths(timestampedEmailOutputDir(this.now(), this.emailOutputRoot));
    await writeResultWorkbook(rows, outputs);

    return {
      ...result,
      extraction: {
        ...result.extraction,
        rows,
        outputs,
      },
    };
  }

  async extractLocal(request: LocalExtractionRequest): Promise<ExtractionResult> {
    const resolution = await resolveInputPaths(request.paths, { recursive: request.recursive ?? false });
    if (resolution.inputFiles.length === 0) {
      throw new Error("No valid order Excel files found.");
    }
    const files = await Promise.all(
      resolution.inputFiles.map(async (filePath, index) => ({
        filename: `${String(index + 1).padStart(4, "0")}-${path.basename(filePath)}`,
        contentBase64: (await readFile(filePath)).toString("base64"),
      })),
    );
    const remoteResult = await this.post<ExtractionResult>("/api/orders/extract", {
      files,
      recursive: false,
      inferManual: request.inferManual,
    });
    const rows = sortExtractedRowsByIdealDate(remoteResult.rows);
    const outputs = defaultOutputPaths(resolution.baseDir);
    await writeResultWorkbook(rows, outputs);

    return {
      ...remoteResult,
      rows,
      inputFiles: resolution.inputFiles,
      skippedFiles: [...resolution.skippedFiles, ...remoteResult.skippedFiles],
      outputs,
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

    const response = await fetchRemote(
      `${this.baseUrl}${pathname}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      },
      this.baseUrl,
    );
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

async function fetchRemote(url: string, init: RequestInit, baseUrl: string): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new Error(`无法连接远程邮件服务 ${baseUrl}，请检查服务地址、网络连接或远程服务是否已启动。`);
  }
}

function optionalTrimmed(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function timestampedEmailOutputDir(now: Date, root = defaultEmailDownloadRoot()): string {
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "-",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");
  return path.join(root, stamp);
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
