import path from "node:path";

import { app, BrowserWindow, Notification, powerMonitor, safeStorage } from "electron";

import { listRecentOrderEmailMessages } from "../core/emailSource.js";
import type { LocalMailEvent, LocalMailMessageSummary } from "../shared/types.js";
import { openImapIdleConnection } from "../localMail/imapIdleConnection.js";
import { LocalMailCredentialStore } from "../localMail/localMailCredentialStore.js";
import { LocalMailboxMonitor } from "../localMail/localMailboxMonitor.js";
import { LocalMailService } from "../localMail/localMailService.js";
import { openLocalMailStore } from "../localMail/localMailStore.js";

export interface MainLocalMailServices {
  localMail: LocalMailService;
  close(): Promise<void>;
}

export interface NotificationBindings {
  isSupported(): boolean;
  create(options: { title: string; body: string; silent: boolean }): {
    on(name: "click", listener: () => void): void;
    show(): void;
  };
  focusFirstWindow(): void;
}

export function loginItemSettings(enabled: boolean): Electron.Settings {
  return { openAtLogin: enabled, args: ["--hidden"] };
}

export async function createMainLocalMailServices(): Promise<MainLocalMailServices> {
  const credentialStore = new LocalMailCredentialStore({ safeStorage });
  const store = await openLocalMailStore({ databasePath: path.join(app.getPath("userData"), "mail-cache.sqlite") });
  const monitor = new LocalMailboxMonitor({
    loadCredentials: () => credentialStore.loadCredentials(),
    scan: listRecentOrderEmailMessages,
    openIdle: openImapIdleConnection,
    store,
  });
  const notificationBindings: NotificationBindings = {
    isSupported: () => Notification.isSupported(),
    create: (options) => new Notification(options),
    focusFirstWindow,
  };
  const localMail = new LocalMailService({
    credentials: credentialStore,
    store,
    monitor,
    notify: (messages) => showOrderMailNotification(messages, notificationBindings),
    setStartAtLogin: (enabled) => app.setLoginItemSettings(loginItemSettings(enabled)),
  });
  const resume = () => { void monitor.handleResume(); };
  powerMonitor.on("resume", resume);
  const unsubscribe = localMail.subscribe(broadcastLocalMailEvent);
  return {
    localMail,
    async close() {
      unsubscribe();
      powerMonitor.off("resume", resume);
      await localMail.stop();
      store.close();
    },
  };
}

export async function showOrderMailNotification(
  messages: LocalMailMessageSummary[],
  bindings: NotificationBindings,
): Promise<boolean> {
  if (messages.length === 0 || !bindings.isSupported()) return false;
  const notification = bindings.create({
    title: `发现 ${messages.length} 封新订单邮件`,
    body: messages[0]?.subject || "有新的订单邮件待提取。",
    silent: false,
  });
  notification.on("click", bindings.focusFirstWindow);
  notification.show();
  return true;
}

function broadcastLocalMailEvent(event: LocalMailEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.webContents.isDestroyed()) window.webContents.send("local-mail:event", event);
  }
}

function focusFirstWindow(): void {
  const window = BrowserWindow.getAllWindows()[0];
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}
