import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { loadRemoteEmailApiConfig, RemoteEmailApiClient } from "./remoteEmailApi.js";

let activeServer: Server | undefined;

afterEach(async () => {
  if (!activeServer?.listening) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    activeServer?.close((error) => (error ? reject(error) : resolve()));
  });
  activeServer = undefined;
});

describe("remote email API client", () => {
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

  test("clears server-side output paths from remote extraction results", async () => {
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

    const client = new RemoteEmailApiClient({ baseUrl });
    const result = await client.extractEmail({
      email: "orders@example.com",
      authCode: "mail-auth-code",
      messageUids: ["101"],
      inferManual: true,
    });

    expect(result.emailFetch.attachmentCount).toBe(1);
    expect(result.extraction.rows).toHaveLength(1);
    expect(result.extraction.outputs).toEqual({
      outputDir: "",
      csvOutput: "",
      xlsxOutput: "",
      auditOutput: "",
    });
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
});

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

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(",") : value;
}
