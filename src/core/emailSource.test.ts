import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { loadEmailSettings, saveEmailSettings } from "./settings.js";
import {
  isExcelAttachmentName,
  isMessageWithinFetchWindow,
  saveEmailAttachments,
  sanitizeAttachmentName,
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
    expect(await readFile(files[0], "utf8")).toBe("one");
    expect(await readFile(files[1], "utf8")).toBe("two");
  });

  test("filters messages by exact parsed date when a fetch window is provided", () => {
    const cutoff = new Date("2026-06-16T08:00:00.000Z");

    expect(isMessageWithinFetchWindow(new Date("2026-06-16T07:59:59.000Z"), cutoff)).toBe(false);
    expect(isMessageWithinFetchWindow(new Date("2026-06-16T08:00:00.000Z"), cutoff)).toBe(true);
    expect(isMessageWithinFetchWindow(new Date("2026-06-16T09:00:00.000Z"), cutoff)).toBe(true);
    expect(isMessageWithinFetchWindow(undefined, cutoff)).toBe(true);
    expect(isMessageWithinFetchWindow(new Date("2026-06-15T00:00:00.000Z"), undefined)).toBe(true);
  });
});
