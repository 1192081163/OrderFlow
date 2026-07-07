import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { resolvePythonExecutionCwd, runPythonOrderExtraction } from "./pythonExtractor.js";

let tempRoot = "";

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "python-extract-"));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

async function makeWorksheetOrder(filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Worksheet");
  ws.getCell("C1").value = "29698";
  ws.getCell("C2").value = "Celebration Homes";
  ws.getCell("C5").value = "2026-06-15";
  ws.getCell("C6").value = "PO-1";
  ["Material", "Stock", "Qty", "Profile", "B/O", "Reveal Height", "Reveal Width"].forEach((value, index) => {
    ws.getCell(9, index + 1).value = value;
  });
  ws.getCell("A11").value = "1.05mm Zincanneal";
  ws.getCell("C11").value = 1;
  ws.getCell("D11").value = "Modern";
  await wb.xlsx.writeFile(filePath);
}

describe("python order extraction bridge", () => {
  test("uses real resources directory instead of app.asar as packaged cwd", () => {
    const resourcesPath = path.join(tempRoot, "resources");
    const asarRoot = path.join(resourcesPath, "app.asar");
    const runnerPath = path.join(resourcesPath, "python-helper", "order-python-runner.exe");

    expect(resolvePythonExecutionCwd(runnerPath, asarRoot, resourcesPath)).toBe(resourcesPath);
  });

  test("keeps project root as cwd during development", () => {
    const runnerPath = path.join(tempRoot, "python-helper", "order-python-runner.exe");

    expect(resolvePythonExecutionCwd(runnerPath, tempRoot)).toBe(tempRoot);
  });

  test("runs the Python rules and returns generated outputs", async () => {
    const filePath = path.join(tempRoot, "29698 python bridge.xlsx");
    await makeWorksheetOrder(filePath);

    const result = await runPythonOrderExtraction([filePath], { inferManual: true });

    expect(result.inputFiles.map((item) => path.basename(item))).toEqual([path.basename(filePath)]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].values[2]).toBe("CELEBRATION");
    expect(result.rows[0].values[6]).toBe("29698");
    expect(result.rows[0].values[11]).toBe("MODERN");
    expect(await stat(result.outputs.xlsxOutput)).toBeTruthy();
    await expect(stat(result.outputs.csvOutput)).rejects.toThrow();
    await expect(stat(result.outputs.auditOutput)).rejects.toThrow();
  });

  test("forwards Python file progress events", async () => {
    const filePath = path.join(tempRoot, "29698 python progress.xlsx");
    await makeWorksheetOrder(filePath);
    const progressEvents: Array<{ index: number; total: number; filename: string; status: string }> = [];

    await runPythonOrderExtraction([filePath], {
      inferManual: true,
      progress: (event) => progressEvents.push(event),
    });

    expect(progressEvents).toEqual([
      { index: 1, total: 1, filename: path.basename(filePath), status: "running" },
      { index: 1, total: 1, filename: path.basename(filePath), status: "completed" },
    ]);
  });
});
