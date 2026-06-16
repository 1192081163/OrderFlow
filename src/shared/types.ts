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
}
