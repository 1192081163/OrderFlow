# Full Electron TypeScript Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an Electron/TypeScript desktop version of the order organizer while keeping the existing Python rules engine as the authoritative order extraction implementation.

**Architecture:** Electron runs the desktop shell, file dialogs, renderer UI, and secure IPC. TypeScript modules own settings, email attachment ingestion, input file scanning, orchestration, and app packaging. Order extraction calls `python_extraction_bridge.py`, which delegates to `desktop_runner.py` and `extract.py` so the existing Python rules stay in use.

**Tech Stack:** Electron, React, Fluent UI React, TypeScript, Vite, Vitest, ExcelJS, mailparser, imapflow, Node.js filesystem APIs, Python, openpyxl, PyInstaller for the Windows rules runner.

**Architecture pivot on 2026-06-16:** The project initially explored a full TypeScript rule migration, but the current product direction is to keep Python rules for speed and rule fidelity. The TypeScript extractor and parity tests remain useful as reference coverage, but runtime extraction now defaults to the Python bridge.

---

### Task 1: TypeScript Project Skeleton

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `src/shared/types.ts`

- [x] **Step 1: Add package scripts and TypeScript config**

Create npm scripts for typecheck, unit tests, renderer build, and Electron start.

- [x] **Step 2: Install dependencies**

Run `npm install`.

- [x] **Step 3: Run typecheck**

Run `npm run typecheck`.

Expected: TypeScript compiles once source files exist.

### Task 2: Core File Scanning And Output Paths

**Files:**
- Create: `src/core/fileScanner.ts`
- Create: `src/core/outputPaths.ts`
- Create: `src/core/fileScanner.test.ts`

- [x] **Step 1: Write failing tests**

Cover `.xlsx/.xlsm` filtering, temp-file rejection, Job Track rejection, `总表.xlsx` rejection, folder recursion, and default output paths.

- [x] **Step 2: Run tests for RED**

Run `npm test -- src/core/fileScanner.test.ts`.

- [x] **Step 3: Implement scanner and output paths**

Mirror `desktop_runner.py` behavior in TypeScript.

- [x] **Step 4: Run tests for GREEN**

Run `npm test -- src/core/fileScanner.test.ts`.

### Task 3: Basic Excel Extraction And Writers

**Files:**
- Create: `src/core/orderExtractor.ts`
- Create: `src/core/writers.ts`
- Create: `src/core/orderExtractor.test.ts`

- [x] **Step 1: Write failing tests**

Generate an in-memory workbook with `Worksheet`, `C1`, `C2`, `C5`, `C6`, and a simple material/detail row. Assert job number, PO, builder, delivery date, material, goods, and quantity.

- [x] **Step 2: Run tests for RED**

Run `npm test -- src/core/orderExtractor.test.ts`.

- [x] **Step 3: Implement first-pass extractor and writers**

Use ExcelJS. Implement enough TS extraction to support common Worksheet/Main Sheet labels and generate `订单整理结果.xlsx`, `extracted_job_rows.csv`, and `audit.csv`.

- [x] **Step 4: Run tests for GREEN**

Run `npm test -- src/core/orderExtractor.test.ts`.

### Task 4: Email Settings And Attachment Source

**Files:**
- Create: `src/core/settings.ts`
- Create: `src/core/emailSource.ts`
- Create: `src/core/emailSource.test.ts`

- [x] **Step 1: Write failing tests**

Cover settings round-trip, Excel attachment filtering, filename sanitizing, and duplicate attachment names.

- [x] **Step 2: Run tests for RED**

Run `npm test -- src/core/emailSource.test.ts`.

- [x] **Step 3: Implement settings and email attachment helpers**

Use `mailparser` for parsing message attachments and `imapflow` for runtime IMAP access.

- [x] **Step 4: Run tests for GREEN**

Run `npm test -- src/core/emailSource.test.ts`.

Additional progress: TypeScript email fetching now mirrors Python's recent-mail behavior by applying an exact parsed `Date` cutoff after IMAP retrieval, while still keeping messages with missing dates.

### Task 5: Electron Main, Preload, And Renderer

**Files:**
- Create: `src/main/main.ts`
- Create: `src/preload/preload.ts`
- Create: `src/renderer/index.html`
- Create: `src/renderer/app.ts`
- Create: `src/renderer/styles.css`
- Create: `src/main/ipcHandlers.ts`

- [x] **Step 1: Implement secure IPC**

Expose load/save settings, select files, select folder, extract from local paths, extract from email, and open output path.

- [x] **Step 2: Implement single-page renderer**

Use the approved minimal layout: email extraction as primary, local Excel/folder as secondary, compact settings, progress/log/result controls.

- [x] **Step 3: Run typecheck and unit tests**

Run `npm run typecheck` and `npm test`.

### Task 6: Documentation And Local Run

**Files:**
- Modify: `README.md`

- [x] **Step 1: Add Electron run instructions**

Document `npm install`, Python runner dependencies, `npm start`, and the note that Python rules remain the extraction source.

- [x] **Step 2: Run verification**

Run `npm run typecheck`, `npm test`, and `python3 -m pytest`.

- [x] **Step 3: Start Electron locally**

Run `npm start` and inspect the local window.

### Task 7: Deep Python Rule Parity Migration

**Files:**
- Modify: `src/core/orderExtractor.ts`
- Modify: `src/core/orderExtractor.test.ts`
- Add as needed: focused helper modules under `src/core/`

Runtime note: this task is no longer required before shipping because Electron now calls the Python rules engine directly. Keep this work as regression/reference coverage and resume only if a future decision removes Python from runtime extraction.

- [x] **Step 1: Port job metadata extraction rules**

Use tests to cover title-cell job numbers, filename fallback, purchase order cleanup, builder normalization, and delivery date parsing.

Completed coverage includes Worksheet fixed cells and label fallback, Main Sheet label lookup, PO cleanup, builder aliases/manual-review fallback, delivery date parsing, inferred completion date, and duplicate job source-version dedupe.

Additional progress: duplicate job rows without source-version suffix now use Python's latest-source fallback, selecting by file modification time before source filename.

Additional progress: Worksheet metadata now fills the Zone and Deliver Address columns from `C7`/`C4`, including Python-compatible `12a -> 12A` zone normalization and `pickup -> PICK UP` address normalization.

Additional progress: `Sheet1`/`Main Sheet` metadata now mirrors Python's `Delivery Address` label parsing, including right-side `12A` plus address pairs and single-cell `12A - address` splitting before normalizing Zone and Deliver Address.

Additional progress: TypeScript builder normalization now mirrors Python's CSV-backed `rules/builder_aliases.csv` entries such as `NATS`, preserving the builder value without adding an unmapped-builder manual review warning.

Additional progress: delivery-date parsing now mirrors Python's accepted `%Y-%m-%d`, `%d/%m/%Y`, and `%m/%d/%Y` formats so slash-formatted order dates normalize before completion-date calculation.

Additional progress: `Main Sheet` Danze Door Skin PO numbers now mirror Python's special `NN-000123-NN -> 123` normalization when the normalized builder is `DANZE` and a visible sheet cell contains `SKIN`.

- [ ] **Step 2: Port detail table and goods classification rules**

Use tests to cover split/stacker/cavity/modern/deluxe/commercial profile names, material aliases, multiple quantity columns, and missing detail fallback.

Progress: TypeScript now covers material thickness aliases, Colorbond colour markers, SPLIT DL, CS, MODERN, DELUXE, COMMERCIAL aliases, multi-row material aggregation, two largest goods groups, and `more than two goods groups found` manual review.

Additional progress: standard `Worksheet` rows now fill inferred MITRE, Parts, V/W/X hardware buckets for plain hinge, screw-fixed prep, and KD rows when `inferManual` is enabled.

Additional progress: `Sheet1` profile-table orders now extract label metadata, material rows, product quantities, goods groups, inferred completion date, MITRE, Parts, and V hardware bucket for simple profile tables.

Additional progress: nonstandard `Worksheet` orders now fall back to `Door #`/`Qty` tables, commercial profile-code detection, material labels, MITRE totals, and multiple `Sheet1` profile tables with different column positions.

Additional progress: `Sheet1` profileless `Door #`/`Type` tables now extract Type as the product profile, and cavity/slider table context now maps Modern/Deluxe rows to `CS` with default cavity-slider material and MITRE totals.

Additional progress: Python/TypeScript parity coverage now includes a generated standard `Worksheet` fixture that runs both `extract.py` and `extractWorkbook`; hidden detail rows are skipped in TypeScript to match Python goods and manual totals.

Additional progress: parity coverage now includes standard `Worksheet` Deluxe Dry Lining output and `Sheet1` hinge-plates hardware rows; TypeScript now routes Sheet1 hinge plate quantities to W, keeps striker quantities in V, and uses the Python-compatible 1.43 W multiplier for Parts.

Additional progress: parity coverage now includes `Sheet1` CSK/DTNA numeric hardware columns; TypeScript now detects numeric hardware columns, applies the same header multipliers as Python, and parses the first number from text values like `10 (5 EACH SIDE)`.

Additional progress: parity coverage now includes `Sheet1` head-only replacement rows; TypeScript now skips `REPLACEMENT HEAD` + `HEAD ONLY` rows so replacement heads do not inflate KD goods or manual hardware totals.

Additional progress: parity coverage now includes `Main Sheet` profileless commercial hardware; TypeScript now treats non-cavity `Main Sheet` profileless rows as `COMMERCIAL`, reads striker columns to the right of the profile column, and routes profileless hinge quantities into the W bucket to match Python Parts/V/W totals.

Additional progress: parity coverage now includes `Main Sheet` commercial profile tables with wide frames and hardware; TypeScript now applies Python's 1.43 W-to-Parts multiplier for Main Sheet profile rows while keeping profileless commercial rows at the Python-compatible 1.0 multiplier.

Additional progress: parity coverage now includes Door Skin and Trad Dyna file-name context rules; TypeScript now maps Door Skin `FLAT SHEET` rows to `DS`, suppresses commercial fallback for Door Skin `CAPPING` rows when a flat sheet exists, and treats `TRAD DYNA` source files as commercial goods.

Additional progress: Door Stop Build Up source files now mirror Python's filename context rule by forcing profile rows into the `CP` goods bucket instead of falling back to commercial profile-code classification.

Additional progress: Main Sheet profile rows with `CONCEALED FRAME` in the row context now mirror Python's context classification by overriding the profile goods bucket to `CONCEALED`.

Additional progress: Cavity-style row contexts now mirror Python's `CS` override for `/CAV/`, `COWDROY`, and `CLOSING JAMB` profile/context markers.

Additional progress: generic profile text classification now mirrors Python's direct `CAPPING` and `FLAT SHEET` branches before broader goods fallback/manual-review handling.

Additional progress: generic profile text classification now mirrors Python's `SLIDER` branch by mapping slider profiles to `CS`.

Additional progress: TypeScript now mirrors Python's `rules/goods_ignore_patterns.csv` behavior for non-product profile descriptions such as `Single Electric`, suppressing unmapped-goods manual checks while leaving Goods empty.

Additional progress: generic profile text classification now mirrors Python's `LN-`/`BL-` prefix branch by treating those rows as `COMMERCIAL` even when the suffix is not numeric.

Additional progress: parity coverage now includes Worksheet Deluxe cleat files; TypeScript now mirrors Python's `CLEAT` filename rule by adding `qty * 6` extra Parts/V for Deluxe Dry Lining rows.

Additional progress: standard `Worksheet` detail rows now match Python's Cavity marker scan, including quantity/profile rows with blank material under `Cavity Sliders`, `CS` goods mapping, default cavity-slider material codes, and Cavity MITRE totals.

Additional progress: standard `Worksheet` Cavity accessory rows such as `Brio Soft Closer` now stay out of the `CS` goods/MITRE totals while preserving Python's manual-check side effect for unmapped accessory profiles.

Additional progress: legacy `Main Sheet` files without profile/profileless headers now mirror Python's fallback detail-row extraction for material codes, goods totals, MITRE, and V/W/Parts hardware totals.

Additional progress: nonstandard `Worksheet` `Door #`/`Qty` fallback rows now mirror Python's source/context goods overrides for Door Stop Build Up (`CP`), Trad Dyna (`COMMERCIAL`), and Concealed Frame (`CONCEALED`).

- [ ] **Step 3: Port manual-review signals**

Use tests to cover ambiguous quantities, missing job number, missing material/profile, oversize clues, and fields that should be surfaced in `manualCheck`.

Progress: standard `Worksheet` rows now fill H Over Size from reveal width above 1024 and add `Over Size requires manual entry` for double rows without a concrete over-size marker.

Additional progress: unsupported `Worksheet` detail layouts now add `unsupported worksheet detail layout: nonstandard detail header` to `manualCheck` instead of silently producing an empty goods row.

Additional progress: `Sheet1`/`Main Sheet` files without profile or profileless headers now add `Sheet1 profile header not found` to `manualCheck`.

Additional progress: `Main Sheet` profile/profileless tables now read `WIDTH` columns into the TypeScript manual totals path so widths over 1024 populate H Over Size; Main Sheet profileless rows also preserve Python's `goods type not mapped` manual-review side effect before commercial fallback.

Additional progress: legacy `Main Sheet` fallback rows now mirror Python's width-column over-size count and stillage note/manual-review behavior.

Additional progress: `Main Sheet` commercial double-action rows now use Python's half-extra MITRE rule (`DOUBLE ACTION` adds 0.5 per commercial row instead of 1.0), while ordinary commercial double rows retain the full extra MITRE rule.

Additional progress: workbook-level over-size text markers now match Python priority scanning (`GLUT`, `PALLET`, `STILLAGE`) across visible rows and write H Over Size marker values such as `pallet`.

Additional progress: standard `Worksheet` Cavity accessory profiles now preserve Python's `goods type not mapped` manual-review signal while still suppressing accessory goods totals.

Additional progress: `Sheet1`/`Main Sheet` delivery dates that cannot be parsed now mirror Python by clearing the date output and adding `delivery date not parsed: ...` to `manualCheck`.

- [ ] **Step 4: Compare against Python reference fixtures**

Run Python and TypeScript extraction against the same generated fixtures and keep mismatches documented until fully resolved.

Progress: a Vitest parity fixture now invokes Python `extract.extract_workbook(..., infer_manual=True)` against the same generated workbook as TypeScript, starting with hidden standard `Worksheet` detail rows.

Additional progress: parity fixtures now also cover Deluxe Dry Lining and Sheet1 hinge-plates hardware buckets.

Additional progress: parity fixtures now cover Sheet1 CSK/DTNA numeric hardware columns and their V/Parts totals.

Additional progress: parity fixtures now cover Sheet1 head-only replacement rows, Main Sheet profileless commercial hardware, and Main Sheet profileless oversize width/manual-check behavior.

Additional progress: parity fixtures now cover Main Sheet commercial double-action MITRE, Main Sheet commercial width/hardware totals, Door Skin capping behavior, and Trad Dyna split-profile commercial grouping.

Additional progress: parity fixtures now cover Worksheet Deluxe cleat extra Parts/V totals and Worksheet pallet over-size marker behavior.

Additional progress: parity fixtures now cover duplicate-job latest-mtime dedupe and standard Worksheet Cavity rows where equal quantities preserve Python goods ordering and blank-material rows still produce `CS`.

Additional progress: parity fixtures now cover Worksheet Zone/Deliver Address normalization and standard Worksheet Cavity Soft Closer accessory rows.

Additional progress: parity fixtures now cover `Sheet1` delivery-address zone splitting from values like `12a - pickup`.

Additional progress: parity fixtures now cover Door Stop Build Up source-file goods overrides (`CP`).

Additional progress: parity fixtures now cover unsupported multi-sheet `Sheet1` workbooks; TypeScript now matches Python by returning an unsupported-layout manual check instead of parsing the first sheet.

Additional progress: standard `Worksheet` notes now mirror Python by surfacing cleaned `I4` content as `notes=...` audit metadata.

Additional progress: standard `Worksheet` metadata now mirrors Python's `Data` sheet fallback for job, builder, PO, delivery address, delivery date, and zone when the fixed `C` cells are empty.

Additional progress: nonstandard `Worksheet` metadata now mirrors Python's delivery-address splitting, so label values such as `12a - pickup` populate Zone and Deliver Address separately.

Additional progress: nonstandard `Worksheet` material fallback now mirrors Python by preserving a `Material` label code even when the detail layout is unsupported.

Additional progress: `Sheet1`/`Main Sheet` material extraction now mirrors Python's multi-cell material label behavior by collecting the joined material code, individual adjacent cell codes, and first-15-row fallback codes before sorting and de-duplicating.

Additional progress: parity fixtures now cover legacy `Main Sheet` fallback detail rows, fallback stillage notes, and fallback over-size widths.

Additional progress: parity fixtures now cover nonstandard `Worksheet` source/context goods overrides for Door Stop Build Up, Trad Dyna, and Concealed Frame rows.

Additional progress: parity fixtures now cover `CONCEALED FRAME` row-context goods overrides (`CONCEALED`).

Additional progress: parity fixtures now cover `COWDROY` row-context goods overrides (`CS`) and the resulting cavity-slider MITRE total.

Additional progress: parity fixtures now cover generic `CAPPING` and `FLAT SHEET` profile rows.

Additional progress: parity fixtures now cover generic `SLIDER` profile rows and ignored non-product profile descriptions.

Additional progress: parity fixtures now cover generic `LN-`/`BL-` commercial prefix rows and CSV-backed builder aliases.

Additional progress: parity fixtures now cover slash-formatted delivery dates and unparsed `Sheet1` delivery date manual-review signals.

Additional progress: parity fixtures now cover Danze Door Skin three-part PO normalization.

### Task 8: Electron Packaging And Release

**Files:**
- Modify: `package.json`
- Modify: `.github/workflows/release.yml`
- Modify: `README.md`
- Create: `src/packaging/packageConfig.test.ts`

- [x] **Step 1: Add packaging regression tests**

Verify `package.json` exposes Electron Builder Windows scripts, omits macOS packaging scripts, and the release workflow no longer packages the Python desktop app.

- [x] **Step 2: Add Electron Builder configuration**

Use `electron-builder` with the Windows NSIS target, writing artifacts to `release/`.

- [x] **Step 3: Replace Release workflow**

Use Node/npm CI, install Python runner dependencies, build the Windows Python rules runner, run `npm run typecheck`, `npm test`, and `npm run dist:win`; remove the old Python desktop packaging and macOS packaging from the release workflow.

- [x] **Step 4: Verify local Windows package**

Run `npm run dist:win` and confirm `release/order-organizer-assistant-windows.exe` is produced.
