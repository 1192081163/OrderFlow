import { describe, expect, test } from "vitest";

import { CachedEmailMessageService } from "./emailMessageCache.js";
import type { EmailListRequest } from "../core/extractionService.js";
import type { EmailListResult } from "../shared/types.js";

describe("cached email message service", () => {
  test("loads messages on first request and reuses fresh cached results", async () => {
    let calls = 0;
    const service = new CachedEmailMessageService({
      refreshIntervalMs: 60_000,
      listEmailMessages: async () => {
        calls += 1;
        return resultWithMessage(`uid-${calls}`);
      },
      now: () => 1_000,
    });

    const first = await service.list(testRequest());
    const second = await service.list(testRequest());

    expect(first.messages[0]?.uid).toBe("uid-1");
    expect(second.messages[0]?.uid).toBe("uid-1");
    expect(calls).toBe(1);
  });

  test("returns stale cache immediately while refreshing in the background", async () => {
    let now = 1_000;
    let calls = 0;
    let releaseRefresh: (() => void) | undefined;
    let markRefreshStarted: (() => void) | undefined;
    const refreshStarted = new Promise<void>((resolve) => {
      markRefreshStarted = resolve;
    });

    const service = new CachedEmailMessageService({
      refreshIntervalMs: 100,
      listEmailMessages: async () => {
        calls += 1;
        if (calls === 2) {
          markRefreshStarted?.();
          await new Promise<void>((release) => {
            releaseRefresh = release;
          });
        }
        return resultWithMessage(`uid-${calls}`);
      },
      now: () => now,
    });

    const first = await service.list(testRequest());
    now = 1_500;
    const stale = await service.list(testRequest());

    expect(first.messages[0]?.uid).toBe("uid-1");
    expect(stale.messages[0]?.uid).toBe("uid-1");
    await refreshStarted;
    expect(calls).toBe(2);
    releaseRefresh?.();
  });

  test("preloads the default mailbox when started", async () => {
    const seenRequests: EmailListRequest[] = [];
    const service = new CachedEmailMessageService({
      refreshIntervalMs: 60_000,
      defaultRequest: { ...testRequest(), days: 7 },
      listEmailMessages: async (request) => {
        seenRequests.push(request);
        return resultWithMessage("default");
      },
      now: () => 1_000,
    });

    await service.primeDefault();

    expect(seenRequests).toEqual([{ ...testRequest(), days: 7 }]);
    await expect(service.list({ ...testRequest(), days: 7 })).resolves.toMatchObject({
      messages: [{ uid: "default" }],
    });
  });
});

function testRequest(): EmailListRequest {
  return {
    email: "orders@example.com",
    authCode: "secret",
    server: "imap.example.com",
    port: 993,
    proxy: "socks5://127.0.0.1:7891",
    days: 1,
  };
}

function resultWithMessage(uid: string): EmailListResult {
  return {
    scannedMessages: 1,
    days: 1,
    orderAttachmentCount: 1,
    nonOrderExcelAttachmentCount: 0,
    messages: [
      {
        uid,
        subject: "PO",
        date: "2026-06-24T00:00:00.000Z",
        attachmentCount: 1,
        excelAttachmentNames: ["order.xlsx"],
        hasExcelAttachments: true,
      },
    ],
  };
}
