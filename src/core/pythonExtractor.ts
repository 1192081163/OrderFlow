import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ExtractionResult, ProgressEvent, ProgressPhase, ProgressStatus } from "../shared/types.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

interface PythonCommand {
  command: string;
  argsPrefix: string[];
}

export interface RunExtractionOptions {
  recursive?: boolean;
  inferManual?: boolean;
  progress?: (event: ProgressEvent) => void;
}

export type OrderExtractionRunner = (paths: string[], options?: RunExtractionOptions) => Promise<ExtractionResult>;

export async function runPythonOrderExtraction(
  paths: string[],
  options: RunExtractionOptions = {},
): Promise<ExtractionResult> {
  const command = resolvePythonCommand();
  const args = [
    ...command.argsPrefix,
    "--progress-jsonl",
    ...(options.recursive ? ["--recursive"] : []),
    options.inferManual ?? true ? "--infer-manual" : "--no-infer-manual",
    ...paths,
  ];

  return runPythonCommand(command.command, args, resolvePythonExecutionCwd(command.command), options.progress);
}

function runPythonCommand(
  command: string,
  args: string[],
  cwd: string,
  progress?: (event: ProgressEvent) => void,
): Promise<ExtractionResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd });
    const stdoutChunks: Buffer[] = [];
    const stderrLines: string[] = [];
    let stderrRemainder = "";
    let settled = false;

    function fail(error: Error): void {
      if (settled) return;
      settled = true;
      reject(error);
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrRemainder = readStderrLines(`${stderrRemainder}${chunk.toString("utf8")}`, progress, stderrLines);
    });

    child.on("error", (error) => {
      fail(new Error(`Python extraction failed: ${error.message}`));
    });

    child.on("close", (code) => {
      if (settled) return;
      if (stderrRemainder.trim()) {
        handleStderrLine(stderrRemainder, progress, stderrLines);
      }

      const stderr = stderrLines.join("\n").trim();
      if (code !== 0) {
        fail(new Error(stderr ? `Python extraction failed: ${stderr}` : `Python extraction failed with exit code ${code}`));
        return;
      }

      try {
        const result = JSON.parse(Buffer.concat(stdoutChunks).toString("utf8")) as ExtractionResult;
        settled = true;
        resolve(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        fail(new Error(stderr ? `Python extraction failed: ${stderr}` : `Python extraction failed: ${message}`));
      }
    });
  });
}

function readStderrLines(
  text: string,
  progress: ((event: ProgressEvent) => void) | undefined,
  stderrLines: string[],
): string {
  const lines = text.split(/\r?\n/);
  const remainder = lines.pop() ?? "";
  for (const line of lines) {
    handleStderrLine(line, progress, stderrLines);
  }
  return remainder;
}

function handleStderrLine(
  line: string,
  progress: ((event: ProgressEvent) => void) | undefined,
  stderrLines: string[],
): void {
  if (!line.trim()) return;
  if (readProgressLine(line, progress)) return;
  stderrLines.push(line);
}

function readProgressLine(line: string, progress?: (event: ProgressEvent) => void): boolean {
  let payload: unknown;
  try {
    payload = JSON.parse(line);
  } catch {
    return false;
  }

  if (!payload || typeof payload !== "object" || (payload as { type?: unknown }).type !== "progress") {
    return false;
  }

  const event = toProgressEvent(payload);
  if (event) progress?.(event);
  return true;
}

function toProgressEvent(payload: unknown): ProgressEvent | null {
  const item = payload as Record<string, unknown>;
  const index = item.index;
  const total = item.total;
  const filename = item.filename;
  const status = item.status;
  const phase = item.phase;
  const percent = item.percent;
  if (
    typeof index !== "number" ||
    typeof total !== "number" ||
    !Number.isInteger(index) ||
    !Number.isInteger(total) ||
    typeof filename !== "string" ||
    !isProgressStatus(status) ||
    (phase !== undefined && !isProgressPhase(phase)) ||
    (percent !== undefined && (typeof percent !== "number" || !Number.isFinite(percent)))
  ) {
    return null;
  }
  return {
    index,
    total,
    filename,
    status,
    ...(phase === undefined ? {} : { phase }),
    ...(percent === undefined ? {} : { percent }),
  };
}

function isProgressStatus(value: unknown): value is ProgressStatus {
  return value === "running" || value === "completed" || value === "failed";
}

function isProgressPhase(value: unknown): value is ProgressPhase {
  return value === "preparing" || value === "downloading" || value === "extracting" || value === "writing";
}

function resolvePythonCommand(): PythonCommand {
  const scriptPath = findBridgeScript();
  const configuredPython = process.env.ORDER_ORGANIZER_PYTHON?.trim();
  if (configuredPython) {
    return { command: configuredPython, argsPrefix: [scriptPath] };
  }

  const bundledRunner = findBundledRunner();
  if (bundledRunner) {
    return { command: bundledRunner, argsPrefix: [] };
  }

  if (process.platform === "win32") {
    return { command: "py", argsPrefix: ["-3", scriptPath] };
  }
  return { command: "python3", argsPrefix: [scriptPath] };
}

export function resolvePythonExecutionCwd(
  _command: string,
  root = projectRoot(),
  resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath,
): string {
  if (!root.toLowerCase().replaceAll("\\", "/").includes("/app.asar")) {
    return root;
  }
  return resourcesPath?.trim() || path.dirname(root);
}

function findBundledRunner(): string | null {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (!resourcesPath) {
    return null;
  }
  const runnerName = process.platform === "win32" ? "order-python-runner.exe" : "order-python-runner";
  const candidate = path.join(resourcesPath, "python-helper", runnerName);
  if (existsSync(candidate)) {
    return candidate;
  }
  return null;
}

function findBridgeScript(): string {
  for (const baseDir of resourceRoots()) {
    const candidate = path.join(baseDir, "python", "python_extraction_bridge.py");
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return path.join(projectRoot(), "python_extraction_bridge.py");
}

function resourceRoots(): string[] {
  const roots = [projectRoot()];
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resourcesPath) {
    roots.unshift(resourcesPath);
  }
  return roots;
}

function projectRoot(): string {
  return path.resolve(moduleDir, "../..");
}
