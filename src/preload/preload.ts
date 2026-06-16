import { contextBridge, ipcRenderer } from "electron";

import type { EmailSettings, ExtractionResult, ProgressEvent } from "../shared/types.js";
import type { EmailExtractionRequest, EmailExtractionResult } from "../core/extractionService.js";

export interface OrderOrganizerApi {
  loadSettings: () => Promise<EmailSettings>;
  saveSettings: (settings: EmailSettings) => Promise<EmailSettings>;
  selectFiles: () => Promise<string[]>;
  selectFolder: () => Promise<string[]>;
  extractLocal: (payload: { paths: string[]; recursive?: boolean; inferManual?: boolean }) => Promise<ExtractionResult>;
  extractEmail: (payload: EmailExtractionRequest) => Promise<EmailExtractionResult>;
  openPath: (targetPath: string) => Promise<void>;
  onProgress: (callback: (event: ProgressEvent) => void) => () => void;
}

const api: OrderOrganizerApi = {
  loadSettings: () => ipcRenderer.invoke("settings:load"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  selectFiles: () => ipcRenderer.invoke("dialog:select-files"),
  selectFolder: () => ipcRenderer.invoke("dialog:select-folder"),
  extractLocal: (payload) => ipcRenderer.invoke("orders:extract-local", payload),
  extractEmail: (payload) => ipcRenderer.invoke("orders:extract-email", payload),
  openPath: (targetPath) => ipcRenderer.invoke("shell:open-path", targetPath),
  onProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: ProgressEvent) => {
      callback(progress);
    };
    ipcRenderer.on("orders:progress", listener);
    return () => ipcRenderer.off("orders:progress", listener);
  },
};

contextBridge.exposeInMainWorld("orderOrganizer", api);
