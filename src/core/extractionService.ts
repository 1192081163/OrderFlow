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

  emitPreparing(progress);
  const extractor = dependencies.runOrderExtraction ?? runPythonOrderExtraction;
  return extractor(paths, {
    recursive: request.recursive ?? false,
    inferManual: request.inferManual ?? true,
    progress: mapExtractionProgress(progress, 5),
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
  emitPreparing(progress);
  const emailFetch = await fetcher(config, downloadDir, {
    hours: request.hours,
    messageUids: request.messageUids,
    progress: mapProgressRange(progress, 5, 35),
  });
  const extraction = await extractor(emailFetch.files, {
    recursive: false,
    inferManual: request.inferManual ?? true,
    progress: mapExtractionProgress(progress, 35),
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

function emitPreparing(progress?: (event: ProgressEvent) => void): void {
  progress?.({
    index: 0,
    total: 1,
    filename: "准备提取",
    status: "running",
    phase: "preparing",
    percent: 2,
  });
}

function mapExtractionProgress(
  progress: ((event: ProgressEvent) => void) | undefined,
  extractingStart: number,
): ((event: ProgressEvent) => void) | undefined {
  if (!progress) return undefined;
  return (event) => {
    const [start, end] = event.phase === "writing" ? [96, 99] : [extractingStart, 95];
    progress(mapProgressEvent(event, start, end));
  };
}

function mapProgressRange(
  progress: ((event: ProgressEvent) => void) | undefined,
  start: number,
  end: number,
): ((event: ProgressEvent) => void) | undefined {
  if (!progress) return undefined;
  return (event) => progress(mapProgressEvent(event, start, end));
}

function mapProgressEvent(event: ProgressEvent, start: number, end: number): ProgressEvent {
  const total = Math.max(0, event.total);
  const completed =
    event.status === "running"
      ? Math.max(0, event.index - 1)
      : Math.min(total, Math.max(0, event.index));
  const ratio =
    typeof event.percent === "number" && Number.isFinite(event.percent)
      ? Math.min(100, Math.max(0, event.percent)) / 100
      : total > 0
        ? completed / total
        : 0;
  return {
    ...event,
    percent: Math.round(start + (end - start) * ratio),
  };
}
