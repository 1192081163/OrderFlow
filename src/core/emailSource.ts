import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ImapFlow,
  type FetchMessageObject,
  type MessageAddressObject,
  type MessageStructureObject,
  type SearchObject,
  type SequenceString,
} from "imapflow";

import { isOrderWorkbookContent } from "./orderFileClassifier.js";
import type { EmailListResult, EmailMessageSummary, ImapConfig, ProgressEvent } from "../shared/types.js";

export const DEFAULT_IMAP_SERVER = "imap.exmail.qq.com";
export const DEFAULT_IMAP_PORT = 993;

const SUPPORTED_EXCEL_SUFFIXES = new Set([".xlsx", ".xlsm"]);
const DEFAULT_EMAIL_LIST_DAYS = 7;
const TRANSIENT_IMAP_ATTEMPTS = 3;

export const MAX_ORDER_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  messageSubject?: string;
  messageDate?: Date;
  messageUid?: string;
}

export interface EmailFetchResult {
  files: string[];
  scannedMessages: number;
  attachmentCount: number;
  downloadDir: string;
}

export interface EmailFetchOptions {
  hours?: number;
  messageUids?: string[];
  progress?: (event: ProgressEvent) => void;
}

export interface EmailListOptions {
  days?: number;
  now?: Date;
}

export interface OrderEmailListOptions extends EmailListOptions {
  excludeUids?: string[];
}

interface EmailAttachmentBatch {
  attachments: EmailAttachment[];
  scannedMessages: number;
}

interface EmailAttachmentPart {
  part: string;
  filename: string;
}

interface EmailDownloadCandidate {
  uid: string;
  subject: string;
  date?: Date;
  parts: EmailAttachmentPart[];
}

interface ParsedEmailAttachmentLike {
  filename?: string | null;
  content?: unknown;
}

export interface ParsedEmailLike {
  subject?: string | false | null;
  date?: Date;
  from?: { text?: string } | null;
  attachments?: ParsedEmailAttachmentLike[];
}

interface OrderAttachmentCandidate {
  filename: string;
  content: Buffer;
}

type OrderAttachmentFilter = (attachment: OrderAttachmentCandidate) => boolean | Promise<boolean>;

export function isExcelAttachmentName(filename: string): boolean {
  return SUPPORTED_EXCEL_SUFFIXES.has(path.extname(filename).toLowerCase());
}

export function sanitizeAttachmentName(filename: string): string {
  const name = path.basename(filename).trim();
  if (!name || !isExcelAttachmentName(name)) {
    return "attachment.xlsx";
  }
  return name;
}

export async function saveEmailAttachments(attachments: EmailAttachment[], targetDir: string): Promise<string[]> {
  await mkdir(targetDir, { recursive: true });
  const used = new Set<string>();
  const saved: string[] = [];

  for (const attachment of attachments) {
    const filename = dedupeName(sanitizeAttachmentName(attachment.filename), used);
    used.add(filename);
    const filePath = path.join(targetDir, filename);
    await writeFile(filePath, attachment.content);
    saved.push(filePath);
  }

  return saved;
}

export async function fetchEmailOrderFiles(
  config: ImapConfig,
  downloadDir: string,
  options: EmailFetchOptions = {},
): Promise<EmailFetchResult> {
  const result = await fetchExcelAttachments(config, options);
  if (result.attachments.length === 0) {
    throw new Error("没有找到订单 Excel 附件，请先刷新近一周邮件并选择带订单附件的邮件。");
  }

  const files = await saveEmailAttachments(result.attachments, downloadDir);
  return {
    files,
    scannedMessages: result.scannedMessages,
    attachmentCount: result.attachments.length,
    downloadDir,
  };
}

export async function listRecentEmailMessages(
  config: ImapConfig,
  options: EmailListOptions = {},
): Promise<EmailListResult> {
  const days = options.days ?? DEFAULT_EMAIL_LIST_DAYS;
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const client = createImapClient(config);
  const messages: EmailMessageSummary[] = [];
  const scannedUids: string[] = [];
  let scannedMessages = 0;
  let candidateAttachmentCount = 0;

  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      for await (const message of client.fetch({ since: cutoff }, { envelope: true, bodyStructure: true, uid: true })) {
        if (!isMessageWithinFetchWindow(message.envelope?.date, cutoff)) {
          continue;
        }

        scannedMessages += 1;
        const summary = summarizeFetchedEmailMetadata(message);
        scannedUids.push(summary.uid);
        candidateAttachmentCount += summary.attachmentCount;
        if (summary.hasExcelAttachments) {
          messages.push(summary);
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
  }

  return {
    messages: sortEmailMessagesByDateDesc(messages),
    scannedUids,
    scannedMessages,
    days,
    orderAttachmentCount: candidateAttachmentCount,
    nonOrderExcelAttachmentCount: 0,
  };
}

export async function listRecentOrderEmailMessages(
  config: ImapConfig,
  options: OrderEmailListOptions = {},
): Promise<EmailListResult> {
  return retryTransientImapConnection(() => listRecentOrderEmailMessagesOnce(config, options), config);
}

async function listRecentOrderEmailMessagesOnce(
  config: ImapConfig,
  options: OrderEmailListOptions,
): Promise<EmailListResult> {
  const days = options.days ?? DEFAULT_EMAIL_LIST_DAYS;
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const excluded = new Set((options.excludeUids ?? []).map((uid) => uid.trim()).filter(Boolean));
  const client = createImapClient(config);
  const candidates: Array<{ summary: EmailMessageSummary; parts: EmailAttachmentPart[] }> = [];
  const messages: EmailMessageSummary[] = [];
  const scannedUids: string[] = [];
  let scannedMessages = 0;
  let candidateCount = 0;

  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      for await (const message of client.fetch({ since: cutoff }, { envelope: true, bodyStructure: true, uid: true })) {
        if (!isMessageWithinFetchWindow(message.envelope?.date, cutoff)) {
          continue;
        }
        scannedMessages += 1;
        const summary = summarizeFetchedEmailMetadata(message);
        scannedUids.push(summary.uid);
        if (!summary.hasExcelAttachments || excluded.has(summary.uid)) {
          continue;
        }
        const parts = findExcelAttachmentParts(message.bodyStructure);
        candidateCount += parts.length;
        candidates.push({ summary, parts });
      }

      for (const candidate of candidates) {
        const downloaded = await client.downloadMany(
          candidate.summary.uid,
          candidate.parts.map((part) => part.part),
          { uid: true },
        );
        const names: string[] = [];
        for (const part of candidate.parts) {
          const downloadedPart = downloaded[part.part];
          if (!downloadedPart?.content) {
            continue;
          }
          const filename = downloadedPart.meta?.filename || part.filename;
          if (await isOrderEmailAttachment({ filename, content: toBuffer(downloadedPart.content) })) {
            names.push(filename);
          }
        }
        if (names.length > 0) {
          messages.push({
            ...candidate.summary,
            attachmentCount: names.length,
            excelAttachmentNames: names,
            hasExcelAttachments: true,
          });
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
  }

  const orderAttachmentCount = messages.reduce((sum, message) => sum + message.attachmentCount, 0);
  return {
    messages: sortEmailMessagesByDateDesc(messages),
    scannedUids,
    scannedMessages,
    days,
    orderAttachmentCount,
    nonOrderExcelAttachmentCount: Math.max(0, candidateCount - orderAttachmentCount),
  };
}

export async function verifyImapConnection(config: ImapConfig): Promise<void> {
  const client = createImapClient(config);
  await client.connect();
  try {
    await client.mailboxOpen("INBOX");
  } finally {
    await client.logout().catch(() => undefined);
  }
}

export function summarizeParsedEmail(parsed: ParsedEmailLike, uid: string): EmailMessageSummary {
  const excelAttachmentNames = (parsed.attachments ?? [])
    .map((attachment) => attachment.filename?.trim() ?? "")
    .filter((filename) => filename && isExcelAttachmentName(filename));

  return emailSummaryFromAttachmentNames(parsed, uid, excelAttachmentNames);
}

export async function summarizeParsedOrderEmail(
  parsed: ParsedEmailLike,
  uid: string,
  filter: OrderAttachmentFilter = isOrderEmailAttachment,
): Promise<EmailMessageSummary> {
  const orderAttachments = await collectOrderEmailAttachments(parsed, uid, filter);
  return emailSummaryFromAttachmentNames(
    parsed,
    uid,
    orderAttachments.map((attachment) => attachment.filename),
  );
}

export async function collectOrderEmailAttachments(
  parsed: ParsedEmailLike,
  uid: string,
  filter: OrderAttachmentFilter = isOrderEmailAttachment,
): Promise<EmailAttachment[]> {
  const orderAttachments: EmailAttachment[] = [];

  for (const attachment of parsed.attachments ?? []) {
    const filename = attachment.filename?.trim() ?? "";
    if (!filename || !isExcelAttachmentName(filename) || attachment.content === undefined) {
      continue;
    }

    const content = toBuffer(attachment.content);
    if (await filter({ filename, content })) {
      orderAttachments.push({
        filename,
        content,
        messageSubject: parsed.subject || "",
        messageDate: parsed.date,
        messageUid: uid,
      });
    }
  }

  return orderAttachments;
}

export function sortEmailMessagesByDateDesc(messages: EmailMessageSummary[]): EmailMessageSummary[] {
  return [...messages].sort((left, right) => timestampOf(right.date) - timestampOf(left.date));
}

export function shouldIncludeMessageUid(uid: string, selectedUids?: ReadonlySet<string>): boolean {
  return !selectedUids || selectedUids.size === 0 || selectedUids.has(uid);
}

export function isMessageWithinFetchWindow(messageDate: Date | undefined, cutoff: Date | undefined): boolean {
  if (!cutoff || !messageDate) {
    return true;
  }
  return messageDate >= cutoff;
}

async function fetchExcelAttachments(config: ImapConfig, options: EmailFetchOptions): Promise<EmailAttachmentBatch> {
  return retryTransientImapConnection(() => fetchExcelAttachmentsOnce(config, options), config);
}

async function fetchExcelAttachmentsOnce(config: ImapConfig, options: EmailFetchOptions): Promise<EmailAttachmentBatch> {
  const client = createImapClient(config);
  const cutoff = options.hours === undefined ? undefined : new Date(Date.now() - options.hours * 60 * 60 * 1000);
  const selectedUids = options.messageUids?.length ? new Set(options.messageUids) : undefined;
  const attachments: EmailAttachment[] = [];
  const candidates: EmailDownloadCandidate[] = [];
  let scannedMessages = 0;

  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const fetchRange = buildAttachmentFetchRange(cutoff, selectedUids);
      const fetchOptions = selectedUids ? { uid: true } : undefined;

      for await (const message of client.fetch(
        fetchRange,
        { uid: true, bodyStructure: true, envelope: true },
        fetchOptions,
      )) {
        const uid = String(message.uid ?? "");
        if (!shouldIncludeMessageUid(uid, selectedUids)) {
          continue;
        }

        if (!isMessageWithinFetchWindow(message.envelope?.date, cutoff)) {
          continue;
        }

        scannedMessages += 1;
        const excelParts = findExcelAttachmentParts(message.bodyStructure);
        if (excelParts.length === 0) {
          continue;
        }

        candidates.push({
          uid,
          subject: normalizeMailText(message.envelope?.subject) || "",
          date: message.envelope?.date,
          parts: excelParts,
        });
      }

      const totalAttachments = candidates.reduce((sum, candidate) => sum + candidate.parts.length, 0);
      let attachmentIndex = 0;
      for (const candidate of candidates) {
        const firstPart = candidate.parts[0];
        if (firstPart) {
          options.progress?.({
            index: attachmentIndex + 1,
            total: totalAttachments,
            filename: firstPart.filename,
            status: "running",
            phase: "downloading",
          });
        }
        const downloaded = await client.downloadMany(
          candidate.uid,
          candidate.parts.map((part) => part.part),
          { uid: true },
        );
        for (const [partIndex, part] of candidate.parts.entries()) {
          attachmentIndex += 1;
          if (partIndex > 0) {
            options.progress?.({
              index: attachmentIndex,
              total: totalAttachments,
              filename: part.filename,
              status: "running",
              phase: "downloading",
            });
          }
          const downloadedPart = downloaded[part.part];
          if (!downloadedPart?.content) {
            options.progress?.({
              index: attachmentIndex,
              total: totalAttachments,
              filename: part.filename,
              status: "failed",
              phase: "downloading",
            });
            continue;
          }

          const filename = downloadedPart.meta?.filename || part.filename;
          const content = toBuffer(downloadedPart.content);
          if (content.byteLength <= MAX_ORDER_ATTACHMENT_BYTES) {
            attachments.push({
              filename,
              content,
              messageSubject: candidate.subject,
              messageDate: candidate.date,
              messageUid: candidate.uid,
            });
          }
          options.progress?.({
            index: attachmentIndex,
            total: totalAttachments,
            filename,
            status: "completed",
            phase: "downloading",
          });
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
  }

  return { attachments, scannedMessages };
}

async function retryTransientImapConnection<T>(operation: () => Promise<T>, config: ImapConfig): Promise<T> {
  for (let attempt = 1; attempt <= TRANSIENT_IMAP_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isTransientImapConnectionError(error)) {
        throw error;
      }
      if (attempt === TRANSIENT_IMAP_ATTEMPTS) {
        throw imapNetworkError(config, error);
      }
      await waitForImapRetry(attempt * 1_000);
    }
  }

  throw new Error("IMAP retry loop exhausted unexpectedly.");
}

function imapNetworkError(config: ImapConfig, cause: unknown): Error {
  const error = new Error(
    `企业邮箱网络连接失败：无法建立到 ${config.server}:${config.port} 的 TLS 连接。请确认当前电脑或办公室网络允许出站 TCP ${config.port}，然后点击“重新连接”再试。`,
  );
  Object.defineProperty(error, "cause", { value: cause, configurable: true });
  return error;
}

function waitForImapRetry(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isTransientImapConnectionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const code =
    error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  const text = `${message} ${code}`;
  return /Client network socket disconnected before secure TLS connection was established|ECONNRESET|ETIMEDOUT|EPIPE|socket hang up|SSL_ERROR_SYSCALL/i.test(
    text,
  );
}

function buildAttachmentFetchRange(
  cutoff: Date | undefined,
  selectedUids: ReadonlySet<string> | undefined,
): SequenceString | SearchObject {
  if (selectedUids?.size) {
    return [...selectedUids].join(",");
  }
  return cutoff ? { since: cutoff } : "1:*";
}

async function isOrderEmailAttachment(attachment: OrderAttachmentCandidate): Promise<boolean> {
  if (attachment.content.byteLength > MAX_ORDER_ATTACHMENT_BYTES) {
    return false;
  }
  return isOrderWorkbookContent(attachment.filename, attachment.content);
}

function summarizeFetchedEmailMetadata(message: FetchMessageObject): EmailMessageSummary {
  const attachmentNames = findExcelAttachmentParts(message.bodyStructure).map((part) => part.filename);
  return {
    uid: String(message.uid ?? ""),
    subject: normalizeMailText(message.envelope?.subject) || "(无主题)",
    from: formatEnvelopeAddresses(message.envelope?.from),
    date: normalizeEnvelopeDate(message.envelope?.date),
    attachmentCount: attachmentNames.length,
    excelAttachmentNames: attachmentNames,
    hasExcelAttachments: attachmentNames.length > 0,
  };
}

function findExcelAttachmentParts(
  node: MessageStructureObject | undefined,
  attachments: EmailAttachmentPart[] = [],
): EmailAttachmentPart[] {
  if (!node) {
    return attachments;
  }

  const filename = node.dispositionParameters?.filename || node.parameters?.name || "";
  if (node.part && filename && isExcelAttachmentName(filename)) {
    attachments.push({ part: node.part, filename });
  }

  for (const child of node.childNodes ?? []) {
    findExcelAttachmentParts(child, attachments);
  }

  return attachments;
}

function emailSummaryFromAttachmentNames(parsed: ParsedEmailLike, uid: string, attachmentNames: string[]): EmailMessageSummary {
  return {
    uid,
    subject: normalizeMailText(parsed.subject) || "(无主题)",
    from: normalizeMailText(parsed.from?.text),
    date: parsed.date?.toISOString(),
    attachmentCount: attachmentNames.length,
    excelAttachmentNames: attachmentNames,
    hasExcelAttachments: attachmentNames.length > 0,
  };
}

function formatEnvelopeAddresses(addresses: MessageAddressObject[] | undefined): string | undefined {
  if (!addresses?.length) {
    return undefined;
  }

  const formatted = addresses
    .map((address) => {
      const name = normalizeMailText(address.name);
      const email = normalizeMailText(address.address);
      if (name && email) {
        return `${name} <${email}>`;
      }
      return name || email || "";
    })
    .filter(Boolean)
    .join(", ");

  return formatted || undefined;
}

function normalizeEnvelopeDate(date: Date | undefined): string | undefined {
  if (!date || !Number.isFinite(date.getTime())) {
    return undefined;
  }
  return date.toISOString();
}

export function createImapClient(config: ImapConfig): ImapFlow {
  return new ImapFlow({
    host: config.server,
    port: config.port,
    secure: true,
    auth: {
      user: config.email,
      pass: config.authCode,
    },
    logger: false,
  });
}

function dedupeName(filename: string, used: Set<string>): string {
  if (!used.has(filename)) {
    return filename;
  }

  const parsed = path.parse(filename);
  let index = 2;
  while (true) {
    const candidate = `${parsed.name}-${index}${parsed.ext}`;
    if (!used.has(candidate)) {
      return candidate;
    }
    index += 1;
  }
}

function toBuffer(content: unknown): Buffer {
  if (Buffer.isBuffer(content)) {
    return content;
  }
  if (content instanceof Uint8Array) {
    return Buffer.from(content);
  }
  if (typeof content === "string") {
    return Buffer.from(content);
  }
  throw new Error("Unsupported email attachment content.");
}

function timestampOf(date: string | undefined): number {
  if (!date) {
    return 0;
  }
  const timestamp = Date.parse(date);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function normalizeMailText(value: string | false | null | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}
