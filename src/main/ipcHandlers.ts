import { BrowserWindow, Notification, dialog, ipcMain, shell } from "electron";

import {
  extractEmailOrders,
  extractLocalOrders,
  listEmailMessages,
  type EmailExtractionRequest,
  type EmailListRequest,
} from "../core/extractionService.js";
import { loadEmailSettings, saveEmailSettings } from "../core/settings.js";
import { checkForUpdates } from "../core/updateChecker.js";
import type { EmailSettings, NewOrderEmailNotification, ProgressEvent } from "../shared/types.js";

interface LocalExtractionPayload {
  paths?: string[];
  recursive?: boolean;
  inferManual?: boolean;
}

export function registerIpcHandlers(): void {
  ipcMain.handle("settings:load", async () => loadEmailSettings());

  ipcMain.handle("settings:save", async (_event, settings: EmailSettings) => {
    await saveEmailSettings(settings);
    return loadEmailSettings();
  });

  ipcMain.handle("updates:check", async () => checkForUpdates());

  ipcMain.handle("dialog:select-files", async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: "选择订单 Excel 文件",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Excel", extensions: ["xlsx", "xlsm"] }],
    } satisfies Electron.OpenDialogOptions;
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle("dialog:select-folder", async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: "选择订单文件夹",
      properties: ["openDirectory"],
    } satisfies Electron.OpenDialogOptions;
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle("emails:list", async (_event, payload: EmailListRequest) => listEmailMessages(payload));

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
    extractEmailOrders(payload, sendProgress(event.sender)),
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
