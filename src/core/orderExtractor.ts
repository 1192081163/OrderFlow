import path from "node:path";
import { stat } from "node:fs/promises";
import ExcelJS from "exceljs";

import { TRACK_HEADERS, type ExtractedOrderRow, type ExtractionResult, type ProgressEvent } from "../shared/types.js";
import { resolveInputPaths } from "./fileScanner.js";
import { defaultOutputPaths } from "./outputPaths.js";
import { sortExtractedRowsByIdealDate } from "./rowSorting.js";
import { writeAuditCsv, writeCsv, writeXlsx } from "./writers.js";

const OVER_SIZE_REVEAL_WIDTH_THRESHOLD = 1220;
const OVER_SIZE_OVERALL_WIDTH_THRESHOLD = 1300;

const BUILDER_ALIASES: Record<string, string> = {
  "a&m construction group": "A&M",
  "aart homes": "AART",
  "activa homes group pty ltd": "ACTIVA",
  "ace wa construction pty ltd": "ACE",
  "alita construction": "ALITA",
  "apex building (aus) pty ltd": "APEX",
  "austern building supplies pty ltd": "AUSTERN",
  "aw design & build pty ltd": "AW",
  "beaumonde homes": "Beaumonde",
  "beyond residential": "BEYOND",
  "csr building products ltd": "CSR",
  "bunnings group limited": "Bunnings",
  "building development group constructions pty ltd": "BDGC",
  "built": "BULIT",
  "cash sale": "CASH SALE",
  "cash sale - loris moriconi (abn staff member)": "CASH SALE",
  "carnarvon timber & hardware": "Carnarvon Timber & Hardware",
  "celebration homes": "CELEBRATION",
  "coastal design & construction pty ltd": "COASTAL",
  "coastview australia pty ltd (river stone design)": "Coastview Australia Pty Ltd (River Stone Design)",
  "c u building group": "CU",
  "customised projects": "CUSTOMISED",
  "dale alcock homes": "DALE ALCOCK",
  "danze mining": "DANZE",
  "danze mining & building products": "DANZE",
  "dasco building group pty ltd": "DASCO",
  "distinct homes pty ltd": "DISTINCTIVE",
  "distinctive homes wa pty ltd": "DISTINCTIVE",
  "direct homes wa": "DIRECT",
  "dynamic steelform": "DYNAMIC",
  "edge construction": "EDGE",
  "emco": "EMCO",
  "fire door maintenance": "FDM",
  "fire door mainenance": "FDM",
  "fratelli homes (wa) pty ltd": "FRATELLI",
  "geared construction": "GEARED",
  "giorgi architects + builders (building corporation": "GIORGI",
  "gvm solutions ptuy ltd": "GVM",
  "australian fire door company": "AFDC",
  "evoke living homes": "EVOKE",
  "homebuyers centre": "HOMEBUYERS",
  "imagine building wa pty ltd": "IMAGINE",
  "indoz homez pty ltd": "INDOZ",
  "insite residential": "INSITE",
  "ionic projects pty ltd": "IONIC",
  "karlin supplies": "KARLIN",
  "la vida australia pty ltd": "La Vida",
  "lee holden": "Lee Holden",
  "lee contracting group pty ltd": "LEE",
  "lend lease": "Lend Lease",
  "leigh homes pty ltd": "LEIGH",
  "lock up security & doors (polon pty ltd t/a)": "LOCK UP",
  "longhua international pty ltd": "LONGHUA",
  "louis homes pty ltd": "LOUIS",
  "makin homes": "MAKIN",
  "m&b sales": "M&B",
  "marshall homes pty ltd": "MARSHALL",
  "mecca constructions pty ltd": "MECCA",
  "midstream hardware (ragra pty ltd t/a)": "MIDSTREAM",
  "modular wa": "MODULAR",
  "mvg construction pty ltd": "MVG",
  "nats": "NATS",
  "new era homes australia": "NEW ERA",
  "nexus contruction co": "NEXUS",
  "nu-style living": "NUSTYLE",
  "novus homes": "Novus Homes",
  "novus homes (antonelli investments p/l trading as)": "Novus",
  "oceanic custom homes": "OCEANIC",
  "one stop doors": "OSD",
  "oz home building": "OZ",
  "papalia building & design pty ltd": "PAPALIA",
  "planet building products pty ltd": "PLANET",
  "prestige homes wa pty ltd": "Prestige",
  "prima homes": "PRIMA",
  "prime projects": "Prime Projects",
  "prime projects construction p/l": "PRIME",
  "project building supplies ( plasterboard projects)": "PROJECT",
  "project building supplies south west": "PROJECT",
  "rg construct pty ltd": "RG",
  "ross north homes the challengerhomes unit trust": "ROSS NORTH",
  "ryza homes (s&p glossop t/a)": "RYZA",
  "select living": "SELECT",
  "spence doors": "SPENCE",
  "superior homes": "SUPERIOR",
  "thomas building": "THOMAS",
  "the homesmith group": "HOMESMITH",
  "tj payne developments": "TJ",
  "tobia constructions": "TOBIA",
  "trio home builders pty ltd": "TRIO",
  "viva developments pty ltd": "VIVA",
  "vm building": "VM",
  "webb & brown-neaves": "Webb & Brown-Neaves",
  "westwood homes": "Westwood",
  "willing build": "WILLING",
  "zz designer homes": "ZZ",
};

const PROFILE_ALIASES: Record<string, string> = {
  a: "COMMERCIAL",
  b: "COMMERCIAL",
  c: "COMMERCIAL",
  custom: "COMMERCIAL",
  d: "COMMERCIAL",
  h: "COMMERCIAL",
  j: "COMMERCIAL",
  w: "COMMERCIAL",
};

const GOODS_IGNORE_PATTERNS = [
  "combination gas/electric",
  "single electric",
  "single elec",
  "soft close -",
];

const COLORBOND_COLOUR_MARKERS = new Set([
  "basalt",
  "classic cream",
  "cove",
  "deep ocean",
  "dune",
  "gully",
  "ironstone",
  "jasper",
  "loft",
  "mangrove",
  "manor red",
  "monument",
  "night sky",
  "pale eucalypt",
  "paperbark",
  "shale grey",
  "southerly",
  "surfmist",
  "terrain",
  "wallaby",
  "wilderness",
  "windspray",
  "woodland grey",
]);

const WA_2026_PUBLIC_HOLIDAYS = new Set([
  "2026-01-01",
  "2026-01-26",
  "2026-03-02",
  "2026-04-03",
  "2026-04-05",
  "2026-04-06",
  "2026-04-25",
  "2026-04-27",
  "2026-06-01",
  "2026-09-28",
  "2026-12-25",
  "2026-12-26",
  "2026-12-28",
]);

export interface RunExtractionOptions {
  recursive?: boolean;
  inferManual?: boolean;
  progress?: (event: ProgressEvent) => void;
}

interface DetailLine {
  material: string;
  profile: string;
  quantity: number;
  revealWidth: string;
  hingeQty: string;
  hingeType: string;
  strikerType: string;
  sill: string;
  double: string;
  strikerType2: string;
  goodsOverride?: string | null;
  materialCodeExtras?: string[];
  classifyForManualCheck?: boolean;
  hingeQtyBucket?: "v" | "w";
  partsWMultiplier?: number;
  vPartsExtra?: number;
}

interface ManualTotals {
  mitre: number;
  v: number;
  w: number;
  weightedWParts: number;
  x: number;
  screwKdXParts: number;
  screwKdVParts: number;
  overSizeQty: number;
  overSizeMarker: string | null;
  doubleQty: number;
}

interface ExtractedRowEntry {
  index: number;
  filePath: string;
  mtimeMs: number;
  row: ExtractedOrderRow;
}

export async function extractWorkbook(filePath: string, options: Pick<RunExtractionOptions, "inferManual"> = {}): Promise<ExtractedOrderRow> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sourceFile = path.basename(filePath);
  const values = Array.from<string | number | null>({ length: TRACK_HEADERS.length }).fill(null);
  const manualCheck: string[] = [];
  const worksheet = selectWorkbookWorksheet(workbook);
  if (!worksheet) {
    addManualCheck(manualCheck, `unsupported workbook layout: sheets=${formatPythonStringList(workbook.worksheets.map((sheet) => sheet.name))}`);
    return {
      values,
      notes: [],
      manualCheck,
      sourceFile,
    };
  }
  const notes = extractWorkbookNotes(worksheet);

  const metadata = extractMetadata(workbook, worksheet, filePath);
  values[6] = metadata.job;
  values[2] = normalizeBuilder(metadata.builder, manualCheck);
  values[1] = normalizePoForWorksheet(metadata.po, values[2], worksheet);
  values[4] = normalizeZone(metadata.zone);
  values[5] = normalizeDeliveryAddress(metadata.deliveryAddress);
  values[14] = normalizeDate(metadata.deliveryDate);
  if (!values[14] && cellText(metadata.deliveryDate) && (worksheet.name === "Sheet1" || worksheet.name === "Main Sheet")) {
    addManualCheck(manualCheck, `delivery date not parsed: ${cellText(metadata.deliveryDate)}`);
  }
  if (options.inferManual) {
    const completion = previousBusinessDay(values[14]);
    values[15] = completion?.date ?? null;
    values[16] = completion?.weekday ?? null;
  }

  let details = extractDetailLines(worksheet).concat(
    worksheet.name === "Sheet1" || worksheet.name === "Main Sheet" ? extractProfileTableLines(worksheet, sourceFile) : [],
  );
  if (details.length === 0 && worksheet.name === "Worksheet") {
    if (!worksheetHasStandardDetailHeader(worksheet)) {
      values[9] = joinMaterials(sheetMaterialCodes(worksheet));
    }
    details = extractNonstandardDoorLines(worksheet, sourceFile);
  }
  const handledMainFallback =
    details.length === 0 && worksheet.name === "Main Sheet"
      ? applyMainFallbackExtraction(worksheet, values, manualCheck, options.inferManual ?? false, notes)
      : false;
  if (!handledMainFallback && details.length === 0 && (worksheet.name === "Sheet1" || worksheet.name === "Main Sheet")) {
    addManualCheck(manualCheck, "Sheet1 profile header not found");
  }
  if (details.length === 0 && worksheet.name === "Worksheet") {
    addManualCheck(manualCheck, "unsupported worksheet detail layout: nonstandard detail header");
  }
  if (!handledMainFallback && details.length > 0) {
    const materials: string[] = [];
    const goodsTotals = new Map<string, number>();
    const manualTotals = createManualTotals();
    manualTotals.overSizeMarker = workbookOverSizeMarker(workbook);
    for (const detail of details) {
      const code = materialCode(detail.material);
      if (code) {
        materials.push(code);
      }
      if (detail.materialCodeExtras) {
        materials.push(...detail.materialCodeExtras);
      }
      if (detail.classifyForManualCheck) {
        classifyGoods(detail.profile, manualCheck, { allowProfileCodeFallback: false });
      }
      const goods = detail.goodsOverride !== undefined ? detail.goodsOverride : classifyGoods(detail.profile, manualCheck);
      const cleatExtraParts = deluxeCleatsExtraParts(sourceFile, detail.profile, goods, detail.quantity);
      if (cleatExtraParts) {
        detail.vPartsExtra = (detail.vPartsExtra ?? 0) + cleatExtraParts;
      }
      addGoods(goodsTotals, goods, detail.quantity);
      if (options.inferManual) {
        addManualTotals(manualTotals, detail, goods);
      }
    }
    values[9] = joinMaterials(materials);
    writeGoods(values, goodsTotals, manualCheck);
    if (options.inferManual) {
      writeManualTotals(values, manualTotals, manualCheck);
    }
  }

  return {
    values,
    notes,
    manualCheck,
    sourceFile,
  };
}

function selectWorkbookWorksheet(workbook: ExcelJS.Workbook): ExcelJS.Worksheet | null {
  const worksheet = workbook.getWorksheet("Worksheet");
  if (worksheet) {
    return worksheet;
  }
  const mainSheet = workbook.getWorksheet("Main Sheet");
  if (mainSheet) {
    return mainSheet;
  }
  const onlySheet = workbook.worksheets.length === 1 ? workbook.worksheets[0] : undefined;
  return onlySheet?.name === "Sheet1" ? onlySheet : null;
}

function formatPythonStringList(values: string[]): string {
  return `[${values.map((value) => `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`).join(", ")}]`;
}

function extractWorkbookNotes(worksheet: ExcelJS.Worksheet): string[] {
  if (worksheet.name !== "Worksheet") {
    return [];
  }
  const notes = cleanText(worksheet.getCell("I4").value);
  return notes ? [`notes=${notes}`] : [];
}

export async function runOrderExtraction(paths: string[], options: RunExtractionOptions = {}): Promise<ExtractionResult> {
  const resolution = await resolveInputPaths(paths, { recursive: options.recursive ?? false });
  if (resolution.inputFiles.length === 0) {
    throw new Error("No valid order Excel files were found.");
  }

  const outputs = defaultOutputPaths(resolution.baseDir);
  const rowEntries: ExtractedRowEntry[] = [];
  const failures: Array<{ path: string; error: string }> = [];
  const total = resolution.inputFiles.length;

  for (const [index, filePath] of resolution.inputFiles.entries()) {
    options.progress?.({ index: index + 1, total, filename: path.basename(filePath), status: "running" });
    try {
      const row = await extractWorkbook(filePath, { inferManual: options.inferManual ?? false });
      if (!isExtractedOrderRow(row)) {
        resolution.skippedFiles.push(path.basename(filePath));
        options.progress?.({ index: index + 1, total, filename: path.basename(filePath), status: "completed" });
        continue;
      }
      const fileStat = await stat(filePath);
      rowEntries.push({ index, filePath, mtimeMs: fileStat.mtimeMs, row });
    } catch (error) {
      failures.push({ path: filePath, error: error instanceof Error ? error.message : String(error) });
      options.progress?.({ index: index + 1, total, filename: path.basename(filePath), status: "failed" });
      continue;
    }
    options.progress?.({ index: index + 1, total, filename: path.basename(filePath), status: "completed" });
  }

  const dedupedRows = dedupeLatestRows(rowEntries);
  const sortedRows = sortExtractedRowsByIdealDate(dedupedRows);

  await writeCsv(sortedRows, outputs.csvOutput);
  await writeXlsx(sortedRows, outputs);
  await writeAuditCsv(sortedRows, outputs.auditOutput);

  return {
    inputFiles: resolution.inputFiles,
    rows: sortedRows,
    skippedFiles: resolution.skippedFiles,
    failures,
    outputs,
  };
}

export function isExtractedOrderRow(row: ExtractedOrderRow): boolean {
  const hasIdentifier = [1, 2, 6].some((index) => hasRowValue(row.values[index]));
  const hasDeadline = hasRowValue(row.values[14]);
  const hasDetail = [9, 10, 11, 12, 13, 19, 20, 21, 22, 23].some((index) => hasRowValue(row.values[index]));
  const hasOnlyUnsupportedLayoutNote =
    row.manualCheck.length > 0 && row.manualCheck.every((note) => note.startsWith("unsupported workbook layout"));

  if (hasOnlyUnsupportedLayoutNote && row.values.every((value) => !hasRowValue(value))) {
    return false;
  }
  return hasIdentifier && (hasDeadline || hasDetail);
}

function hasRowValue(value: string | number | null): boolean {
  return value !== null && String(value).trim() !== "";
}

function dedupeLatestRows(entries: ExtractedRowEntry[]): ExtractedOrderRow[] {
  const selected = new Map<string, { index: number; key: SourceSortKey; row: ExtractedOrderRow }>();
  const unkeyed: Array<{ index: number; row: ExtractedOrderRow }> = [];

  entries.forEach((entry) => {
    const job = cleanText(entry.row.values[6]);
    if (!job) {
      unkeyed.push({ index: entry.index, row: entry.row });
      return;
    }
    const candidate = { index: entry.index, key: sourceSortKey(entry), row: entry.row };
    const current = selected.get(job);
    if (!current || compareSourceSortKey(candidate.key, current.key) > 0) {
      selected.set(job, candidate);
    }
  });

  return [...unkeyed, ...Array.from(selected.values()).map(({ index, row }) => ({ index, row }))]
    .sort((left, right) => left.index - right.index)
    .map((item) => item.row);
}

type SourceSortKey = [number, number, number, string];

function sourceSortKey(entry: ExtractedRowEntry): SourceSortKey {
  const version = sourceVersionNumber(entry.row.sourceFile);
  if (version !== null) {
    return [1, version, entry.mtimeMs, entry.row.sourceFile];
  }
  return [0, 0, entry.mtimeMs, entry.row.sourceFile];
}

function sourceVersionNumber(sourceFile: string): number | null {
  const match = sourceFile.match(/__(\d+)__/);
  return match ? Number(match[1]) : null;
}

function compareSourceSortKey(left: SourceSortKey, right: SourceSortKey): number {
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];
    if (leftValue === rightValue) {
      continue;
    }
    if (typeof leftValue === "string" && typeof rightValue === "string") {
      return leftValue.localeCompare(rightValue);
    }
    return Number(leftValue) - Number(rightValue);
  }
  return 0;
}

function extractMetadata(
  workbook: ExcelJS.Workbook,
  worksheet: ExcelJS.Worksheet,
  filePath: string,
): { job: string | null; po: string; builder: string; deliveryDate: ExcelJS.CellValue; deliveryAddress: string; zone: string } {
  if (worksheet.name === "Main Sheet") {
    const address = extractSheetAddress(worksheet);
    return {
      job: parseJobNumber(cellText(worksheet.getCell("A1").value)) ?? parseJobNumber(path.basename(filePath)),
      po:
        sheetLabelValue(worksheet, ["po", "po no", "po number", "purchase order", "purchase order #"]) ||
        cellText(worksheet.getCell("B6").value),
      builder: sheetLabelValue(worksheet, ["builder", "invoice"]) || cellText(worksheet.getCell("B2").value),
      deliveryDate:
        sheetLabelValue(worksheet, ["delivery date", "delivery d", "date"]) || worksheet.getCell("B5").value,
      deliveryAddress: address.address || cellText(worksheet.getCell("B4").value),
      zone:
        address.zone ||
        sheetLabelValue(worksheet, ["delivery zone", "zone", "location", "delivry zone"]) ||
        cellText(worksheet.getCell("B7").value),
    };
  }
  if (worksheet.name === "Sheet1") {
    const address = extractSheetAddress(worksheet);
    return {
      job: parseJobNumber(cellText(worksheet.getCell("A1").value)) ?? parseJobNumber(path.basename(filePath)),
      po: sheetLabelValue(worksheet, ["po", "order #", "purchase order"]) || "",
      builder: sheetLabelValue(worksheet, ["builder", "invoice"]) || "",
      deliveryDate: sheetLabelValue(worksheet, ["delivery date", "delivery d", "date"]),
      deliveryAddress: address.address,
      zone: address.zone || sheetLabelValue(worksheet, ["zone", "location", "delivry zone"]),
    };
  }

  const data = workbook.getWorksheet("Data");
  const address = extractSheetAddress(worksheet);
  return {
    job:
      parseJobNumber(cellText(worksheet.getCell("C1").value)) ??
      parseJobNumber(cellText(data?.getCell("A2").value)) ??
      parseJobNumber(cellText(worksheet.getCell("A1").value)) ??
      parseJobNumber(path.basename(filePath)),
    po:
      cellText(worksheet.getCell("C6").value) ||
      cellText(data?.getCell("G2").value) ||
      sheetLabelValue(worksheet, ["po", "po no", "po number", "purchase order", "purchase order #"]),
    builder: cellText(worksheet.getCell("C2").value) || cellText(data?.getCell("C2").value) || sheetLabelValue(worksheet, ["builder", "invoice"]),
    deliveryAddress:
      cellText(worksheet.getCell("C4").value) ||
      cellText(data?.getCell("E2").value) ||
      address.address ||
      sheetLabelValue(worksheet, ["delivery address", "delivery a", "address"]),
    deliveryDate: worksheet.getCell("C5").value || data?.getCell("F2").value || sheetLabelValue(worksheet, ["delivery date", "delivery d", "date"]),
    zone: cellText(worksheet.getCell("C7").value) || cellText(data?.getCell("I2").value) || address.zone || sheetLabelValue(worksheet, ["zone"]),
  };
}

function sheetLabelValue(worksheet: ExcelJS.Worksheet, labels: string[], maxRight = 4): string {
  const found = findLabelCell(worksheet, labels);
  if (!found) {
    return "";
  }
  for (let offset = 1; offset <= maxRight; offset += 1) {
    const value = cellText(worksheet.getCell(found.row, found.column + offset).value);
    if (hasValue(value)) {
      return value;
    }
  }
  return "";
}

function extractSheetAddress(worksheet: ExcelJS.Worksheet): { zone: string; address: string } {
  const found = findLabelCell(worksheet, ["delivery address", "delivery a", "address"]);
  if (!found) {
    return { zone: "", address: "" };
  }
  const values: string[] = [];
  for (let offset = 1; offset <= 4; offset += 1) {
    const value = cellText(worksheet.getCell(found.row, found.column + offset).value);
    if (hasValue(value)) {
      values.push(value);
    }
  }
  if (values.length === 0) {
    return { zone: "", address: "" };
  }
  if (values.length >= 2 && /^\d{2}[A-Za-z]$/.test(values[0])) {
    return { zone: normalizeZone(values[0]) ?? "", address: values[1] };
  }
  return splitZoneAndAddress(values[0]);
}

function splitZoneAndAddress(text: string): { zone: string; address: string } {
  const cleaned = cleanText(text);
  const match = cleaned.match(/^(\d{2}[A-Za-z])(?:\s*[-,]\s*|\s+)(.+)$/);
  if (match) {
    return { zone: normalizeZone(match[1]) ?? "", address: match[2] };
  }
  return { zone: "", address: cleaned };
}

function findLabelCell(worksheet: ExcelJS.Worksheet, labels: string[], maxRow = 20): { row: number; column: number } | null {
  const labelSet = new Set(labels);
  for (let row = 1; row <= Math.min(worksheet.rowCount, maxRow); row += 1) {
    if (rowIsHidden(worksheet, row)) {
      continue;
    }
    for (let column = 1; column <= worksheet.columnCount; column += 1) {
      const label = cellText(worksheet.getCell(row, column).value).toLowerCase().replace(/:$/, "");
      if (labelSet.has(label)) {
        return { row, column };
      }
    }
  }
  return null;
}

function extractDetailLines(worksheet: ExcelJS.Worksheet): DetailLine[] {
  for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    if (rowIsHidden(worksheet, rowNumber)) {
      continue;
    }
    const row = worksheet.getRow(rowNumber);
    const firstCell = cellText(row.getCell(1).value).toLowerCase();
    const thirdCell = cellText(row.getCell(3).value).toLowerCase();
    const fourthCell = cellText(row.getCell(4).value).toLowerCase();
    if (firstCell === "material" && thirdCell === "qty" && fourthCell.startsWith("profile")) {
      const lines: DetailLine[] = [];
      for (let detailRow = rowNumber + 1; detailRow <= worksheet.rowCount; detailRow += 1) {
        if (rowIsHidden(worksheet, detailRow)) {
          continue;
        }
        const current = worksheet.getRow(detailRow);
        const material = cellText(current.getCell(1).value);
        const quantity = numberValue(current.getCell(3).value);
        const profile = cellText(current.getCell(4).value);
        if (quantity !== null && (profile || material)) {
          const isCavity = standardWorksheetRowIsCavity(worksheet, detailRow);
          const cavityDefaultMaterial = isCavity ? cavitySliderDefaultMaterial(profile) : null;
          const isCavityAccessory = isCavity && isCavityAccessoryProfile(profile);
          lines.push({
            material: material || cavityDefaultMaterial || "",
            quantity,
            profile,
            revealWidth: cellText(current.getCell(7).value),
            hingeQty: cellText(current.getCell(9).value),
            hingeType: cellText(current.getCell(10).value),
            strikerType: cellText(current.getCell(11).value),
            sill: cellText(current.getCell(13).value),
            double: cellText(current.getCell(15).value),
            strikerType2: cellText(current.getCell(18).value),
            goodsOverride: isCavity ? cavityGoodsOverride(profile) : undefined,
            materialCodeExtras: material && cavityDefaultMaterial ? [cavityDefaultMaterial] : undefined,
            classifyForManualCheck: isCavityAccessory,
          });
        }
      }
      return lines;
    }
  }
  return [];
}

function worksheetHasStandardDetailHeader(worksheet: ExcelJS.Worksheet): boolean {
  return (
    cellText(worksheet.getCell("A9").value).toUpperCase() === "MATERIAL" &&
    cellText(worksheet.getCell("C9").value).toUpperCase() === "QTY" &&
    cellText(worksheet.getCell("D9").value).toUpperCase() === "PROFILE"
  );
}

function standardWorksheetRowIsCavity(worksheet: ExcelJS.Worksheet, rowNumber: number): boolean {
  for (let row = rowNumber; row >= 9; row -= 1) {
    if (rowIsHidden(worksheet, row)) {
      continue;
    }
    const first = cellText(worksheet.getCell(row, 1).value).toUpperCase();
    const parts: string[] = [];
    for (let column = 1; column <= Math.min(worksheet.columnCount, 14); column += 1) {
      parts.push(cellText(worksheet.getCell(row, column).value));
    }
    const line = parts.join(" ").toUpperCase();
    if (row !== rowNumber && first === "MATERIAL") {
      return false;
    }
    if (line.includes("CAVITY") || line.includes("SLIDER")) {
      return true;
    }
  }
  return false;
}

function extractProfileTableLines(worksheet: ExcelJS.Worksheet, sourceFile: string): DetailLine[] {
  const headers = findProfileHeaders(worksheet);
  const profilelessHeaders = findProfilelessHeaders(worksheet);
  const materialCodes = sheetMaterialCodes(worksheet);
  const material = materialCodes[0] ?? "";
  const lines: DetailLine[] = [];

  headers.forEach((header, index) => {
    const nextHeaderRow =
      headers.slice(index + 1).find((candidate) => candidate.row > header.row)?.row ?? worksheet.rowCount + 1;
    const isCavityTable = sheetTableIsCavity(worksheet, header.row);
    const tableHasFlatSheet = tableContainsText(worksheet, header.row + 1, nextHeaderRow, "FLAT SHEET");
    const quantityColumn = findProductQuantityColumn(worksheet, header.row);
    const handColumn = findHeaderColumn(worksheet, header.row, (text) => /\bHAND\b/.test(text));
    const hingeColumn = findSheet1HingeQuantityColumn(worksheet, header.row);
    const strikerColumn = findHeaderColumn(worksheet, header.row, (text, column) => (text === "TYPE" && column > header.column) || (text.includes("STRIKER") && (text.includes("TYPE") || text.includes("STRIKE"))));
    const sillColumn = findHeaderColumn(worksheet, header.row, (text) => /\bSILL\b/.test(text));
    const widthColumns = findWidthColumns(worksheet, header.row);

    for (let row = header.row + 1; row < nextHeaderRow; row += 1) {
      if (rowIsHidden(worksheet, row)) {
        continue;
      }
      const profile = cellText(worksheet.getCell(row, header.column).value);
      if (!profile) {
        continue;
      }
      if (cellText(worksheet.getCell(row, 1).value).toLowerCase().startsWith("material")) {
        continue;
      }
      if (materialCode(profile)) {
        continue;
      }
      if (isReplacementHeadOnly(profile, rowText(worksheet, row))) {
        continue;
      }
      const quantity = quantityColumn ? numberValue(worksheet.getCell(row, quantityColumn).value) ?? 0 : 1;
      if (quantity <= 0) {
        continue;
      }
      const context = rowText(worksheet, row);
      const hand = handColumn ? cellText(worksheet.getCell(row, handColumn).value) : "";
      const hasHingePlates = sheet1RowHasHingePlates(worksheet, row, header.row);
      const vPartsExtra = quantity * sheet1NumericPartQuantity(worksheet, row, header.row);
      const sourceOverride = sourceGoodsOverride(sourceFile, context, tableHasFlatSheet, profile);
      const cavityDefaultMaterial = isCavityTable ? cavitySliderDefaultMaterial(profile) : null;
      const materialCodeExtras = extraMaterialCodes(materialCodes, cavityDefaultMaterial);
      lines.push({
        material: material || cavityDefaultMaterial || "",
        quantity,
        profile,
        revealWidth: maxWidthText(worksheet, row, widthColumns, header.row),
        hingeQty: hingeColumn ? cellText(worksheet.getCell(row, hingeColumn).value) : "",
        hingeType: hasHingePlates ? "HINGE PLATE" : "",
        strikerType: strikerColumn ? cellText(worksheet.getCell(row, strikerColumn).value) : "",
        sill: sillColumn ? cellText(worksheet.getCell(row, sillColumn).value) : "",
        double: hand,
        strikerType2: "",
        goodsOverride: sourceOverride !== undefined ? sourceOverride : isCavityTable ? cavityGoodsOverride(profile) : undefined,
        materialCodeExtras,
        hingeQtyBucket: hasHingePlates || worksheet.name === "Main Sheet" ? "w" : undefined,
        partsWMultiplier: hasHingePlates || worksheet.name === "Main Sheet" ? 1.43 : undefined,
        vPartsExtra,
      });
    }
  });

  profilelessHeaders.forEach((header, index) => {
    const nextHeaderRow =
      profilelessHeaders.slice(index + 1).find((candidate) => candidate.row > header.row)?.row ??
      headers.find((candidate) => candidate.row > header.row)?.row ??
      worksheet.rowCount + 1;
    const isCavityTable = sheetTableIsCavity(worksheet, header.row);
    const tableHasFlatSheet = tableContainsText(worksheet, header.row + 1, nextHeaderRow, "FLAT SHEET");
    const quantityColumn = findProductQuantityColumn(worksheet, header.row);
    const handColumn = findHeaderColumn(worksheet, header.row, (text) => /\bHAND\b/.test(text)) ?? 5;
    const hingeColumn = findSheet1HingeQuantityColumn(worksheet, header.row);
    const strikerColumn = findHeaderColumn(worksheet, header.row, (text, column) => (text === "TYPE" && column > header.column) || (text.includes("STRIKER") && (text.includes("TYPE") || text.includes("STRIKE"))));
    const sillColumn = findHeaderColumn(worksheet, header.row, (text) => /\bSILL\b/.test(text));
    const widthColumns = findWidthColumns(worksheet, header.row);

    for (let row = header.row + 1; row < nextHeaderRow; row += 1) {
      if (rowIsHidden(worksheet, row)) {
        continue;
      }
      if (rowLooksProfilelessTableHeader(worksheet, row)) {
        break;
      }
      const first = cellText(worksheet.getCell(row, 1).value);
      if (!first || first.toLowerCase().startsWith("material")) {
        break;
      }
      const profile = cellText(worksheet.getCell(row, header.column).value);
      if (!hasValue(profile)) {
        break;
      }
      if (isReplacementHeadOnly(profile, rowText(worksheet, row))) {
        continue;
      }
      const quantity = quantityColumn ? numberValue(worksheet.getCell(row, quantityColumn).value) ?? 0 : 1;
      if (quantity <= 0) {
        continue;
      }
      const context = rowText(worksheet, row);
      const hasHingePlates = sheet1RowHasHingePlates(worksheet, row, header.row);
      const vPartsExtra = quantity * sheet1NumericPartQuantity(worksheet, row, header.row);
      const sourceOverride = sourceGoodsOverride(sourceFile, context, tableHasFlatSheet, profile);
      const cavityDefaultMaterial = isCavityTable ? cavitySliderDefaultMaterial(profile) : null;
      const materialCodeExtras = extraMaterialCodes(materialCodes, cavityDefaultMaterial);
      lines.push({
        material: material || cavityDefaultMaterial || "",
        quantity,
        profile,
        revealWidth: maxWidthText(worksheet, row, widthColumns, header.row),
        hingeQty: hingeColumn ? cellText(worksheet.getCell(row, hingeColumn).value) : "",
        hingeType: hasHingePlates ? "HINGE PLATE" : "",
        strikerType: strikerColumn ? cellText(worksheet.getCell(row, strikerColumn).value) : "",
        sill: sillColumn ? cellText(worksheet.getCell(row, sillColumn).value) : "",
        double: cellText(worksheet.getCell(row, handColumn).value),
        strikerType2: "",
        goodsOverride:
          sourceOverride !== undefined
            ? sourceOverride
            : isCavityTable
              ? cavityGoodsOverride(profile)
            : worksheet.name === "Main Sheet"
                ? "COMMERCIAL"
                : undefined,
        materialCodeExtras,
        classifyForManualCheck:
          worksheet.name === "Main Sheet" && !isCavityTable && sourceOverride === undefined,
        hingeQtyBucket: "w",
        partsWMultiplier: hasHingePlates ? 1.43 : undefined,
        vPartsExtra,
      });
    }
  });

  return lines;
}

function applyMainFallbackExtraction(
  worksheet: ExcelJS.Worksheet,
  values: Array<string | number | null>,
  manualCheck: string[],
  inferManual: boolean,
  notes: string[],
): boolean {
  const materials: string[] = [];
  for (let row = 1; row <= worksheet.rowCount; row += 1) {
    if (rowIsHidden(worksheet, row)) {
      continue;
    }
    if (cellText(worksheet.getCell(row, 1).value).toLowerCase().startsWith("material")) {
      const code = materialCode(`${cellText(worksheet.getCell(row, 2).value)} ${cellText(worksheet.getCell(row, 3).value)}`);
      if (code) {
        materials.push(code);
      }
    }
  }
  values[9] = joinMaterials(materials);

  const goodsTotals = new Map<string, number>();
  const manualTotals = createManualTotals();
  manualTotals.overSizeMarker = worksheetOverSizeMarker(worksheet);
  const widthColumns = mainFallbackWidthColumns(worksheet);

  for (const row of iterMainFallbackRows(worksheet)) {
    const rawA = worksheet.getCell(row, 1).value;
    const qtyA = numberValue(rawA);
    const qtyF = numberValue(worksheet.getCell(row, 6).value);
    const profile = cellText(worksheet.getCell(row, 2).value);
    const goods = classifyGoods(profile, manualCheck);
    const hand = cellText(worksheet.getCell(row, 5).value).toUpperCase();
    let productQuantity = 0;

    if (typeof rawA === "number" && qtyA !== null && hasValue(profile) && goods !== "COMMERCIAL") {
      productQuantity = qtyA;
    } else if (goods === "COMMERCIAL" && qtyF !== null) {
      productQuantity = qtyF;
    }

    addGoods(goodsTotals, goods, productQuantity);
    if (goods === "SPLIT" || goods === "SPLIT DL") {
      if (hand === "DOUBLE") {
        manualTotals.doubleQty += productQuantity;
        manualTotals.mitre += productQuantity * splitMitreMultiplier(profile, true);
      } else {
        manualTotals.mitre += productQuantity * splitMitreMultiplier(profile, false);
      }
    } else if (goods === "CS") {
      manualTotals.mitre += productQuantity * 14;
    } else if (goods === "COMMERCIAL" || goods === "MODERN" || goods === "DELUXE") {
      manualTotals.mitre += productQuantity;
    }

    const stud = numberValue(worksheet.getCell(row, 11).value);
    const striker = hasValue(worksheet.getCell(row, 8).value) ? 1 : 0;
    if (stud !== null) {
      manualTotals.v += stud + striker;
      if (qtyF !== null) {
        manualTotals.w += qtyF;
        manualTotals.weightedWParts += qtyF * 1.43;
      }
    } else if (qtyF !== null) {
      manualTotals.v += qtyF;
    }
    if (mainFallbackRowIsOverSize(worksheet, row, widthColumns)) {
      manualTotals.overSizeQty += 1;
    }
  }

  if (inferManual) {
    const stillageNote = mainFallbackStillageNote(worksheet);
    if (stillageNote) {
      notes.push(stillageNote);
      if (!manualTotals.overSizeMarker && !manualTotals.overSizeQty) {
        addManualCheck(manualCheck, "Over Size requires manual entry");
      }
    }
    writeManualTotals(values, manualTotals, manualCheck);
  }
  writeGoods(values, goodsTotals, manualCheck);
  return true;
}

function iterMainFallbackRows(worksheet: ExcelJS.Worksheet): number[] {
  const rows: number[] = [];
  for (let row = 1; row <= worksheet.rowCount; row += 1) {
    if (rowIsHidden(worksheet, row)) {
      continue;
    }
    const first = worksheet.getCell(row, 1).value;
    const second = worksheet.getCell(row, 2).value;
    const third = worksheet.getCell(row, 3).value;
    const fourth = worksheet.getCell(row, 4).value;
    const sixth = worksheet.getCell(row, 6).value;
    if (
      [first, sixth].some((value) => numberValue(value) !== null) &&
      [second, third, fourth].some((value) => hasValue(value)) &&
      !["door #", "qty"].includes(cellText(first).toLowerCase()) &&
      cellText(second).toLowerCase() !== "profile"
    ) {
      rows.push(row);
    }
  }
  return rows;
}

function mainFallbackStillageNote(worksheet: ExcelJS.Worksheet): string | null {
  for (let row = 1; row <= worksheet.rowCount; row += 1) {
    if (rowIsHidden(worksheet, row)) {
      continue;
    }
    const line = rowText(worksheet, row);
    if (line.toUpperCase().includes("STILLAGE")) {
      return `row ${row}: ${line}`;
    }
  }
  return null;
}

function mainFallbackWidthColumns(worksheet: ExcelJS.Worksheet): number[] {
  const columns: number[] = [];
  for (let row = 1; row <= Math.min(worksheet.rowCount, 40); row += 1) {
    if (rowIsHidden(worksheet, row)) {
      continue;
    }
    for (let column = 1; column <= worksheet.columnCount; column += 1) {
      const context: string[] = [];
      for (let contextRow = Math.max(1, row - 1); contextRow <= Math.min(worksheet.rowCount, row + 1); contextRow += 1) {
        if (!rowIsHidden(worksheet, contextRow)) {
          context.push(cellText(worksheet.getCell(contextRow, column).value));
        }
      }
      if (context.join(" ").toUpperCase().includes("WIDTH") && !columns.includes(column)) {
        columns.push(column);
      }
    }
  }
  return columns;
}

function mainFallbackRowIsOverSize(worksheet: ExcelJS.Worksheet, row: number, widthColumns: number[]): boolean {
  return widthColumns.some((column) =>
    widthExceedsOverSizeThreshold(worksheet.getCell(row, column).value, widthColumnContext(worksheet, column)),
  );
}

function findProfileHeaders(worksheet: ExcelJS.Worksheet): Array<{ row: number; column: number }> {
  const headers: Array<{ row: number; column: number }> = [];
  for (let row = 1; row <= Math.min(worksheet.rowCount, 100); row += 1) {
    if (rowIsHidden(worksheet, row)) {
      continue;
    }
    for (let column = 1; column <= worksheet.columnCount; column += 1) {
      if (cellText(worksheet.getCell(row, column).value).toLowerCase().startsWith("profile")) {
        headers.push({ row, column });
      }
    }
  }
  return headers;
}

function findProfilelessHeaders(worksheet: ExcelJS.Worksheet): Array<{ row: number; column: number }> {
  const headers: Array<{ row: number; column: number }> = [];
  for (let row = 1; row <= Math.min(worksheet.rowCount, 180); row += 1) {
    if (rowIsHidden(worksheet, row)) {
      continue;
    }
    const candidate = rowLooksProfilelessTableHeader(worksheet, row)
      ? { row: row + 1, column: 2 }
      : rowIsProfilelessTableHeader(worksheet, row)
        ? { row, column: 2 }
        : null;
    if (candidate && !headers.some((header) => header.row === candidate.row && header.column === candidate.column)) {
      headers.push(candidate);
    }
  }
  return headers;
}

function rowLooksProfilelessTableHeader(worksheet: ExcelJS.Worksheet, row: number): boolean {
  if (row >= worksheet.rowCount || rowIsHidden(worksheet, row) || rowIsHidden(worksheet, row + 1)) {
    return false;
  }
  const nextFirst = cellText(worksheet.getCell(row + 1, 1).value).toLowerCase();
  const nextSecond = cellText(worksheet.getCell(row + 1, 2).value).toUpperCase();
  if (nextFirst !== "door #" || nextSecond !== "TYPE") {
    return false;
  }
  const line = rowText(worksheet, row).toUpperCase();
  return !line.includes("PROFILE") && ["WALL", "FRAME", "CAVITY", "HINGE"].some((token) => line.includes(token));
}

function rowIsProfilelessTableHeader(worksheet: ExcelJS.Worksheet, row: number): boolean {
  if (rowIsHidden(worksheet, row)) {
    return false;
  }
  const first = cellText(worksheet.getCell(row, 1).value).toLowerCase();
  const second = cellText(worksheet.getCell(row, 2).value).toUpperCase();
  return first === "door #" && second === "TYPE" && !rowText(worksheet, row).toUpperCase().includes("PROFILE");
}

function rowText(worksheet: ExcelJS.Worksheet, row: number): string {
  const parts: string[] = [];
  for (let column = 1; column <= worksheet.columnCount; column += 1) {
    parts.push(cellText(worksheet.getCell(row, column).value));
  }
  return parts.join(" ");
}

function tableContainsText(worksheet: ExcelJS.Worksheet, startRow: number, endRow: number, text: string): boolean {
  const needle = text.toUpperCase();
  for (let row = startRow; row < endRow; row += 1) {
    if (rowIsHidden(worksheet, row)) {
      continue;
    }
    if (rowText(worksheet, row).toUpperCase().includes(needle)) {
      return true;
    }
  }
  return false;
}

function workbookOverSizeMarker(workbook: ExcelJS.Workbook): string | null {
  const markers = workbook.worksheets.map((worksheet) => worksheetOverSizeMarker(worksheet));
  return ["glut", "pallet", "stillages"].find((marker) => markers.includes(marker)) ?? null;
}

function worksheetOverSizeMarker(worksheet: ExcelJS.Worksheet): string | null {
  const markers: string[] = [];
  for (let row = 1; row <= worksheet.rowCount; row += 1) {
    if (rowIsHidden(worksheet, row)) {
      continue;
    }
    const parts: string[] = [];
    for (let column = 1; column <= Math.min(worksheet.columnCount, 24); column += 1) {
      parts.push(cellText(worksheet.getCell(row, column).value));
    }
    const marker = overSizeMarkerFromText(parts.join(" "));
    if (marker) {
      markers.push(marker);
    }
  }
  return ["glut", "pallet", "stillages"].find((marker) => markers.includes(marker)) ?? null;
}

function overSizeMarkerFromText(value: string): string | null {
  const upper = cleanText(value).toUpperCase();
  if (upper.includes("GLUT")) {
    return "glut";
  }
  if (upper.includes("PALLET")) {
    return "pallet";
  }
  if (upper.includes("STILLAGE")) {
    return "stillages";
  }
  return null;
}

function rowIsHidden(worksheet: ExcelJS.Worksheet, row: number): boolean {
  return Boolean(worksheet.getRow(row).hidden);
}

function sheet1RowHasHingePlates(worksheet: ExcelJS.Worksheet, row: number, headerRow: number): boolean {
  for (let column = 1; column <= worksheet.columnCount; column += 1) {
    const header = sheetHeaderText(worksheet, headerRow, column);
    if (header.includes("HINGE PLATE") && hasValue(worksheet.getCell(row, column).value)) {
      return true;
    }
  }
  return false;
}

function sheet1NumericPartQuantity(worksheet: ExcelJS.Worksheet, row: number, headerRow: number): number {
  let total = 0;
  for (let column = 1; column <= worksheet.columnCount; column += 1) {
    const header = sheetHeaderText(worksheet, headerRow, column);
    if (header.includes("BACKING PLATE") || header.includes("HINGE") || header.includes("STRIKER")) {
      continue;
    }
    const multiplier = sheet1DynaHardwareMultiplier(header);
    if (!multiplier && !["STUD", "DYNA", "2110"].some((token) => header.includes(token))) {
      continue;
    }
    total += (numberValue(worksheet.getCell(row, column).value) ?? 0) * (multiplier ?? 1);
  }
  return total;
}

function sheetTableIsCavity(worksheet: ExcelJS.Worksheet, headerRow: number): boolean {
  for (let row = Math.max(1, headerRow - 2); row <= headerRow; row += 1) {
    if (rowIsHidden(worksheet, row)) {
      continue;
    }
    const line = rowText(worksheet, row).toUpperCase();
    if (line.includes("CAVITY") || line.includes("SLIDER")) {
      return true;
    }
  }
  return false;
}

function cavityGoodsOverride(profile: string): string | null | undefined {
  if (isCavityAccessoryProfile(profile)) {
    return null;
  }
  const goods = classifyGoods(profile);
  if (goods === null || goods === "MODERN" || goods === "DELUXE") {
    return "CS";
  }
  return undefined;
}

function sourceGoodsOverride(
  sourceFile: string,
  context: string,
  tableHasFlatSheet: boolean,
  profile: string,
): string | null | undefined {
  const sourceUpper = sourceFile.toUpperCase();
  const upper = context.toUpperCase();
  const profileUpper = cleanText(profile).toUpperCase();
  if (sourceUpper.includes("TRAD DYNA")) {
    return "COMMERCIAL";
  }
  if (sourceUpper.includes("DOOR STOP BUILD UP")) {
    return "CP";
  }
  if (sourceUpper.includes("DOOR SKIN")) {
    if (upper.includes("FLAT SHEET")) {
      return "DS";
    }
    if (upper.includes("CAPPING")) {
      return tableHasFlatSheet ? null : "DS";
    }
    return "DS";
  }
  if (upper.includes("CONCEALED FRAME")) {
    return "CONCEALED";
  }
  if (upper.includes("/CAV/") || upper.includes("COWDROY") || profileUpper.includes("CLOSING JAMB")) {
    return "CS";
  }
  return undefined;
}

function deluxeCleatsExtraParts(sourceFile: string, profile: string, goods: string | null, quantity: number): number {
  if (!sourceFile.toUpperCase().includes("CLEAT") || goods !== "DELUXE" || quantity <= 0) {
    return 0;
  }
  return profileIsDeluxeDryLining(profile) ? quantity * 6 : 0;
}

function profileIsDeluxeDryLining(profile: string): boolean {
  const upper = cleanText(profile).toUpperCase();
  return upper.includes("DRY LINING") || upper.includes("DR LINING");
}

function cavitySliderDefaultMaterial(profile: string): string | null {
  const goods = classifyGoods(profile);
  const upper = cleanText(profile).toUpperCase();
  if (upper.includes("MODERN") || goods === "MODERN") {
    return "1.6Z";
  }
  if (upper.includes("DELUXE") || goods === "DELUXE") {
    return "1Z";
  }
  return null;
}

function isCavityAccessoryProfile(profile: string): boolean {
  const upper = cleanText(profile).toUpperCase();
  return upper.includes("SOFT CLOSER") || upper.includes("SOFT CLOSE");
}

function isReplacementHeadOnly(profile: string, context: string): boolean {
  return cleanText(profile).toUpperCase().includes("HEAD ONLY") && context.toUpperCase().includes("REPLACEMENT HEAD");
}

function extractNonstandardDoorLines(worksheet: ExcelJS.Worksheet, sourceFile: string): DetailLine[] {
  const materialCodes = sheetMaterialCodes(worksheet);
  const material = materialCodes[0] ?? "";
  const materialCodeExtras = extraMaterialCodes(materialCodes, null);
  for (let headerRow = 1; headerRow <= Math.min(worksheet.rowCount, 180); headerRow += 1) {
    if (rowIsHidden(worksheet, headerRow)) {
      continue;
    }
    const headers = new Map<string, number>();
    for (let column = 1; column <= worksheet.columnCount; column += 1) {
      const header = cellText(worksheet.getCell(headerRow, column).value).toLowerCase();
      if (header) {
        headers.set(header, column);
      }
    }

    const doorColumn = headers.get("door #");
    const quantityColumn = headers.get("qty") ?? headers.get("quantity");
    if (!doorColumn || !quantityColumn) {
      continue;
    }

    const lines: DetailLine[] = [];
    for (let row = headerRow + 1; row <= worksheet.rowCount; row += 1) {
      if (rowIsHidden(worksheet, row)) {
        continue;
      }
      if (cellText(worksheet.getCell(row, 1).value).toLowerCase() === "material") {
        break;
      }
      const quantity = numberValue(worksheet.getCell(row, quantityColumn).value);
      if (quantity === null || quantity <= 0) {
        continue;
      }
      const profile = cellText(worksheet.getCell(row, doorColumn).value);
      if (!hasValue(profile)) {
        continue;
      }
      const context = rowText(worksheet, row);
      lines.push({
        material,
        quantity,
        profile,
        revealWidth: "",
        hingeQty: "",
        hingeType: "",
        strikerType: "",
        sill: "",
        double: "",
        strikerType2: "",
        materialCodeExtras,
        goodsOverride: nonstandardWorksheetGoodsOverride(sourceFile, context),
      });
    }

    if (lines.length > 0) {
      return lines;
    }
  }
  return [];
}

function nonstandardWorksheetGoodsOverride(sourceFile: string, context: string): string | undefined {
  const sourceUpper = sourceFile.toUpperCase();
  const contextUpper = context.toUpperCase();
  if (sourceUpper.includes("DOOR STOP BUILD UP")) {
    return "CP";
  }
  if (sourceUpper.includes("TRAD DYNA")) {
    return "COMMERCIAL";
  }
  if (contextUpper.includes("CONCEALED FRAME")) {
    return "CONCEALED";
  }
  return undefined;
}

function extraMaterialCodes(materialCodes: string[], cavityDefaultMaterial: string | null): string[] | undefined {
  const extras = materialCodes.slice(1);
  if (materialCodes.length > 0 && cavityDefaultMaterial) {
    extras.push(cavityDefaultMaterial);
  }
  return extras.length > 0 ? extras : undefined;
}

function findHeaderColumn(
  worksheet: ExcelJS.Worksheet,
  headerRow: number,
  predicate: (header: string, column: number) => boolean,
): number | null {
  for (let column = 1; column <= worksheet.columnCount; column += 1) {
    const header = sheetHeaderText(worksheet, headerRow, column);
    if (predicate(header, column)) {
      return column;
    }
  }
  return null;
}

function findWidthColumns(worksheet: ExcelJS.Worksheet, headerRow: number): number[] {
  const columns: number[] = [];
  for (let column = 1; column <= worksheet.columnCount; column += 1) {
    if (sheetHeaderText(worksheet, headerRow, column).includes("WIDTH")) {
      columns.push(column);
    }
  }
  return columns;
}

function overSizeWidthThreshold(header: string): number {
  return cleanText(header).toUpperCase().includes("OVERALL") ? OVER_SIZE_OVERALL_WIDTH_THRESHOLD : OVER_SIZE_REVEAL_WIDTH_THRESHOLD;
}

function widthColumnContext(worksheet: ExcelJS.Worksheet, column: number): string {
  const parts: string[] = [];
  for (let row = 1; row <= Math.min(worksheet.rowCount, 40); row += 1) {
    if (rowIsHidden(worksheet, row)) {
      continue;
    }
    const text = cellText(worksheet.getCell(row, column).value);
    if (text) {
      parts.push(text);
    }
  }
  return parts.join(" ");
}

function widthExceedsOverSizeThreshold(value: ExcelJS.CellValue, header: string): boolean {
  const width = numberValue(value);
  return width !== null && width > overSizeWidthThreshold(header);
}

function maxWidthText(worksheet: ExcelJS.Worksheet, row: number, columns: number[], headerRow?: number): string {
  const maxWidth = Math.max(
    0,
    ...columns.map((column) => {
      const width = numberValue(worksheet.getCell(row, column).value) ?? 0;
      const header = headerRow === undefined ? widthColumnContext(worksheet, column) : sheetHeaderText(worksheet, headerRow, column);
      return width > overSizeWidthThreshold(header) ? width : 0;
    }),
  );
  return maxWidth > 0 ? String(maxWidth) : "";
}

function findProductQuantityColumn(worksheet: ExcelJS.Worksheet, headerRow: number): number | null {
  for (let column = 1; column <= worksheet.columnCount; column += 1) {
    const header = sheetHeaderText(worksheet, headerRow, column);
    if (!/\b(QTY|QUANTITY)\b/.test(header)) {
      continue;
    }
    if (sheet1QuantityColumnIsHardware(worksheet, headerRow, column)) {
      continue;
    }
    return column;
  }
  return null;
}

function findSheet1HingeQuantityColumn(worksheet: ExcelJS.Worksheet, headerRow: number): number | null {
  for (let column = 1; column <= worksheet.columnCount; column += 1) {
    const header = sheetHeaderText(worksheet, headerRow, column);
    if (sheet1DynaHardwareMultiplier(header)) {
      continue;
    }
    if (header.includes("HINGE") && header.includes("QTY")) {
      return column;
    }
    if (/\bQTY\b/.test(header) && sheet1QuantityColumnIsHardware(worksheet, headerRow, column)) {
      return column;
    }
  }
  return null;
}

function sheet1QuantityColumnIsHardware(worksheet: ExcelJS.Worksheet, headerRow: number, column: number): boolean {
  const header = sheetHeaderText(worksheet, headerRow, column);
  if (sheet1DynaHardwareMultiplier(header)) {
    return true;
  }
  if (["HINGE", "STRIKER", "DYNA", "BOLT", "PLATE"].some((token) => header.includes(token))) {
    return true;
  }
  const previousHeader = column > 1 ? sheetHeaderText(worksheet, headerRow, column - 1) : "";
  const nextHeader = column < worksheet.columnCount ? sheetHeaderText(worksheet, headerRow, column + 1) : "";
  return nextHeader.includes("HINGE") || nextHeader.includes("TO SUIT") || previousHeader.includes("HAND");
}

function sheetHeaderText(worksheet: ExcelJS.Worksheet, headerRow: number, column: number): string {
  const parts: string[] = [];
  for (let row = Math.max(1, headerRow - 2); row <= headerRow; row += 1) {
    const text = cellText(worksheet.getCell(row, column).value);
    if (text) {
      parts.push(text);
    }
  }
  return parts.join(" ").toUpperCase();
}

function sheet1DynaHardwareMultiplier(header: string): number | null {
  const tokens = new Set(header.replace(/[^A-Z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean));
  if (tokens.has("CSK") && tokens.has("DTNA")) {
    return 2;
  }
  if (tokens.has("CSK") && tokens.has("DYNA") && tokens.has("TUBE")) {
    return 4;
  }
  if (tokens.has("DYNA") && (tokens.has("TRADITION") || tokens.has("TRAD"))) {
    return 1;
  }
  return null;
}

function sheetMaterialCodes(worksheet: ExcelJS.Worksheet): string[] {
  const values: string[] = [];
  for (let row = 1; row <= Math.min(worksheet.rowCount, 180); row += 1) {
    if (rowIsHidden(worksheet, row)) {
      continue;
    }
    for (let column = 1; column <= worksheet.columnCount; column += 1) {
      if (cellText(worksheet.getCell(row, column).value).toLowerCase().replace(/:$/, "") !== "material") {
        continue;
      }
      const parts: string[] = [];
      for (let offset = 1; offset <= 4; offset += 1) {
        const value = cellText(worksheet.getCell(row, column + offset).value);
        if (value) {
          parts.push(value);
        }
      }
      const joinedCode = materialCode(parts.join(" "));
      if (joinedCode) {
        values.push(joinedCode);
      }
      for (let offset = 1; offset <= 4; offset += 1) {
        const code = materialCode(cellText(worksheet.getCell(row, column + offset).value));
        if (code) {
          values.push(code);
        }
      }
    }
  }
  if (values.length === 0) {
    for (let row = 1; row <= Math.min(worksheet.rowCount, 15); row += 1) {
      if (rowIsHidden(worksheet, row)) {
        continue;
      }
      for (let column = 1; column <= worksheet.columnCount; column += 1) {
        const code = materialCode(cellText(worksheet.getCell(row, column).value));
        if (code) {
          values.push(code);
        }
      }
    }
  }
  return values;
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (value instanceof Date) {
    return normalizeDate(value) ?? "";
  }
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") {
      return value.text.trim();
    }
    if ("result" in value) {
      return cellText(value.result as ExcelJS.CellValue);
    }
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((item) => item.text).join("").trim();
    }
  }
  return cleanText(value);
}

function numberValue(value: ExcelJS.CellValue): number | null {
  if (typeof value === "number") {
    return value;
  }
  const match = cellText(value).match(/-?\d+(?:\.\d+)?/);
  if (!match) {
    return null;
  }
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDate(value: ExcelJS.CellValue): string | null {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  const text = cellText(value);
  if (!text) {
    return null;
  }
  const parsedByPythonFormats = parsePythonDateText(text);
  if (parsedByPythonFormats) {
    return formatDateOnly(parsedByPythonFormats);
  }
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return null;
}

function previousBusinessDay(value: string | number | null): { date: string; weekday: string } | null {
  if (typeof value !== "string") {
    return null;
  }
  const day = parseDateOnly(value);
  if (!day) {
    return null;
  }
  day.setUTCDate(day.getUTCDate() - 1);
  while (!isWaWorkday(day)) {
    day.setUTCDate(day.getUTCDate() - 1);
  }
  return {
    date: formatDateOnly(day),
    weekday: new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(day),
  };
}

function isWaWorkday(day: Date): boolean {
  const date = formatDateOnly(day);
  const weekday = day.getUTCDay();
  return weekday !== 0 && weekday !== 6 && !WA_2026_PUBLIC_HOLIDAYS.has(date);
}

function parseDateOnly(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  return dateFromParts(Number(match[1]), Number(match[2]), Number(match[3]));
}

function formatDateOnly(day: Date): string {
  return day.toISOString().slice(0, 10);
}

function parsePythonDateText(value: string): Date | null {
  const text = value.trim();
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    return dateFromParts(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }
  const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!slash) {
    return null;
  }
  return dateFromParts(Number(slash[3]), Number(slash[2]), Number(slash[1]))
    ?? dateFromParts(Number(slash[3]), Number(slash[1]), Number(slash[2]));
}

function dateFromParts(year: number, month: number, day: number): Date | null {
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return parsed;
}

function parseJobNumber(text: string): string | null {
  const match = text.match(/#\s*(\d+[A-Za-z]?)/) ?? text.match(/\b(\d{4,6}[A-Za-z]?)\b/);
  return match?.[1] ?? null;
}

function normalizePo(text: string): string | null {
  const cleaned = cleanText(text).replace(/\s*\[[^\]]+\]\s*$/, "").trim();
  if (!cleaned) {
    return null;
  }
  if (/^\d+$/.test(cleaned)) {
    return cleaned.replace(/^0+/, "") || "0";
  }
  return cleaned;
}

function normalizePoForWorksheet(
  text: string,
  builder: string | number | null,
  worksheet: ExcelJS.Worksheet,
): string | null {
  const normalized = normalizePo(text);
  if (
    worksheet.name !== "Main Sheet" ||
    cleanText(builder).toUpperCase() !== "DANZE" ||
    !normalized ||
    !sheetHasDoorSkinProfile(worksheet)
  ) {
    return normalized;
  }
  const match = normalized.match(/^\d{2}-(\d+)-\d{2}$/);
  if (!match) {
    return normalized;
  }
  return match[1].replace(/^0+/, "") || "0";
}

function sheetHasDoorSkinProfile(worksheet: ExcelJS.Worksheet): boolean {
  for (let row = 1; row <= Math.min(worksheet.rowCount, 180); row += 1) {
    if (rowIsHidden(worksheet, row)) {
      continue;
    }
    for (let column = 1; column <= worksheet.columnCount; column += 1) {
      if (cellText(worksheet.getCell(row, column).value).toUpperCase().includes("SKIN")) {
        return true;
      }
    }
  }
  return false;
}

function normalizeZone(text: string): string | null {
  const cleaned = cleanText(text);
  if (!cleaned) {
    return null;
  }
  if (/^\d{2}[A-Za-z]$/.test(cleaned)) {
    return cleaned.toUpperCase();
  }
  return cleaned;
}

function normalizeDeliveryAddress(text: string): string | null {
  const cleaned = cleanText(text);
  if (!cleaned) {
    return null;
  }
  if (cleaned.replace(/[^A-Za-z0-9]+/g, "").toLowerCase() === "pickup") {
    return "PICK UP";
  }
  return cleaned.replace(/\bPICKUP\b/gi, "PICK UP");
}

function materialCode(text: string): string | null {
  const cleaned = cleanText(text);
  if (!cleaned || cleaned.toLowerCase() === "other") {
    return null;
  }
  if (/^\d+(?:\.\d+)?(?:Z|G|CB|SS)$/i.test(cleaned) || cleaned === "Aluminium") {
    return cleaned.replace(/(?:z|g|cb|ss)$/i, (suffix) => suffix.toUpperCase());
  }
  const lower = cleaned.toLowerCase();
  let suffix: string | null = null;
  if (lower.includes("colorbond") || lower.includes("colourbond") || hasColorbondColour(lower)) {
    suffix = "CB";
  } else if (lower.includes("stainless")) {
    suffix = "SS";
  } else if (lower.includes("aluminium") || lower.includes("aluminum")) {
    suffix = "Aluminium";
  } else if (lower.includes("galv") || lower.includes("galvanised") || lower.includes("galvanized")) {
    suffix = "G";
  } else if (lower.includes("zinc")) {
    suffix = "Z";
  }
  if (!suffix) {
    return null;
  }

  const match = cleaned.match(/(\d+(?:\.\d+)?)\s*mm/i);
  if (!match && suffix === "Aluminium") {
    return "Aluminium";
  }
  if (!match) {
    return null;
  }
  const thickness = normalizeThickness(match[1]);
  return `${thickness}${suffix}`;
}

function classifyGoods(
  profile: string,
  manualCheck?: string[],
  options: { allowProfileCodeFallback?: boolean } = {},
): string | null {
  const text = cleanText(profile);
  if (!text || /^\d+(?:\.\d+)?$/.test(text)) {
    return null;
  }
  const key = text.toLowerCase();
  if (["wall", "type"].includes(text.toLowerCase())) {
    return null;
  }
  if (PROFILE_ALIASES[key]) {
    return PROFILE_ALIASES[key];
  }
  const upper = text.toUpperCase();
  if (upper.includes("CAPPING")) {
    return "CAPPING";
  }
  if (upper.includes("FLAT SHEET")) {
    return upper;
  }
  if (upper.includes("CAVITY") || upper.includes("SLIDER") || upper.includes("CS")) {
    return "CS";
  }
  if (upper.includes("SERVICE PART")) {
    return "PART";
  }
  if (upper.includes("SKIN") || upper.includes("DOOR SKIN")) {
    return "DS";
  }
  if (upper.includes("SPLIT")) {
    if (upper.includes("DELUXE") || /\bDL\b/.test(upper)) {
      return "SPLIT DL";
    }
    return "SPLIT";
  }
  if (upper.includes("KNOCK") || /\bKD\b/.test(upper)) {
    return "KD";
  }
  if (upper.includes("MODERN")) {
    return "MODERN";
  }
  if (upper.includes("DELUXE")) {
    return "DELUXE";
  }
  if (upper.includes("CUSTOM") || upper.includes("COMMERCIAL")) {
    return "COMMERCIAL";
  }
  if (/^(LN|BL)-/.test(upper)) {
    return "COMMERCIAL";
  }
  if (GOODS_IGNORE_PATTERNS.some((pattern) => key.includes(pattern))) {
    return null;
  }
  if ((options.allowProfileCodeFallback ?? true) && looksLikeCommercialProfileCode(text)) {
    return "COMMERCIAL";
  }
  addManualCheck(manualCheck, `goods type not mapped: ${text}`);
  return null;
}

function looksLikeCommercialProfileCode(profile: string): boolean {
  const upper = cleanText(profile).toUpperCase();
  if (!upper || /^\d+(?:\.\d+)?$/.test(upper)) {
    return false;
  }
  return (
    /^\d+[A-Z]$/.test(upper) ||
    /^\d+[A-Z]?B\/O$/.test(upper) ||
    /^[A-Z]$/.test(upper) ||
    /^[A-Z]{1,4}-?\d+[A-Z]?(?:-[A-Z0-9]+)?$/.test(upper)
  );
}

function addGoods(goodsTotals: Map<string, number>, goods: string | null, quantity: number): void {
  if (!goods || quantity <= 0) {
    return;
  }
  goodsTotals.set(goods, (goodsTotals.get(goods) ?? 0) + quantity);
}

function writeGoods(
  values: Array<string | number | null>,
  goodsTotals: Map<string, number>,
  manualCheck: string[],
): void {
  const items = Array.from(goodsTotals.entries())
    .filter(([, quantity]) => quantity > 0)
    .sort((left, right) => right[1] - left[1]);
  if (items.length === 0) {
    return;
  }

  values[10] = excelDisplayNumber(items[0][1]);
  values[11] = items[0][0];
  if (items.length > 1) {
    values[12] = excelDisplayNumber(items[1][1]);
    values[13] = items[1][0];
  }
  if (items.length > 2) {
    addManualCheck(manualCheck, "more than two goods groups found");
  }
}

function createManualTotals(): ManualTotals {
  return {
    mitre: 0,
    v: 0,
    w: 0,
    weightedWParts: 0,
    x: 0,
    screwKdXParts: 0,
    screwKdVParts: 0,
    overSizeQty: 0,
    overSizeMarker: null,
    doubleQty: 0,
  };
}

function isScrewFixProfile(profile: string): boolean {
  const upper = cleanText(profile).toUpperCase();
  return /\bSCREW\b.*\bFIX(?:ED)?\b|\bFIX(?:ED)?\b.*\bSCREW\b/.test(upper);
}

function kdXPartsMultiplier(profile: string): number {
  return isScrewFixProfile(profile) ? 7 : 4;
}

function addManualTotals(
  totals: ManualTotals,
  detail: DetailLine,
  goods: string | null,
): void {
  const quantity = detail.quantity;
  if (quantity <= 0) {
    return;
  }

  const materialIsOther = cleanText(detail.material).toLowerCase() === "other";
  if (!materialIsOther && (numberValue(detail.revealWidth) ?? 0) > OVER_SIZE_REVEAL_WIDTH_THRESHOLD) {
    totals.overSizeQty += quantity;
  }

  if (goods !== "CS" && !materialIsOther) {
    const hinge = numberValue(detail.hingeQty) ?? 0;
    const striker = parseStrikerQty(detail.strikerType, detail.strikerType2);
    const sill = hasValue(detail.sill) ? 1 : 0;
    let lineV = 0;
    if (cleanText(detail.hingeType).toUpperCase().includes("SCREW FIXED PREP")) {
      lineV = quantity * (striker + sill);
      totals.v += lineV;
      addWTotal(totals, quantity * hinge, detail.partsWMultiplier);
    } else if (detail.hingeQtyBucket === "w") {
      lineV = quantity * (striker + sill);
      totals.v += lineV;
      addWTotal(totals, quantity * hinge, detail.partsWMultiplier);
    } else {
      lineV = quantity * (hinge + striker + sill);
      totals.v += lineV;
    }
    if (goods === "KD") {
      const kdXParts = quantity * kdXPartsMultiplier(detail.profile);
      totals.x += kdXParts;
      if (isScrewFixProfile(detail.profile)) {
        totals.screwKdXParts += kdXParts;
        totals.screwKdVParts += lineV;
      }
    }
  }
  totals.v += detail.vPartsExtra ?? 0;

  const doubleText = cleanText(detail.double).toUpperCase();
  const isDouble = doubleText === "YES" || doubleText.includes("DOUBLE");
  if (isDouble) {
    totals.doubleQty += quantity;
  }
  if (goods === "SPLIT" || goods === "SPLIT DL") {
    totals.mitre += quantity * splitMitreMultiplier(detail.profile, isDouble);
  } else if (goods === "CS") {
    totals.mitre += quantity * 14;
  } else if (goods === "MODERN" || goods === "DELUXE" || goods === "COMMERCIAL") {
    totals.mitre += quantity;
    if (isDouble) {
      totals.mitre += goods === "COMMERCIAL" ? quantity * commercialDoubleMitreExtra(detail.double) : 1;
    }
  }
}

function addWTotal(
  totals: { w: number; weightedWParts: number },
  quantity: number,
  multiplier = 1,
): void {
  totals.w += quantity;
  totals.weightedWParts += quantity * multiplier;
}

function writeManualTotals(
  values: Array<string | number | null>,
  totals: ManualTotals,
  manualCheck: string[],
): void {
  if (totals.overSizeMarker === "glut" || totals.overSizeMarker === "pallet") {
    values[7] = totals.overSizeMarker;
  } else if (totals.overSizeQty) {
    values[7] = excelDisplayInt(totals.overSizeQty);
  } else if (totals.overSizeMarker) {
    values[7] = totals.overSizeMarker;
  } else if (totals.doubleQty) {
    addManualCheck(manualCheck, "Over Size requires manual entry");
  }
  if (totals.mitre) {
    values[19] = excelDisplayInt(totals.mitre);
  } else if (values[11] === "KD") {
    values[19] = 0;
  }
  if (totals.v) {
    values[21] = excelDisplayInt(totals.v);
  } else if (values[11] === "DS") {
    values[21] = 0;
  }
  if (totals.w) {
    values[22] = excelDisplayInt(totals.w);
  }
  if (totals.x) {
    values[23] = excelDisplayInt(totals.x);
  }
  if (totals.v || totals.w || totals.x) {
    const screwKdX = Math.min(totals.x, totals.screwKdXParts);
    const screwKdV = Math.min(totals.v, totals.screwKdVParts);
    values[20] = excelDisplayInt(
      Math.max(0, totals.v - screwKdV)
      + totals.weightedWParts
      + Math.max(0, totals.x - screwKdX) * 0.43
      + screwKdX,
    );
  }
}

function parseStrikerQty(primary: string, secondary = ""): number {
  const source = hasValue(primary) ? primary : secondary;
  if (!hasValue(source)) {
    return 0;
  }
  const parts = cleanText(source)
    .split("+")
    .filter((part) => hasValue(part));
  return parts.length || 1;
}

function splitMitreMultiplier(profile: string, isDouble: boolean): number {
  if (/\bPART\s+[AB]\s+ONLY\b/.test(cleanText(profile).toUpperCase())) {
    return 1;
  }
  return isDouble ? 3 : 2;
}

function commercialDoubleMitreExtra(hand: string): number {
  return cleanText(hand).toUpperCase().includes("DOUBLE ACTION") ? 0.5 : 1;
}

function joinMaterials(materials: string[]): string | null {
  const seen = materials.filter((item, index) => item && materials.indexOf(item) === index);
  if (seen.length === 0) {
    return null;
  }
  return seen.sort(materialSortKey).join("/");
}

function materialSortKey(left: string, right: string): number {
  const leftParts = splitMaterialCode(left);
  const rightParts = splitMaterialCode(right);
  return (
    leftParts.thickness - rightParts.thickness ||
    leftParts.suffixOrder - rightParts.suffixOrder ||
    left.localeCompare(right)
  );
}

function splitMaterialCode(code: string): { thickness: number; suffixOrder: number } {
  const match = code.match(/^(\d+(?:\.\d+)?)/);
  const suffix = code.replace(/^\d+(?:\.\d+)?/, "");
  const suffixOrder: Record<string, number> = { Z: 0, G: 1, CB: 2, SS: 3, Aluminium: 4 };
  return {
    thickness: match ? Number(match[1]) : 999,
    suffixOrder: suffixOrder[suffix] ?? 99,
  };
}

function excelDisplayNumber(value: number): number {
  return Number.isInteger(value) ? value : Number(value.toFixed(4));
}

function excelDisplayInt(value: number): number {
  return Math.round(value);
}

function normalizeBuilder(builder: string, manualCheck: string[]): string | null {
  const normalized = cleanText(builder);
  if (!normalized) {
    return null;
  }
  const alias = BUILDER_ALIASES[normalized.toLowerCase()];
  if (alias) {
    return alias;
  }
  addManualCheck(manualCheck, `builder alias not mapped: ${normalized}`);
  return normalized;
}

function cleanText(value: unknown): string {
  return String(value ?? "")
    .replace(/\n/g, " ")
    .replace(/\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function hasValue(value: unknown): boolean {
  const text = cleanText(value).toUpperCase();
  return Boolean(text) && !["-", "NO", "N/A", "NA"].includes(text);
}

function addManualCheck(manualCheck: string[] | undefined, message: string): void {
  if (manualCheck && !manualCheck.includes(message)) {
    manualCheck.push(message);
  }
}

function hasColorbondColour(lowerText: string): boolean {
  for (const marker of COLORBOND_COLOUR_MARKERS) {
    if (lowerText.includes(marker)) {
      return true;
    }
  }
  return false;
}

function normalizeThickness(value: string): string {
  if (value === "1.05") {
    return "1";
  }
  return String(Number(value));
}
