export const TRACK_HEADERS = [
  "D DATE",
  "PO NUMBER",
  "BUILDER",
  "Urgent",
  "",
  "Deliver Address",
  "#",
  "Over \nSize",
  "",
  "Material",
  "QTY",
  "Goods1",
  "QTY",
  "Goods2",
  "Ideal\n D date",
  "Estimate\n C Date",
  "",
  "MITRE",
  "Parts",
  "MITRE",
  "Parts",
  "hinge/striker/stud/dynabolt/2110/sill",
  "hinge holder/3751/WS7/mib",
  "door closer/kd",
] as const;

export type ProgressStatus = "running" | "completed" | "failed";

export interface ProgressEvent {
  index: number;
  total: number;
  filename: string;
  status: ProgressStatus;
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
  proxy?: string;
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
  scannedMessages: number;
  days: number;
  orderAttachmentCount?: number;
  nonOrderExcelAttachmentCount?: number;
}

export interface EmailNewMessagesEvent {
  email: string;
  days: number;
  messages: EmailMessageSummary[];
}

export interface NewOrderEmailNotification {
  title: string;
  body: string;
}

export interface UpdateCheckResult {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion?: string;
  releaseUrl?: string;
  downloadUrl?: string;
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
