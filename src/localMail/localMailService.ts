import { verifyImapConnection } from "../core/emailSource.js";
import { buildImapConfig, extractEmailOrders, type EmailExtractionResult } from "../core/extractionService.js";
import type {
  LocalEmailExtractionRequest,
  LocalMailEvent,
  LocalMailListResult,
  LocalMailMessageSummary,
  LocalMailRuntimeStatus,
  LocalMailSettingsView,
  ProgressEvent,
  SaveLocalMailSettingsInput,
} from "../shared/types.js";
import type { LocalMailCredentialStore } from "./localMailCredentialStore.js";
import type { LocalMailboxMonitor, LocalMailboxMonitorEvent } from "./localMailboxMonitor.js";
import type { LocalMailStore } from "./localMailStore.js";

export interface LocalMailServiceDependencies {
  credentials: Pick<LocalMailCredentialStore, "loadView" | "loadCredentials" | "save">;
  store: Pick<
    LocalMailStore,
    "listMessages" | "listUnnotified" | "markNotified" | "markExtracted" | "lastSyncAt" | "lastScannedMessages"
  >;
  monitor: Pick<LocalMailboxMonitor, "start" | "stop" | "refreshNow" | "reconnect" | "status" | "subscribe">;
  verify?: typeof verifyImapConnection;
  extract?: typeof extractEmailOrders;
  notify(messages: LocalMailMessageSummary[]): Promise<boolean>;
  setStartAtLogin(enabled: boolean): void;
  reportBackgroundError?(error: unknown): void;
}

export class LocalMailService {
  private readonly subscribers = new Set<(event: LocalMailEvent) => void>();
  private readonly verify: typeof verifyImapConnection;
  private readonly extract: typeof extractEmailOrders;
  private readonly reportBackgroundError: (error: unknown) => void;
  private unsubscribeMonitor?: () => void;

  constructor(private readonly dependencies: LocalMailServiceDependencies) {
    this.verify = dependencies.verify ?? verifyImapConnection;
    this.extract = dependencies.extract ?? extractEmailOrders;
    this.reportBackgroundError = dependencies.reportBackgroundError ?? ((error) => console.warn("Local mail background event failed", error));
  }

  async start(): Promise<void> {
    if (!this.unsubscribeMonitor) {
      this.unsubscribeMonitor = this.dependencies.monitor.subscribe((event) => {
        void this.handleMonitorEvent(event).catch(this.reportBackgroundError);
      });
    }
    const settings = await this.dependencies.credentials.loadView();
    this.dependencies.setStartAtLogin(settings.startAtLogin);
    if (settings.email && settings.hasAuthCode) {
      await this.notifyUnnotifiedSafely(settings.email);
      await this.dependencies.monitor.start();
    }
  }

  async stop(): Promise<void> {
    this.unsubscribeMonitor?.();
    this.unsubscribeMonitor = undefined;
    await this.dependencies.monitor.stop();
  }

  loadSettings(): Promise<LocalMailSettingsView> {
    return this.dependencies.credentials.loadView();
  }

  async saveSettings(input: SaveLocalMailSettingsInput): Promise<LocalMailSettingsView> {
    const email = input.email.trim();
    const current = await this.dependencies.credentials.loadCredentials();
    const authCode = input.authCode?.trim() || (current.email.toLowerCase() === email.toLowerCase() ? current.authCode : "");
    if (!email || !authCode) {
      throw new Error("请填写企业邮箱和客户端授权码。");
    }
    await this.verify(buildImapConfig({ email, authCode }));
    const saved = await this.dependencies.credentials.save({
      ...input,
      email,
      ...(input.authCode ? { authCode } : {}),
    });
    this.dependencies.setStartAtLogin(saved.startAtLogin);
    await this.dependencies.monitor.reconnect();
    return saved;
  }

  async listEmails(): Promise<LocalMailListResult> {
    const settings = await this.dependencies.credentials.loadView();
    const messages = settings.email ? this.dependencies.store.listMessages(settings.email) : [];
    const status = this.status();
    if (!status.lastSyncAt && settings.email) {
      status.lastSyncAt = this.dependencies.store.lastSyncAt(settings.email);
    }
    return {
      messages,
      scannedMessages: settings.email ? this.dependencies.store.lastScannedMessages(settings.email) : 0,
      days: 7,
      orderAttachmentCount: messages.reduce((sum, message) => sum + message.attachmentCount, 0),
      nonOrderExcelAttachmentCount: 0,
      status,
    };
  }

  async refreshEmails(): Promise<LocalMailListResult> {
    await this.dependencies.monitor.refreshNow();
    return this.listEmails();
  }

  async reconnect(): Promise<void> {
    await this.dependencies.monitor.reconnect();
  }

  status(): LocalMailRuntimeStatus {
    return this.dependencies.monitor.status();
  }

  subscribe(listener: (event: LocalMailEvent) => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  async extractEmail(
    request: LocalEmailExtractionRequest,
    progress?: (event: ProgressEvent) => void,
  ): Promise<EmailExtractionResult> {
    const messageUids = [...new Set(request.messageUids.map((uid) => uid.trim()).filter(Boolean))];
    if (messageUids.length === 0) {
      throw new Error("请先勾选要提取的邮件。");
    }
    const credentials = await this.dependencies.credentials.loadCredentials();
    await this.dependencies.monitor.stop();
    try {
      const result = await this.extract(
        {
          ...credentials,
          server: "imap.exmail.qq.com",
          port: 993,
          hours: 168,
          messageUids,
          inferManual: request.inferManual ?? true,
        },
        progress,
      );
      if (result.extraction.failures.length === 0) {
        this.dependencies.store.markExtracted(credentials.email, messageUids);
        await this.emitList([]);
      }
      return result;
    } finally {
      await this.dependencies.monitor.start();
    }
  }

  private async handleMonitorEvent(event: LocalMailboxMonitorEvent): Promise<void> {
    if (event.type === "status") {
      this.emit({ type: "status-changed", data: event.status });
      return;
    }
    const credentials = await this.dependencies.credentials.loadCredentials();
    if (!event.initialSync) {
      await this.notifyUnnotifiedSafely(credentials.email);
    }
    await this.emitList(event.initialSync ? [] : event.messages.map((message) => message.uid));
  }

  private async notifyUnnotified(email: string): Promise<void> {
    const unnotified = this.dependencies.store.listUnnotified(email);
    if (unnotified.length > 0 && (await this.dependencies.notify(unnotified))) {
      this.dependencies.store.markNotified(
        email,
        unnotified.map((message) => message.uid),
      );
    }
  }

  private async notifyUnnotifiedSafely(email: string): Promise<void> {
    try {
      await this.notifyUnnotified(email);
    } catch (error) {
      this.reportBackgroundError(error);
    }
  }

  private async emitList(newMessageUids: string[]): Promise<void> {
    this.emit({ type: "messages-updated", data: { newMessageUids, list: await this.listEmails() } });
  }

  private emit(event: LocalMailEvent): void {
    for (const subscriber of this.subscribers) {
      subscriber(event);
    }
  }
}
