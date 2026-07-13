import path from "node:path";
import { describe, expect, test } from "vitest";

import {
  buildImapConfig,
  extractEmailOrders,
  extractLocalOrders,
  listEmailMessages,
  timestampedDownloadDir,
  type EmailExtractionRequest,
} from "./extractionService.js";
import type { ProgressEvent } from "../shared/types.js";

describe("extraction service", () => {
  test("builds default enterprise WeChat IMAP config", () => {
    expect(buildImapConfig({ email: " user@example.com ", authCode: " code " })).toEqual({
      email: "user@example.com",
      authCode: "code",
      server: "imap.exmail.qq.com",
      port: 993,
    });
  });

  test("creates stable timestamped email attachment directories", () => {
    const dir = timestampedDownloadDir(new Date("2026-06-16T03:04:05"));

    expect(path.basename(dir)).toBe("20260616-030405");
    expect(dir).toContain(".order_organizer_assistant");
  });

  test("fetches selected email files before running extraction", async () => {
    const calls: string[] = [];
    const progressEvents: ProgressEvent[] = [];
    const request: EmailExtractionRequest = {
      email: "orders@example.com",
      authCode: "secret",
      inferManual: false,
      hours: 168,
      messageUids: ["102", "108"],
      downloadDir: "/tmp/orders",
    };

    const result = await extractEmailOrders(request, (event) => progressEvents.push(event), {
      fetchEmailOrderFiles: async (config, downloadDir, options) => {
        calls.push(`fetch:${config.email}:${downloadDir}:${options?.hours}:${options?.messageUids?.join("|")}`);
        options?.progress?.({
          index: 1,
          total: 1,
          filename: "order.xlsx",
          status: "running",
          phase: "downloading",
        });
        options?.progress?.({
          index: 1,
          total: 1,
          filename: "order.xlsx",
          status: "completed",
          phase: "downloading",
        });
        return {
          files: ["/tmp/orders/order.xlsx"],
          scannedMessages: 3,
          attachmentCount: 1,
          downloadDir,
        };
      },
      runOrderExtraction: async (paths, options) => {
        calls.push(`extract:${paths.join(",")}:${options?.recursive}:${options?.inferManual}`);
        options?.progress?.({
          index: 1,
          total: 1,
          filename: "order.xlsx",
          status: "running",
          phase: "extracting",
        });
        options?.progress?.({
          index: 1,
          total: 1,
          filename: "order.xlsx",
          status: "completed",
          phase: "extracting",
        });
        options?.progress?.({
          index: 1,
          total: 1,
          filename: "订单整理结果.xlsx",
          status: "running",
          phase: "writing",
        });
        options?.progress?.({
          index: 1,
          total: 1,
          filename: "订单整理结果.xlsx",
          status: "completed",
          phase: "writing",
        });
        return {
          inputFiles: paths,
          rows: [],
          skippedFiles: [],
          failures: [],
          outputs: {
            outputDir: "/tmp/orders",
            csvOutput: "/tmp/orders/out.csv",
            xlsxOutput: "/tmp/orders/out.xlsx",
            auditOutput: "/tmp/orders/audit.csv",
          },
        };
      },
    });

    expect(calls).toEqual([
      "fetch:orders@example.com:/tmp/orders:168:102|108",
      "extract:/tmp/orders/order.xlsx:false:false",
    ]);
    expect(result.emailFetch.attachmentCount).toBe(1);
    expect(progressEvents).toEqual([
      { index: 0, total: 1, filename: "准备提取", status: "running", phase: "preparing", percent: 2 },
      { index: 1, total: 1, filename: "order.xlsx", status: "running", phase: "downloading", percent: 5 },
      { index: 1, total: 1, filename: "order.xlsx", status: "completed", phase: "downloading", percent: 35 },
      { index: 1, total: 1, filename: "order.xlsx", status: "running", phase: "extracting", percent: 35 },
      { index: 1, total: 1, filename: "order.xlsx", status: "completed", phase: "extracting", percent: 95 },
      { index: 1, total: 1, filename: "订单整理结果.xlsx", status: "running", phase: "writing", percent: 96 },
      { index: 1, total: 1, filename: "订单整理结果.xlsx", status: "completed", phase: "writing", percent: 99 },
    ]);
  });

  test("lists recent email messages with default one-week window", async () => {
    const result = await listEmailMessages(
      {
        email: " orders@example.com ",
        authCode: " secret ",
      },
      {
      listRecentEmailMessages: async (_config, options) => ({
          scannedMessages: 2,
          messages: [
            {
              uid: "200",
              subject: "today",
              date: options?.now?.toISOString(),
              attachmentCount: 1,
              excelAttachmentNames: ["order.xlsx"],
              hasExcelAttachments: true,
            },
          ],
          days: options?.days ?? 0,
        }),
        now: () => new Date("2026-06-17T08:00:00.000Z"),
      },
    );

    expect(result).toEqual({
      scannedMessages: 2,
      days: 7,
      messages: [
        {
          uid: "200",
          subject: "today",
          date: "2026-06-17T08:00:00.000Z",
          attachmentCount: 1,
          excelAttachmentNames: ["order.xlsx"],
          hasExcelAttachments: true,
        },
      ],
    });
  });

  test("extracts local orders", async () => {
    const result = await extractLocalOrders(
      { paths: [" /tmp/input.xlsx "], recursive: true, inferManual: false },
      undefined,
      {
      runOrderExtraction: async (paths, _options) => ({
          inputFiles: paths,
          rows: [],
          skippedFiles: [],
          failures: [],
          outputs: {
            outputDir: "/tmp/out",
            csvOutput: "/tmp/out/out.csv",
            xlsxOutput: "/tmp/out/out.xlsx",
            auditOutput: "/tmp/out/audit.csv",
          },
        }),
      },
    );

    expect(result.inputFiles).toEqual(["/tmp/input.xlsx"]);
  });
});
