import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { OrderEmailListOptions } from "../core/emailSource.js";
import { LocalMailboxMonitor, type LocalMailboxMonitorDependencies } from "./localMailboxMonitor.js";
import type { EmailListResult, EmailSettings, ImapConfig } from "../shared/types.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("local mailbox monitor", () => {
  test("scans immediately, then every 15 seconds, without reinserting known UIDs", async () => {
    const fixture = createFixture();
    await fixture.monitor.start();
    await vi.waitFor(() => expect(fixture.scan).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(fixture.openIdle).toHaveBeenCalledOnce());
    expect(fixture.scan.mock.calls[0]?.[1]).toMatchObject({ days: 7, excludeUids: [] });

    await vi.advanceTimersByTimeAsync(15_000);
    await vi.waitFor(() => expect(fixture.scan).toHaveBeenCalledTimes(2));
    expect(fixture.store.knownUids).toHaveBeenCalledTimes(2);
    await fixture.monitor.stop();
  });

  test("opens IDLE without waiting for the initial seven-day scan", async () => {
    const fixture = createFixture();
    let finishScan: ((result: EmailListResult) => void) | undefined;
    fixture.scan.mockImplementationOnce(() => new Promise<EmailListResult>((resolve) => { finishScan = resolve; }));

    await fixture.monitor.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(fixture.scan).toHaveBeenCalledOnce();
    expect(fixture.openIdle).toHaveBeenCalledOnce();
    expect(fixture.monitor.status().state).toBe("connected");

    finishScan?.(emptyEmailList());
    await vi.advanceTimersByTimeAsync(0);
    await fixture.monitor.stop();
  });

  test("scans as soon as IDLE reports a change", async () => {
    const fixture = createFixture();
    await fixture.monitor.start();
    await vi.waitFor(() => expect(fixture.openIdle).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(fixture.store.syncMessages).toHaveBeenCalledOnce());
    fixture.resolveIdle?.("changed");
    await vi.waitFor(() => expect(fixture.scan).toHaveBeenCalledTimes(2));
    await fixture.monitor.stop();
  });

  test("pauses on an authorization error until reconnect", async () => {
    const fixture = createFixture();
    fixture.scan.mockRejectedValueOnce(new Error("AUTHENTICATIONFAILED Invalid credentials"));
    await fixture.monitor.start();
    await vi.waitFor(() => expect(fixture.monitor.status().state).toBe("attention_required"));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fixture.scan).toHaveBeenCalledTimes(1);
    await fixture.monitor.stop();
  });

  test("reconnects after credentials are repaired", async () => {
    const fixture = createFixture();
    fixture.scan.mockRejectedValueOnce(new Error("AUTHENTICATIONFAILED Invalid credentials"));
    await fixture.monitor.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.monitor.status().state).toBe("attention_required");

    await fixture.monitor.reconnect();
    await vi.waitFor(() => expect(fixture.openIdle).toHaveBeenCalledTimes(2));

    expect(fixture.scan).toHaveBeenCalledTimes(2);
    expect(fixture.monitor.status().state).toBe("connected");
    await fixture.monitor.stop();
  });

  test("publishes runtime status to subscribers and supports unsubscribe", async () => {
    const fixture = createFixture();
    const states: string[] = [];
    const unsubscribe = fixture.monitor.subscribe((event) => {
      if (event.type === "status") states.push(event.status.state);
    });

    await fixture.monitor.start();
    await vi.waitFor(() => expect(fixture.openIdle).toHaveBeenCalledOnce());
    expect(states).toContain("connecting");
    expect(states).toContain("connected");
    unsubscribe();
    await fixture.monitor.stop();
    expect(states.at(-1)).toBe("connected");
  });

  test("retries a transient network failure after one second and caps at 60 seconds", async () => {
    const fixture = createFixture();
    fixture.scan.mockRejectedValueOnce(new Error("ETIMEDOUT"));
    await fixture.monitor.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.monitor.status().state).toBe("offline");
    expect(fixture.scan).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(fixture.scan).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(fixture.scan).toHaveBeenCalledTimes(2));
    await fixture.monitor.stop();
  });

  test("runs an immediate recovery scan on resume", async () => {
    const fixture = createFixture();
    await fixture.monitor.start();
    await vi.waitFor(() => expect(fixture.openIdle).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(fixture.store.syncMessages).toHaveBeenCalledOnce());
    await fixture.monitor.handleResume();
    expect(fixture.scan).toHaveBeenCalledTimes(2);
    await fixture.monitor.stop();
  });
});

function createFixture() {
  const credentials: EmailSettings = { email: "orders@example.com", authCode: "secret" };
  const scan = vi.fn(async (_config: ImapConfig, _options: OrderEmailListOptions): Promise<EmailListResult> => emptyEmailList());
  let resolveIdle: ((value: "changed" | "closed") => void) | undefined;
  const idleClose = vi.fn(async () => undefined);
  const openIdle = vi.fn(async () => ({
    waitForChange: vi.fn(() => new Promise<"changed" | "closed">((resolve) => { resolveIdle = resolve; })),
    close: idleClose,
  }));
  const store = {
    knownUids: vi.fn((): string[] => []),
    syncMessages: vi.fn(() => ({ inserted: [], initialSync: false })),
    prune: vi.fn(() => 0),
  };
  const dependencies = {
    loadCredentials: vi.fn(async () => credentials),
    scan,
    openIdle,
    store,
    random: () => 0.5,
  } as unknown as LocalMailboxMonitorDependencies;
  return {
    monitor: new LocalMailboxMonitor(dependencies),
    scan,
    openIdle,
    store,
    get resolveIdle() {
      return resolveIdle;
    },
  };
}

function emptyEmailList(): EmailListResult {
  return {
    messages: [],
    scannedMessages: 1,
    days: 7,
    orderAttachmentCount: 0,
    nonOrderExcelAttachmentCount: 0,
  };
}
