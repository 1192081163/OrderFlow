import { EventEmitter } from "node:events";
import { describe, expect, test, vi } from "vitest";

import { openImapIdleConnection, type ImapIdleClient } from "./imapIdleConnection.js";
import type { ImapConfig } from "../shared/types.js";

describe("IMAP idle connection", () => {
  test("opens INBOX and resolves when the mailbox count changes", async () => {
    const client = new FakeIdleClient();
    const connection = await openImapIdleConnection(config(), () => client);
    const changed = connection.waitForChange(new AbortController().signal);

    client.emit("exists", { count: 2, prevCount: 1 });

    await expect(changed).resolves.toBe("changed");
    expect(client.connect).toHaveBeenCalledOnce();
    expect(client.mailboxOpen).toHaveBeenCalledWith("INBOX");
    await connection.close();
  });

  test("resolves closed on abort and logs out exactly once", async () => {
    const client = new FakeIdleClient();
    const connection = await openImapIdleConnection(config(), () => client);
    const controller = new AbortController();
    const waiting = connection.waitForChange(controller.signal);
    controller.abort();

    await expect(waiting).resolves.toBe("closed");
    await connection.close();
    await connection.close();
    expect(client.logout).toHaveBeenCalledOnce();
  });

  test("rejects a named network error and removes listeners", async () => {
    const client = new FakeIdleClient();
    const connection = await openImapIdleConnection(config(), () => client);
    const waiting = connection.waitForChange(new AbortController().signal);
    client.emit("error", new Error("socket hang up"));
    await expect(waiting).rejects.toThrow("socket hang up");
    await connection.close();
    expect(client.listenerCount("exists")).toBe(0);
  });
});

class FakeIdleClient extends EventEmitter implements ImapIdleClient {
  connect = vi.fn(async () => undefined);
  mailboxOpen = vi.fn(async () => undefined);
  logout = vi.fn(async () => undefined);
}

function config(): ImapConfig {
  return { email: "orders@example.com", authCode: "secret", server: "imap.exmail.qq.com", port: 993 };
}
