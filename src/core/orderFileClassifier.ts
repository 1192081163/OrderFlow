import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { extractWorkbook, isExtractedOrderRow } from "./orderExtractor.js";

export async function isOrderWorkbookContent(filename: string, content: Buffer): Promise<boolean> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "order-workbook-"));
  const filePath = path.join(tempDir, safeWorkbookName(filename));

  try {
    await writeFile(filePath, content);
    const row = await extractWorkbook(filePath, { inferManual: true });
    return isExtractedOrderRow(row);
  } catch {
    return false;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function safeWorkbookName(filename: string): string {
  const basename = path.basename(filename).trim();
  return basename || "attachment.xlsx";
}
