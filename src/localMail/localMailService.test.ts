import { describe, expect, test, vi } from "vitest";

import type { EmailExtractionResult } from "../core/extractionService.js";
import type { ExtractionFailure, LocalMailMessageSummary, LocalMailRuntimeStatus } from "../shared/types.js";
import type { LocalMailboxMonitorEvent } from "./localMailboxMonitor.js";
import { LocalMailService, type LocalMailServiceDependencies } from "./localMailService.js";

describe("local mail service", () => {
  test("verifies new credentials before encrypting and enables login startup", async () => {
    const fixture = createFixture();
    await fixture.service.saveSettings({ email: " orders@example.com ", authCode: "new-secret", startAtLogin: true });
    expect(fixture.verify).toHaveBeenCalledWith({
      email: "orders@example.com",
      authCode: "new-secret",
      server: "imap.exmail.qq.com",
      port: 993,
    });
    expect(fixture.verify.mock.invocationCallOrder[0]).toBeLessThan(fixture.credentials.save.mock.invocationCallOrder[0]!);
    expect(fixture.setStartAtLogin).toHaveBeenCalledWith(true);
    expect(fixture.monitor.reconnect).toHaveBeenCalledOnce();
  });

  test("starts the background monitor only when encrypted credentials exist", async () => {
    const fixture = createFixture();
    await fixture.service.start();
    expect(fixture.monitor.start).toHaveBeenCalledOnce();
    fixture.credentials.loadView.mockResolvedValueOnce({ email: "", hasAuthCode: false, startAtLogin: true });
    const second = new LocalMailService(fixture.dependencies);
    await second.start();
    expect(fixture.monitor.start).toHaveBeenCalledOnce();
  });

  test("shows each inserted order-mail notification once and emits a cache view", async () => {
    const fixture = createFixture();
    const events: string[] = [];
    fixture.service.subscribe((event) => events.push(event.type));
    await fixture.service.start();
    fixture.store.listUnnotified.mockReturnValue([message("101")]);
    fixture.emitMonitor({ type: "messages-synced", messages: [message("101")], initialSync: false });
    await vi.waitFor(() => expect(fixture.notify).toHaveBeenCalledOnce());
    expect(fixture.store.markNotified).toHaveBeenCalledWith("orders@example.com", ["101"]);
    expect(events).toContain("messages-updated");
  });

  test("fills the first seven-day cache without historical notifications", async () => {
    const fixture = createFixture();
    const events: string[] = [];
    fixture.service.subscribe((event) => events.push(event.type));
    await fixture.service.start();
    fixture.emitMonitor({ type: "messages-synced", messages: [message("101")], initialSync: true });
    await vi.waitFor(() => expect(events).toContain("messages-updated"));
    expect(fixture.notify).not.toHaveBeenCalled();
  });

  test("extracts only explicitly selected UIDs and marks success", async () => {
    const fixture = createFixture();
    await fixture.service.extractEmail({ messageUids: ["101"], inferManual: true });
    expect(fixture.extract).toHaveBeenCalledWith(
      expect.objectContaining({ email: "orders@example.com", authCode: "secret", messageUids: ["101"], hours: 168 }),
      undefined,
    );
    expect(fixture.store.markExtracted).toHaveBeenCalledWith("orders@example.com", ["101"]);
  });

  test("does not mark selected UIDs when extraction reports any failure", async () => {
    const fixture = createFixture();
    fixture.extract.mockResolvedValueOnce(emailExtractionResult([{ path: "order.xlsx", error: "invalid workbook" }]));
    await fixture.service.extractEmail({ messageUids: ["101"] });
    expect(fixture.store.markExtracted).not.toHaveBeenCalled();
  });
});

function createFixture() {
  let monitorSubscriber: ((event: LocalMailboxMonitorEvent) => void) | undefined;
  const credentials = {
    loadView: vi.fn(async () => ({ email: "orders@example.com", hasAuthCode: true, startAtLogin: true })),
    loadCredentials: vi.fn(async () => ({ email: "orders@example.com", authCode: "secret" })),
    save: vi.fn(async (input: { email: string; authCode?: string; startAtLogin: boolean }) => ({
      email: input.email.trim(),
      hasAuthCode: true,
      startAtLogin: input.startAtLogin,
    })),
  };
  const store = {
    listMessages: vi.fn((): LocalMailMessageSummary[] => [message("101")]),
    listUnnotified: vi.fn((): LocalMailMessageSummary[] => []),
    markNotified: vi.fn(),
    markExtracted: vi.fn(),
    lastSyncAt: vi.fn(() => "2026-07-13T00:00:00Z"),
    lastScannedMessages: vi.fn(() => 1),
  };
  const connected: LocalMailRuntimeStatus = { state: "connected", detail: "邮箱已连接" };
  const monitor = {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    refreshNow: vi.fn(async () => undefined),
    reconnect: vi.fn(async () => undefined),
    status: vi.fn(() => connected),
    subscribe: vi.fn((listener: (event: LocalMailboxMonitorEvent) => void) => {
      monitorSubscriber = listener;
      return () => {
        monitorSubscriber = undefined;
      };
    }),
  };
  const verify = vi.fn(async () => undefined);
  const extract = vi.fn(async (): Promise<EmailExtractionResult> => emailExtractionResult([]));
  const notify = vi.fn(async () => true);
  const setStartAtLogin = vi.fn();
  const dependencies: LocalMailServiceDependencies = {
    credentials,
    store,
    monitor,
    verify,
    extract,
    notify,
    setStartAtLogin,
  };
  return {
    dependencies,
    service: new LocalMailService(dependencies),
    credentials,
    store,
    monitor,
    verify,
    extract,
    notify,
    setStartAtLogin,
    emitMonitor(event: LocalMailboxMonitorEvent) {
      monitorSubscriber?.(event);
    },
  };
}

function message(uid: string): LocalMailMessageSummary {
  return {
    uid,
    subject: `PO ${uid}`,
    from: "orders@example.com",
    date: "2026-07-13T00:00:00Z",
    attachmentCount: 1,
    excelAttachmentNames: [`${uid}.xlsx`],
    hasExcelAttachments: true,
    extracted: false,
  };
}

function emailExtractionResult(failures: ExtractionFailure[]): EmailExtractionResult {
  return {
    emailFetch: { files: ["order.xlsx"], scannedMessages: 1, attachmentCount: 1, downloadDir: "/tmp/mail" },
    extraction: {
      inputFiles: ["order.xlsx"],
      rows: [],
      skippedFiles: [],
      failures,
      outputs: { outputDir: "/tmp/out", csvOutput: "", xlsxOutput: "/tmp/out/result.xlsx", auditOutput: "" },
    },
  };
}
