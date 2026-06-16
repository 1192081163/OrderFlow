import path from "node:path";

import type { OutputPaths } from "../shared/types.js";

export function defaultOutputPaths(baseDir: string): OutputPaths {
  const outputDir = path.join(baseDir, "order_extraction_output");
  return {
    outputDir,
    csvOutput: path.join(outputDir, "extracted_job_rows.csv"),
    xlsxOutput: path.join(outputDir, "订单整理结果.xlsx"),
    auditOutput: path.join(outputDir, "audit.csv"),
  };
}
