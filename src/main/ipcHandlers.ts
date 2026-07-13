import { BrowserWindow, app, dialog, ipcMain, shell } from "electron";

import { checkForUpdates, downloadUpdateExecutable } from "../core/updateChecker.js";
import type { LocalEmailExtractionRequest, ProgressEvent, SaveLocalMailSettingsInput } from "../shared/types.js";
import type { LocalMailService } from "../localMail/localMailService.js";
import { extractDesktopLocalOrders } from "./emailActions.js";

interface LocalExtractionPayload {
  paths?: string[];
  recursive?: boolean;
  inferManual?: boolean;
}

export function registerIpcHandlers(dependencies: {
  localMail: Pick<LocalMailService, "loadSettings" | "saveSettings" | "listEmails" | "refreshEmails" | "reconnect" | "extractEmail">;
}): void {
  ipcMain.handle("local-mail:settings:load", () => dependencies.localMail.loadSettings());
  ipcMain.handle("local-mail:settings:save", (_event, input: SaveLocalMailSettingsInput) =>
    dependencies.localMail.saveSettings(input),
  );
  ipcMain.handle("local-mail:list", () => dependencies.localMail.listEmails());
  ipcMain.handle("local-mail:refresh", () => dependencies.localMail.refreshEmails());
  ipcMain.handle("local-mail:reconnect", () => dependencies.localMail.reconnect());
  ipcMain.handle("local-mail:extract", (event, request: LocalEmailExtractionRequest) =>
    dependencies.localMail.extractEmail(request, sendProgress(event.sender)),
  );

  ipcMain.handle("updates:check", async () => checkForUpdates());

  ipcMain.handle("updates:download-and-open", async (): Promise<string> => {
    if (process.platform !== "win32") {
      throw new Error("自动打开新版仅支持 Windows 便携版 exe，请在 Windows 电脑上更新。");
    }

    const update = await checkForUpdates();
    if (!update.updateAvailable) {
      throw new Error(update.error || "当前没有可下载的新版本。");
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

  ipcMain.handle("orders:extract-local", async (event, payload: LocalExtractionPayload) =>
    extractDesktopLocalOrders(
      {
        paths: Array.isArray(payload.paths) ? payload.paths : [],
        recursive: payload.recursive,
        inferManual: payload.inferManual,
      },
      sendProgress(event.sender),
    ),
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
