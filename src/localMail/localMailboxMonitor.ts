import { listRecentOrderEmailMessages } from "../core/emailSource.js";
import { buildImapConfig } from "../core/extractionService.js";
import type { EmailSettings, LocalMailMessageSummary, LocalMailRuntimeStatus } from "../shared/types.js";
import { openImapIdleConnection, type ImapIdleConnection } from "./imapIdleConnection.js";
import type { LocalMailStore } from "./localMailStore.js";

const FALLBACK_SCAN_MS = 15_000;

export type LocalMailboxMonitorEvent =
  | { type: "messages-synced"; messages: LocalMailMessageSummary[]; initialSync: boolean }
  | { type: "status"; status: LocalMailRuntimeStatus };

export interface LocalMailboxMonitorDependencies {
  loadCredentials(): Promise<EmailSettings>;
  scan: typeof listRecentOrderEmailMessages;
  openIdle: typeof openImapIdleConnection;
  store: Pick<LocalMailStore, "knownUids" | "syncMessages" | "prune">;
  random?: () => number;
}

export class LocalMailboxMonitor {
  private readonly subscribers = new Set<(event: LocalMailboxMonitorEvent) => void>();
  private readonly random: () => number;
  private running = false;
  private pausedForAuth = false;
  private controller?: AbortController;
  private idle?: ImapIdleConnection;
  private scanInFlight?: Promise<void>;
  private currentStatus: LocalMailRuntimeStatus = { state: "stopped", detail: "邮箱监听未启动" };

  constructor(private readonly dependencies: LocalMailboxMonitorDependencies) {
    this.random = dependencies.random ?? Math.random;
  }

  status(): LocalMailRuntimeStatus {
    return { ...this.currentStatus };
  }

  subscribe(listener: (event: LocalMailboxMonitorEvent) => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    this.pausedForAuth = false;
    this.controller = new AbortController();
    void this.run(this.controller.signal);
  }

  async stop(): Promise<void> {
    this.running = false;
    this.controller?.abort();
    await this.idle?.close();
    this.idle = undefined;
    this.setStatus({ state: "stopped", detail: "邮箱监听已停止" });
  }

  async reconnect(): Promise<void> {
    await this.stop();
    await this.start();
  }

  async refreshNow(): Promise<void> {
    if (this.pausedForAuth) {
      throw new Error("邮箱授权已失效，请重新登录。");
    }
    await this.scanOnce();
  }

  async handleResume(): Promise<void> {
    if (this.running && !this.pausedForAuth) {
      await this.scanOnce();
    }
  }

  private async run(signal: AbortSignal): Promise<void> {
    let attempt = 0;
    while (this.running && !signal.aborted) {
      try {
        this.setStatus({ state: "connecting", detail: "正在连接企业邮箱" });
        const credentials = await this.dependencies.loadCredentials();
        const config = buildImapConfig(credentials);
        const initialScan = this.scanOnce();
        void initialScan.catch(() => undefined);
        this.idle = await this.dependencies.openIdle(config);
        attempt = 0;
        this.setStatus({ state: "connected", detail: "邮箱已连接", lastSyncAt: new Date().toISOString() });
        await initialScan;
        while (this.running && !signal.aborted) {
          const reason = await waitForChangeOrFallback(this.idle, signal);
          if (reason === "closed") {
            throw new Error("IMAP connection closed");
          }
          await this.scanOnce();
        }
      } catch (error) {
        await this.idle?.close();
        this.idle = undefined;
        if (!this.running || signal.aborted) {
          return;
        }
        if (isAuthenticationError(error)) {
          this.pausedForAuth = true;
          this.setStatus({ state: "attention_required", detail: "邮箱授权已失效，请重新登录" });
          return;
        }
        this.setStatus({ state: "offline", detail: "网络不可用，正在显示本地缓存" });
        const base = Math.min(60_000, 1_000 * 2 ** attempt);
        attempt += 1;
        const jittered = Math.round(base * (0.75 + this.random() * 0.5));
        await delay(jittered, signal);
      }
    }
  }

  private scanOnce(): Promise<void> {
    if (this.scanInFlight) {
      return this.scanInFlight;
    }
    this.scanInFlight = (async () => {
      const credentials = await this.dependencies.loadCredentials();
      if (!credentials.email || !credentials.authCode) {
        throw new Error("请先登录企业邮箱。");
      }
      const known = this.dependencies.store.knownUids(credentials.email);
      const result = await this.dependencies.scan(buildImapConfig(credentials), { days: 7, excludeUids: known });
      const synced = this.dependencies.store.syncMessages(credentials.email, result);
      this.dependencies.store.prune();
      if (synced.inserted.length > 0) {
        this.emit({ type: "messages-synced", messages: synced.inserted, initialSync: synced.initialSync });
      }
      this.setStatus({ state: "connected", detail: "邮箱已连接", lastSyncAt: new Date().toISOString() });
    })().finally(() => {
      this.scanInFlight = undefined;
    });
    return this.scanInFlight;
  }

  private setStatus(status: LocalMailRuntimeStatus): void {
    this.currentStatus = status;
    this.emit({ type: "status", status: { ...status } });
  }

  private emit(event: LocalMailboxMonitorEvent): void {
    for (const subscriber of this.subscribers) {
      subscriber(event);
    }
  }
}

function isAuthenticationError(error: unknown): boolean {
  return /AUTHENTICATIONFAILED|Invalid credentials|authentication failed|authorization|授权|重新登录|安全存储不可用/i.test(
    error instanceof Error ? error.message : String(error),
  );
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(done, milliseconds);
    const onAbort = () => done();
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve();
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function waitForChangeOrFallback(
  idle: ImapIdleConnection,
  parentSignal: AbortSignal,
): Promise<"changed" | "closed" | "fallback"> {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  parentSignal.addEventListener("abort", onParentAbort, { once: true });
  try {
    return await Promise.race([
      idle.waitForChange(controller.signal),
      delay(FALLBACK_SCAN_MS, controller.signal).then(() => "fallback" as const),
    ]);
  } finally {
    controller.abort();
    parentSignal.removeEventListener("abort", onParentAbort);
  }
}
