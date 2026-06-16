import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const VALID_SUFFIXES = new Set([".xlsx", ".xlsm"]);

export interface InputResolution {
  inputFiles: string[];
  skippedFiles: string[];
  baseDir: string;
}

export interface ResolveInputOptions {
  recursive?: boolean;
}

export function isValidOrderFile(filePath: string): boolean {
  const name = path.basename(filePath);
  const lower = name.toLowerCase();
  if (name.startsWith(".~") || lower.startsWith("~$")) {
    return false;
  }
  if (!VALID_SUFFIXES.has(path.extname(name).toLowerCase())) {
    return false;
  }
  if (lower.includes("job track")) {
    return false;
  }
  if (name === "总表.xlsx") {
    return false;
  }
  return true;
}

export async function resolveInputPaths(
  paths: string[],
  options: ResolveInputOptions = {},
): Promise<InputResolution> {
  const recursive = options.recursive ?? false;
  const rawPaths = paths.map((item) => path.resolve(item));
  const inputFiles: string[] = [];
  const skippedFiles: string[] = [];
  let baseDir = rawPaths[0] ?? process.cwd();
  let firstValidFileParent: string | null = null;

  for (const itemPath of rawPaths) {
    const itemStat = await stat(itemPath).catch(() => null);
    if (!itemStat) {
      skippedFiles.push(path.basename(itemPath));
      continue;
    }

    if (itemStat.isDirectory()) {
      baseDir = itemPath;
      for (const filePath of await iterDirectoryFiles(itemPath, recursive)) {
        if (isValidOrderFile(filePath)) {
          inputFiles.push(filePath);
        } else {
          skippedFiles.push(path.basename(filePath));
        }
      }
      continue;
    }

    if (itemStat.isFile() && isValidOrderFile(itemPath)) {
      inputFiles.push(itemPath);
      firstValidFileParent ??= path.dirname(itemPath);
    } else {
      skippedFiles.push(path.basename(itemPath));
    }
  }

  const uniqueSorted = Array.from(new Set(inputFiles)).sort();
  if (uniqueSorted.length > 0 && (rawPaths.length === 0 || !(await isDirectory(rawPaths[0])))) {
    baseDir = firstValidFileParent ?? path.dirname(uniqueSorted[0]);
  }

  return {
    inputFiles: uniqueSorted,
    skippedFiles,
    baseDir,
  };
}

async function iterDirectoryFiles(dirPath: string, recursive: boolean): Promise<string[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isFile()) {
      files.push(entryPath);
    } else if (recursive && entry.isDirectory()) {
      files.push(...(await iterDirectoryFiles(entryPath, recursive)));
    }
  }

  return files.sort();
}

async function isDirectory(itemPath: string): Promise<boolean> {
  const itemStat = await stat(itemPath).catch(() => null);
  return Boolean(itemStat?.isDirectory());
}
