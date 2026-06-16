import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";

import type { ImapConfig } from "../shared/types.js";

export const DEFAULT_IMAP_SERVER = "imap.exmail.qq.com";
export const DEFAULT_IMAP_PORT = 993;
const SUPPORTED_EXCEL_SUFFIXES = new Set([".xlsx", ".xlsm"]);

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
  options: { hours?: number } = {},
): Promise<EmailFetchResult> {
  const attachments = await fetchExcelAttachments(config, options.hours);
  if (attachments.attachments.length === 0) {
    throw new Error(`没有找到订单 Excel 附件。已扫描邮件：${attachments.scannedMessages}`);
  }
  const files = await saveEmailAttachments(attachments.attachments, downloadDir);
  return {
    files,
    scannedMessages: attachments.scannedMessages,
    attachmentCount: attachments.attachments.length,
    downloadDir,
  };
}

export async function fetchExcelAttachments(
  config: ImapConfig,
  hours?: number,
): Promise<{ attachments: EmailAttachment[]; scannedMessages: number }> {
  const client = new ImapFlow({
    host: config.server,
    port: config.port,
    secure: true,
    auth: {
      user: config.email,
      pass: config.authCode,
    },
  });

  const cutoff = hours === undefined ? undefined : new Date(Date.now() - hours * 60 * 60 * 1000);
  const attachments: EmailAttachment[] = [];
  let scannedMessages = 0;

  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      for await (const message of client.fetch(cutoff ? { since: cutoff } : "1:*", { source: true, uid: true })) {
        if (!message.source) {
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
          attachments.push({
            filename: attachment.filename,
            content: toBuffer(attachment.content),
            messageSubject: parsed.subject ?? "",
            messageDate: parsed.date,
            messageUid: String(message.uid ?? ""),
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

export function isMessageWithinFetchWindow(messageDate: Date | undefined, cutoff: Date | undefined): boolean {
  if (!cutoff || !messageDate) {
    return true;
  }
  return messageDate >= cutoff;
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
