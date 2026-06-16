import path from "node:path";
import { describe, expect, test } from "vitest";

import {
  buildImapConfig,
  extractEmailOrders,
  extractLocalOrders,
  timestampedDownloadDir,
  type EmailExtractionRequest,
} from "./extractionService.js";

describe("extraction service", () => {
  test("builds a default enterprise WeChat IMAP config", () => {
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

  test("fetches email files before running extraction", async () => {
    const calls: string[] = [];
    const request: EmailExtractionRequest = {
      email: "orders@example.com",
      authCode: "secret",
      inferManual: false,
      hours: 48,
      downloadDir: "/tmp/orders",
    };

    const result = await extractEmailOrders(request, undefined, {
      fetchEmailOrderFiles: async (config, downloadDir, options) => {
        calls.push(`fetch:${config.email}:${downloadDir}:${options?.hours}`);
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

    expect(calls).toEqual(["fetch:orders@example.com:/tmp/orders:48", "extract:/tmp/orders/order.xlsx:false:false"]);
    expect(result.emailFetch.attachmentCount).toBe(1);
    expect(result.extraction.inputFiles).toEqual(["/tmp/orders/order.xlsx"]);
  });

  test("runs local extraction through the configured extraction runner", async () => {
    const calls: string[] = [];

    const result = await extractLocalOrders(
      { paths: [" /tmp/orders/order.xlsx "], recursive: true, inferManual: false },
      undefined,
      {
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
      },
    );

    expect(calls).toEqual(["extract:/tmp/orders/order.xlsx:true:false"]);
    expect(result.inputFiles).toEqual(["/tmp/orders/order.xlsx"]);
  });
});
