import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import type { RunExtractionOptions } from "./orderExtractor.js";
import type { ExtractionResult } from "../shared/types.js";

const execFileAsync = promisify(execFile);
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

interface PythonCommand {
  command: string;
  argsPrefix: string[];
}

export type OrderExtractionRunner = (paths: string[], options?: RunExtractionOptions) => Promise<ExtractionResult>;

export async function runPythonOrderExtraction(
  paths: string[],
  options: RunExtractionOptions = {},
): Promise<ExtractionResult> {
  const command = resolvePythonCommand();
  const args = [
    ...command.argsPrefix,
    ...(options.recursive ? ["--recursive"] : []),
    options.inferManual ?? true ? "--infer-manual" : "--no-infer-manual",
    ...paths,
  ];

  try {
    const { stdout } = await execFileAsync(command.command, args, {
      cwd: resolvePythonExecutionCwd(command.command),
      maxBuffer: 50 * 1024 * 1024,
    });
    return JSON.parse(stdout) as ExtractionResult;
  } catch (error) {
    const details = error && typeof error === "object" && "stderr" in error ? String(error.stderr).trim() : "";
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(details ? `Python extraction failed: ${details}` : `Python extraction failed: ${message}`);
  }
}

function resolvePythonCommand(): PythonCommand {
  const bundledRunner = findBundledRunner();
  if (bundledRunner) {
    return { command: bundledRunner, argsPrefix: [] };
  }

  const scriptPath = findBridgeScript();
  const configuredPython = process.env.ORDER_ORGANIZER_PYTHON?.trim();
  if (configuredPython) {
    return { command: configuredPython, argsPrefix: [scriptPath] };
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
  const runnerName = process.platform === "win32" ? "order-python-runner.exe" : "order-python-runner";
  for (const baseDir of resourceRoots()) {
    const candidate = path.join(baseDir, "python-helper", runnerName);
    if (existsSync(candidate)) {
      return candidate;
    }
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
