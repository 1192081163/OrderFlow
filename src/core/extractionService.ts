import path from "node:path";

import {
  DEFAULT_IMAP_PORT,
  DEFAULT_IMAP_SERVER,
  fetchEmailOrderFiles,
  listRecentEmailMessages,
  type EmailFetchResult,
} from "./emailSource.js";
import { runPythonOrderExtraction, type OrderExtractionRunner } from "./pythonExtractor.js";
import { defaultEmailDownloadRoot } from "./settings.js";
import type { EmailListResult, ExtractionResult, ImapConfig, ProgressEvent } from "../shared/types.js";

export interface LocalExtractionRequest {
  paths: string[];
  recursive?: boolean;
  inferManual?: boolean;
}

export interface EmailConnectionRequest {
  email: string;
  authCode: string;
  server?: string;
  port?: number;
}

export interface EmailExtractionRequest extends EmailConnectionRequest {
  inferManual?: boolean;
  hours?: number;
  messageUids?: string[];
  downloadDir?: string;
}

export interface EmailListRequest extends EmailConnectionRequest {
  days?: number;
}

export interface EmailExtractionResult {
  emailFetch: EmailFetchResult;
  extraction: ExtractionResult;
}

export interface LocalExtractionDependencies {
  runOrderExtraction?: OrderExtractionRunner;
}

export interface EmailExtractionDependencies {
  fetchEmailOrderFiles?: typeof fetchEmailOrderFiles;
  runOrderExtraction?: OrderExtractionRunner;
  now?: () => Date;
}

export interface EmailListDependencies {
  listRecentEmailMessages?: typeof listRecentEmailMessages;
  now?: () => Date;
}

export async function extractLocalOrders(
  request: LocalExtractionRequest,
  progress?: (event: ProgressEvent) => void,
  dependencies: LocalExtractionDependencies = {},
): Promise<ExtractionResult> {
  const paths = request.paths.map((item) => item.trim()).filter(Boolean);
  if (paths.length === 0) {
    throw new Error("请选择订单 Excel 文件或文件夹。");
  }

  const extractor = dependencies.runOrderExtraction ?? runPythonOrderExtraction;
  return extractor(paths, {
    recursive: request.recursive ?? false,
    inferManual: request.inferManual ?? true,
    progress,
  });
}

export async function extractEmailOrders(
  request: EmailExtractionRequest,
  progress?: (event: ProgressEvent) => void,
  dependencies: EmailExtractionDependencies = {},
): Promise<EmailExtractionResult> {
  const config = buildImapConfig(request);
  const fetcher = dependencies.fetchEmailOrderFiles ?? fetchEmailOrderFiles;
  const extractor = dependencies.runOrderExtraction ?? runPythonOrderExtraction;
  const downloadDir = request.downloadDir ?? timestampedDownloadDir(dependencies.now?.() ?? new Date());
  const emailFetch = await fetcher(config, downloadDir, {
    hours: request.hours,
    messageUids: request.messageUids,
  });
  const extraction = await extractor(emailFetch.files, {
    recursive: false,
    inferManual: request.inferManual ?? true,
    progress,
  });

  return { emailFetch, extraction };
}

export async function listEmailMessages(
  request: EmailListRequest,
  dependencies: EmailListDependencies = {},
): Promise<EmailListResult> {
  const config = buildImapConfig(request);
  const lister = dependencies.listRecentEmailMessages ?? listRecentEmailMessages;
  return lister(config, {
    days: request.days ?? 7,
    now: dependencies.now?.(),
  });
}

export function buildImapConfig(settings: EmailConnectionRequest): ImapConfig {
  const email = settings.email.trim();
  const authCode = settings.authCode.trim();
  if (!email || !authCode) {
    throw new Error("请先填写企业微信邮箱和授权码。");
  }
  return {
    email,
    authCode,
    server: settings.server?.trim() || DEFAULT_IMAP_SERVER,
    port: settings.port && Number.isFinite(settings.port) ? settings.port : DEFAULT_IMAP_PORT,
  };
}

export function timestampedDownloadDir(now: Date): string {
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "-",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");
  return path.join(defaultEmailDownloadRoot(), stamp);
}
