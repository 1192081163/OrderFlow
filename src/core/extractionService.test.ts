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
    const request: EmailExtractionRequest = {
      email: "orders@example.com",
      authCode: "secret",
      inferManual: false,
      hours: 168,
      messageUids: ["102", "108"],
      downloadDir: "/tmp/orders",
    };

    const result = await extractEmailOrders(request, undefined, {
      fetchEmailOrderFiles: async (config, downloadDir, options) => {
        calls.push(`fetch:${config.email}:${downloadDir}:${options?.hours}:${options?.messageUids?.join("|")}`);
        return {
          files: ["/tmp/orders/order.xlsx"],
          scannedMessages: 3,
          attachmentCount: 1,
          downloadDir,
        };
      },
      runOrderExtraction: async (paths, options) => {
        calls.push(`extract:${paths.join(",")}:${options?.recursive}:${options?.inferManual}`);
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
  });

  test("lists recent email messages with default one-week window", async () => {
    const result = await listEmailMessages(
      {
        email: " orders@example.com ",
        authCode: " secret ",
      },
      {
        listRecentEmailMessages: async (config, options) => ({
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
        runOrderExtraction: async (paths, options) => ({
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
