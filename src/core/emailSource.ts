import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";

import { isOrderWorkbookContent } from "./orderFileClassifier.js";
import type { EmailListResult, EmailMessageSummary, ImapConfig } from "../shared/types.js";

export const DEFAULT_IMAP_SERVER = "imap.exmail.qq.com";
export const DEFAULT_IMAP_PORT = 993;

const SUPPORTED_EXCEL_SUFFIXES = new Set([".xlsx", ".xlsm"]);
const DEFAULT_EMAIL_LIST_DAYS = 7;

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
}

export interface EmailListOptions {
  days?: number;
  now?: Date;
}

interface EmailAttachmentBatch {
  attachments: EmailAttachment[];
  scannedMessages: number;
}

interface ParsedEmailAttachmentLike {
  filename?: string | null;
  content?: unknown;
}

interface ParsedEmailLike {
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
  const client = createClient(config);
  const messages: EmailMessageSummary[] = [];
  let scannedMessages = 0;

  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      for await (const message of client.fetch({ since: cutoff }, { source: true, uid: true })) {
        if (!message.source) {
          continue;
        }

        const parsed: ParsedMail = await simpleParser(message.source);
        if (!isMessageWithinFetchWindow(parsed.date, cutoff)) {
          continue;
        }

        scannedMessages += 1;
        const summary = await summarizeParsedOrderEmail(parsed, String(message.uid ?? ""));
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
    scannedMessages,
    days,
  };
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
  const orderAttachmentNames: string[] = [];

  for (const attachment of parsed.attachments ?? []) {
    const filename = attachment.filename?.trim() ?? "";
    if (!filename || !isExcelAttachmentName(filename) || attachment.content === undefined) {
      continue;
    }

    const content = toBuffer(attachment.content);
    if (await filter({ filename, content })) {
      orderAttachmentNames.push(filename);
    }
  }

  return emailSummaryFromAttachmentNames(parsed, uid, orderAttachmentNames);
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
  const client = createClient(config);
  const cutoff = options.hours === undefined ? undefined : new Date(Date.now() - options.hours * 60 * 60 * 1000);
  const selectedUids = options.messageUids?.length ? new Set(options.messageUids) : undefined;
  const attachments: EmailAttachment[] = [];
  let scannedMessages = 0;

  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      for await (const message of client.fetch(cutoff ? { since: cutoff } : "1:*", { source: true, uid: true })) {
        const uid = String(message.uid ?? "");
        if (!shouldIncludeMessageUid(uid, selectedUids) || !message.source) {
          continue;
        }

        const parsed: ParsedMail = await simpleParser(message.source);
        if (!isMessageWithinFetchWindow(parsed.date, cutoff)) {
          continue;
        }

        scannedMessages += 1;
        for (const attachment of parsed.attachments) {
          if (!attachment.filename || !isExcelAttachmentName(attachment.filename)) {
            continue;
          }

          const content = toBuffer(attachment.content);
          if (!(await isOrderEmailAttachment({ filename: attachment.filename, content }))) {
            continue;
          }

          attachments.push({
            filename: attachment.filename,
            content,
            messageSubject: parsed.subject ?? "",
            messageDate: parsed.date,
            messageUid: uid,
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

async function isOrderEmailAttachment(attachment: OrderAttachmentCandidate): Promise<boolean> {
  return isOrderWorkbookContent(attachment.filename, attachment.content);
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

function createClient(config: ImapConfig): ImapFlow {
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
