import { mkdir, rm, writeFile } from "node:fs/promises";
import ExcelJS from "exceljs";

import { TRACK_HEADERS, type ExtractedOrderRow, type OutputPaths } from "../shared/types.js";

export async function writeCsv(rows: ExtractedOrderRow[], outputPath: string): Promise<void> {
  await mkdirParent(outputPath);
  const lines = [TRACK_HEADERS.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push(row.values.map(csvCell).join(","));
  }
  await writeFile(outputPath, `${lines.join("\n")}\n`, "utf8");
}

export async function writeAuditCsv(rows: ExtractedOrderRow[], outputPath: string): Promise<void> {
  await mkdirParent(outputPath);
  const lines = ["source_file,manual_check,notes"];
  for (const row of rows) {
    lines.push([row.sourceFile, row.manualCheck.join("; "), row.notes.join("; ")].map(csvCell).join(","));
  }
  await writeFile(outputPath, `${lines.join("\n")}\n`, "utf8");
}

export async function writeXlsx(rows: ExtractedOrderRow[], outputs: OutputPaths): Promise<void> {
  await mkdir(outputs.outputDir, { recursive: true });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("订单整理结果");
  ws.addRow([...TRACK_HEADERS]);
  for (const row of rows) {
    ws.addRow(row.values);
  }
  ws.columns.forEach((column) => {
    column.width = 16;
  });
  await wb.xlsx.writeFile(outputs.xlsxOutput);
}

export async function writeResultWorkbook(rows: ExtractedOrderRow[], outputs: OutputPaths): Promise<void> {
  await Promise.all([removeOutputFile(outputs.csvOutput), removeOutputFile(outputs.auditOutput)]);
  await writeXlsx(rows, outputs);
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

async function mkdirParent(filePath: string): Promise<void> {
  const { dirname } = await import("node:path");
  await mkdir(dirname(filePath), { recursive: true });
}

async function removeOutputFile(filePath: string): Promise<void> {
  if (filePath) {
    await rm(filePath, { force: true });
  }
}
