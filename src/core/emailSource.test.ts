import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  collectOrderEmailAttachments,
  fetchEmailOrderFiles,
  isExcelAttachmentName,
  isMessageWithinFetchWindow,
  listRecentOrderEmailMessages,
  listRecentEmailMessages,
  MAX_ORDER_ATTACHMENT_BYTES,
  saveEmailAttachments,
  sanitizeAttachmentName,
  shouldIncludeMessageUid,
  sortEmailMessagesByDateDesc,
  summarizeParsedEmail,
  summarizeParsedOrderEmail,
  verifyImapConnection,
  type EmailAttachment,
} from "./emailSource.js";
import type { ImapConfig } from "../shared/types.js";

const imapMock = vi.hoisted(() => ({
  messages: [] as unknown[],
  downloads: {} as Record<string, Record<string, { content: Buffer | null; meta?: { filename?: string } }>>,
  connectFailures: [] as Error[],
  downloadManyWhileFetching: false,
  instances: [] as Array<{
    options?: unknown;
    connectCalls: number;
    fetchCalls: Array<{ range: unknown; query: unknown; options: unknown }>;
    downloadManyCalls: Array<{ range: string; parts: string[]; options: unknown }>;
    lockedMailbox?: string;
    releasedLocks: number;
    logoutCalls: number;
    activeFetches: number;
  }>,
}));

vi.mock("imapflow", () => {
  class ImapFlow {
    fetchCalls: Array<{ range: unknown; query: unknown; options: unknown }> = [];
    downloadManyCalls: Array<{ range: string; parts: string[]; options: unknown }> = [];
    lockedMailbox?: string;
    connectCalls = 0;
    releasedLocks = 0;
    logoutCalls = 0;
    activeFetches = 0;
    options?: unknown;

    constructor(options?: unknown) {
      this.options = options;
      imapMock.instances.push(this);
    }

    async connect(): Promise<void> {
      this.connectCalls += 1;
      const error = imapMock.connectFailures.shift();
      if (error) {
        throw error;
      }
    }

    async getMailboxLock(mailbox: string): Promise<{ release: () => void }> {
      this.lockedMailbox = mailbox;
      return {
        release: () => {
          this.releasedLocks += 1;
        },
      };
    }

    async mailboxOpen(mailbox: string): Promise<void> {
      this.lockedMailbox = mailbox;
    }

    async *fetch(range: unknown, query: unknown, options?: unknown): AsyncGenerator<unknown> {
      this.fetchCalls.push({ range, query, options });
      this.activeFetches += 1;
      try {
        for (const message of imapMock.messages) {
          yield message;
        }
      } finally {
        this.activeFetches -= 1;
      }
    }

    async downloadMany(
      range: string,
      parts: string[],
      options?: unknown,
    ): Promise<Record<string, { content: Buffer | null; meta?: { filename?: string } }>> {
      if (imapMock.downloadManyWhileFetching && this.activeFetches > 0) {
        throw new Error("downloadMany must run after fetch iteration completes");
      }
      this.downloadManyCalls.push({ range, parts, options });
      return imapMock.downloads[range] ?? {};
    }

    async logout(): Promise<void> {
      this.logoutCalls += 1;
    }
  }

  return { ImapFlow };
});

let tempRoot = "";

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "email-source-"));
  imapMock.messages = [];
  imapMock.downloads = {};
  imapMock.connectFailures = [];
  imapMock.downloadManyWhileFetching = false;
  imapMock.instances.length = 0;
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe("email attachments", () => {
  test("accepts supported Excel attachment names only", () => {
    expect(isExcelAttachmentName("订单.xlsx")).toBe(true);
    expect(isExcelAttachmentName("订单.xlsm")).toBe(true);
    expect(isExcelAttachmentName("notes.txt")).toBe(false);
    expect(isExcelAttachmentName("legacy.xls")).toBe(false);
  });

  test("sanitizes attachment names", () => {
    expect(sanitizeAttachmentName("../../订单.xlsx")).toBe("订单.xlsx");
    expect(sanitizeAttachmentName("")).toBe("attachment.xlsx");
  });

  test("saves attachments with deduplicated names", async () => {
    const attachments: EmailAttachment[] = [
      { filename: "../../order.xlsx", content: Buffer.from("one") },
      { filename: "order.xlsx", content: Buffer.from("two") },
    ];

    const files = await saveEmailAttachments(attachments, tempRoot);

    expect(files.map((file) => path.basename(file))).toEqual(["order.xlsx", "order-2.xlsx"]);
    await expect(readFile(files[0], "utf8")).resolves.toBe("one");
    await expect(readFile(files[1], "utf8")).resolves.toBe("two");
  });
});

describe("email message summaries", () => {
  test("summarizes parsed email with Excel attachment metadata", () => {
    const summary = summarizeParsedEmail(
      {
        subject: "PO update",
        date: new Date("2026-06-17T03:30:00.000Z"),
        from: { text: "Orders <orders@example.com>" },
        attachments: [
          { filename: "order.xlsx" },
          { filename: "image.png" },
          { filename: "changes.xlsm" },
        ],
      },
      "105",
    );

    expect(summary).toEqual({
      uid: "105",
      subject: "PO update",
      from: "Orders <orders@example.com>",
      date: "2026-06-17T03:30:00.000Z",
      attachmentCount: 2,
      excelAttachmentNames: ["order.xlsx", "changes.xlsm"],
      hasExcelAttachments: true,
    });
  });

  test("sorts recent emails by message date descending", () => {
    const sorted = sortEmailMessagesByDateDesc([
      {
        uid: "old",
        subject: "old",
        date: "2026-06-15T09:00:00.000Z",
        attachmentCount: 1,
        excelAttachmentNames: ["old.xlsx"],
        hasExcelAttachments: true,
      },
      {
        uid: "missing-date",
        subject: "missing",
        attachmentCount: 1,
        excelAttachmentNames: ["missing.xlsx"],
        hasExcelAttachments: true,
      },
      {
        uid: "new",
        subject: "new",
        date: "2026-06-17T09:00:00.000Z",
        attachmentCount: 1,
        excelAttachmentNames: ["new.xlsx"],
        hasExcelAttachments: true,
      },
    ]);

    expect(sorted.map((message) => message.uid)).toEqual(["new", "old", "missing-date"]);
  });

  test("checks selected message UID filters", () => {
    const selected = new Set(["102", "108"]);

    expect(shouldIncludeMessageUid("102", selected)).toBe(true);
    expect(shouldIncludeMessageUid("103", selected)).toBe(false);
    expect(shouldIncludeMessageUid("103", undefined)).toBe(true);
  });

  test("keeps only Excel attachments that contain order content", async () => {
    const summary = await summarizeParsedOrderEmail(
      {
        subject: "attachments",
        attachments: [
          { filename: "order.xlsx", content: await makeOrderWorkbookBuffer() },
          { filename: "weekly-report.xlsx", content: await makeReportWorkbookBuffer() },
          { filename: "notes.txt", content: Buffer.from("ignore") },
        ],
      },
      "202",
    );

    expect(summary.attachmentCount).toBe(1);
    expect(summary.excelAttachmentNames).toEqual(["order.xlsx"]);
    expect(summary.hasExcelAttachments).toBe(true);
  });

  test("collects order attachments through the shared classifier", async () => {
    const attachments = await collectOrderEmailAttachments(
      {
        subject: "attachments",
        date: new Date("2026-06-17T01:00:00.000Z"),
        attachments: [
          { filename: "order.xlsx", content: await makeOrderWorkbookBuffer() },
          { filename: "weekly-report.xlsx", content: await makeReportWorkbookBuffer() },
        ],
      },
      "303",
    );

    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({
      filename: "order.xlsx",
      messageSubject: "attachments",
      messageUid: "303",
    });
    expect(attachments[0]?.messageDate?.toISOString()).toBe("2026-06-17T01:00:00.000Z");
  });
});

describe("email fetch windows", () => {
  test("includes messages when no cutoff is provided", () => {
    expect(isMessageWithinFetchWindow(undefined, undefined)).toBe(true);
  });

  test("filters messages before cutoff", () => {
    const cutoff = new Date("2026-06-17T00:00:00.000Z");

    expect(isMessageWithinFetchWindow(new Date("2026-06-17T01:00:00.000Z"), cutoff)).toBe(true);
    expect(isMessageWithinFetchWindow(new Date("2026-06-16T23:59:59.000Z"), cutoff)).toBe(false);
  });
});

describe("email IMAP scanning", () => {
  test("always creates a direct verified TLS IMAP client", async () => {
    await verifyImapConnection(testImapConfig());
    expect(imapMock.instances[0]?.options).toMatchObject({
      host: "imap.example.com",
      port: 993,
      secure: true,
      auth: { user: "orders@example.com", pass: "secret" },
      logger: false,
    });
    expect(imapMock.instances[0]).toMatchObject({ connectCalls: 1, lockedMailbox: "INBOX", logoutCalls: 1 });
  });

  test("lists candidate order emails from metadata without fetching full message source", async () => {
    imapMock.messages = [
      makeMetadataMessage({
        uid: 501,
        subject: "PO 501",
        date: new Date("2026-06-17T03:30:00.000Z"),
        attachments: ["order.xlsx", "notes.txt"],
      }),
      makeMetadataMessage({
        uid: 502,
        subject: "No Excel",
        date: new Date("2026-06-17T04:00:00.000Z"),
        attachments: ["photo.png"],
      }),
    ];

    const result = await listRecentEmailMessages(testImapConfig(), {
      days: 7,
      now: new Date("2026-06-18T00:00:00.000Z"),
    });

    expect(result.messages).toEqual([
      {
        uid: "501",
        subject: "PO 501",
        from: "Orders <orders@example.com>",
        date: "2026-06-17T03:30:00.000Z",
        attachmentCount: 1,
        excelAttachmentNames: ["order.xlsx"],
        hasExcelAttachments: true,
      },
    ]);
    expect(result.scannedMessages).toBe(2);
    expect(result.orderAttachmentCount).toBe(1);
    expect(result.nonOrderExcelAttachmentCount).toBe(0);
    expect(imapMock.instances[0]?.fetchCalls).toEqual([
      {
        range: { since: new Date("2026-06-11T00:00:00.000Z") },
        query: { envelope: true, bodyStructure: true, uid: true },
        options: undefined,
      },
    ]);
    expect(imapMock.instances[0]?.downloadManyCalls).toEqual([]);
  });

  test("downloads selected Excel attachment parts before filtering order workbooks", async () => {
    imapMock.downloadManyWhileFetching = true;
    imapMock.messages = [
      makeMetadataMessage({
        uid: 601,
        subject: "PO 601",
        date: new Date("2026-06-17T03:30:00.000Z"),
        attachments: ["order.xlsx", "weekly-report.xlsx", "notes.txt"],
      }),
    ];
    imapMock.downloads = {
      "601": {
        "1": { content: await makeOrderWorkbookBuffer(), meta: { filename: "order.xlsx" } },
        "2": { content: await makeReportWorkbookBuffer(), meta: { filename: "weekly-report.xlsx" } },
      },
    };

    const result = await fetchEmailOrderFiles(testImapConfig(), tempRoot, { messageUids: ["601"] });

    expect(result.scannedMessages).toBe(1);
    expect(result.attachmentCount).toBe(1);
    expect(result.files).toHaveLength(1);
    expect(path.basename(result.files[0] ?? "")).toBe("order.xlsx");
    expect(imapMock.instances[0]?.fetchCalls).toEqual([
      {
        range: "601",
        query: { uid: true, bodyStructure: true, envelope: true },
        options: { uid: true },
      },
    ]);
    expect(imapMock.instances[0]?.downloadManyCalls).toEqual([
      { range: "601", parts: ["1", "2"], options: { uid: true } },
    ]);
  });

  test("retries transient TLS disconnects while fetching selected attachments", async () => {
    imapMock.connectFailures = [new Error("Client network socket disconnected before secure TLS connection was established")];
    imapMock.messages = [
      makeMetadataMessage({
        uid: 701,
        subject: "PO 701",
        date: new Date("2026-06-17T03:30:00.000Z"),
        attachments: ["order.xlsx"],
      }),
    ];
    imapMock.downloads = {
      "701": {
        "1": { content: await makeOrderWorkbookBuffer(), meta: { filename: "order.xlsx" } },
      },
    };

    const result = await fetchEmailOrderFiles(testImapConfig(), tempRoot, { messageUids: ["701"] });

    expect(result.attachmentCount).toBe(1);
    expect(imapMock.instances).toHaveLength(2);
    expect(imapMock.instances[0]?.fetchCalls).toEqual([]);
    expect(imapMock.instances[1]?.fetchCalls).toHaveLength(1);
  });

  test("downloads only unseen candidate UIDs and returns only valid order workbooks", async () => {
    imapMock.messages = [
      makeMetadataMessage({ uid: 101, subject: "PO 101", date: new Date("2026-06-17T03:00:00Z"), attachments: ["known.xlsx"] }),
      makeMetadataMessage({ uid: 102, subject: "PO 102", date: new Date("2026-06-17T04:00:00Z"), attachments: ["order.xlsx"] }),
      makeMetadataMessage({ uid: 103, subject: "Report", date: new Date("2026-06-17T05:00:00Z"), attachments: ["report.xlsx"] }),
    ];
    imapMock.downloads = {
      "102": { "1": { content: await makeOrderWorkbookBuffer(), meta: { filename: "order.xlsx" } } },
      "103": { "1": { content: await makeReportWorkbookBuffer(), meta: { filename: "report.xlsx" } } },
    };

    const result = await listRecentOrderEmailMessages(testImapConfig(), {
      days: 7,
      now: new Date("2026-06-18T00:00:00Z"),
      excludeUids: ["101"],
    });

    expect(result.messages.map((item) => item.uid)).toEqual(["102"]);
    expect(result.messages[0]?.excelAttachmentNames).toEqual(["order.xlsx"]);
    const downloadCalls = imapMock.instances.flatMap((instance) => instance.downloadManyCalls.map((call) => call.range));
    expect(downloadCalls).toEqual(["102", "103"]);
    expect(result.nonOrderExcelAttachmentCount).toBe(1);
  });

  test("rejects order-looking candidates larger than 25 MB before classification", async () => {
    imapMock.messages = [
      makeMetadataMessage({ uid: 104, subject: "Large", date: new Date("2026-06-17T05:00:00Z"), attachments: ["large.xlsx"] }),
    ];
    imapMock.downloads = {
      "104": { "1": { content: Buffer.alloc(MAX_ORDER_ATTACHMENT_BYTES + 1), meta: { filename: "large.xlsx" } } },
    };

    const result = await listRecentOrderEmailMessages(testImapConfig(), {
      days: 7,
      now: new Date("2026-06-18T00:00:00Z"),
    });

    expect(result.messages).toEqual([]);
    expect(result.nonOrderExcelAttachmentCount).toBe(1);
  });
});

async function makeOrderWorkbookBuffer(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Worksheet");
  worksheet.getCell("C1").value = "Job 29698";
  worksheet.getCell("C2").value = "Builder";
  worksheet.getCell("C5").value = "2026-06-15";
  worksheet.getCell("C6").value = "PO-1";
  ["Material", "Stock", "Qty", "Profile", "B/O", "Reveal Height", "Reveal Width"].forEach((value, index) => {
    worksheet.getCell(9, index + 1).value = value;
  });
  worksheet.getCell("A11").value = "1.05mm Zincanneal";
  worksheet.getCell("C11").value = 1;
  worksheet.getCell("D11").value = "Modern";
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function makeReportWorkbookBuffer(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Report");
  worksheet.getCell("A1").value = "普通报表";
  worksheet.getCell("A2").value = "不是订单";
  worksheet.getCell("B2").value = "2026-06-15";
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function testImapConfig(): ImapConfig {
  return {
    email: "orders@example.com",
    authCode: "secret",
    server: "imap.example.com",
    port: 993,
  };
}

function makeMetadataMessage({
  uid,
  subject,
  date,
  attachments,
}: {
  uid: number;
  subject: string;
  date: Date;
  attachments: string[];
}): unknown {
  const message = {
    uid,
    envelope: {
      subject,
      date,
      from: [{ name: "Orders", address: "orders@example.com" }],
    },
    bodyStructure: {
      type: "multipart/mixed",
      childNodes: attachments.map((filename, index) => ({
        part: String(index + 1),
        type: "application/octet-stream",
        dispositionParameters: { filename },
      })),
    },
  };

  Object.defineProperty(message, "source", {
    get() {
      throw new Error("list and attachment-part fetch should not read full message source");
    },
  });

  return message;
}
