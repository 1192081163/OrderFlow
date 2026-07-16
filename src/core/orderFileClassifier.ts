import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runPythonOrderExtraction, type OrderExtractionRunner } from "./pythonExtractor.js";

interface OrderWorkbookClassifierDependencies {
  runOrderExtraction?: OrderExtractionRunner;
}

export async function isOrderWorkbookContent(
  filename: string,
  content: Buffer,
  dependencies: OrderWorkbookClassifierDependencies = {},
): Promise<boolean> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "order-workbook-"));
  const filePath = path.join(tempDir, safeWorkbookName(filename));

  try {
    await writeFile(filePath, content);
    const extractor = dependencies.runOrderExtraction ?? runPythonOrderExtraction;
    const result = await extractor([filePath], { inferManual: true });
    return result.rows.length > 0;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function safeWorkbookName(filename: string): string {
  const basename = path.basename(filename).trim();
  return basename || "attachment.xlsx";
}
