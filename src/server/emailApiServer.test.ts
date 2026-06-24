import type { Server } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { createEmailApiServer, type EmailApiServerDependencies } from "./emailApiServer.js";
import type { EmailApiConfig } from "./emailApiConfig.js";
import { startEmailApiServer } from "./main.js";

let activeServer: Server | undefined;

afterEach(async () => {
  if (activeServer?.listening) {
    await new Promise<void>((resolve, reject) => {
      activeServer?.close((error) => (error ? reject(error) : resolve()));
    });
  }
  activeServer = undefined;
});

describe("email API server", () => {
  test("answers health checks without authentication", async () => {
    const server = createEmailApiServer(testDependencies());

    const response = await request(server, "GET", "/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  test("rejects API calls without bearer token", async () => {
    const server = createEmailApiServer(testDependencies());

    const response = await request(server, "POST", "/api/email/messages", { days: 7 });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Unauthorized" });
  });

  test("lists candidate messages through existing extraction service config", async () => {
    const calls: unknown[] = [];
    const server = createEmailApiServer(
      testDependencies({
        listEmailMessages: async (request) => {
          calls.push(request);
          return {
            days: request.days ?? 7,
            scannedMessages: 2,
            orderAttachmentCount: 1,
            nonOrderExcelAttachmentCount: 0,
            messages: [
              {
                uid: "101",
                subject: "PO 101",
                from: "Orders <orders@example.com>",
                date: "2026-06-17T01:00:00.000Z",
                attachmentCount: 1,
                excelAttachmentNames: ["order.xlsx"],
                hasExcelAttachments: true,
              },
            ],
          };
        },
      }),
    );

    const response = await request(server, "POST", "/api/email/messages", { days: 3 }, "token");

    expect(response.status).toBe(200);
    expect(response.body.messages[0].uid).toBe("101");
    expect(calls).toEqual([
      {
        email: "orders@example.com",
        authCode: "secret",
        server: "imap.example.com",
        port: 1993,
        proxy: "socks5://127.0.0.1:7891",
        days: 3,
      },
    ]);
  });

  test("uses mailbox credentials from request body when provided", async () => {
    const calls: unknown[] = [];
    const server = createEmailApiServer(
      testDependencies({
        listEmailMessages: async (request) => {
          calls.push(request);
          return {
            days: request.days ?? 7,
            scannedMessages: 0,
            orderAttachmentCount: 0,
            nonOrderExcelAttachmentCount: 0,
            messages: [],
          };
        },
      }),
    );

    const response = await request(
      server,
      "POST",
      "/api/email/messages",
      {
        email: " body@example.com ",
        authCode: " body-secret ",
        server: " imap.body.example.com ",
        port: 2993,
        days: 1,
      },
      "token",
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      {
        email: "body@example.com",
        authCode: "body-secret",
        server: "imap.body.example.com",
        port: 2993,
        proxy: "socks5://127.0.0.1:7891",
        days: 1,
      },
    ]);
  });

  test("extracts selected message UIDs through existing extraction service config", async () => {
    const calls: unknown[] = [];
    const server = createEmailApiServer(
      testDependencies({
        extractEmailOrders: async (request) => {
          calls.push(request);
          return {
            emailFetch: {
              files: ["/tmp/orders/order.xlsx"],
              scannedMessages: 1,
              attachmentCount: 1,
              downloadDir: "/tmp/orders",
            },
            extraction: {
              inputFiles: ["/tmp/orders/order.xlsx"],
              rows: [],
              skippedFiles: [],
              failures: [],
              outputs: {
                outputDir: "/tmp/out",
                csvOutput: "/tmp/out/orders.csv",
                xlsxOutput: "/tmp/out/orders.xlsx",
                auditOutput: "/tmp/out/audit.xlsx",
              },
            },
          };
        },
      }),
    );

    const response = await request(
      server,
      "POST",
      "/api/email/extract",
      {
        messageUids: ["101", "102"],
        hours: 168,
        inferManual: false,
      },
      "token",
    );

    expect(response.status).toBe(200);
    expect(response.body.emailFetch.attachmentCount).toBe(1);
    expect(calls).toEqual([
      {
        email: "orders@example.com",
        authCode: "secret",
        server: "imap.example.com",
        port: 1993,
        proxy: "socks5://127.0.0.1:7891",
        messageUids: ["101", "102"],
        hours: 168,
        inferManual: false,
      },
    ]);
  });

  test("extracts server-side order file paths through the shared extraction service", async () => {
    const calls: unknown[] = [];
    const server = createEmailApiServer(
      testDependencies({
        extractLocalOrders: async (request) => {
          calls.push(request);
          return {
            inputFiles: request.paths,
            rows: [],
            skippedFiles: [],
            failures: [],
            outputs: {
              outputDir: "/tmp/out",
              csvOutput: "/tmp/out/orders.csv",
              xlsxOutput: "/tmp/out/orders.xlsx",
              auditOutput: "/tmp/out/audit.xlsx",
            },
          };
        },
      }),
    );

    const response = await request(
      server,
      "POST",
      "/api/orders/extract",
      {
        paths: ["/server/orders/order.xlsx"],
        recursive: true,
        inferManual: false,
      },
      "token",
    );

    expect(response.status).toBe(200);
    expect(response.body.inputFiles).toEqual(["/server/orders/order.xlsx"]);
    expect(calls).toEqual([
      {
        paths: ["/server/orders/order.xlsx"],
        recursive: true,
        inferManual: false,
      },
    ]);
  });

  test("extracts uploaded base64 order files through the shared extraction service", async () => {
    const calls: Array<{ request: unknown; savedContent: string; savedName: string }> = [];
    const server = createEmailApiServer(
      testDependencies({
        extractLocalOrders: async (request) => {
          calls.push({
            request,
            savedContent: await readFile(request.paths[0] ?? "", "utf8"),
            savedName: path.basename(request.paths[0] ?? ""),
          });
          return {
            inputFiles: request.paths,
            rows: [],
            skippedFiles: [],
            failures: [],
            outputs: {
              outputDir: "/tmp/out",
              csvOutput: "/tmp/out/orders.csv",
              xlsxOutput: "/tmp/out/orders.xlsx",
              auditOutput: "/tmp/out/audit.xlsx",
            },
          };
        },
      }),
    );

    const response = await request(
      server,
      "POST",
      "/api/orders/extract",
      {
        files: [
          {
            filename: "../order.xlsx",
            contentBase64: Buffer.from("fake workbook").toString("base64"),
          },
        ],
        inferManual: false,
      },
      "token",
    );

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.savedName).toBe("order.xlsx");
    expect(calls[0]?.savedContent).toBe("fake workbook");
    expect(calls[0]?.request).toMatchObject({
      inferManual: false,
      paths: [expect.stringContaining("order.xlsx")],
    });
  });

  test("rejects malformed JSON request bodies", async () => {
    const server = createEmailApiServer(testDependencies());

    const response = await rawRequest(server, "POST", "/api/email/messages", "{", "token");

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("JSON");
  });

  test("returns 404 for unknown routes", async () => {
    const server = createEmailApiServer(testDependencies());

    const response = await request(server, "POST", "/api/nope", {}, "token");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Not Found" });
  });
});

describe("email API server entrypoint", () => {
  test("starts a listening server from explicit config", async () => {
    const server = await startEmailApiServer({
      config: { ...testConfig(), port: 0 },
      listEmailMessages: async () => ({
        days: 7,
        scannedMessages: 0,
        messages: [],
      }),
      extractEmailOrders: async () => {
        throw new Error("extractEmailOrders should not run in this test");
      },
      log: () => undefined,
    });
    activeServer = server;

    expect(server.listening).toBe(true);
  });
});

function testDependencies(
  overrides: Partial<EmailApiServerDependencies> = {},
): EmailApiServerDependencies {
  return {
    config: testConfig(),
    listEmailMessages: async () => ({
      days: 7,
      scannedMessages: 0,
      messages: [],
    }),
    extractEmailOrders: async () => {
      throw new Error("extractEmailOrders should not run in this test");
    },
    extractLocalOrders: async () => {
      throw new Error("extractLocalOrders should not run in this test");
    },
    ...overrides,
  };
}

function testConfig(): EmailApiConfig {
  return {
    token: "token",
    host: "127.0.0.1",
    port: 8787,
    email: "orders@example.com",
    authCode: "secret",
    server: "imap.example.com",
    imapPort: 1993,
    imapProxy: "socks5://127.0.0.1:7891",
  };
}

async function request(
  server: Server,
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; body: any }> {
  return rawRequest(server, method, path, body === undefined ? undefined : JSON.stringify(body), token);
}

async function rawRequest(
  server: Server,
  method: string,
  path: string,
  body?: string,
  token?: string,
): Promise<{ status: number; body: any }> {
  const baseUrl = await listen(server);
  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body,
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : undefined,
  };
}

async function listen(server: Server): Promise<string> {
  if (!server.listening) {
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    activeServer = server;
  }
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not bind to a TCP port.");
  }
  return `http://127.0.0.1:${address.port}`;
}
