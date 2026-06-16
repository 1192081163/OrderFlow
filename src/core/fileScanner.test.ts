import { mkdir, writeFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { defaultOutputPaths } from "./outputPaths.js";
import { resolveInputPaths } from "./fileScanner.js";

async function touch(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, "x");
}

let tempRoot = "";

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "order-organizer-"));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe("resolveInputPaths", () => {
  test("accepts a folder and filters order Excel files", async () => {
    const root = path.join(tempRoot, "scan-folder");
    await touch(path.join(root, "order.xlsx"));
    await touch(path.join(root, "order.xlsm"));
    await touch(path.join(root, "~$temp.xlsx"));
    await touch(path.join(root, "2026 Job Track.xlsx"));
    await touch(path.join(root, "notes.txt"));

    const result = await resolveInputPaths([root]);

    expect(result.inputFiles.map((item) => path.basename(item))).toEqual(["order.xlsm", "order.xlsx"]);
    expect(result.baseDir).toBe(root);
    expect(result.skippedFiles).toContain("notes.txt");
  });

  test("recursively scans child folders only when requested", async () => {
    const root = path.join(tempRoot, "scan-recursive");
    await touch(path.join(root, "child", "nested.xlsx"));

    const flat = await resolveInputPaths([root], { recursive: false });
    const recursive = await resolveInputPaths([root], { recursive: true });

    expect(flat.inputFiles).toEqual([]);
    expect(recursive.inputFiles.map((item) => path.basename(item))).toEqual(["nested.xlsx"]);
  });

  test("uses first valid file parent for file selections", async () => {
    const root = path.join(tempRoot, "scan-files");
    const first = path.join(root, "z", "first.xlsx");
    const second = path.join(root, "a", "second.xlsx");
    await touch(first);
    await touch(second);

    const result = await resolveInputPaths([first, second]);

    expect(result.baseDir).toBe(path.dirname(first));
    expect(result.inputFiles.map((item) => path.basename(item))).toEqual(["second.xlsx", "first.xlsx"]);
  });
});

describe("defaultOutputPaths", () => {
  test("uses the order extraction output folder", () => {
    const baseDir = path.join(tempRoot, "output");

    expect(defaultOutputPaths(baseDir)).toEqual({
      outputDir: path.join(baseDir, "order_extraction_output"),
      csvOutput: path.join(baseDir, "order_extraction_output", "extracted_job_rows.csv"),
      xlsxOutput: path.join(baseDir, "order_extraction_output", "订单整理结果.xlsx"),
      auditOutput: path.join(baseDir, "order_extraction_output", "audit.csv"),
    });
  });
});
