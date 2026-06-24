import type { Server } from "node:http";
import { afterEach, describe, expect, test } from "vitest";

import { createEmailApiServer } from "./emailApiServer.js";
import type { EmailApiConfig } from "./emailApiConfig.js";
import { EmailEventHub } from "./emailEventHub.js";

let activeServer: Server | undefined;

afterEach(async () => {
  if (activeServer?.listening) {
    await new Promise<void>((resolve, reject) => {
      activeServer?.close((error) => (error ? reject(error) : resolve()));
    });
  }
  activeServer = undefined;
});

describe("standalone email API server events", () => {
  test("streams new-message events to authorized subscribers", async () => {
    const emailEvents = new EmailEventHub();
    activeServer = createEmailApiServer({
      config: testConfig(),
      emailEvents,
    });
    const baseUrl = await listen(activeServer);

    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/email/events`, {
      headers: { authorization: "Bearer token" },
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const eventTextPromise = readNextSseEvent(response);
    emailEvents.broadcastNewMessages({
      email: "orders@example.com",
      days: 7,
      messages: [
        {
          uid: "101",
          subject: "PO 101",
          from: "Orders <orders@example.com>",
          date: "2026-06-24T00:00:00.000Z",
          attachmentCount: 1,
          excelAttachmentNames: ["order.xlsx"],
          hasExcelAttachments: true,
        },
      ],
    });

    try {
      await expect(eventTextPromise).resolves.toContain('"uid":"101"');
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

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
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
