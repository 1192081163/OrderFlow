import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import ExcelJS from "exceljs";
import { afterEach, describe, expect, test, vi } from "vitest";

import { loadRemoteEmailApiConfig, RemoteEmailApiClient } from "./remoteEmailApi.js";

let activeServer: Server | undefined;

afterEach(async () => {
  vi.unstubAllGlobals();
  if (!activeServer?.listening) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    activeServer?.close((error) => (error ? reject(error) : resolve()));
  });
  activeServer = undefined;
});

describe("remote email API client", () => {
  test("wraps remote extraction network failures with clear message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const client = new RemoteEmailApiClient({ baseUrl: "http://127.0.0.1:9", token: "api-token" });

    await expect(
      client.extractEmail({
        email: "orders@example.com",
        authCode: "mail-auth-code",
        messageUids: ["123"],
        hours: 24,
      }),
    ).rejects.toThrow("无法连接远程邮件服务 http://127.0.0.1:9，请检查服务地址、网络连接或远程服务是否已启动。");
  });

  test("posts mailbox credentials to the remote message endpoint", async () => {
    const received: Array<{ url?: string; authorization?: string; body: unknown }> = [];
    const baseUrl = await listenWithJsonHandler(async (request, body) => {
      received.push({
        url: request.url,
        authorization: headerValue(request.headers.authorization),
        body,
      });
      return {
        scannedMessages: 1,
        days: 1,
        orderAttachmentCount: 0,
        nonOrderExcelAttachmentCount: 0,
        messages: [],
      };
    });

    const client = new RemoteEmailApiClient({ baseUrl, token: "api-token" });
    const result = await client.listEmails({
      email: "orders@example.com",
      authCode: "mail-auth-code",
      days: 1,
    });

    expect(result.scannedMessages).toBe(1);
    expect(received).toEqual([
      {
        url: "/api/email/messages",
        authorization: "Bearer api-token",
        body: {
          email: "orders@example.com",
          authCode: "mail-auth-code",
          days: 1,
        },
      },
    ]);
  });

  test("writes remote email extraction outputs locally", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "remote-email-extract-"));
    const baseUrl = await listenWithJsonHandler(async () => ({
      emailFetch: {
        files: ["/server/downloads/order.xlsx"],
        scannedMessages: 1,
        attachmentCount: 1,
        downloadDir: "/server/downloads",
      },
      extraction: {
        inputFiles: ["/server/downloads/order.xlsx"],
        rows: [{ values: ["2026-06-24"], notes: [], manualCheck: [], sourceFile: "order.xlsx" }],
        skippedFiles: [],
        failures: [],
        outputs: {
          outputDir: "/server/output",
          csvOutput: "/server/output/orders.csv",
          xlsxOutput: "/server/output/orders.xlsx",
          auditOutput: "/server/output/audit.csv",
        },
      },
    }));

    const client = new RemoteEmailApiClient({ baseUrl }, { emailOutputRoot: tempDir, now: () => new Date(2026, 5, 24, 10, 11, 12) });
    const result = await client.extractEmail({
      email: "orders@example.com",
      authCode: "mail-auth-code",
      messageUids: ["101"],
      inferManual: true,
    });

    expect(result.emailFetch.attachmentCount).toBe(1);
    expect(result.extraction.rows).toHaveLength(1);
    expect(result.extraction.outputs.outputDir).toBe(path.join(tempDir, "20260624-101112", "order_extraction_output"));
    await expect(readFile(result.extraction.outputs.xlsxOutput)).resolves.toBeTruthy();
    await expect(stat(result.extraction.outputs.csvOutput)).rejects.toThrow();
    await expect(stat(result.extraction.outputs.auditOutput)).rejects.toThrow();
  });

  test("uploads local files to remote extraction endpoint and writes local outputs", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "remote-local-extract-"));
    const localFile = path.join(tempDir, "order.xlsx");
    await writeFile(localFile, "excel-content", "utf8");
    const received: Array<{ url?: string; authorization?: string; body: any }> = [];
    const baseUrl = await listenWithJsonHandler(async (request, body) => {
      received.push({ url: request.url, authorization: headerValue(request.headers.authorization), body });
      return {
        inputFiles: ["/server/uploads/order.xlsx"],
        rows: [{ values: ["PO-1"], notes: ["server-rule"], manualCheck: [], sourceFile: "order.xlsx" }],
        skippedFiles: [],
        failures: [],
        outputs: {
          outputDir: "/server/output",
          csvOutput: "/server/output/extracted_job_rows.csv",
          xlsxOutput: "/server/output/orders.xlsx",
          auditOutput: "/server/output/audit.csv",
        },
      };
    });

    const client = new RemoteEmailApiClient({ baseUrl, token: "api-token" });
    const result = await client.extractLocal({ paths: [localFile], inferManual: true });

    expect(received[0]?.url).toBe("/api/orders/extract");
    expect(received[0]?.authorization).toBe("Bearer api-token");
    expect(Buffer.from(received[0]?.body.files[0].contentBase64, "base64").toString("utf8")).toBe("excel-content");
    expect(result.inputFiles).toEqual([localFile]);
    expect(result.outputs.outputDir).toBe(path.join(tempDir, "order_extraction_output"));
    await expect(readFile(result.outputs.xlsxOutput)).resolves.toBeTruthy();
    await expect(stat(result.outputs.csvOutput)).rejects.toThrow();
    await expect(stat(result.outputs.auditOutput)).rejects.toThrow();
  });

  test("sorts remote local extraction outputs by ideal delivery date", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "remote-local-extract-sort-"));
    const localFile = path.join(tempDir, "order.xlsx");
    await writeFile(localFile, "excel-content", "utf8");
    const baseUrl = await listenWithJsonHandler(async () => ({
      inputFiles: ["/server/uploads/order.xlsx"],
      rows: [
        remoteOrderRow("LATE", "2026-06-20"),
        remoteOrderRow("BLANK", ""),
        remoteOrderRow("EARLY", "2026-06-01"),
      ],
      skippedFiles: [],
      failures: [],
      outputs: {
        outputDir: "/server/output",
        csvOutput: "/server/output/extracted_job_rows.csv",
        xlsxOutput: "/server/output/orders.xlsx",
        auditOutput: "/server/output/audit.csv",
      },
    }));

    const client = new RemoteEmailApiClient({ baseUrl, token: "api-token" });
    const result = await client.extractLocal({ paths: [localFile], inferManual: true });

    expect(result.rows.map((row) => row.values[1])).toEqual(["EARLY", "LATE", "BLANK"]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(result.outputs.xlsxOutput);
    const worksheet = workbook.worksheets[0];
    expect([2, 3, 4].map((rowNumber) => worksheet.getCell(rowNumber, 2).value)).toEqual(["EARLY", "LATE", "BLANK"]);
  });

  test("streams new-message events from remote event endpoint", async () => {
    const received: Array<{ url?: string; authorization?: string }> = [];
    const baseUrl = await listenWithRawHandler((request, response) => {
      received.push({
        url: request.url,
        authorization: headerValue(request.headers.authorization),
      });
      response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
      response.write(": connected\n\n");
      response.end(
        `event: new-messages\ndata: ${JSON.stringify({
          email: "orders@example.com",
          days: 7,
          messages: [
            {
              uid: "101",
              subject: "PO 101",
              attachmentCount: 1,
              excelAttachmentNames: ["order.xlsx"],
              hasExcelAttachments: true,
            },
          ],
        })}\n\n`,
      );
    });

    const client = new RemoteEmailApiClient({ baseUrl, token: "api-token" });
    const events: Array<{ email: string; messages: Array<{ uid: string }> }> = [];
    await client.subscribeNewMessages((event) => events.push(event));

    expect(received).toEqual([{ url: "/api/email/events", authorization: "Bearer api-token" }]);
    expect(events[0]?.email).toBe("orders@example.com");
    expect(events[0]?.messages[0]?.uid).toBe("101");
  });

  test("loads hidden remote API settings from environment or local config file", async () => {
    const settingsPath = path.join(tmpdir(), `remote-email-api-${process.pid}.json`);

    expect(
      await loadRemoteEmailApiConfig(
        {
          ORDERFLOW_EMAIL_API_URL: " http://127.0.0.1:8091 ",
          ORDERFLOW_EMAIL_API_TOKEN: " token ",
        },
        settingsPath,
      ),
    ).toEqual({ baseUrl: "http://127.0.0.1:8091", token: "token" });
  });

  test("loads packaged remote API settings when local config file is missing", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "remote-email-api-"));
    const missingSettingsPath = path.join(tempDir, "missing.json");
    const packagedSettingsPath = path.join(tempDir, "packaged.json");
    await writeFile(
      packagedSettingsPath,
      JSON.stringify({ baseUrl: " http://127.0.0.1:8091 ", token: " packaged-token " }),
      "utf8",
    );

    await expect(loadRemoteEmailApiConfig({}, missingSettingsPath, packagedSettingsPath)).resolves.toEqual({
      baseUrl: "http://127.0.0.1:8091",
      token: "packaged-token",
    });
  });

  test("prefers local remote API settings over packaged defaults", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "remote-email-api-"));
    const settingsPath = path.join(tempDir, "local.json");
    const packagedSettingsPath = path.join(tempDir, "packaged.json");
    await writeFile(settingsPath, JSON.stringify({ baseUrl: "http://local.test", token: "local-token" }), "utf8");
    await writeFile(
      packagedSettingsPath,
      JSON.stringify({ baseUrl: "http://packaged.test", token: "packaged-token" }),
      "utf8",
    );

    await expect(loadRemoteEmailApiConfig({}, settingsPath, packagedSettingsPath)).resolves.toEqual({
      baseUrl: "http://local.test",
      token: "local-token",
    });
  });
});

function remoteOrderRow(po: string, idealDate: string) {
  const values = Array.from<string | number | null>({ length: 24 }).fill(null);
  values[1] = po;
  values[14] = idealDate || null;
  return { values, notes: [], manualCheck: [], sourceFile: `${po}.xlsx` };
}

async function listenWithJsonHandler(handler: (request: { url?: string; headers: Record<string, string | string[] | undefined> }, body: unknown) => Promise<unknown> | unknown): Promise<string> {
  activeServer = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const text = Buffer.concat(chunks).toString("utf8").trim();
      const body = text ? JSON.parse(text) : {};
      const payload = await handler({ url: request.url, headers: request.headers }, body);
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(payload));
    } catch (error) {
      response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });

  await new Promise<void>((resolve) => activeServer?.listen(0, "127.0.0.1", resolve));
  const address = activeServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not bind to a TCP port.");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function listenWithRawHandler(handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<string> {
  activeServer = createServer(handler);
  await new Promise<void>((resolve) => activeServer?.listen(0, "127.0.0.1", resolve));
  const address = activeServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not bind to TCP port.");
  }
  return `http://127.0.0.1:${address.port}`;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(",") : value;
}
