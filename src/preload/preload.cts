import { contextBridge, ipcRenderer } from "electron";

import type { EmailExtractionResult } from "../core/extractionService.js";
import type {
  ExtractionResult,
  LocalEmailExtractionRequest,
  LocalMailEvent,
  LocalMailListResult,
  LocalMailSettingsView,
  ProgressEvent,
  SaveLocalMailSettingsInput,
  UpdateCheckResult,
} from "../shared/types.js";

export interface OrderOrganizerApi {
  loadMailSettings: () => Promise<LocalMailSettingsView>;
  saveMailSettings: (input: SaveLocalMailSettingsInput) => Promise<LocalMailSettingsView>;
  selectLocalInputs: () => Promise<string[]>;
  listEmails: () => Promise<LocalMailListResult>;
  refreshEmails: () => Promise<LocalMailListResult>;
  reconnectEmail: () => Promise<void>;
  extractLocal: (payload: { paths: string[]; recursive?: boolean; inferManual?: boolean }) => Promise<ExtractionResult>;
  extractEmail: (request: LocalEmailExtractionRequest) => Promise<EmailExtractionResult>;
  onLocalMailEvent: (callback: (event: LocalMailEvent) => void) => () => void;
  checkUpdates: () => Promise<UpdateCheckResult>;
  downloadAndOpenUpdate: (update: UpdateCheckResult) => Promise<string>;
  openPath: (targetPath: string) => Promise<void>;
  onProgress: (callback: (event: ProgressEvent) => void) => () => void;
}

const api: OrderOrganizerApi = {
  loadMailSettings: () => ipcRenderer.invoke("local-mail:settings:load"),
  saveMailSettings: (input) => ipcRenderer.invoke("local-mail:settings:save", input),
  selectLocalInputs: () => ipcRenderer.invoke("dialog:select-local-inputs"),
  listEmails: () => ipcRenderer.invoke("local-mail:list"),
  refreshEmails: () => ipcRenderer.invoke("local-mail:refresh"),
  reconnectEmail: () => ipcRenderer.invoke("local-mail:reconnect"),
  extractLocal: (payload) => ipcRenderer.invoke("orders:extract-local", payload),
  extractEmail: (request) => ipcRenderer.invoke("local-mail:extract", request),
  onLocalMailEvent: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, event: LocalMailEvent) => {
      callback(event);
    };
    ipcRenderer.on("local-mail:event", listener);
    return () => ipcRenderer.off("local-mail:event", listener);
  },
  checkUpdates: () => ipcRenderer.invoke("updates:check"),
  downloadAndOpenUpdate: (update) => ipcRenderer.invoke("updates:download-and-open", update),
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
