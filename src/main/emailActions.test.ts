import { describe, expect, test } from "vitest";

import {
  extractDesktopEmailOrders,
  listDesktopEmails,
  subscribeDesktopEmailUpdates,
  type RemoteEmailClient,
} from "./emailActions.js";
import type { EmailNewMessagesEvent } from "../shared/types.js";

describe("desktop email actions", () => {
  test("uses the remote email API when configured", async () => {
    const remoteCalls: unknown[] = [];
    const remoteClient: RemoteEmailClient = {
      listEmails: async (request) => {
        remoteCalls.push(request);
        return {
          scannedMessages: 1,
          days: request.days ?? 0,
          orderAttachmentCount: 0,
          nonOrderExcelAttachmentCount: 0,
          messages: [],
        };
      },
      extractEmail: async () => {
        throw new Error("extractEmail should not run in this test");
      },
    };

    const result = await listDesktopEmails(
      { email: "orders@example.com", authCode: "mail-auth-code", days: 1 },
      {
        loadRemoteEmailClient: async () => remoteClient,
        listEmailMessages: async () => {
          throw new Error("local IMAP should not run when remote API is configured");
        },
      },
    );

    expect(result.scannedMessages).toBe(1);
    expect(remoteCalls).toEqual([{ email: "orders@example.com", authCode: "mail-auth-code", days: 1 }]);
  });

  test("falls back to local IMAP when the remote API is not configured", async () => {
    const localCalls: unknown[] = [];

    await listDesktopEmails(
      { email: "orders@example.com", authCode: "mail-auth-code", days: 1 },
      {
        loadRemoteEmailClient: async () => undefined,
        listEmailMessages: async (request) => {
          localCalls.push(request);
          return {
            scannedMessages: 2,
            days: request.days ?? 0,
            orderAttachmentCount: 0,
            nonOrderExcelAttachmentCount: 0,
            messages: [],
          };
        },
      },
    );

    expect(localCalls).toEqual([{ email: "orders@example.com", authCode: "mail-auth-code", days: 1 }]);
  });

  test("extracts selected email orders through the remote API when configured", async () => {
    const remoteClient: RemoteEmailClient = {
      listEmails: async () => {
        throw new Error("listEmails should not run in this test");
      },
      extractEmail: async (request) => ({
        emailFetch: {
          files: [],
          scannedMessages: 1,
          attachmentCount: 1,
          downloadDir: "",
        },
        extraction: {
          inputFiles: [],
          rows: [{ values: [request.messageUids?.[0] ?? ""], notes: [], manualCheck: [], sourceFile: "" }],
          skippedFiles: [],
          failures: [],
          outputs: { outputDir: "", csvOutput: "", xlsxOutput: "", auditOutput: "" },
        },
      }),
    };

    const result = await extractDesktopEmailOrders(
      { email: "orders@example.com", authCode: "mail-auth-code", messageUids: ["101"] },
      undefined,
      {
        loadRemoteEmailClient: async () => remoteClient,
        extractEmailOrders: async () => {
          throw new Error("local email extraction should not run when remote API is configured");
        },
      },
    );

    expect(result.extraction.rows[0]?.values[0]).toBe("101");
  });
  test("subscribes to remote new-message events when remote API is configured", async () => {
    let receivedSignal: AbortSignal | undefined;
    let emitEvent: ((event: EmailNewMessagesEvent) => void) | undefined;
    const remoteClient: RemoteEmailClient = {
      listEmails: async () => {
        throw new Error("listEmails should not run in subscription test");
      },
      extractEmail: async () => {
        throw new Error("extractEmail should not run in subscription test");
      },
      subscribeNewMessages: async (onEvent, options) => {
        emitEvent = onEvent;
        receivedSignal = options?.signal;
      },
    };
    const events: string[] = [];

    const subscription = await subscribeDesktopEmailUpdates(
      (event) => {
        events.push(event.messages[0]?.uid ?? "");
      },
      { loadRemoteEmailClient: async () => remoteClient },
    );

    emitEvent?.({ email: "orders@example.com", days: 7, messages: [{ uid: "101" } as any] });
    subscription?.close();

    expect(events).toEqual(["101"]);
    expect(receivedSignal?.aborted).toBe(true);
  });
});
