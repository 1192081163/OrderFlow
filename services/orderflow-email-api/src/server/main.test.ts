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

  test("broadcasts new default mailbox messages after background refresh", async () => {
    let calls = 0;
    activeServer = await startEmailApiServer({
      config: { ...testConfig(), cacheRefreshMs: 20 },
      listEmailMessages: async (request) => {
        calls += 1;
        return {
          days: request.days ?? 0,
          scannedMessages: calls,
          orderAttachmentCount: calls,
          nonOrderExcelAttachmentCount: 0,
          messages: [
            {
              uid: `uid-${calls}`,
              subject: `PO ${calls}`,
              attachmentCount: 1,
              excelAttachmentNames: [`order-${calls}.xlsx`],
              hasExcelAttachments: true,
            },
          ],
        };
      },
    });
    await waitFor(() => calls === 1);

    const controller = new AbortController();
    const response = await fetch(`${serverUrl(activeServer)}/api/email/events`, {
      headers: { authorization: "Bearer token" },
      signal: controller.signal,
    });
    expect(response.status).toBe(200);

    try {
      await expect(readNextSseEvent(response)).resolves.toContain('"uid":"uid-2"');
    } finally {
      controller.abort();
    }
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

function serverUrl(server: Server): string {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not bind to TCP port.");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function readNextSseEvent(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Response body is not readable.");
  }
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    text += decoder.decode(value, { stream: true });
    const eventEnd = text.indexOf("\n\n");
    if (eventEnd === -1) {
      continue;
    }
    const eventText = text.slice(0, eventEnd + 2);
    if (!eventText.startsWith(":")) {
      return eventText;
    }
    text = text.slice(eventEnd + 2);
  }
  return text;
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
