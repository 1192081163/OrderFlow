import { BrowserWindow, Notification, app, dialog, ipcMain, shell } from "electron";

import {
  extractLocalOrders,
  type EmailExtractionRequest,
  type EmailListRequest,
} from "../core/extractionService.js";
import { loadEmailSettings, saveEmailSettings } from "../core/settings.js";
import { checkForUpdates, downloadUpdateExecutable } from "../core/updateChecker.js";
import type { EmailSettings, NewOrderEmailNotification, ProgressEvent, UpdateCheckResult } from "../shared/types.js";
import { extractDesktopEmailOrders, listDesktopEmails, subscribeDesktopEmailUpdates, type DesktopEmailSubscription } from "./emailActions.js";

interface LocalExtractionPayload {
  paths?: string[];
  recursive?: boolean;
  inferManual?: boolean;
}

const emailUpdateSubscriptions = new Map<number, DesktopEmailSubscription>();

export function registerIpcHandlers(): void {
  ipcMain.handle("settings:load", async () => loadEmailSettings());

  ipcMain.handle("settings:save", async (_event, settings: EmailSettings) => {
    await saveEmailSettings(settings);
    return loadEmailSettings();
  });

  ipcMain.handle("updates:check", async () => checkForUpdates());

  ipcMain.handle("updates:download-and-open", async (_event, update: UpdateCheckResult): Promise<string> => {
    if (process.platform !== "win32") {
      throw new Error("自动打开新版仅支持 Windows 便携版 exe，请在 Windows 电脑上更新。");
    }

    const executablePath = await downloadUpdateExecutable(update, app.getPath("downloads"));
    const errorMessage = await shell.openPath(executablePath);
    if (errorMessage) {
      throw new Error(errorMessage);
    }
    setTimeout(() => app.quit(), 1000);
    return executablePath;
  });

  ipcMain.handle("dialog:select-local-inputs", async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: "选择本地订单文件或文件夹",
      properties: ["openFile", "openDirectory", "multiSelections"],
      filters: [{ name: "Excel", extensions: ["xlsx", "xlsm"] }],
    } satisfies Electron.OpenDialogOptions;
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle("emails:list", async (_event, payload: EmailListRequest) => listDesktopEmails(payload));

  ipcMain.handle("emails:subscribe-updates", async (event): Promise<boolean> => {
    closeEmailUpdateSubscription(event.sender.id);
    const subscription = await subscribeDesktopEmailUpdates((update) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send("emails:update", update);
      }
    });
    if (!subscription) {
      return false;
    }
    emailUpdateSubscriptions.set(event.sender.id, subscription);
    event.sender.once("destroyed", () => closeEmailUpdateSubscription(event.sender.id));
    return true;
  });

  ipcMain.handle("emails:unsubscribe-updates", async (event): Promise<boolean> => {
    closeEmailUpdateSubscription(event.sender.id);
    return true;
  });

  ipcMain.handle("notifications:new-order-emails", async (event, notification: NewOrderEmailNotification) =>
    showNewOrderEmailNotification(event.sender, notification),
  );

  ipcMain.handle("orders:extract-local", async (event, payload: LocalExtractionPayload) =>
    extractLocalOrders(
      {
        paths: Array.isArray(payload.paths) ? payload.paths : [],
        recursive: payload.recursive,
        inferManual: payload.inferManual,
      },
      sendProgress(event.sender),
    ),
  );

  ipcMain.handle("orders:extract-email", async (event, payload: EmailExtractionRequest) =>
    extractDesktopEmailOrders(payload, sendProgress(event.sender)),
  );

  ipcMain.handle("shell:open-path", async (_event, targetPath: string) => {
    if (!targetPath) {
      return;
    }
    const error = await shell.openPath(targetPath);
    if (error) {
      throw new Error(error);
    }
  });
}

function closeEmailUpdateSubscription(webContentsId: number): void {
  const existing = emailUpdateSubscriptions.get(webContentsId);
  if (!existing) {
    return;
  }
  existing.close();
  emailUpdateSubscriptions.delete(webContentsId);
}

function sendProgress(sender: Electron.WebContents): (event: ProgressEvent) => void {
  return (event) => {
    sender.send("orders:progress", event);
  };
}

function showNewOrderEmailNotification(sender: Electron.WebContents, notification: NewOrderEmailNotification): boolean {
  if (!Notification.isSupported()) {
    return false;
  }

  const window = BrowserWindow.fromWebContents(sender);
  const nativeNotification = new Notification({
    title: notification.title.trim() || "发现新订单邮件",
    body: notification.body.trim() || "有新的订单邮件待提取。",
    silent: false,
  });

  nativeNotification.on("click", () => {
    if (!window) {
      return;
    }
    if (window.isMinimized()) {
      window.restore();
    }
    window.show();
    window.focus();
  });
  nativeNotification.show();
  window?.flashFrame(true);
  return true;
}
