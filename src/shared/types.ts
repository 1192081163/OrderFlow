export type ProgressStatus = "running" | "completed" | "failed";

export type ProgressPhase = "preparing" | "downloading" | "extracting" | "writing";

export interface ProgressEvent {
  index: number;
  total: number;
  filename: string;
  status: ProgressStatus;
  phase?: ProgressPhase;
  percent?: number;
}

export interface OutputPaths {
  outputDir: string;
  csvOutput: string;
  xlsxOutput: string;
  auditOutput: string;
}

export interface ExtractionFailure {
  path: string;
  error: string;
}

export interface ExtractedOrderRow {
  values: Array<string | number | null>;
  notes: string[];
  manualCheck: string[];
  sourceFile: string;
}

export interface ExtractionResult {
  inputFiles: string[];
  rows: ExtractedOrderRow[];
  skippedFiles: string[];
  failures: ExtractionFailure[];
  outputs: OutputPaths;
}

export interface EmailSettings {
  email: string;
  authCode: string;
}

export interface ImapConfig extends EmailSettings {
  server: string;
  port: number;
}

export interface EmailMessageSummary {
  uid: string;
  subject: string;
  from?: string;
  date?: string;
  attachmentCount: number;
  excelAttachmentNames: string[];
  hasExcelAttachments: boolean;
}

export interface EmailListResult {
  messages: EmailMessageSummary[];
  scannedUids?: string[];
  scannedMessages: number;
  days: number;
  orderAttachmentCount?: number;
  nonOrderExcelAttachmentCount?: number;
}

export interface UpdateCheckResult {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion?: string;
  releaseUrl?: string;
  downloadUrl?: string;
  downloadParts?: Array<{ assetName: string; downloadUrl: string }>;
  checksumUrl?: string;
  assetName?: string;
  reason: "current" | "newer_version" | "missing_asset" | "error";
  error?: string;
}

export type LocalMailRuntimeState = "stopped" | "connecting" | "connected" | "offline" | "attention_required";

export interface LocalMailRuntimeStatus {
  state: LocalMailRuntimeState;
  detail: string;
  lastSyncAt?: string;
}

export interface LocalMailSettingsView {
  email: string;
  hasAuthCode: boolean;
  startAtLogin: boolean;
}

export interface SaveLocalMailSettingsInput {
  email: string;
  authCode?: string;
  startAtLogin: boolean;
}

export interface LocalMailMessageSummary extends EmailMessageSummary {
  extracted: boolean;
}

export interface LocalMailListResult extends Omit<EmailListResult, "messages"> {
  messages: LocalMailMessageSummary[];
  status: LocalMailRuntimeStatus;
}

export interface LocalEmailExtractionRequest {
  messageUids: string[];
  inferManual?: boolean;
}

export type LocalMailEvent =
  | { type: "messages-updated"; data: { newMessageUids: string[]; list: LocalMailListResult } }
  | { type: "status-changed"; data: LocalMailRuntimeStatus };
