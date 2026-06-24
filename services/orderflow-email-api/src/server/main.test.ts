import type { Server } from "node:http";

import { afterEach, describe, expect, test } from "vitest";

import type { EmailApiConfig } from "./emailApiConfig.js";
import { startEmailApiServer } from "./main.js";
import type { EmailListRequest } from "../core/extractionService.js";

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

describe("standalone email API entrypoint", () => {
  test("preloads the default mailbox cache before list requests need it", async () => {
    const calls: EmailListRequest[] = [];
    activeServer = await startEmailApiServer({
      config: testConfig(),
      listEmailMessages: async (request) => {
        calls.push(request);
        return {
          days: request.days ?? 0,
          scannedMessages: 1,
          orderAttachmentCount: 1,
          nonOrderExcelAttachmentCount: 0,
          messages: [
            {
              uid: "cached",
              subject: "PO",
              attachmentCount: 1,
              excelAttachmentNames: ["order.xlsx"],
              hasExcelAttachments: true,
            },
          ],
        };
      },
    });

    await waitFor(() => calls.length === 1);
    const response = await requestJson(activeServer, "/api/email/messages", { days: 7 }, "token");

    expect(response.status).toBe(200);
    expect(response.body.messages[0].uid).toBe("cached");
    expect(calls).toEqual([
      {
        email: "orders@example.com",
        authCode: "secret",
        server: "imap.example.com",
        port: 1993,
        proxy: "socks5://127.0.0.1:7891",
        days: 7,
      },
    ]);
  });
});

function testConfig(): EmailApiConfig {
  return {
    token: "token",
    host: "127.0.0.1",
    port: 0,
    email: "orders@example.com",
    authCode: "secret",
    server: "imap.example.com",
    imapPort: 1993,
    imapProxy: "socks5://127.0.0.1:7891",
    cacheDays: 7,
    cacheRefreshMs: 60_000,
  };
}

async function requestJson(server: Server, path: string, body: unknown, token: string): Promise<{ status: number; body: any }> {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not bind to a TCP port.");
  }

  const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: JSON.parse(await response.text()),
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition.");
}
