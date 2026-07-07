import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ExcelJS from "exceljs";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { extractWorkbook, runOrderExtraction } from "./orderExtractor.js";

let tempRoot = "";
const execFileAsync = promisify(execFile);

interface PythonReferenceRow {
  values: Array<string | number | null>;
  notes: string[];
  manualCheck: string[];
  sourceFile: string;
}

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "order-extract-"));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

async function makeWorksheetOrder(filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Worksheet");
  ws.getCell("C1").value = "Job 29698";
  ws.getCell("C2").value = "Builder";
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

async function makeNonOrderWorkbook(filePath: string): Promise<void> {
 const wb = new ExcelJS.Workbook();
 const ws = wb.addWorksheet("Report");
 ws.getCell("A1").value = "普通报表";
 ws.getCell("A2").value = "不是订单";
 ws.getCell("B2").value = "2026-06-15";
 await wb.xlsx.writeFile(filePath);
}

async function makeWorksheetOrderWithFields(
  filePath: string,
  fields: {
    job?: string;
    builder?: string;
    deliveryAddress?: string;
    deliveryDate?: string;
    po?: string;
    zone?: string;
    material?: string;
    qty?: number;
    profile?: string;
    notes?: string;
  },
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Worksheet");
  ws.getCell("C1").value = fields.job ?? "Job 29698";
  ws.getCell("C2").value = fields.builder ?? "Builder";
  ws.getCell("C4").value = fields.deliveryAddress ?? "";
  ws.getCell("C5").value = fields.deliveryDate ?? "2026-06-15";
  ws.getCell("C6").value = fields.po ?? "PO-1";
  ws.getCell("C7").value = fields.zone ?? "";
  ws.getCell("I4").value = fields.notes ?? "";
  ["Material", "Stock", "Qty", "Profile", "B/O", "Reveal Height", "Reveal Width"].forEach((value, index) => {
    ws.getCell(9, index + 1).value = value;
  });
  ws.getCell("A11").value = fields.material ?? "1.05mm Zincanneal";
  ws.getCell("C11").value = fields.qty ?? 1;
  ws.getCell("D11").value = fields.profile ?? "Modern";
  await wb.xlsx.writeFile(filePath);
}

async function makeWorksheetOrderWithDataFallback(filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Worksheet");
  const data = wb.addWorksheet("Data");
  data.getCell("A2").value = "29698";
  data.getCell("C2").value = "Celebration Homes";
  data.getCell("E2").value = "pickup";
  data.getCell("F2").value = "2026-06-02";
  data.getCell("G2").value = "00077";
  data.getCell("I2").value = "12a";
  ["Material", "Stock", "Qty", "Profile", "B/O", "Reveal Height", "Reveal Width"].forEach((value, index) => {
    ws.getCell(9, index + 1).value = value;
  });
  ws.getCell("A11").value = "1.05mm Zincanneal";
  ws.getCell("C11").value = 1;
  ws.getCell("D11").value = "Modern";
  await wb.xlsx.writeFile(filePath);
}

async function makeWorksheetOrderWithLines(
  filePath: string,
  lines: Array<{
    material: string;
    qty: number;
    profile: string;
    revealWidth?: number;
    hingeQty?: string | number;
    hingeType?: string;
    strikerType?: string;
    sill?: string;
    double?: string;
    strikerType2?: string | number;
  }>,
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Worksheet");
  ws.getCell("C1").value = "Job 29698";
  ws.getCell("C2").value = "Celebration Homes";
  ws.getCell("C5").value = "2026-06-15";
  ws.getCell("C6").value = "PO-1";
  ["Material", "Stock", "Qty", "Profile", "B/O", "Reveal Height", "Reveal Width"].forEach((value, index) => {
    ws.getCell(9, index + 1).value = value;
  });
  lines.forEach((line, index) => {
    const row = 11 + index;
    ws.getCell(row, 1).value = line.material;
    ws.getCell(row, 3).value = line.qty;
    ws.getCell(row, 4).value = line.profile;
    ws.getCell(row, 7).value = line.revealWidth ?? 923;
    ws.getCell(row, 9).value = line.hingeQty ?? "";
    ws.getCell(row, 10).value = line.hingeType ?? "";
    ws.getCell(row, 11).value = line.strikerType ?? "";
    ws.getCell(row, 13).value = line.sill ?? "NO";
    ws.getCell(row, 15).value = line.double ?? "NO";
    ws.getCell(row, 18).value = line.strikerType2 ?? "";
  });
  await wb.xlsx.writeFile(filePath);
}

async function makeWorksheetOrderWithHiddenDuplicateLine(filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Worksheet");
  ws.getCell("C1").value = "Job 29698";
  ws.getCell("C2").value = "Celebration Homes";
  ws.getCell("C5").value = "2026-06-15";
  ws.getCell("C6").value = "PO-1";
  [
    "Material",
    "Stock",
    "Qty",
    "Profile",
    "B/O",
    "Reveal Height",
    "Reveal Width",
    "Hand",
    "Hinge Qty",
    "Hinge Type",
    "Striker Type",
    "Striker Height",
    "Sill",
    "Double",
    "Double",
    "Second Profile",
    "Second B/O",
    "Striker Type 2",
  ].forEach((value, index) => {
    ws.getCell(9, index + 1).value = value;
  });
  const values = [
    "1.05mm Zincanneal",
    "",
    1,
    "Modern",
    "95",
    2060,
    823,
    "RIGHT",
    "2",
    "WELDED",
    "S1",
    "1000",
    "NO",
    "NO",
    "NO",
    "Modern",
    "95",
    "S1",
  ];
  for (const row of [11, 12]) {
    values.forEach((value, index) => {
      ws.getCell(row, index + 1).value = value;
    });
  }
  ws.getRow(12).hidden = true;
  await wb.xlsx.writeFile(filePath);
}

async function makeWorksheetDeluxeDryLiningOrder(filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Worksheet");
  ws.getCell("C1").value = "Job 29698";
  ws.getCell("C2").value = "Celebration Homes";
  ws.getCell("C5").value = "2026-06-15";
  ws.getCell("C6").value = "PO-1";
  ["Material", "Stock", "Qty", "Profile", "B/O", "Reveal Height", "Reveal Width"].forEach((value, index) => {
    ws.getCell(9, index + 1).value = value;
  });
  ws.getCell("A11").value = "1.05mm Zincanneal";
  ws.getCell("C11").value = 2;
  ws.getCell("D11").value = "Deluxe Dry Lining";
  await wb.xlsx.writeFile(filePath);
}

async function makeWorksheetPalletMarkerOrder(filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Worksheet");
  ws.getCell("C1").value = "Job 29698";
  ws.getCell("C2").value = "Celebration Homes";
  ws.getCell("C5").value = "2026-06-15";
  ws.getCell("C6").value = "PO-1";
  ws.getCell("I4").value = "Pack on pallet";
  ["Material", "Stock", "Qty", "Profile", "B/O", "Reveal Height", "Reveal Width"].forEach((value, index) => {
    ws.getCell(9, index + 1).value = value;
  });
  ws.getCell("A11").value = "1.05mm Zincanneal";
  ws.getCell("C11").value = 1;
  ws.getCell("D11").value = "Modern";
  await wb.xlsx.writeFile(filePath);
}

async function makeWorksheetEqualGoodsCavityOrder(filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Worksheet");
  ws.getCell("C1").value = "Job 29698";
  ws.getCell("C2").value = "Celebration Homes";
  ws.getCell("C5").value = "2026-06-15";
  ws.getCell("C6").value = "PO-1";
  [
    "Material",
    "Stock",
    "Qty",
    "Profile",
    "B/O",
    "Reveal Height",
    "Reveal Width",
    "Hand",
    "Hinge Qty",
    "Hinge Type",
    "Striker Type",
    "Striker Height",
    "Sill",
    "Slider",
    "Double",
    "CL1",
    "CL3",
    "Striker Type2",
  ].forEach((value, index) => {
    ws.getCell(9, index + 1).value = value;
  });
  [
    "1.05mm Zincanneal",
    "",
    8,
    "Split",
    "85-125",
    2060,
    823,
    "RIGHT",
    "3",
    "WELDED",
    "S1",
    "1000",
    "NO",
    "NO",
    "NO",
    "Split",
    "85-125",
    "S1",
  ].forEach((value, index) => {
    ws.getCell(11, index + 1).value = value;
  });
  ws.getCell("A13").value = "Cavity Sliders";
  ["", "", 8, "Modern", "114", 2060, 700, "", "", "", "", "", "", "", "", "", "", ""].forEach((value, index) => {
    ws.getCell(14, index + 1).value = value;
  });
  await wb.xlsx.writeFile(filePath);
}

async function makeWorksheetCavitySoftCloserOrder(filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Worksheet");
  ws.getCell("C1").value = "Job 29698";
  ws.getCell("C2").value = "Celebration Homes";
  ws.getCell("C5").value = "2026-06-15";
  ws.getCell("C6").value = "PO-1";
  [
    "Material",
    "Stock",
    "Qty",
    "Profile",
    "B/O",
    "Reveal Height",
    "Reveal Width",
    "Hand",
    "Hinge Qty",
    "Hinge Type",
    "Striker Type",
    "Striker Height",
    "Sill",
    "Slider",
    "Double",
    "CL1",
    "CL3",
    "Striker Type2",
  ].forEach((value, index) => {
    ws.getCell(9, index + 1).value = value;
  });
  ws.getCell("A12").value = "Cavity Sliders";
  [
    ["", "", 1, "Modern", "114", 2360, 700, "", "", "", "", "", "", "", "", "", "", ""],
    ["", "", 1, "Brio Soft Closer (bev to deliver)", "", 0, "", "", "", "", "", "", "", "", "", "", "", ""],
  ].forEach((values, rowOffset) => {
    values.forEach((value, index) => {
      ws.getCell(13 + rowOffset, index + 1).value = value;
    });
  });
  await wb.xlsx.writeFile(filePath);
}

async function makeMainSheetOrder(filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Main Sheet");
  ws.getCell("A1").value = "Job # 29698";
  ws.getCell("A2").value = "Builder";
  ws.getCell("B2").value = "Celebration Homes";
  ws.getCell("A3").value = "PO Number";
  ws.getCell("B3").value = "00045 [Copy]";
  ws.getCell("A4").value = "Delivery Date";
  ws.getCell("B4").value = "2026-06-02";
  await wb.xlsx.writeFile(filePath);
}

async function makeMainSheetFallbackOrder(filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Main Sheet");
  ws.getCell("A1").value = "Job # 29698";
  ws.getCell("A2").value = "Builder";
  ws.getCell("B2").value = "Celebration Homes";
  ws.getCell("A3").value = "PO Number";
  ws.getCell("B3").value = "00045";
  ws.getCell("A4").value = "Delivery Date";
  ws.getCell("B4").value = "2026-06-02";
  ws.getCell("A6").value = "Material";
  ws.getCell("B6").value = "1.05mm";
  ws.getCell("C6").value = "Zincanneal";
  ws.getCell("A12").value = 2;
  ws.getCell("B12").value = "Modern jamb";
  ws.getCell("E12").value = "SINGLE";
  ws.getCell("F12").value = 3;
  await wb.xlsx.writeFile(filePath);
}

async function makeMainSheetFallbackStillageOrder(filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Main Sheet");
  ws.getCell("A1").value = "Job # 29698";
  ws.getCell("A2").value = "Builder";
  ws.getCell("B2").value = "Celebration Homes";
  ws.getCell("A3").value = "PO Number";
  ws.getCell("B3").value = "00045";
  ws.getCell("A4").value = "Delivery Date";
  ws.getCell("B4").value = "2026-06-02";
  ws.getCell("A8").value = "STILLAGE REQUIRED";
  ws.getCell("A12").value = 2;
  ws.getCell("B12").value = "Modern jamb";
  ws.getCell("F12").value = 3;
  await wb.xlsx.writeFile(filePath);
}

async function makeMainSheetFallbackOversizeOrder(filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Main Sheet");
  ws.getCell("A1").value = "Job # 29698";
  ws.getCell("A2").value = "Builder";
  ws.getCell("B2").value = "Celebration Homes";
  ws.getCell("A3").value = "PO Number";
  ws.getCell("B3").value = "00045";
  ws.getCell("A4").value = "Delivery Date";
  ws.getCell("B4").value = "2026-06-02";
  ws.getCell("D10").value = "WIDTH";
  ws.getCell("A12").value = 2;
  ws.getCell("B12").value = "Modern jamb";
  ws.getCell("D12").value = 1200;
  ws.getCell("F12").value = 3;
  await wb.xlsx.writeFile(filePath);
}

async function makeMainSheetProfilelessCommercialHardwareOrder(filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Main Sheet");
  wb.addWorksheet("Profiles");
  ws.getCell("A1").value = "Job No 30354";
  ws.getCell("B2").value = "Fire Door Maintenance";
  const headers = [
    "Door #",
    "TYPE",
    "THICKNESS",
    "HEIGHT",
    "WIDTH",
    "HAND",
    "QTY",
    "TO SUIT",
    "TYPE",
    "HEIGHT",
    "HOLES",
    "BRACKETS",
  ];
  headers.forEach((value, index) => {
    ws.getCell(12, index + 1).value = value;
  });
  const values = [
    "MAIL ROOM",
    "SPLIT 85-125B/O ",
    "40mm",
    2060,
    923,
    "RIGHT",
    4,
    "100X75X2.5",
    "MORTICE LOCK (S1)",
    1032,
    "12 + 6",
    "NOT REQUIRED",
  ];
  values.forEach((value, index) => {
    ws.getCell(13, index + 1).value = value;
  });
  await wb.xlsx.writeFile(filePath);
}

async function makeMainSheetProfilelessOversizeOrder(filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Main Sheet");
  wb.addWorksheet("Profiles");
  ws.getCell("A1").value = "Job No 30354";
  ws.getCell("B2").value = "Fire Door Maintenance";
  const headers = [
    "Door #",
    "TYPE",
    "THICKNESS",
    "HEIGHT",
    "WIDTH",
    "HAND",
    "QTY",
    "TO SUIT",
    "TYPE",
    "HEIGHT",
    "HOLES",
    "BRACKETS",
  ];
  headers.forEach((value, index) => {
    ws.getCell(12, index + 1).value = value;
  });
  const values = [
    "D2.01/S038.1",
    "DMF02",
    "DL01.M = 40mm Thick",
    2380,
    1246,
    "DOUBLE",
    "8 (4 EACH SIDE)",
    "100X75X2.5",
    "-",
    "-",
    "8 (4 EACH JAMB)",
    "",
  ];
  values.forEach((value, index) => {
    ws.getCell(13, index + 1).value = value;
  });
  await wb.xlsx.writeFile(filePath);
}

async function makeMainSheetDoubleActionCommercialOrder(filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Main Sheet");
  wb.addWorksheet("Profiles");
  ws.getCell("A1").value = "Job No 30354";
  ws.getCell("B2").value = "Fire Door Maintenance";
  const headers = [
    "Door #",
    "(PER A_6020 & A_6021)",
    "PROFILE",
    "THICKNESS",
    "HEIGHT",
    "WIDTH",
    "HAND",
    "DOUBLE ACTION BOXES",
  ];
  headers.forEach((value, index) => {
    ws.getCell(12, index + 1).value = value;
  });
  [13, 14].forEach((row) => {
    const values = [
      `ON.L${row}`,
      "08A",
      "CUSTOM D/A",
      "40mm",
      2260,
      2272,
      "DOUBLE ACTION",
      "2 - WELDED IN TO HEAD OF FRAME",
    ];
    values.forEach((value, index) => {
      ws.getCell(row, index + 1).value = value;
    });
  });
  await wb.xlsx.writeFile(filePath);
}

async function makeMainSheetCommercialWidthsOrder(filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Main Sheet");
  wb.addWorksheet("Profiles");
  ws.getCell("A1").value = "Job No 30354";
  ws.getCell("B2").value = "Fire Door Maintenance";
  const headers = ["Door #", "PROFILE", "HEIGHT", "WIDTH", "HAND", "QTY", "TO SUIT", "GUARDS", "TYPE", "HEIGHT", "BOLT", "BRICK TIES"];
  headers.forEach((value, index) => {
    ws.getCell(12, index + 1).value = value;
  });
  const rows = [
    ["D.4", "A", 2410, 1920, "DOUBLE", "8 (4 EACH SIDE)", "100X100X2.5", "YES", "-", "-", "-", 10],
    ["D.3", "A", 2110, 1030, "RIGHT", 4, "100X100X2.5", "YES", "S1", 1020, "-", 8],
  ];
  rows.forEach((values, rowOffset) => {
    values.forEach((value, index) => {
      ws.getCell(13 + rowOffset, index + 1).value = value;
    });
  });
  await wb.xlsx.writeFile(filePath);
}

async function makeDoorSkinsCappingOrder(filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Main Sheet");
  ws.getCell("A1").value = "AUMSET JOB # 29322";
  ws.getCell("B2").value = "Australian Fire Door Company";
  const headers = ["MATERIAL", "PROFILE", "QUANTITY", "WIDTH", "LENGTH", "BOLT", ""];
  headers.forEach((value, index) => {
    ws.getCell(11, index + 1).value = value;
  });
  const rows = [
    ["0.55mm Deep Ocean", "A", 2, 845, 2030, "", "FLAT SHEET"],
    ["0.55mm Deep Ocean", "B", 2, "", 2100, "", "CAPPING"],
    ["0.55mm Deep Ocean", "B", 2, "", 1000, "", "CAPPING"],
  ];
  rows.forEach((values, rowOffset) => {
    values.forEach((value, index) => {
      ws.getCell(12 + rowOffset, index + 1).value = value;
    });
  });
  await wb.xlsx.writeFile(filePath);
}

async function makeDanzeDoorSkinPoOrder(filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Main Sheet");
  ws.getCell("A1").value = "AUMSET JOB # 29322";
  ws.getCell("B2").value = "Danze Mining";
  ws.getCell("B6").value = "07-001234-02";
  const headers = ["MATERIAL", "PROFILE", "QUANTITY", "WIDTH", "LENGTH", "BOLT", ""];
  headers.forEach((value, index) => {
    ws.getCell(11, index + 1).value = value;
  });
  ["0.55mm Deep Ocean", "Door Skin", 2, 845, 2030, "", "FLAT SHEET"].forEach((value, index) => {
    ws.getCell(12, index + 1).value = value;
  });
  await wb.xlsx.writeFile(filePath);
}

async function makeDanzeDoorSkinProfileCodeOrder(filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Main Sheet");
  ws.getCell("A1").value = "AUMSET JOB # 30471 REV00";
  ws.getCell("B2").value = "Danze Mining";
  ws.getCell("B4").value = "2 Volcanic Lp, Wangara";
  ws.getCell("B5").value = "2026-06-24";
  ws.getCell("B6").value = "02-6365-03";
  ws.getCell("B7").value = "57d";
  ws.getCell("B10").value = "1.2mm";
  ws.getCell("C10").value = "Zinc";
  const headers = ["Quantity", "PROFILE", "HEIGHT", "WIDTH", "FOUR SIDED"];
  headers.forEach((value, index) => {
    ws.getCell(13, index + 1).value = value;
  });
  [4, "A", 368, 268, "YES"].forEach((value, index) => {
    ws.getCell(14, index + 1).value = value;
  });
  await wb.xlsx.writeFile(filePath);
}

async function makeDoorStopBuildUpOrder(filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Main Sheet");
  wb.addWorksheet("Profiles");
  ws.getCell("A1").value = "Job No 30354";
  ws.getCell("B2").value = "Fire Door Maintenance";
  const headers = ["Door #", "PROFILE", "HEIGHT", "WIDTH", "HAND", "QTY"];
  headers.forEach((value, index) => {
    ws.getCell(12, index + 1).value = value;
  });
  ["D1", "A", 2075, 1011, "LEFT", 4].forEach((value, index) => {
    ws.getCell(13, index + 1).value = value;
  });
  await wb.xlsx.writeFile(filePath);
}

async function makeConcealedFrameOrder(filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Main Sheet");
  wb.addWorksheet("Profiles");
  ws.getCell("A1").value = "Job No 30354";
  ws.getCell("B2").value = "Fire Door Maintenance";
  const headers = ["Door #", "PROFILE", "HEIGHT", "WIDTH", "HAND", "QTY", "NOTE"];
  headers.forEach((value, index) => {
    ws.getCell(12, index + 1).value = value;
  });
  ["D1", "Modern", 2075, 1011, "LEFT", 1, "CONCEALED FRAME"].forEach((value, index) => {
    ws.getCell(13, index + 1).value = value;
  });
  await wb.xlsx.writeFile(filePath);
}

async function makeCowdroyContextOrder(filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Main Sheet");
  wb.addWorksheet("Profiles");
  ws.getCell("A1").value = "Job No 30354";
  ws.getCell("B2").value = "Fire Door Maintenance";
  const headers = ["Door #", "PROFILE", "HEIGHT", "WIDTH", "HAND", "QTY", "NOTE"];
  headers.forEach((value, index) => {
    ws.getCell(12, index + 1).value = value;
  });
  ["D1", "Modern", 2075, 1011, "LEFT", 1, "COWDROY TRACK"].forEach((value, index) => {
    ws.getCell(13, index + 1).value = value;
  });
  await wb.xlsx.writeFile(filePath);
}

async function makeGenericCappingProfileOrder(filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Main Sheet");
  wb.addWorksheet("Profiles");
  ws.getCell("A1").value = "Job No 30354";
  ws.getCell("B2").value = "Fire Door Maintenance";
  const headers = ["Door #", "PROFILE", "HEIGHT", "WIDTH", "HAND", "QTY"];
  headers.forEach((value, index) => {
    ws.getCell(12, index + 1).value = value;
  });
  ["D1", "CAPPING", 2075, 1011, "LEFT", 3].forEach((value, index) => {
    ws.getCell(13, index + 1).value = value;
  });
  await wb.xlsx.writeFile(filePath);
}

async function makeGenericFlatSheetProfileOrder(filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Main Sheet");
  wb.addWorksheet("Profiles");
  ws.getCell("A1").value = "Job No 30354";
  ws.getCell("B2").value = "Fire Door Maintenance";
  const headers = ["Door #", "PROFILE", "HEIGHT", "WIDTH", "HAND", "QTY"];
  headers.forEach((value, index) => {
    ws.getCell(12, index + 1).value = value;
  });
  ["D1", "FLAT SHEET", 2075, 1011, "LEFT", 2].forEach((value, index) => {
    ws.getCell(13, index + 1).value = value;
  });
  await wb.xlsx.writeFile(filePath);
}

async function makeGenericSliderProfileOrder(filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Main Sheet");
  wb.addWorksheet("Profiles");
  ws.getCell("A1").value = "Job No 30354";
  ws.getCell("B2").value = "Fire Door Maintenance";
  const headers = ["Door #", "PROFILE", "HEIGHT", "WIDTH", "HAND", "QTY"];
  headers.forEach((value, index) => {
    ws.getCell(12, index + 1).value = value;
  });
  ["D1", "Pocket Slider", 2075, 1011, "LEFT", 2].forEach((value, index) => {
    ws.getCell(13, index + 1).value = value;
  });
  await wb.xlsx.writeFile(filePath);
}

async function makeGenericIgnoredProfileOrder(filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Main Sheet");
  wb.addWorksheet("Profiles");
  ws.getCell("A1").value = "Job No 30354";
  ws.getCell("B2").value = "Fire Door Maintenance";
  const headers = ["Door #", "PROFILE", "HEIGHT", "WIDTH", "HAND", "QTY"];
  headers.forEach((value, index) => {
    ws.getCell(12, index + 1).value = value;
  });
  ["D1", "Single Electric", 2075, 1011, "LEFT", 2].forEach((value, index) => {
    ws.getCell(13, index + 1).value = value;
  });
  await wb.xlsx.writeFile(filePath);
}

async function makeGenericCommercialPrefixProfileOrder(filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Main Sheet");
  wb.addWorksheet("Profiles");
  ws.getCell("A1").value = "Job No 30354";
  ws.getCell("B2").value = "Fire Door Maintenance";
  const headers = ["Door #", "PROFILE", "HEIGHT", "WIDTH", "HAND", "QTY"];
  headers.forEach((value, index) => {
    ws.getCell(12, index + 1).value = value;
  });
  [
    ["D1", "LN-SPECIAL", 2075, 1011, "LEFT", 2],
    ["D2", "BL-FRAME", 2075, 1011, "LEFT", 1],
  ].forEach((values, rowOffset) => {
    values.forEach((value, index) => {
      ws.getCell(13 + rowOffset, index + 1).value = value;
    });
  });
  await wb.xlsx.writeFile(filePath);
}

async function makeTradDynaMainSheetOrder(filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Main Sheet");
  wb.addWorksheet("Profiles");
  ws.getCell("A1").value = "Job No 30354";
  ws.getCell("B2").value = "Fire Door Maintenance";
  const headers = ["Door #", "PROFILE", "HEIGHT", "WIDTH", "HAND", "QTY", "TO SUIT", "GUARDS", "TYPE", "HEIGHT", "BOLT", "BRICK TIES"];
  headers.forEach((value, index) => {
    ws.getCell(12, index + 1).value = value;
  });
  const rows = new Map<number, Array<string | number>>([
    [13, ["D8", "A", 2075, 1011, "LEFT", 4, "100x100x2.5", "S1", 1030, "", ""]],
    [20, ["D7", "125BO SPLIT", 2060, 910, "LEFT", 4, "100X100X2.5", "S1", 1000, "-", ""]],
  ]);
  rows.forEach((values, row) => {
    values.forEach((value, index) => {
      ws.getCell(row, index + 1).value = value;
    });
  });
  await wb.xlsx.writeFile(filePath);
}

async function makeSheet1ProfileOrder(filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.getCell("A1").value = "Job # 29698";
  ws.getCell("A2").value = "Builder";
  ws.getCell("B2").value = "Celebration Homes";
  ws.getCell("A3").value = "PO";
  ws.getCell("B3").value = "00088 [Copy]";
  ws.getCell("A4").value = "Delivery Date";
  ws.getCell("B4").value = "2026-06-02";
  ws.getCell("A6").value = "Material";
  ws.getCell("B6").value = "1.05mm Zincanneal";
  ["Qty", "Profile", "Hand", "Hinge Qty", "Striker Type", "Sill"].forEach((value, index) => {
    ws.getCell(10, index + 1).value = value;
  });
  ws.getCell("A11").value = 2;
  ws.getCell("B11").value = "Modern";
  ws.getCell("C11").value = "LEFT";
  ws.getCell("D11").value = 3;
  ws.getCell("E11").value = "S1";
  ws.getCell("F11").value = "NO";
  ws.getCell("A12").value = 1;
  ws.getCell("B12").value = "Split DL";
  ws.getCell("C12").value = "DOUBLE ACTION";
  await wb.xlsx.writeFile(filePath);
}

async function makeSheet1AddressOrder(filePath: string, deliveryAddress = "12a - pickup"): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.getCell("A1").value = "Job # 29698";
  ws.getCell("A2").value = "Builder";
  ws.getCell("B2").value = "Celebration Homes";
  ws.getCell("A3").value = "PO";
  ws.getCell("B3").value = "00088 [Copy]";
  ws.getCell("A4").value = "Delivery Date";
  ws.getCell("B4").value = "2026-06-02";
  ws.getCell("A5").value = "Delivery Address";
  ws.getCell("B5").value = deliveryAddress;
  ws.getCell("A6").value = "Material";
  ws.getCell("B6").value = "1.05mm Zincanneal";
  ["Qty", "Profile", "Hand", "Hinge Qty", "Striker Type", "Sill"].forEach((value, index) => {
    ws.getCell(10, index + 1).value = value;
  });
  ws.getCell("A11").value = 1;
  ws.getCell("B11").value = "Modern";
  await wb.xlsx.writeFile(filePath);
}

async function makeSheet1InvalidDeliveryDateOrder(filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.getCell("A1").value = "Job # 29698";
  ws.getCell("A2").value = "Builder";
  ws.getCell("B2").value = "Celebration Homes";
  ws.getCell("A3").value = "PO";
  ws.getCell("B3").value = "00088";
  ws.getCell("A4").value = "Delivery Date";
  ws.getCell("B4").value = "soon";
  ws.getCell("A6").value = "Material";
  ws.getCell("B6").value = "1.05mm Zincanneal";
  ["Qty", "Profile", "Hand", "Hinge Qty", "Striker Type", "Sill"].forEach((value, index) => {
    ws.getCell(10, index + 1).value = value;
  });
  ws.getCell("A11").value = 1;
  ws.getCell("B11").value = "Modern";
  await wb.xlsx.writeFile(filePath);
}

async function makeNonstandardWorksheetDoorOrder(filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Worksheet");
  ws.getCell("C1").value = "Job 29698";
  ws.getCell("C2").value = "Celebration Homes";
  ws.getCell("C5").value = "2026-06-15";
  ws.getCell("C6").value = "PO-1";
  ws.getCell("A6").value = "Material";
  ws.getCell("B6").value = "0.55mm Galv";
  ws.getCell("A10").value = "Door #";
  ws.getCell("B10").value = "Qty";
  ws.getCell("A11").value = "Modern";
  ws.getCell("B11").value = 2;
  ws.getCell("A12").value = "LN-200";
  ws.getCell("B12").value = 1;
  await wb.xlsx.writeFile(filePath);
}

async function makeNonstandardWorksheetDoorStopBuildUpOrder(filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Worksheet");
  ws.getCell("C1").value = "Job 29698";
  ws.getCell("C2").value = "Fire Door Maintenance";
  ws.getCell("C5").value = "2026-06-15";
  ws.getCell("C6").value = "PO-1";
  ws.getCell("A6").value = "Material";
  ws.getCell("B6").value = "0.55mm Galv";
  ws.getCell("A10").value = "Door #";
  ws.getCell("B10").value = "Qty";
  ws.getCell("A11").value = "Modern";
  ws.getCell("B11").value = 2;
  await wb.xlsx.writeFile(filePath);
}

async function makeNonstandardWorksheetTradDynaOrder(filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Worksheet");
  ws.getCell("C1").value = "Job 29698";
  ws.getCell("C2").value = "Fire Door Maintenance";
  ws.getCell("C5").value = "2026-06-15";
  ws.getCell("C6").value = "PO-1";
  ws.getCell("A6").value = "Material";
  ws.getCell("B6").value = "0.55mm Galv";
  ws.getCell("A10").value = "Door #";
  ws.getCell("B10").value = "Qty";
  ws.getCell("A11").value = "Modern";
  ws.getCell("B11").value = 2;
  await wb.xlsx.writeFile(filePath);
}

async function makeNonstandardWorksheetConcealedFrameOrder(filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Worksheet");
  ws.getCell("C1").value = "Job 29698";
  ws.getCell("C2").value = "Fire Door Maintenance";
  ws.getCell("C5").value = "2026-06-15";
  ws.getCell("C6").value = "PO-1";
  ws.getCell("A6").value = "Material";
  ws.getCell("B6").value = "0.55mm Galv";
  ws.getCell("A10").value = "Door #";
  ws.getCell("B10").value = "Qty";
  ws.getCell("A11").value = "Modern";
  ws.getCell("B11").value = 2;
  ws.getCell("C11").value = "CONCEALED FRAME";
  await wb.xlsx.writeFile(filePath);
}

async function makeNonstandardWorksheetLabelOrder(filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Worksheet");
  ws.getCell("A1").value = "Job # 29698";
  ws.getCell("A2").value = "Builder";
  ws.getCell("B2").value = "Celebration Homes";
  ws.getCell("A3").value = "PO Number";
  ws.getCell("B3").value = "00088 [Copy]";
  ws.getCell("A4").value = "Delivery Date";
  ws.getCell("B4").value = "2026-06-02";
  ws.getCell("A6").value = "Material";
  ws.getCell("B6").value = "1.05mm Zincanneal";
  ws.getCell("A10").value = "Door #";
  ws.getCell("B10").value = "Qty";
  ws.getCell("A11").value = "Split DL";
  ws.getCell("B11").value = 1;
  await wb.xlsx.writeFile(filePath);
}

async function makeUnsupportedWorksheetOrder(filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Worksheet");
  ws.getCell("C1").value = "Job 29698";
  ws.getCell("C2").value = "Celebration Homes";
  ws.getCell("C5").value = "2026-06-15";
  ws.getCell("C6").value = "PO-1";
  ws.getCell("A10").value = "Description";
  ws.getCell("B10").value = "Amount";
  await wb.xlsx.writeFile(filePath);
}

async function makeNonstandardWorksheetAddressOrder(filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Worksheet");
  ws.getCell("A1").value = "Job # 29698";
  ws.getCell("A2").value = "Builder";
  ws.getCell("B2").value = "Celebration Homes";
  ws.getCell("A3").value = "PO";
  ws.getCell("B3").value = "00088";
  ws.getCell("A4").value = "Delivery Date";
  ws.getCell("B4").value = "2026-06-02";
  ws.getCell("A5").value = "Delivery Address";
  ws.getCell("B5").value = "12a - pickup";
  ws.getCell("A6").value = "Material";
  ws.getCell("B6").value = "1.05mm Zincanneal";
  ws.getCell("A10").value = "Description";
  ws.getCell("B10").value = "Amount";
  await wb.xlsx.writeFile(filePath);
}

async function makeSheet1MultipleProfileTablesOrder(filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.getCell("A1").value = "Job # 29698";
  ws.getCell("A2").value = "Builder";
  ws.getCell("B2").value = "Celebration Homes";
  ws.getCell("A3").value = "PO";
  ws.getCell("B3").value = "00088";
  ws.getCell("A4").value = "Delivery Date";
  ws.getCell("B4").value = "2026-06-02";
  ws.getCell("A6").value = "Material";
  ws.getCell("B6").value = "1.05mm Zincanneal";
  ws.getCell("A10").value = "Qty";
  ws.getCell("B10").value = "Profile";
  ws.getCell("A11").value = 1;
  ws.getCell("B11").value = "Modern";
  ws.getCell("C20").value = "Qty";
  ws.getCell("D20").value = "Profile";
  ws.getCell("C21").value = 2;
  ws.getCell("D21").value = "Deluxe";
  await wb.xlsx.writeFile(filePath);
}

async function makeSheet1MultiMaterialOrder(filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.getCell("A1").value = "Job # 29698";
  ws.getCell("A2").value = "Builder";
  ws.getCell("B2").value = "Celebration Homes";
  ws.getCell("A3").value = "PO";
  ws.getCell("B3").value = "00088";
  ws.getCell("A4").value = "Delivery Date";
  ws.getCell("B4").value = "2026-06-02";
  ws.getCell("A6").value = "Material";
  ws.getCell("B6").value = "1.05mm Zincanneal";
  ws.getCell("C6").value = "0.55mm Galv";
  ws.getCell("A10").value = "Qty";
  ws.getCell("B10").value = "Profile";
  ws.getCell("A11").value = 1;
  ws.getCell("B11").value = "Modern";
  await wb.xlsx.writeFile(filePath);
}

async function makeSheet1ProfilelessTypeOrder(filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.getCell("A1").value = "Job # 29698";
  ws.getCell("A2").value = "Builder";
  ws.getCell("B2").value = "Celebration Homes";
  ws.getCell("A3").value = "PO";
  ws.getCell("B3").value = "00088";
  ws.getCell("A4").value = "Delivery Date";
  ws.getCell("B4").value = "2026-06-02";
  ws.getCell("A6").value = "Material";
  ws.getCell("B6").value = "1.05mm Zincanneal";
  ws.getCell("A10").value = "Door #";
  ws.getCell("B10").value = "Type";
  ws.getCell("C10").value = "Qty";
  ws.getCell("A11").value = "D01";
  ws.getCell("B11").value = "Modern";
  ws.getCell("C11").value = 2;
  ws.getCell("A12").value = "D02";
  ws.getCell("B12").value = "Split";
  ws.getCell("C12").value = 1;
  await wb.xlsx.writeFile(filePath);
}

async function makeSheet1CavityProfileOrder(filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.getCell("A1").value = "Job # 29698";
  ws.getCell("A2").value = "Builder";
  ws.getCell("B2").value = "Celebration Homes";
  ws.getCell("A3").value = "PO";
  ws.getCell("B3").value = "00088";
  ws.getCell("A4").value = "Delivery Date";
  ws.getCell("B4").value = "2026-06-02";
  ws.getCell("A9").value = "Cavity Slider Schedule";
  ws.getCell("A10").value = "Qty";
  ws.getCell("B10").value = "Profile";
  ws.getCell("A11").value = 1;
  ws.getCell("B11").value = "Modern";
  await wb.xlsx.writeFile(filePath);
}

async function makeSheet1HingePlatesOrder(filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.getCell("A1").value = "Job # 29698";
  const headers = ["QTY", "PROFILE", "HEIGHT", "WIDTH", "HAND", "QTY", "HINGE PLATES", "TYPE", "HEIGHT", "HOLES"];
  headers.forEach((value, index) => {
    ws.getCell(12, index + 1).value = value;
  });
  const values = [2, "Split A + B", 2060, 923, "RIGHT", 3, "Suit 100x75x2.5", "S1", 1000, ""];
  values.forEach((value, index) => {
    ws.getCell(13, index + 1).value = value;
  });
  await wb.xlsx.writeFile(filePath);
}

async function makeSheet1CskDtnaOrder(filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.getCell("A1").value = "Job # 29698";
  ws.getCell("F10").value = "CSK";
  ws.getCell("F11").value = "DTNA";
  const headers = ["QTY", "PROFILE", "HEIGHT", "WIDTH", "HAND", "QTY", "HINGES", "TYPE", "HEIGHT", "HOLES"];
  headers.forEach((value, index) => {
    ws.getCell(12, index + 1).value = value;
  });
  const values = [1, "Split 180B/O (35 Door)", 2060, 923, "RIGHT", "10 (5 EACH SIDE)", "", "", 1000, ""];
  values.forEach((value, index) => {
    ws.getCell(13, index + 1).value = value;
  });
  await wb.xlsx.writeFile(filePath);
}

async function makeSheet1HeadOnlyReplacementOrder(filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.getCell("A1").value = "Job 30095";
  const headers = ["QTY", "PROFILE", "HEIGHT", "WIDTH", "HAND", "QTY", "HINGES", "TYPE", "HEIGHT", "HOLES"];
  headers.forEach((value, index) => {
    ws.getCell(12, index + 1).value = value;
  });
  const rows = [
    [1, "125mm B/O MODERN KNOCK DOWN-SCREW FIXED MITRE", 2060, 923, "RIGHT", 3, "100X75X1.6", "S1", 1000, ""],
    ["REPLACEMENT HEAD # 1", "112mm B/O MODERN KNOCK DOWN-SCREW FIXED MITRE HEAD ONLY", "", 723, "LEFT", "", "", "", "", ""],
  ];
  rows.forEach((values, rowOffset) => {
    values.forEach((value, index) => {
      ws.getCell(13 + rowOffset, index + 1).value = value;
    });
  });
  await wb.xlsx.writeFile(filePath);
}

async function makeUnsupportedSheet1Order(filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.getCell("A1").value = "Job # 29698";
  ws.getCell("A2").value = "Builder";
  ws.getCell("B2").value = "Celebration Homes";
  ws.getCell("A3").value = "PO";
  ws.getCell("B3").value = "00088";
  ws.getCell("A4").value = "Delivery Date";
  ws.getCell("B4").value = "2026-06-02";
  ws.getCell("A6").value = "Material";
  ws.getCell("B6").value = "1.05mm Zincanneal";
  ws.getCell("A10").value = "Description";
  ws.getCell("B10").value = "Amount";
  await wb.xlsx.writeFile(filePath);
}

async function makeSheet1WithExtraSheetOrder(filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.getCell("A1").value = "Job # 29698";
  ws.getCell("A2").value = "Builder";
  ws.getCell("B2").value = "Celebration Homes";
  ws.getCell("A3").value = "PO";
  ws.getCell("B3").value = "00088";
  ws.getCell("A4").value = "Delivery Date";
  ws.getCell("B4").value = "2026-06-02";
  ws.getCell("A6").value = "Material";
  ws.getCell("B6").value = "1.05mm Zincanneal";
  ws.getCell("A10").value = "Qty";
  ws.getCell("B10").value = "Profile";
  ws.getCell("A11").value = 1;
  ws.getCell("B11").value = "Modern";
  wb.addWorksheet("Other");
  await wb.xlsx.writeFile(filePath);
}

async function pythonReference(filePath: string): Promise<PythonReferenceRow> {
  const script = [
    "import json",
    "import sys",
    "from pathlib import Path",
    "import extract",
    "row = extract.extract_workbook(Path(sys.argv[1]), infer_manual=True)",
    "print(json.dumps({",
    "  'values': row.values,",
    "  'notes': row.notes,",
    "  'manualCheck': row.manual_check,",
    "  'sourceFile': row.source_file,",
    "}, ensure_ascii=False, default=str))",
  ].join("\n");
  const { stdout } = await execFileAsync("python3", ["-c", script, filePath], { cwd: process.cwd() });
  return JSON.parse(stdout) as PythonReferenceRow;
}

describe("extractWorkbook", () => {
  test("extracts common Worksheet order fields", async () => {
    const filePath = path.join(tempRoot, "29698 order.xlsx");
    await makeWorksheetOrder(filePath);

    const row = await extractWorkbook(filePath);

    expect(row.sourceFile).toBe("29698 order.xlsx");
    expect(row.values[1]).toBe("PO-1");
    expect(row.values[2]).toBe("Builder");
    expect(row.values[6]).toBe("29698");
    expect(row.values[9]).toBe("1Z");
    expect(row.values[10]).toBe(1);
    expect(row.values[11]).toBe("MODERN");
    expect(row.values[14]).toBe("2026-06-15");
  });

  test("normalizes worksheet metadata using Python parity rules", async () => {
    const filePath = path.join(tempRoot, "1234A Celebration split.xlsx");
    await makeWorksheetOrderWithFields(filePath, {
      job: "Job # 1234A",
      builder: "Celebration Homes",
      deliveryAddress: "pickup",
      po: "00123 [Supplier Copy]",
      profile: "Split DL jamb",
      zone: "12a",
    });

    const python = await pythonReference(filePath);
    const row = await extractWorkbook(filePath);

    expect(row.values[1]).toBe("123");
    expect(row.values[2]).toBe("CELEBRATION");
    expect(row.values[4]).toBe(python.values[4]);
    expect(row.values[5]).toBe(python.values[5]);
    expect(row.values[6]).toBe("1234A");
    expect(row.values[11]).toBe("SPLIT DL");
    expect(row.manualCheck).toEqual([]);
  });

  test("matches Python reference for slash-formatted worksheet delivery dates", async () => {
    const filePath = path.join(tempRoot, "29698 slash delivery date.xlsx");
    await makeWorksheetOrderWithFields(filePath, { deliveryDate: "15/06/2026" });

    const python = await pythonReference(filePath);
    const typescript = await extractWorkbook(filePath, { inferManual: true });

    expect(typescript.values.slice(14, 17)).toEqual(python.values.slice(14, 17));
    expect(typescript.manualCheck).toEqual(python.manualCheck);
  });

  test("matches Python reference for unparsed Sheet1 delivery dates", async () => {
    const filePath = path.join(tempRoot, "29698 invalid sheet1 date.xlsx");
    await makeSheet1InvalidDeliveryDateOrder(filePath);

    const python = await pythonReference(filePath);
    const typescript = await extractWorkbook(filePath, { inferManual: true });

    expect(typescript.values.slice(14, 17)).toEqual(python.values.slice(14, 17));
    expect(typescript.manualCheck).toEqual(python.manualCheck);
  });

  test("marks unmapped builders for manual review", async () => {
    const filePath = path.join(tempRoot, "29698 unknown builder.xlsx");
    await makeWorksheetOrderWithFields(filePath, { builder: "Unknown Builder Pty Ltd" });

    const row = await extractWorkbook(filePath);

    expect(row.values[2]).toBe("Unknown Builder Pty Ltd");
    expect(row.manualCheck).toContain("builder alias not mapped: Unknown Builder Pty Ltd");
  });

  test("matches Python reference for CSV-backed builder aliases", async () => {
    const filePath = path.join(tempRoot, "29698 csv builder alias.xlsx");
    await makeWorksheetOrderWithFields(filePath, { builder: "NATS" });

    const python = await pythonReference(filePath);
    const typescript = await extractWorkbook(filePath);

    expect(typescript.values[2]).toEqual(python.values[2]);
    expect(typescript.manualCheck).toEqual(python.manualCheck);
  });

  test("classifies cavity sliders and commercial profile aliases", async () => {
    const cavityPath = path.join(tempRoot, "29698 cavity.xlsx");
    await makeWorksheetOrderWithFields(cavityPath, { profile: "Cavity Slider Deluxe", material: "0.55mm Monument" });
    const commercialPath = path.join(tempRoot, "29699 commercial.xlsx");
    await makeWorksheetOrderWithFields(commercialPath, { job: "Job 29699", profile: "A", material: "0.55mm Galv" });

    const cavity = await extractWorkbook(cavityPath);
    const commercial = await extractWorkbook(commercialPath);
    const pythonCavity = await pythonReference(cavityPath);
    const pythonCommercial = await pythonReference(commercialPath);

    expect(cavity.values[9]).toBe(pythonCavity.values[9]);
    expect(cavity.values[11]).toBe(pythonCavity.values[11]);
    expect(commercial.values[9]).toBe(pythonCommercial.values[9]);
    expect(commercial.values[11]).toBe(pythonCommercial.values[11]);
  });

  test("aggregates materials and the two largest goods groups", async () => {
    const filePath = path.join(tempRoot, "29698 mixed goods.xlsx");
    await makeWorksheetOrderWithLines(filePath, [
      { material: "1.05mm Zincanneal", qty: 2, profile: "Modern" },
      { material: "0.55mm Galv", qty: 3, profile: "Split" },
      { material: "0.55mm Monument", qty: 1, profile: "Deluxe" },
    ]);

    const row = await extractWorkbook(filePath);

    expect(row.values[9]).toBe("0.55G/0.55CB/1Z");
    expect(row.values[10]).toBe(3);
    expect(row.values[11]).toBe("SPLIT");
    expect(row.values[12]).toBe(2);
    expect(row.values[13]).toBe("MODERN");
    expect(row.manualCheck).toContain("more than two goods groups found");
  });

  test("extracts Main Sheet metadata from labels", async () => {
    const filePath = path.join(tempRoot, "main sheet.xlsx");
    await makeMainSheetOrder(filePath);

    const row = await extractWorkbook(filePath, { inferManual: true });

    expect(row.values[1]).toBe("45");
    expect(row.values[2]).toBe("CELEBRATION");
    expect(row.values[6]).toBe("29698");
    expect(row.values[14]).toBe("2026-06-02");
    expect(row.values[15]).toBe("2026-05-29");
  });

  test("matches Python reference for Main Sheet fallback detail rows", async () => {
    const filePath = path.join(tempRoot, "29698 main fallback.xlsx");
    await makeMainSheetFallbackOrder(filePath);

    const python = await pythonReference(filePath);
    const typescript = await extractWorkbook(filePath, { inferManual: true });

    expect(typescript.values.slice(9, 12)).toEqual(python.values.slice(9, 12));
    expect(typescript.values.slice(19, 24)).toEqual(python.values.slice(19, 24));
    expect(typescript.manualCheck).toEqual(python.manualCheck);
  });

  test("matches Python reference for Main Sheet fallback stillage notes", async () => {
    const filePath = path.join(tempRoot, "29698 main fallback stillage.xlsx");
    await makeMainSheetFallbackStillageOrder(filePath);

    const python = await pythonReference(filePath);
    const typescript = await extractWorkbook(filePath, { inferManual: true });

    expect(typescript.values[7]).toEqual(python.values[7]);
    expect(typescript.notes).toEqual(python.notes);
    expect(typescript.manualCheck).toEqual(python.manualCheck);
  });

  test("matches Python reference for Main Sheet fallback oversize widths", async () => {
    const filePath = path.join(tempRoot, "29698 main fallback oversize.xlsx");
    await makeMainSheetFallbackOversizeOrder(filePath);

    const python = await pythonReference(filePath);
    const typescript = await extractWorkbook(filePath, { inferManual: true });

    expect(typescript.values[7]).toEqual(python.values[7]);
    expect(typescript.manualCheck).toEqual(python.manualCheck);
  });

  test("fills Worksheet mitre and hardware buckets for plain hinge rows", async () => {
    const filePath = path.join(tempRoot, "29698 plain hinge.xlsx");
    await makeWorksheetOrderWithLines(filePath, [
      {
        material: "1.05mm Zincanneal",
        qty: 1,
        profile: "Split",
        hingeQty: "3",
        hingeType: "HINGE PREP",
        strikerType: "S1+RDL",
        sill: "NO",
        double: "NO",
      },
    ]);

    const row = await extractWorkbook(filePath, { inferManual: true });

    expect(row.values.slice(19, 24)).toEqual([2, 5, 5, null, null]);
  });

  test("fills Worksheet W bucket for screw fixed prep rows", async () => {
    const filePath = path.join(tempRoot, "29698 screw fixed.xlsx");
    await makeWorksheetOrderWithLines(filePath, [
      {
        material: "1.05mm Zincanneal",
        qty: 1,
        profile: "Modern",
        hingeQty: "3",
        hingeType: "SCREW FIXED PREP",
        strikerType: "S1+ZANDA 10421",
        sill: "NO",
      },
      {
        material: "1.05mm Zincanneal",
        qty: 1,
        profile: "Modern",
        hingeQty: "3",
        hingeType: "SCREW FIXED PREP",
        strikerType: "S1",
        sill: "NO",
      },
    ]);

    const row = await extractWorkbook(filePath, { inferManual: true });

    expect(row.values.slice(19, 24)).toEqual([2, 9, 3, 6, null]);
  });

  test("fills Worksheet KD rows into X bucket and zero mitre", async () => {
    const filePath = path.join(tempRoot, "29698 kd.xlsx");
    await makeWorksheetOrderWithLines(filePath, [
      {
        material: "1.05mm Zincanneal",
        qty: 2,
        profile: "KD frame",
        hingeQty: "",
        strikerType: "",
      },
    ]);

    const row = await extractWorkbook(filePath, { inferManual: true });

    expect(row.values[11]).toBe("KD");
    expect(row.values.slice(19, 24)).toEqual([0, 3, null, null, 8]);
  });

  test("fills Worksheet screw fix KD rows into X bucket at seven per quantity", async () => {
    const filePath = path.join(tempRoot, "29698 kd screw fix.xlsx");
    await makeWorksheetOrderWithLines(filePath, [
      {
        material: "1.05mm Zincanneal",
        qty: 1,
        profile: "Modern Knock Down - Screw Fix",
        revealWidth: 723,
        hingeQty: "2",
        hingeType: "WELDED",
        strikerType: "S1",
        sill: "NO",
      },
      {
        material: "1.05mm Zincanneal",
        qty: 2,
        profile: "Modern Knock Down - Screw Fix",
        revealWidth: 723,
        hingeQty: "2",
        hingeType: "WELDED",
        strikerType: "S1",
        sill: "NO",
      },
      {
        material: "1.05mm Zincanneal",
        qty: 3,
        profile: "Modern Knock Down - Screw Fix",
        revealWidth: 823,
        hingeQty: "2",
        hingeType: "WELDED",
        strikerType: "S1",
        sill: "NO",
      },
    ]);

    const row = await extractWorkbook(filePath, { inferManual: true });

    expect(row.values[11]).toBe("KD");
    expect(row.values[20]).toBe(42);
    expect(row.values[23]).toBe(42);
  });

  test("fills Worksheet over-size quantity only when reveal width is over 1220", async () => {
    const filePath = path.join(tempRoot, "29698 oversize.xlsx");
    await makeWorksheetOrderWithLines(filePath, [
      {
        material: "1.05mm Zincanneal",
        qty: 1,
        profile: "Modern",
        revealWidth: 1203,
      },
      {
        material: "1.05mm Zincanneal",
        qty: 2,
        profile: "Modern",
        revealWidth: 1220,
      },
      {
        material: "1.05mm Zincanneal",
        qty: 3,
        profile: "Modern",
        revealWidth: 1221,
      },
    ]);

    const row = await extractWorkbook(filePath, { inferManual: true });

    expect(row.values[7]).toBe(3);
  });

  test("does not count Sheet1 reveal width 1203 as over-size", async () => {
    const filePath = path.join(tempRoot, "29698 sheet1 reveal threshold.xlsx");
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");
    ws.getCell("A1").value = "Job # 29698";
    ws.getCell("A6").value = "Material";
    ws.getCell("B6").value = "1.05mm Zincanneal";
    [
      "Door #",
      "PROFILE",
      "OVERALL HEIGHT",
      "REVEAL WIDTH",
      "HAND",
      "HINGE QTY",
      "WELDED HINGES",
      "STRIKER TYPE",
      "STRIKER HEIGHT",
    ].forEach((value, index) => {
      ws.getCell(12, index + 1).value = value;
    });
    [
      ["D1", "A", 2229, 1203, "RIGHT", 4, "100X75X1.6", "-", "-"],
      ["D2", "A", 2229, 1220, "LEFT", 4, "100X75X1.6", "-", "-"],
      ["D3", "A", 2229, 1221, "RIGHT", 4, "100X75X1.6", "-", "-"],
    ].forEach((values, rowOffset) => {
      values.forEach((value, index) => {
        ws.getCell(13 + rowOffset, index + 1).value = value;
      });
    });
    await wb.xlsx.writeFile(filePath);

    const row = await extractWorkbook(filePath, { inferManual: true });

    expect(row.values[7]).toBe(1);
  });

  test("marks double rows for over-size manual review when no marker exists", async () => {
    const filePath = path.join(tempRoot, "29698 double.xlsx");
    await makeWorksheetOrderWithLines(filePath, [
      {
        material: "1.05mm Zincanneal",
        qty: 1,
        profile: "Modern",
        double: "YES",
      },
    ]);

    const row = await extractWorkbook(filePath, { inferManual: true });

    expect(row.values[7]).toBeNull();
    expect(row.manualCheck).toContain("Over Size requires manual entry");
  });

  test("extracts Sheet1 profile table metadata, goods, and inferred hardware", async () => {
    const filePath = path.join(tempRoot, "29698 sheet1.xlsx");
    await makeSheet1ProfileOrder(filePath);

    const row = await extractWorkbook(filePath, { inferManual: true });

    expect(row.values[1]).toBe("88");
    expect(row.values[2]).toBe("CELEBRATION");
    expect(row.values[6]).toBe("29698");
    expect(row.values[9]).toBe("1Z");
    expect(row.values[10]).toBe(2);
    expect(row.values[11]).toBe("MODERN");
    expect(row.values[12]).toBe(1);
    expect(row.values[13]).toBe("SPLIT DL");
    expect(row.values[14]).toBe("2026-06-02");
    expect(row.values[15]).toBe("2026-05-29");
    expect(row.values.slice(19, 24)).toEqual([5, 8, 8, null, null]);
  });

  test("matches Python reference for Sheet1 delivery address zone splitting", async () => {
    const filePath = path.join(tempRoot, "29698 sheet1 address.xlsx");
    await makeSheet1AddressOrder(filePath);

    const python = await pythonReference(filePath);
    const typescript = await extractWorkbook(filePath, { inferManual: true });

    expect(typescript.values[4]).toEqual(python.values[4]);
    expect(typescript.values[5]).toEqual(python.values[5]);
  });

  test("extracts nonstandard Worksheet Door # quantity tables as goods fallback", async () => {
    const filePath = path.join(tempRoot, "29698 nonstandard door table.xlsx");
    await makeNonstandardWorksheetDoorOrder(filePath);

    const row = await extractWorkbook(filePath, { inferManual: true });

    expect(row.values[9]).toBe("0.55G");
    expect(row.values[10]).toBe(2);
    expect(row.values[11]).toBe("MODERN");
    expect(row.values[12]).toBe(1);
    expect(row.values[13]).toBe("COMMERCIAL");
    expect(row.values[19]).toBe(3);
    expect(row.manualCheck).toEqual([]);
  });

  test("extracts nonstandard Worksheet metadata from labels when fixed cells are empty", async () => {
    const filePath = path.join(tempRoot, "nonstandard label order.xlsx");
    await makeNonstandardWorksheetLabelOrder(filePath);

    const row = await extractWorkbook(filePath, { inferManual: true });

    expect(row.values[1]).toBe("88");
    expect(row.values[2]).toBe("CELEBRATION");
    expect(row.values[6]).toBe("29698");
    expect(row.values[9]).toBe("1Z");
    expect(row.values[11]).toBe("SPLIT DL");
    expect(row.values[14]).toBe("2026-06-02");
    expect(row.values[15]).toBe("2026-05-29");
  });

  test("marks unsupported Worksheet detail layouts for manual review", async () => {
    const filePath = path.join(tempRoot, "29698 unsupported worksheet.xlsx");
    await makeUnsupportedWorksheetOrder(filePath);

    const row = await extractWorkbook(filePath);

    expect(row.manualCheck).toContain("unsupported worksheet detail layout: nonstandard detail header");
  });

  test("aggregates Sheet1 profile rows from multiple profile tables", async () => {
    const filePath = path.join(tempRoot, "29698 multiple profile tables.xlsx");
    await makeSheet1MultipleProfileTablesOrder(filePath);

    const row = await extractWorkbook(filePath, { inferManual: true });

    expect(row.values[10]).toBe(2);
    expect(row.values[11]).toBe("DELUXE");
    expect(row.values[12]).toBe(1);
    expect(row.values[13]).toBe("MODERN");
    expect(row.values[19]).toBe(3);
  });

  test("extracts Sheet1 profileless Door # Type quantity tables", async () => {
    const filePath = path.join(tempRoot, "29698 profileless sheet1.xlsx");
    await makeSheet1ProfilelessTypeOrder(filePath);

    const row = await extractWorkbook(filePath, { inferManual: true });

    expect(row.values[9]).toBe("1Z");
    expect(row.values[10]).toBe(2);
    expect(row.values[11]).toBe("MODERN");
    expect(row.values[12]).toBe(1);
    expect(row.values[13]).toBe("SPLIT");
    expect(row.values[19]).toBe(4);
    expect(row.manualCheck).toEqual([]);
  });

  test("classifies Sheet1 cavity profile tables as cavity sliders with default material", async () => {
    const filePath = path.join(tempRoot, "29698 cavity sheet1.xlsx");
    await makeSheet1CavityProfileOrder(filePath);

    const row = await extractWorkbook(filePath, { inferManual: true });

    expect(row.values[9]).toBe("1.6Z");
    expect(row.values[10]).toBe(1);
    expect(row.values[11]).toBe("CS");
    expect(row.values[19]).toBe(14);
    expect(row.manualCheck).toEqual([]);
  });

  test("marks Sheet1 orders without profile headers for manual review", async () => {
    const filePath = path.join(tempRoot, "29698 unsupported sheet1.xlsx");
    await makeUnsupportedSheet1Order(filePath);

    const row = await extractWorkbook(filePath);

    expect(row.manualCheck).toContain("Sheet1 profile header not found");
  });

  test("matches Python reference for hidden standard Worksheet detail rows", async () => {
    const filePath = path.join(tempRoot, "29698 hidden worksheet.xlsx");
    await makeWorksheetOrderWithHiddenDuplicateLine(filePath);

    const python = await pythonReference(filePath);
    const typescript = await extractWorkbook(filePath, { inferManual: true });

    expect(typescript.values.slice(10, 12)).toEqual(python.values.slice(10, 12));
    expect(typescript.values.slice(19, 24)).toEqual(python.values.slice(19, 24));
    expect(typescript.manualCheck).toEqual(python.manualCheck);
  });

  test("matches Python reference for Worksheet Deluxe Dry Lining goods bucket", async () => {
    const filePath = path.join(tempRoot, "29698 deluxe dry lining.xlsx");
    await makeWorksheetDeluxeDryLiningOrder(filePath);

    const python = await pythonReference(filePath);
    const typescript = await extractWorkbook(filePath, { inferManual: true });

    expect(typescript.values.slice(10, 12)).toEqual(python.values.slice(10, 12));
    expect(typescript.values[19]).toEqual(python.values[19]);
    expect(typescript.manualCheck).toEqual(python.manualCheck);
  });

  test("matches Python reference for Worksheet Deluxe cleats extra parts", async () => {
    const filePath = path.join(tempRoot, "29698 CLEAT deluxe dry lining.xlsx");
    await makeWorksheetDeluxeDryLiningOrder(filePath);

    const python = await pythonReference(filePath);
    const typescript = await extractWorkbook(filePath, { inferManual: true });

    expect(typescript.values.slice(10, 12)).toEqual(python.values.slice(10, 12));
    expect(typescript.values.slice(19, 24)).toEqual(python.values.slice(19, 24));
    expect(typescript.manualCheck).toEqual(python.manualCheck);
  });

  test("matches Python reference for Worksheet pallet over-size marker", async () => {
    const filePath = path.join(tempRoot, "29698 pallet marker.xlsx");
    await makeWorksheetPalletMarkerOrder(filePath);

    const python = await pythonReference(filePath);
    const typescript = await extractWorkbook(filePath, { inferManual: true });

    expect(typescript.values[7]).toEqual(python.values[7]);
    expect(typescript.manualCheck).toEqual(python.manualCheck);
  });

  test("matches Python reference for standard Worksheet equal goods source order and cavity rows", async () => {
    const filePath = path.join(tempRoot, "29698 equal goods cavity.xlsx");
    await makeWorksheetEqualGoodsCavityOrder(filePath);

    const python = await pythonReference(filePath);
    const typescript = await extractWorkbook(filePath, { inferManual: true });

    expect(typescript.values.slice(10, 14)).toEqual(python.values.slice(10, 14));
    expect(typescript.values[19]).toEqual(python.values[19]);
    expect(typescript.manualCheck).toEqual(python.manualCheck);
  });

  test("matches Python reference for standard Worksheet cavity soft closer accessory rows", async () => {
    const filePath = path.join(tempRoot, "29698 cavity soft closer.xlsx");
    await makeWorksheetCavitySoftCloserOrder(filePath);

    const python = await pythonReference(filePath);
    const typescript = await extractWorkbook(filePath, { inferManual: true });

    expect(typescript.values.slice(9, 14)).toEqual(python.values.slice(9, 14));
    expect(typescript.values[19]).toEqual(python.values[19]);
    expect(typescript.manualCheck).toEqual(python.manualCheck);
  });

  test("matches Python reference for Sheet1 hinge plates hardware buckets", async () => {
    const filePath = path.join(tempRoot, "29698 sheet1 hinge plates.xlsx");
    await makeSheet1HingePlatesOrder(filePath);

    const python = await pythonReference(filePath);
    const typescript = await extractWorkbook(filePath, { inferManual: true });

    expect(typescript.values.slice(10, 12)).toEqual(python.values.slice(10, 12));
    expect(typescript.values.slice(19, 24)).toEqual(python.values.slice(19, 24));
    expect(typescript.manualCheck).toEqual(python.manualCheck);
  });

  test("matches Python reference for Sheet1 CSK DTNA numeric hardware columns", async () => {
    const filePath = path.join(tempRoot, "29698 sheet1 csk dtna.xlsx");
    await makeSheet1CskDtnaOrder(filePath);

    const python = await pythonReference(filePath);
    const typescript = await extractWorkbook(filePath, { inferManual: true });

    expect(typescript.values.slice(10, 12)).toEqual(python.values.slice(10, 12));
    expect(typescript.values.slice(19, 24)).toEqual(python.values.slice(19, 24));
    expect(typescript.manualCheck).toEqual(python.manualCheck);
  });

  test("matches Python reference for Sheet1 head-only replacement rows", async () => {
    const filePath = path.join(tempRoot, "30095 sheet1 head only.xlsx");
    await makeSheet1HeadOnlyReplacementOrder(filePath);

    const python = await pythonReference(filePath);
    const typescript = await extractWorkbook(filePath, { inferManual: true });

    expect(typescript.values.slice(10, 12)).toEqual(python.values.slice(10, 12));
    expect(typescript.values.slice(19, 24)).toEqual(python.values.slice(19, 24));
    expect(typescript.manualCheck).toEqual(python.manualCheck);
  });

  test("matches Python reference for Main Sheet profileless commercial hardware", async () => {
    const filePath = path.join(tempRoot, "30354 main profileless hardware.xlsx");
    await makeMainSheetProfilelessCommercialHardwareOrder(filePath);

    const python = await pythonReference(filePath);
    const typescript = await extractWorkbook(filePath, { inferManual: true });

    expect(typescript.values.slice(10, 12)).toEqual(python.values.slice(10, 12));
    expect(typescript.values.slice(19, 24)).toEqual(python.values.slice(19, 24));
    expect(typescript.manualCheck).toEqual(python.manualCheck);
  });

  test("matches Python reference for Main Sheet profileless oversize width", async () => {
    const filePath = path.join(tempRoot, "30354 main profileless oversize.xlsx");
    await makeMainSheetProfilelessOversizeOrder(filePath);

    const python = await pythonReference(filePath);
    const typescript = await extractWorkbook(filePath, { inferManual: true });

    expect(typescript.values[7]).toEqual(python.values[7]);
    expect(typescript.manualCheck).toEqual(python.manualCheck);
  });

  test("matches Python reference for Main Sheet double-action commercial mitre", async () => {
    const filePath = path.join(tempRoot, "30354 main double action.xlsx");
    await makeMainSheetDoubleActionCommercialOrder(filePath);

    const python = await pythonReference(filePath);
    const typescript = await extractWorkbook(filePath, { inferManual: true });

    expect(typescript.values.slice(10, 12)).toEqual(python.values.slice(10, 12));
    expect(typescript.values[19]).toEqual(python.values[19]);
    expect(typescript.manualCheck).toEqual(python.manualCheck);
  });

  test("matches Python reference for Main Sheet commercial width and hardware totals", async () => {
    const filePath = path.join(tempRoot, "30354 main commercial widths.xlsx");
    await makeMainSheetCommercialWidthsOrder(filePath);

    const python = await pythonReference(filePath);
    const typescript = await extractWorkbook(filePath, { inferManual: true });

    expect(typescript.values[7]).toEqual(python.values[7]);
    expect(typescript.values.slice(10, 12)).toEqual(python.values.slice(10, 12));
    expect(typescript.values.slice(19, 24)).toEqual(python.values.slice(19, 24));
    expect(typescript.manualCheck).toEqual(python.manualCheck);
  });

  test("matches Python reference for Door Skin capping rows", async () => {
    const filePath = path.join(tempRoot, "AFDC Door Skins.xlsx");
    await makeDoorSkinsCappingOrder(filePath);

    const python = await pythonReference(filePath);
    const typescript = await extractWorkbook(filePath, { inferManual: true });

    expect(typescript.values.slice(10, 12)).toEqual(python.values.slice(10, 12));
    expect(typescript.manualCheck).toEqual(python.manualCheck);
  });

  test("matches Python reference for Danze Door Skin PO normalization", async () => {
    const filePath = path.join(tempRoot, "Danze Door Skins.xlsx");
    await makeDanzeDoorSkinPoOrder(filePath);

    const python = await pythonReference(filePath);
    const typescript = await extractWorkbook(filePath, { inferManual: true });

    expect(typescript.values[1]).toEqual(python.values[1]);
    expect(typescript.values[2]).toEqual(python.values[2]);
    expect(typescript.manualCheck).toEqual(python.manualCheck);
  });

  test("matches Python reference for Danze Door Skin profile-code source files", async () => {
    const filePath = path.join(tempRoot, "Danze Mining 30471 Door Skins 2mm and 1.05 + Window Handle Blank.xlsx");
    await makeDanzeDoorSkinProfileCodeOrder(filePath);

    const python = await pythonReference(filePath);
    const typescript = await extractWorkbook(filePath, { inferManual: true });

    expect(typescript.values.slice(10, 12)).toEqual(python.values.slice(10, 12));
    expect(typescript.values.slice(19, 24)).toEqual(python.values.slice(19, 24));
    expect(typescript.manualCheck).toEqual(python.manualCheck);
  });

  test("matches Python reference for Door Stop Build Up source files", async () => {
    const filePath = path.join(tempRoot, "AFDC Door Stop Build Up.xlsx");
    await makeDoorStopBuildUpOrder(filePath);

    const python = await pythonReference(filePath);
    const typescript = await extractWorkbook(filePath, { inferManual: true });

    expect(typescript.values.slice(10, 12)).toEqual(python.values.slice(10, 12));
    expect(typescript.manualCheck).toEqual(python.manualCheck);
  });

  test("matches Python reference for nonstandard Worksheet Door Stop Build Up source files", async () => {
    const filePath = path.join(tempRoot, "AFDC Door Stop Build Up nonstandard.xlsx");
    await makeNonstandardWorksheetDoorStopBuildUpOrder(filePath);

    const python = await pythonReference(filePath);
    const typescript = await extractWorkbook(filePath, { inferManual: true });

    expect(typescript.values.slice(10, 12)).toEqual(python.values.slice(10, 12));
    expect(typescript.values[19]).toEqual(python.values[19]);
    expect(typescript.manualCheck).toEqual(python.manualCheck);
  });

  test("matches Python reference for nonstandard Worksheet Trad Dyna source files", async () => {
    const filePath = path.join(tempRoot, "AFDC Trad Dyna nonstandard.xlsx");
    await makeNonstandardWorksheetTradDynaOrder(filePath);

    const python = await pythonReference(filePath);
    const typescript = await extractWorkbook(filePath, { inferManual: true });

    expect(typescript.values.slice(10, 12)).toEqual(python.values.slice(10, 12));
    expect(typescript.values[19]).toEqual(python.values[19]);
    expect(typescript.manualCheck).toEqual(python.manualCheck);
  });

  test("matches Python reference for nonstandard Worksheet Concealed Frame context rows", async () => {
    const filePath = path.join(tempRoot, "nonstandard concealed frame.xlsx");
    await makeNonstandardWorksheetConcealedFrameOrder(filePath);

    const python = await pythonReference(filePath);
    const typescript = await extractWorkbook(filePath, { inferManual: true });

    expect(typescript.values.slice(10, 12)).toEqual(python.values.slice(10, 12));
    expect(typescript.values[19]).toEqual(python.values[19]);
    expect(typescript.manualCheck).toEqual(python.manualCheck);
  });

  test("matches Python reference for Concealed Frame context rows", async () => {
    const filePath = path.join(tempRoot, "30354 concealed frame.xlsx");
    await makeConcealedFrameOrder(filePath);

    const python = await pythonReference(filePath);
    const typescript = await extractWorkbook(filePath, { inferManual: true });

    expect(typescript.values.slice(10, 12)).toEqual(python.values.slice(10, 12));
    expect(typescript.manualCheck).toEqual(python.manualCheck);
  });

  test("matches Python reference for Cowdroy context rows as cavity sliders", async () => {
    const filePath = path.join(tempRoot, "30354 cowdroy context.xlsx");
    await makeCowdroyContextOrder(filePath);

    const python = await pythonReference(filePath);
    const typescript = await extractWorkbook(filePath, { inferManual: true });

    expect(typescript.values.slice(10, 12)).toEqual(python.values.slice(10, 12));
    expect(typescript.values[19]).toEqual(python.values[19]);
    expect(typescript.manualCheck).toEqual(python.manualCheck);
  });

  test("matches Python reference for generic Capping profile rows", async () => {
    const filePath = path.join(tempRoot, "30354 capping profile.xlsx");
    await makeGenericCappingProfileOrder(filePath);

    const python = await pythonReference(filePath);
    const typescript = await extractWorkbook(filePath, { inferManual: true });

    expect(typescript.values.slice(10, 12)).toEqual(python.values.slice(10, 12));
    expect(typescript.manualCheck).toEqual(python.manualCheck);
  });

  test("matches Python reference for generic Flat Sheet profile rows", async () => {
    const filePath = path.join(tempRoot, "30354 flat sheet profile.xlsx");
    await makeGenericFlatSheetProfileOrder(filePath);

    const python = await pythonReference(filePath);
    const typescript = await extractWorkbook(filePath, { inferManual: true });

    expect(typescript.values.slice(10, 12)).toEqual(python.values.slice(10, 12));
    expect(typescript.manualCheck).toEqual(python.manualCheck);
  });

  test("matches Python reference for generic Slider profile rows", async () => {
    const filePath = path.join(tempRoot, "30354 slider profile.xlsx");
    await makeGenericSliderProfileOrder(filePath);

    const python = await pythonReference(filePath);
    const typescript = await extractWorkbook(filePath, { inferManual: true });

    expect(typescript.values.slice(10, 12)).toEqual(python.values.slice(10, 12));
    expect(typescript.manualCheck).toEqual(python.manualCheck);
  });

  test("matches Python reference for ignored non-product profile rows", async () => {
    const filePath = path.join(tempRoot, "30354 ignored profile.xlsx");
    await makeGenericIgnoredProfileOrder(filePath);

    const python = await pythonReference(filePath);
    const typescript = await extractWorkbook(filePath, { inferManual: true });

    expect(typescript.values.slice(10, 12)).toEqual(python.values.slice(10, 12));
    expect(typescript.manualCheck).toEqual(python.manualCheck);
  });

  test("matches Python reference for generic LN and BL commercial prefix rows", async () => {
    const filePath = path.join(tempRoot, "30354 commercial prefix profile.xlsx");
    await makeGenericCommercialPrefixProfileOrder(filePath);

    const python = await pythonReference(filePath);
    const typescript = await extractWorkbook(filePath, { inferManual: true });

    expect(typescript.values.slice(10, 12)).toEqual(python.values.slice(10, 12));
    expect(typescript.manualCheck).toEqual(python.manualCheck);
  });

  test("matches Python reference for Trad Dyna files treating split profiles as commercial", async () => {
    const filePath = path.join(tempRoot, "AFDC Trad Dyna Single Rebate.xlsx");
    await makeTradDynaMainSheetOrder(filePath);

    const python = await pythonReference(filePath);
    const typescript = await extractWorkbook(filePath, { inferManual: true });

    expect(typescript.values.slice(10, 12)).toEqual(python.values.slice(10, 12));
    expect(typescript.manualCheck).toEqual(python.manualCheck);
  });

  test("matches Python reference for unsupported multi-sheet Sheet1 workbooks", async () => {
    const filePath = path.join(tempRoot, "29698 sheet1 extra sheet.xlsx");
    await makeSheet1WithExtraSheetOrder(filePath);

    const python = await pythonReference(filePath);
    const typescript = await extractWorkbook(filePath, { inferManual: true });

    expect(typescript.values).toEqual(python.values);
    expect(typescript.manualCheck).toEqual(python.manualCheck);
  });

  test("matches Python reference for Worksheet notes", async () => {
    const filePath = path.join(tempRoot, "29698 worksheet notes.xlsx");
    await makeWorksheetOrderWithFields(filePath, { notes: "Urgent site delivery" });

    const python = await pythonReference(filePath);
    const typescript = await extractWorkbook(filePath, { inferManual: true });

    expect(typescript.notes).toEqual(python.notes);
  });

  test("matches Python reference for Worksheet Data sheet metadata fallback", async () => {
    const filePath = path.join(tempRoot, "data sheet metadata.xlsx");
    await makeWorksheetOrderWithDataFallback(filePath);

    const python = await pythonReference(filePath);
    const typescript = await extractWorkbook(filePath, { inferManual: true });

    expect([1, 2, 4, 5, 6, 14, 15, 16].map((index) => typescript.values[index])).toEqual(
      [1, 2, 4, 5, 6, 14, 15, 16].map((index) => python.values[index]),
    );
    expect(typescript.manualCheck).toEqual(python.manualCheck);
  });

  test("matches Python reference for nonstandard Worksheet delivery-address splitting", async () => {
    const filePath = path.join(tempRoot, "nonstandard worksheet address.xlsx");
    await makeNonstandardWorksheetAddressOrder(filePath);

    const python = await pythonReference(filePath);
    const typescript = await extractWorkbook(filePath, { inferManual: true });

    expect(typescript.values.slice(1, 6)).toEqual(python.values.slice(1, 6));
    expect(typescript.values[9]).toEqual(python.values[9]);
    expect(typescript.values.slice(14, 17)).toEqual(python.values.slice(14, 17));
    expect(typescript.manualCheck).toEqual(python.manualCheck);
  });

  test("matches Python reference for Sheet1 multiple material labels", async () => {
    const filePath = path.join(tempRoot, "sheet1 multiple materials.xlsx");
    await makeSheet1MultiMaterialOrder(filePath);

    const python = await pythonReference(filePath);
    const typescript = await extractWorkbook(filePath, { inferManual: true });

    expect(typescript.values[9]).toEqual(python.values[9]);
    expect(typescript.manualCheck).toEqual(python.manualCheck);
  });
});

describe("runOrderExtraction", () => {
  test("writes only the result workbook output", async () => {
    const filePath = path.join(tempRoot, "29698 order.xlsx");
    await makeWorksheetOrder(filePath);
    const outputsDir = path.join(tempRoot, "order_extraction_output");
    await mkdir(outputsDir, { recursive: true });
    await writeFile(path.join(outputsDir, "extracted_job_rows.csv"), "old csv", "utf8");
    await writeFile(path.join(outputsDir, "audit.csv"), "old audit", "utf8");

    const result = await runOrderExtraction([filePath]);

    expect(result.rows).toHaveLength(1);
    expect(await stat(result.outputs.xlsxOutput)).toBeTruthy();
    await expect(stat(result.outputs.csvOutput)).rejects.toThrow();
    await expect(stat(result.outputs.auditOutput)).rejects.toThrow();
  });

  test("fills estimated completion date when inferManual is enabled", async () => {
    const filePath = path.join(tempRoot, "29698 order.xlsx");
    await makeWorksheetOrderWithFields(filePath, { deliveryDate: "2026-06-02" });

    const result = await runOrderExtraction([filePath], { inferManual: true });

    expect(result.rows[0].values[14]).toBe("2026-06-02");
    expect(result.rows[0].values[15]).toBe("2026-05-29");
    expect(result.rows[0].values[16]).toBe("Friday");
  });

  test("sorts extracted outputs by ideal delivery date", async () => {
    const laterPath = path.join(tempRoot, "30002 later.xlsx");
    const earlierPath = path.join(tempRoot, "30001 earlier.xlsx");
    const blankPath = path.join(tempRoot, "30003 blank.xlsx");
    await makeWorksheetOrderWithFields(laterPath, { job: "Job 30002", po: "LATE", deliveryDate: "2026-06-20" });
    await makeWorksheetOrderWithFields(earlierPath, { job: "Job 30001", po: "EARLY", deliveryDate: "2026-06-01" });
    await makeWorksheetOrderWithFields(blankPath, { job: "Job 30003", po: "BLANK", deliveryDate: "" });

    const result = await runOrderExtraction([laterPath, blankPath, earlierPath]);

    expect(result.rows.map((row) => row.values[1])).toEqual(["EARLY", "LATE", "BLANK"]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(result.outputs.xlsxOutput);
    const worksheet = workbook.worksheets[0];
    expect([2, 3, 4].map((rowNumber) => worksheet.getCell(rowNumber, 2).value)).toEqual(["EARLY", "LATE", "BLANK"]);
  });

  test("skips Excel files without order content", async () => {
    const orderPath = path.join(tempRoot, "29698 order.xlsx");
 const reportPath = path.join(tempRoot, "weekly report.xlsx");
 await makeWorksheetOrder(orderPath);
 await makeNonOrderWorkbook(reportPath);

 const result = await runOrderExtraction([orderPath, reportPath]);

 expect(result.rows).toHaveLength(1);
 expect(result.rows[0].sourceFile).toBe("29698 order.xlsx");
 expect(result.skippedFiles).toContain("weekly report.xlsx");
 });

 test("deduplicates duplicate jobs by highest source version", async () => {
    const olderPath = path.join(tempRoot, "29698__0178__old.xlsx");
    const newerPath = path.join(tempRoot, "29698__0216__new.xlsx");
    await makeWorksheetOrderWithFields(olderPath, { po: "OLD" });
    await makeWorksheetOrderWithFields(newerPath, { po: "NEW" });

    const result = await runOrderExtraction([olderPath, newerPath]);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].sourceFile).toBe("29698__0216__new.xlsx");
    expect(result.rows[0].values[1]).toBe("NEW");
  });

  test("deduplicates duplicate jobs without source version by newest mtime", async () => {
    const olderPath = path.join(tempRoot, "29698 older.xlsx");
    const newerPath = path.join(tempRoot, "29698 newer.xlsx");
    await makeWorksheetOrderWithFields(olderPath, { po: "OLD" });
    await makeWorksheetOrderWithFields(newerPath, { po: "NEW" });
    await utimes(olderPath, new Date(1_700_000_000_000), new Date(1_700_000_000_000));
    await utimes(newerPath, new Date(1_700_000_100_000), new Date(1_700_000_100_000));

    const result = await runOrderExtraction([newerPath, olderPath]);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].sourceFile).toBe("29698 newer.xlsx");
    expect(result.rows[0].values[1]).toBe("NEW");
  });

  test("splits Sheet1 zone prefix from delivery address in the same cell", async () => {
    const cases = [
      ["42b 28 SIGNAL TCE, COCKBURN TCE", "42B", "28 SIGNAL TCE, COCKBURN TCE"],
      ["03C, 62 CLAYTON STREET BELLEVUE", "03C", "62 CLAYTON STREET BELLEVUE"],
    ];

    for (const [deliveryAddress, expectedZone, expectedAddress] of cases) {
      const filePath = path.join(tempRoot, `${expectedZone} sheet1 address.xlsx`);
      await makeSheet1AddressOrder(filePath, deliveryAddress);
      const row = await extractWorkbook(filePath, { inferManual: true });

      expect(row.values[4]).toBe(expectedZone);
      expect(row.values[5]).toBe(expectedAddress);
    }
  });
});
