import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { loadEmailSettings, saveEmailSettings } from "./settings.js";
import {
  isExcelAttachmentName,
  isMessageWithinFetchWindow,
  saveEmailAttachments,
  sanitizeAttachmentName,
  shouldIncludeMessageUid,
  sortEmailMessagesByDateDesc,
  summarizeParsedEmail,
  summarizeParsedOrderEmail,
  type EmailAttachment,
} from "./emailSource.js";

let tempRoot = "";

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "email-source-"));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe("email settings", () => {
  test("round trips settings", async () => {
    const settingsPath = path.join(tempRoot, "settings.json");
    await saveEmailSettings({ email: "user@example.com", authCode: "secret" }, settingsPath);

    expect(await loadEmailSettings(settingsPath)).toEqual({ email: "user@example.com", authCode: "secret" });
  });
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
