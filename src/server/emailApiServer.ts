import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";

import {
  extractLocalOrders,
  extractEmailOrders,
  listEmailMessages,
  type EmailExtractionRequest,
  type EmailExtractionResult,
  type EmailListRequest,
  type LocalExtractionRequest,
} from "../core/extractionService.js";
import type { EmailListResult, ExtractionResult } from "../shared/types.js";
import type { EmailApiConfig } from "./emailApiConfig.js";

export interface EmailApiServerDependencies {
  config: EmailApiConfig;
  listEmailMessages?: (request: EmailListRequest) => Promise<EmailListResult>;
  extractEmailOrders?: (request: EmailExtractionRequest) => Promise<EmailExtractionResult>;
  extractLocalOrders?: (request: LocalExtractionRequest) => Promise<ExtractionResult>;
}

type JsonRecord = Record<string, unknown>;

interface UploadedOrderFile {
  filename: string;
  contentBase64: string;
}

export function createEmailApiServer(dependencies: EmailApiServerDependencies): Server {
  const lister = dependencies.listEmailMessages ?? listEmailMessages;
  const emailExtractor = dependencies.extractEmailOrders ?? ((request) => extractEmailOrders(request));
  const localExtractor = dependencies.extractLocalOrders ?? ((request) => extractLocalOrders(request));

  return createServer((request, response) => {
    void handleRequest(request, response, dependencies.config, lister, emailExtractor, localExtractor);
  });
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: EmailApiConfig,
  lister: (request: EmailListRequest) => Promise<EmailListResult>,
  emailExtractor: (request: EmailExtractionRequest) => Promise<EmailExtractionResult>,
  localExtractor: (request: LocalExtractionRequest) => Promise<ExtractionResult>,
): Promise<void> {
  try {
    if (request.method === "GET" && request.url === "/health") {
      writeJson(response, 200, { ok: true });
      return;
    }

    if (!isAuthorized(request, config.token)) {
      writeJson(response, 401, { error: "Unauthorized" });
      return;
    }

    if (request.method === "POST" && request.url === "/api/email/messages") {
      const body = await readJsonBody(request);
      const result = await lister({
        ...emailConnectionFromConfig(config, body),
        days: optionalNumber(body, "days"),
      });
      writeJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && request.url === "/api/email/extract") {
      const body = await readJsonBody(request);
      const result = await emailExtractor({
        ...emailConnectionFromConfig(config, body),
        hours: optionalNumber(body, "hours"),
        inferManual: optionalBoolean(body, "inferManual"),
        messageUids: optionalStringArray(body, "messageUids"),
        downloadDir: optionalString(body, "downloadDir"),
      });
      writeJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && request.url === "/api/orders/extract") {
      const body = await readJsonBody(request);
      const paths = optionalStringArray(body, "paths") ?? [];
      const uploadedPaths = await saveUploadedOrderFiles(optionalUploadedOrderFiles(body, "files") ?? []);
      const result = await localExtractor({
        paths: [...paths, ...uploadedPaths],
        recursive: optionalBoolean(body, "recursive"),
        inferManual: optionalBoolean(body, "inferManual"),
      });
      writeJson(response, 200, result);
      return;
    }

    writeJson(response, 404, { error: "Not Found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeJson(response, message.includes("JSON") ? 400 : 500, { error: message });
  }
}

function emailConnectionFromConfig(
  config: EmailApiConfig,
  body: JsonRecord = {},
): Pick<EmailListRequest, "email" | "authCode" | "server" | "port" | "proxy"> {
  return {
    email: optionalString(body, "email") ?? config.email,
    authCode: optionalString(body, "authCode") ?? config.authCode,
    server: optionalString(body, "server") ?? config.server,
    port: optionalNumber(body, "port") ?? config.imapPort,
    proxy: config.imapProxy,
  };
}

function isAuthorized(request: IncomingMessage, token: string): boolean {
  return request.headers.authorization === `Bearer ${token}`;
}

async function readJsonBody(request: IncomingMessage): Promise<JsonRecord> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) {
    return {};
  }

  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("JSON body must be an object.");
  }
  return parsed as JsonRecord;
}

function optionalNumber(body: JsonRecord, key: string): number | undefined {
  const value = body[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${key} must be a number.`);
  }
  return value;
}

function optionalBoolean(body: JsonRecord, key: string): boolean | undefined {
  const value = body[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${key} must be a boolean.`);
  }
  return value;
}

function optionalString(body: JsonRecord, key: string): string | undefined {
  const value = body[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${key} must be a string.`);
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function optionalStringArray(body: JsonRecord, key: string): string[] | undefined {
  const value = body[key];
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${key} must be an array.`);
  }

  const items = value.map((item) => {
    if (typeof item !== "string") {
      throw new Error(`${key} must contain only strings.`);
    }
    return item.trim();
  });
  return items.filter(Boolean);
}

function optionalUploadedOrderFiles(body: JsonRecord, key: string): UploadedOrderFile[] | undefined {
  const value = body[key];
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${key} must be an array.`);
  }

  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`${key} must contain file objects.`);
    }

    const record = item as JsonRecord;
    const filename = optionalString(record, "filename") ?? "upload.xlsx";
    const contentBase64 = optionalString(record, "contentBase64");
    if (!contentBase64) {
      throw new Error(`${key}.contentBase64 is required.`);
    }
    return { filename, contentBase64 };
  });
}

async function saveUploadedOrderFiles(files: UploadedOrderFile[]): Promise<string[]> {
  if (files.length === 0) {
    return [];
  }

  const uploadDir = await mkdtemp(path.join(os.tmpdir(), "orderflow-api-"));
  const savedPaths: string[] = [];
  for (const [index, file] of files.entries()) {
    const filename = safeUploadFilename(file.filename, index);
    const filePath = path.join(uploadDir, filename);
    await writeFile(filePath, Buffer.from(file.contentBase64, "base64"));
    savedPaths.push(filePath);
  }
  return savedPaths;
}

function safeUploadFilename(filename: string, index: number): string {
  const base = path.basename(filename.trim());
  return base || `upload-${index + 1}.xlsx`;
}

function writeJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}
