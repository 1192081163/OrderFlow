import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { isOrderWorkbookContent } from "./orderFileClassifier.js";
import type { ExtractionResult } from "../shared/types.js";

let tempRoot = "";

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "order-file-classifier-"));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

function extractionResult(paths: string[], rows: ExtractionResult["rows"]): ExtractionResult {
  return {
    inputFiles: paths,
    rows,
    skippedFiles: [],
    failures: [],
    outputs: {
      outputDir: tempRoot,
      csvOutput: path.join(tempRoot, "rows.csv"),
      xlsxOutput: path.join(tempRoot, "rows.xlsx"),
      auditOutput: path.join(tempRoot, "audit.csv"),
    },
  };
}

describe("order workbook classifier", () => {
  test("uses the Python extraction runner as the only order-content classifier", async () => {
    const content = Buffer.from("workbook-bytes");
    let tempWorkbookPath = "";

    const isOrder = await isOrderWorkbookContent("../30446.xlsx", content, {
      runOrderExtraction: async (paths, options) => {
        tempWorkbookPath = paths[0] ?? "";
        expect(options?.inferManual).toBe(true);
        expect(path.basename(tempWorkbookPath)).toBe("30446.xlsx");
        expect(await readFile(tempWorkbookPath)).toEqual(content);
        return extractionResult(paths, [
          {
            values: [null, "473463", "PRIME", null, "05E", "LOT 902", "30446"],
            notes: [],
            manualCheck: [],
            sourceFile: "30446.xlsx",
          },
        ]);
      },
    });

    expect(isOrder).toBe(true);
    await expect(stat(tempWorkbookPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("rejects workbooks when the Python extraction runner finds no rows", async () => {
    const isOrder = await isOrderWorkbookContent("weekly-report.xlsx", Buffer.from("report"), {
      runOrderExtraction: async (paths) => extractionResult(paths, []),
    });

    expect(isOrder).toBe(false);
  });

  test("propagates classifier infrastructure failures so email scans can retry", async () => {
    let tempWorkbookPath = "";
    const result = isOrderWorkbookContent("order.xlsx", Buffer.from("workbook"), {
      runOrderExtraction: async (paths) => {
        tempWorkbookPath = paths[0] ?? "";
        throw new Error("Python runner unavailable");
      },
    });

    await expect(result).rejects.toThrow("Python runner unavailable");
    await expect(stat(tempWorkbookPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
