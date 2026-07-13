# Local Mail Workstation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the desktop application into a single-Windows-PC mail workstation that logs directly into WeCom IMAP, caches seven days locally, runs in the tray, notifies only for valid order workbooks, and extracts only after the user selects messages.

**Architecture:** Electron main owns the DPAPI-backed credential boundary, `node:sqlite` cache, IMAP IDLE monitor, Windows notifications, and the existing local Python extraction path. The renderer receives secret-free views and events over IPC. The remote API, SSE, agent, server, deployment, and packaged remote configuration are removed; the desktop opens no inbound listener.

**Tech Stack:** Electron 39.8.10 (Node 22.22.1), React 19, TypeScript 5.9, `node:sqlite`, ImapFlow, Vitest, Electron `safeStorage`, Windows DPAPI, existing Python extraction bridge.

## Global Constraints

- V1 runs on one designated office Windows computer only; there is no shared multi-computer mail list or notification stream.
- The office computer opens no HTTP, WebSocket, SOCKS, file-sharing, or remote-control listener.
- Mail traffic connects directly to `imap.exmail.qq.com:993` with TLS verification enabled. There is no proxy or insecure-certificate bypass.
- Mailbox credentials, attachments, cached metadata, and extraction results never go to `orderflow.ausmet.ai` or another mail service.
- The authorization code is persisted only through Electron `safeStorage`; Windows DPAPI protects it. If encryption is unavailable, never fall back to plaintext persistence.
- Plaintext authorization codes, decrypted settings objects, raw attachment contents, and Authorization headers never enter logs.
- The first release starts after the Windows user signs in, not as a pre-login Windows Service.
- Closing the main window hides it to the system tray. Only the tray's explicit Exit command stops monitoring and quits.
- Cache exactly the most recent 7 days. Do not add a configurable 3/14/30-day range.
- Prefer IMAP IDLE, scan every 60 seconds as a fallback, and reconnect with jittered exponential backoff from 1 to 60 seconds.
- Only `.xlsx` and `.xlsm` attachments that pass the existing order-workbook classifier enter the list or trigger a notification. Reject candidates larger than 25 MB.
- New order messages update the list and notify once, but never start extraction automatically.
- Email extraction starts only after manual UID selection and continues through the existing local Python bridge and `extract.py`.
- Existing local-file/folder extraction, progress events, result workbooks, and output-folder buttons remain unchanged.
- Use Electron's bundled `node:sqlite`; do not add `sqlite3`, `better-sqlite3`, or another native SQLite dependency. Electron 39.8.10/Node 22.22.1 was verified to load SQLite 3.51.2.
- The existing `codex/office-mail-gateway` branch at `c3cabac` is abandoned and must never be merged into this branch.
- Preserve the user's existing Deluxe Dry Lining changes in `extract.py`, `services/orderflow-email-api/extract.py`, `src/core/orderExtractor.ts`, `src/core/orderExtractor.test.ts`, and `tests/test_hardware_rules.py` before deleting the obsolete service tree.

---

## File Structure

### Shared contracts and storage

- Modify `src/shared/types.ts`: secret-free settings, runtime status, cached message, event, and manual extraction contracts.
- Create `src/localMail/localMailCredentialStore.ts`: DPAPI/safeStorage persistence and one-time plaintext settings migration.
- Create `src/localMail/localMailCredentialStore.test.ts`: encryption, migration, and no-plaintext tests.
- Create `src/localMail/localMailStore.ts`: WAL cache, UID idempotency, notification/extraction flags, seven-day pruning, and corruption recovery.
- Create `src/localMail/localMailStore.test.ts`: database behavior and recovery tests.

### IMAP and runtime

- Modify `src/core/emailSource.ts`: verify credentials, classify only new candidate UIDs, enforce 25 MB, and expose a safe IMAP client factory for the idle session.
- Modify `src/core/emailSource.test.ts`: classification, excluded UID, size, and verification tests.
- Create `src/localMail/imapIdleConnection.ts`: one outbound IMAP connection that resolves on mailbox change/close/error/abort.
- Create `src/localMail/imapIdleConnection.test.ts`: event and cleanup tests.
- Create `src/localMail/localMailboxMonitor.ts`: initial/fallback/IDLE scans, sleep recovery hook, auth pause, and reconnect backoff.
- Create `src/localMail/localMailboxMonitor.test.ts`: deterministic fake-clock monitor tests.
- Create `src/localMail/localMailService.ts`: credential, monitor, cache, notification, extraction, and event orchestration.
- Create `src/localMail/localMailService.test.ts`: login, startup, cache, notification, and manual extraction tests.

### Electron and renderer

- Create `src/main/localMailServices.ts`: bind Electron `safeStorage`, `Notification`, power resume, login settings, and window event broadcasting.
- Create `src/main/localMailServices.test.ts`: verify secret-free binding and notification acknowledgement.
- Replace `src/main/emailActions.ts` and its test: keep only local-file extraction helpers; email actions move to `LocalMailService`.
- Modify `src/main/ipcHandlers.ts`: inject local services and expose secret-free local-mail IPC.
- Modify `src/preload/preload.cts` and `src/main/preloadBridge.test.ts`: expose the new bridge with no authorization-code reads.
- Create `src/main/windowLifecycle.ts` and test: close-to-tray and explicit quit.
- Create `src/main/trayController.ts` and test: Open, Reconnect, and Exit commands.
- Modify `src/main/main.ts`: compose runtime after `app.whenReady()`, honor `--hidden`, and cleanly stop.
- Create `src/renderer/localMailViewState.ts` and test: pure status, settings, list, and event reducers.
- Modify `src/renderer/app.tsx` and `src/renderer/styles.css`: local status/settings flow, cache-first list, main-process notifications, and unchanged manual extraction/output behavior.

### Removal, packaging, and docs

- Delete `src/core/remoteEmailApi.ts`, its test, `src/server/`, the obsolete `services/orderflow-email-api/` tree, remote config resources/scripts, and old proxy keeper artifacts.
- Modify `package.json`, `package-lock.json`, `tsconfig.build.json`, and `vitest.config.ts`: remove the server surface, mailparser, remote resource, and server test include; package the tray icon.
- Modify `.github/workflows/release.yml`: remove remote API config generation.
- Create `src/packaging/localOnlyInvariant.test.ts`: prove no listener, remote config, server script, or native SQLite dependency ships.
- Modify `src/packaging/packageConfig.test.ts`, `src/packaging/readme.test.ts`, and `README.md`.
- Create `docs/local-mail-workstation.md`; replace `docs/email-api-server.md` with a short superseded notice and mark the two old cloud design/plan documents superseded.

---

## Controller-Owned Execution Preflight

This preflight is not delegated. It protects user-owned changes before any task implementer starts.

- [ ] **Step P1: Reconfirm the original checkout contains only the five known extraction changes**

Run from `/Users/dongyu/Documents/R004 12.54.54`:

```bash
git status --short --branch
git diff --name-only
```

Expected modified paths, and no others:

```text
extract.py
services/orderflow-email-api/extract.py
src/core/orderExtractor.test.ts
src/core/orderExtractor.ts
tests/test_hardware_rules.py
```

- [ ] **Step P2: Verify the real Deluxe Dry Lining fix before preserving it**

```bash
python3 -m pytest -q tests/test_hardware_rules.py
npm test -- src/core/orderExtractor.test.ts
npm run typecheck
```

Expected: Python and Vitest checks pass and TypeScript exits `0`.

- [ ] **Step P3: Commit only those five user-owned fixes**

```bash
git add extract.py services/orderflow-email-api/extract.py src/core/orderExtractor.ts src/core/orderExtractor.test.ts tests/test_hardware_rules.py
git diff --cached --check
git commit -m "fix: classify Deluxe Dry Lining orders correctly"
```

Expected: one isolated extraction commit; `git status --short` is empty.

- [ ] **Step P4: Rebase the local-workstation branch onto the preserved fix**

Run from `/Users/dongyu/Documents/R004 12.54.54/.worktrees/local-mail-workstation`:

```bash
git rebase main
git status --short --branch
git log --oneline --decorate -5
```

Expected: branch `codex/local-mail-workstation` is clean and contains the extraction fix before the local-workstation design/plan commits.

- [ ] **Step P5: Install and prove the clean baseline**

```bash
npm ci
npm run typecheck
npm test
python3 -m pytest -q tests/test_desktop_runner.py tests/test_hardware_rules.py tests/test_jobtrack_compare.py tests/test_mihomo_imap_node_keeper.py
```

Expected: all root TypeScript/Vitest/Python checks pass. If a baseline check fails, stop and report it before Task 1.

---

### Task 1: Define the secret-free contract and DPAPI credential store

**Files:**
- Modify: `src/shared/types.ts`
- Create: `src/localMail/localMailCredentialStore.ts`
- Create: `src/localMail/localMailCredentialStore.test.ts`

**Interfaces:**
- Consumes: existing `EmailSettings`, `EmailMessageSummary`, `EmailListResult`, `ExtractionResult`, and `defaultEmailSettingsPath()`.
- Produces: `LocalMailSettingsView`, `SaveLocalMailSettingsInput`, `LocalMailRuntimeStatus`, `LocalMailMessageSummary`, `LocalMailListResult`, `LocalMailEvent`, `LocalEmailExtractionRequest`, `SafeStorageOperations`, and `LocalMailCredentialStore`.

- [ ] **Step 1: Add the failing contract and credential tests**

Append these imports and tests in `src/localMail/localMailCredentialStore.test.ts`:

```typescript
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { LocalMailCredentialStore, type SafeStorageOperations } from "./localMailCredentialStore.js";

const roots: string[] = [];
afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("local mail credential store", () => {
  test("persists the authorization code only as safeStorage ciphertext", async () => {
    const settingsPath = await tempSettingsPath();
    const store = new LocalMailCredentialStore({ settingsPath, safeStorage: fakeSafeStorage() });

    await store.save({ email: " orders@example.com ", authCode: "mail-secret", startAtLogin: true });

    expect(await store.loadView()).toEqual({ email: "orders@example.com", hasAuthCode: true, startAtLogin: true });
    expect(await store.loadCredentials()).toEqual({ email: "orders@example.com", authCode: "mail-secret" });
    const raw = await readFile(settingsPath, "utf8");
    expect(raw).not.toContain("mail-secret");
    expect(JSON.parse(raw)).toMatchObject({ email: "orders@example.com", encryptedAuthCode: expect.any(String) });
  });

  test("migrates a legacy plaintext authorization code once", async () => {
    const settingsPath = await tempSettingsPath();
    await writeFile(settingsPath, JSON.stringify({ email: "orders@example.com", authCode: "legacy-secret" }), "utf8");
    const store = new LocalMailCredentialStore({ settingsPath, safeStorage: fakeSafeStorage() });

    expect(await store.loadCredentials()).toEqual({ email: "orders@example.com", authCode: "legacy-secret" });
    const raw = await readFile(settingsPath, "utf8");
    expect(raw).not.toContain("legacy-secret");
    expect(raw).not.toContain("authCode");
  });

  test("never falls back to plaintext when encryption is unavailable", async () => {
    const settingsPath = await tempSettingsPath();
    const store = new LocalMailCredentialStore({
      settingsPath,
      safeStorage: { ...fakeSafeStorage(), isEncryptionAvailable: () => false },
    });

    await expect(store.save({ email: "orders@example.com", authCode: "mail-secret", startAtLogin: true })).rejects.toThrow(
      "Windows 安全存储不可用",
    );
    await expect(readFile(settingsPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("preserves an existing encrypted code when only non-secret settings change", async () => {
    const settingsPath = await tempSettingsPath();
    const store = new LocalMailCredentialStore({ settingsPath, safeStorage: fakeSafeStorage() });
    await store.save({ email: "orders@example.com", authCode: "mail-secret", startAtLogin: true });

    await store.save({ email: "orders@example.com", startAtLogin: false });

    expect(await store.loadCredentials()).toEqual({ email: "orders@example.com", authCode: "mail-secret" });
    expect(await store.loadView()).toMatchObject({ startAtLogin: false });
  });
});

async function tempSettingsPath(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-mail-credentials-"));
  roots.push(root);
  return path.join(root, "email_settings.json");
}

function fakeSafeStorage(): SafeStorageOperations {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
    decryptString: (value) => value.toString("utf8").replace(/^encrypted:/, ""),
  };
}
```

- [ ] **Step 2: Run the test and confirm the missing-module failure**

Run:

```bash
npm test -- src/localMail/localMailCredentialStore.test.ts
```

Expected: FAIL because `localMailCredentialStore.ts` does not exist.

- [ ] **Step 3: Add the exact local-mail wire/view contracts**

Append to `src/shared/types.ts`:

```typescript
export type LocalMailRuntimeState = "stopped" | "connecting" | "connected" | "offline" | "attention_required";

export interface LocalMailRuntimeStatus {
  state: LocalMailRuntimeState;
  detail: string;
  lastSyncAt?: string;
}

export interface LocalMailSettingsView {
  email: string;
  hasAuthCode: boolean;
  startAtLogin: boolean;
}

export interface SaveLocalMailSettingsInput {
  email: string;
  authCode?: string;
  startAtLogin: boolean;
}

export interface LocalMailMessageSummary extends EmailMessageSummary {
  extracted: boolean;
}

export interface LocalMailListResult extends Omit<EmailListResult, "messages"> {
  messages: LocalMailMessageSummary[];
  status: LocalMailRuntimeStatus;
}

export interface LocalEmailExtractionRequest {
  messageUids: string[];
  inferManual?: boolean;
}

export type LocalMailEvent =
  | { type: "messages-updated"; data: { newMessageUids: string[]; list: LocalMailListResult } }
  | { type: "status-changed"; data: LocalMailRuntimeStatus };
```

Do not remove `EmailSettings` yet; it remains the main-process-only decrypted value until Task 6 removes renderer access.

- [ ] **Step 4: Implement the complete credential store**

Create `src/localMail/localMailCredentialStore.ts`:

```typescript
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { defaultEmailSettingsPath } from "../core/settings.js";
import type { EmailSettings, LocalMailSettingsView, SaveLocalMailSettingsInput } from "../shared/types.js";

export interface SafeStorageOperations {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

interface StoredLocalMailSettings {
  email: string;
  encryptedAuthCode?: string;
  startAtLogin: boolean;
  authCode?: string;
}

interface LocalMailCredentialStoreOptions {
  safeStorage: SafeStorageOperations;
  settingsPath?: string;
}

export class LocalMailCredentialStore {
  private readonly safeStorage: SafeStorageOperations;
  private readonly settingsPath: string;

  constructor(options: LocalMailCredentialStoreOptions) {
    this.safeStorage = options.safeStorage;
    this.settingsPath = options.settingsPath ?? defaultEmailSettingsPath();
  }

  async loadView(): Promise<LocalMailSettingsView> {
    const record = await this.loadAndMigrate();
    return viewOf(record);
  }

  async loadCredentials(): Promise<EmailSettings> {
    const record = await this.loadAndMigrate();
    if (!record.email || !record.encryptedAuthCode) {
      return { email: record.email, authCode: "" };
    }
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new Error("Windows 安全存储不可用，请重新登录邮箱。");
    }
    return {
      email: record.email,
      authCode: this.safeStorage.decryptString(Buffer.from(record.encryptedAuthCode, "base64")),
    };
  }

  async save(input: SaveLocalMailSettingsInput): Promise<LocalMailSettingsView> {
    const current = await this.readRecord();
    const email = input.email.trim();
    let encryptedAuthCode = current.encryptedAuthCode;
    if (input.authCode !== undefined) {
      const authCode = input.authCode.trim();
      if (!authCode) {
        encryptedAuthCode = undefined;
      } else {
        if (!this.safeStorage.isEncryptionAvailable()) {
          throw new Error("Windows 安全存储不可用，无法安全保存邮箱授权码。");
        }
        encryptedAuthCode = this.safeStorage.encryptString(authCode).toString("base64");
      }
    }
    const next: StoredLocalMailSettings = { email, encryptedAuthCode, startAtLogin: input.startAtLogin };
    await this.writeRecord(next);
    return viewOf(next);
  }

  async clearAuthorizationCode(): Promise<LocalMailSettingsView> {
    const current = await this.readRecord();
    const next: StoredLocalMailSettings = {
      email: current.email,
      startAtLogin: current.startAtLogin,
    };
    await this.writeRecord(next);
    return viewOf(next);
  }

  private async loadAndMigrate(): Promise<StoredLocalMailSettings> {
    const record = await this.readRecord();
    if (!record.authCode) {
      return record;
    }
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new Error("Windows 安全存储不可用，无法迁移旧邮箱授权码。");
    }
    const migrated: StoredLocalMailSettings = {
      email: record.email,
      encryptedAuthCode: this.safeStorage.encryptString(record.authCode).toString("base64"),
      startAtLogin: record.startAtLogin,
    };
    await this.writeRecord(migrated);
    return migrated;
  }

  private async readRecord(): Promise<StoredLocalMailSettings> {
    try {
      const raw = JSON.parse(await readFile(this.settingsPath, "utf8")) as Partial<StoredLocalMailSettings>;
      return {
        email: typeof raw.email === "string" ? raw.email.trim() : "",
        encryptedAuthCode: typeof raw.encryptedAuthCode === "string" ? raw.encryptedAuthCode : undefined,
        authCode: typeof raw.authCode === "string" ? raw.authCode : undefined,
        startAtLogin: typeof raw.startAtLogin === "boolean" ? raw.startAtLogin : true,
      };
    } catch (error) {
      if (isMissingFile(error) || error instanceof SyntaxError) {
        return { email: "", startAtLogin: true };
      }
      throw error;
    }
  }

  private async writeRecord(record: StoredLocalMailSettings): Promise<void> {
    await mkdir(path.dirname(this.settingsPath), { recursive: true });
    const temporaryPath = `${this.settingsPath}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(record, null, 2), "utf8");
    await rename(temporaryPath, this.settingsPath);
  }
}

function viewOf(record: StoredLocalMailSettings): LocalMailSettingsView {
  return {
    email: record.email,
    hasAuthCode: Boolean(record.encryptedAuthCode),
    startAtLogin: record.startAtLogin,
  };
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
```

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```bash
npm test -- src/localMail/localMailCredentialStore.test.ts
npm run typecheck
```

Expected: 4 credential tests pass and TypeScript exits `0`.

- [ ] **Step 6: Commit the contract and credential boundary**

```bash
git add src/shared/types.ts src/localMail/localMailCredentialStore.ts src/localMail/localMailCredentialStore.test.ts
git diff --cached --check
git commit -m "feat: encrypt local mail credentials"
```

---

### Task 2: Add the seven-day SQLite WAL mail cache

**Files:**
- Create: `src/localMail/localMailStore.ts`
- Create: `src/localMail/localMailStore.test.ts`

**Interfaces:**
- Consumes: `EmailListResult`, `EmailMessageSummary`, `LocalMailMessageSummary`, and `LocalMailRuntimeStatus`.
- Produces: `openLocalMailStore(options): Promise<LocalMailStore>`, `mailboxIdFor(email)`, and methods `knownUids`, `syncMessages`, `listMessages`, `listUnnotified`, `markNotified`, `markExtracted`, `prune`, `recordSync`, `lastSyncAt`, and `close`.

- [ ] **Step 1: Write the failing WAL, idempotency, retention, flag, and recovery tests**

Create `src/localMail/localMailStore.test.ts`:

```typescript
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { mailboxIdFor, openLocalMailStore, type LocalMailStore } from "./localMailStore.js";

const roots: string[] = [];
let store: LocalMailStore | undefined;
afterEach(async () => {
  store?.close();
  store = undefined;
  const { rm } = await import("node:fs/promises");
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("local mail SQLite store", () => {
  test("uses WAL and idempotently stores mailbox plus UID", async () => {
    const { databasePath } = await tempDatabase();
    store = await openLocalMailStore({ databasePath, now: () => Date.parse("2026-07-13T01:00:00Z") });
    const first = store.syncMessages("Orders@Example.com", scan([message("101")]));
    const second = store.syncMessages("orders@example.com", scan([message("101")]));

    expect(first.inserted.map((item) => item.uid)).toEqual(["101"]);
    expect(first.initialSync).toBe(true);
    expect(second.inserted).toEqual([]);
    expect(second.initialSync).toBe(false);
    expect(store.knownUids("orders@example.com")).toEqual(["101"]);
    expect(store.journalMode()).toBe("wal");
    expect(mailboxIdFor(" Orders@Example.com ")).toBe(mailboxIdFor("orders@example.com"));
  });

  test("persists notification and extraction state", async () => {
    const { databasePath } = await tempDatabase();
    store = await openLocalMailStore({ databasePath, now: () => Date.parse("2026-07-13T01:00:00Z") });
    store.syncMessages("orders@example.com", scan([]));
    store.syncMessages("orders@example.com", scan([message("101"), message("102")]));

    expect(store.listUnnotified("orders@example.com").map((item) => item.uid)).toEqual(["102", "101"]);
    store.markNotified("orders@example.com", ["101", "102"]);
    store.markExtracted("orders@example.com", ["101"]);

    expect(store.listUnnotified("orders@example.com")).toEqual([]);
    expect(store.listMessages("orders@example.com").find((item) => item.uid === "101")?.extracted).toBe(true);
    expect(store.listMessages("orders@example.com").find((item) => item.uid === "102")?.extracted).toBe(false);
  });

  test("prunes messages older than exactly seven days", async () => {
    let now = Date.parse("2026-07-13T12:00:00Z");
    const { databasePath } = await tempDatabase();
    store = await openLocalMailStore({ databasePath, now: () => now });
    store.syncMessages("orders@example.com", scan([message("old", "2026-07-05T11:59:59Z"), message("new", "2026-07-07T12:00:00Z")]));

    expect(store.prune()).toBe(1);
    expect(store.listMessages("orders@example.com").map((item) => item.uid)).toEqual(["new"]);
    now += 1;
  });

  test("backs up a corrupt database and rebuilds an empty cache", async () => {
    const { root, databasePath } = await tempDatabase();
    await writeFile(databasePath, "not sqlite", "utf8");

    store = await openLocalMailStore({ databasePath, now: () => Date.parse("2026-07-13T01:00:00Z") });

    expect(store.listMessages("orders@example.com")).toEqual([]);
    expect((await readdir(root)).some((name) => name.startsWith("mail-cache.sqlite.corrupt-"))).toBe(true);
  });
});

async function tempDatabase(): Promise<{ root: string; databasePath: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-mail-store-"));
  roots.push(root);
  return { root, databasePath: path.join(root, "mail-cache.sqlite") };
}

function scan(messages: ReturnType<typeof message>[]) {
  return { messages, scannedMessages: messages.length, days: 7, orderAttachmentCount: messages.length, nonOrderExcelAttachmentCount: 0 };
}

function message(uid: string, date = "2026-07-13T00:00:00Z") {
  return {
    uid,
    subject: `PO ${uid}`,
    from: "orders@example.com",
    date,
    attachmentCount: 1,
    excelAttachmentNames: [`${uid}.xlsx`],
    hasExcelAttachments: true,
  };
}
```

- [ ] **Step 2: Run the test and confirm the missing-module failure**

```bash
npm test -- src/localMail/localMailStore.test.ts
```

Expected: FAIL because `localMailStore.ts` does not exist.

- [ ] **Step 3: Implement the complete WAL store and corruption recovery**

Create `src/localMail/localMailStore.ts` with this public contract and schema:

```typescript
import { createHash } from "node:crypto";
import { mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { EmailListResult, LocalMailMessageSummary } from "../shared/types.js";

export interface LocalMailStoreOptions {
  databasePath: string;
  now?: () => number;
}

export interface LocalMailSyncResult {
  inserted: LocalMailMessageSummary[];
  initialSync: boolean;
}

export interface LocalMailStore {
  journalMode(): string;
  knownUids(email: string): string[];
  syncMessages(email: string, result: EmailListResult): LocalMailSyncResult;
  listMessages(email: string): LocalMailMessageSummary[];
  listUnnotified(email: string): LocalMailMessageSummary[];
  markNotified(email: string, messageUids: string[]): void;
  markExtracted(email: string, messageUids: string[]): void;
  recordSync(email: string, scannedMessages: number): void;
  lastSyncAt(email: string): string | undefined;
  prune(): number;
  close(): void;
}

export function mailboxIdFor(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

export async function openLocalMailStore(options: LocalMailStoreOptions): Promise<LocalMailStore> {
  await mkdir(path.dirname(options.databasePath), { recursive: true });
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(options.databasePath);
    return new SqliteLocalMailStore(database, options.now ?? Date.now);
  } catch {
    database?.close();
    const suffix = new Date(options.now?.() ?? Date.now()).toISOString().replace(/[:.]/g, "-");
    await rename(options.databasePath, `${options.databasePath}.corrupt-${suffix}`).catch(() => undefined);
    await rename(`${options.databasePath}-wal`, `${options.databasePath}.corrupt-${suffix}-wal`).catch(() => undefined);
    await rename(`${options.databasePath}-shm`, `${options.databasePath}.corrupt-${suffix}-shm`).catch(() => undefined);
    return new SqliteLocalMailStore(new DatabaseSync(options.databasePath), options.now ?? Date.now);
  }
}

class SqliteLocalMailStore implements LocalMailStore {
  constructor(private readonly db: DatabaseSync, private readonly now: () => number) {
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mailbox_state (
        mailbox_id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        last_sync_at TEXT,
        scanned_messages INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS mail_messages (
        mailbox_id TEXT NOT NULL,
        uid TEXT NOT NULL,
        subject TEXT NOT NULL,
        sender TEXT,
        received_at TEXT,
        attachment_names_json TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        notified_at TEXT,
        extracted_at TEXT,
        PRIMARY KEY (mailbox_id, uid)
      );
      CREATE INDEX IF NOT EXISTS mail_messages_received_idx ON mail_messages(received_at DESC);
    `);
  }

  journalMode(): string {
    return String((this.db.prepare("PRAGMA journal_mode").get() as unknown as { journal_mode?: unknown }).journal_mode ?? "").toLowerCase();
  }

  knownUids(email: string): string[] {
    return this.db
      .prepare("SELECT uid FROM mail_messages WHERE mailbox_id=? ORDER BY CAST(uid AS INTEGER),uid")
      .all(mailboxIdFor(email))
      .map((row) => String((row as unknown as { uid: unknown }).uid));
  }

  syncMessages(email: string, result: EmailListResult): LocalMailSyncResult {
    const mailboxId = mailboxIdFor(email);
    const nowIso = new Date(this.now()).toISOString();
    const initialSync = this.lastSyncAt(email) === undefined;
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO mail_messages
      (mailbox_id,uid,subject,sender,received_at,attachment_names_json,first_seen_at,notified_at)
      VALUES (?,?,?,?,?,?,?,?)
    `);
    const inserted: LocalMailMessageSummary[] = [];
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const message of result.messages) {
        const changed = insert.run(
          mailboxId,
          message.uid,
          message.subject,
          message.from ?? null,
          message.date ?? null,
          JSON.stringify(message.excelAttachmentNames),
          nowIso,
          initialSync ? nowIso : null,
        ).changes;
        if (changed > 0) inserted.push({ ...message, extracted: false });
      }
      this.recordSync(email, result.scannedMessages);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return { inserted, initialSync };
  }

  listMessages(email: string): LocalMailMessageSummary[] {
    return this.rows("SELECT * FROM mail_messages WHERE mailbox_id=? ORDER BY COALESCE(received_at,first_seen_at) DESC", email);
  }

  listUnnotified(email: string): LocalMailMessageSummary[] {
    return this.rows(
      "SELECT * FROM mail_messages WHERE mailbox_id=? AND notified_at IS NULL ORDER BY COALESCE(received_at,first_seen_at) DESC",
      email,
    );
  }

  markNotified(email: string, messageUids: string[]): void {
    this.mark("notified_at", email, messageUids);
  }

  markExtracted(email: string, messageUids: string[]): void {
    this.mark("extracted_at", email, messageUids);
  }

  recordSync(email: string, scannedMessages: number): void {
    this.db.prepare(`
      INSERT INTO mailbox_state(mailbox_id,email,last_sync_at,scanned_messages) VALUES(?,?,?,?)
      ON CONFLICT(mailbox_id) DO UPDATE SET email=excluded.email,last_sync_at=excluded.last_sync_at,scanned_messages=excluded.scanned_messages
    `).run(mailboxIdFor(email), email.trim(), new Date(this.now()).toISOString(), scannedMessages);
  }

  lastSyncAt(email: string): string | undefined {
    const row = this.db.prepare("SELECT last_sync_at FROM mailbox_state WHERE mailbox_id=?").get(mailboxIdFor(email)) as unknown as
      | { last_sync_at?: unknown }
      | undefined;
    return typeof row?.last_sync_at === "string" ? row.last_sync_at : undefined;
  }

  prune(): number {
    const cutoff = new Date(this.now() - 7 * 86_400_000).toISOString();
    return Number(
      this.db.prepare("DELETE FROM mail_messages WHERE COALESCE(received_at,first_seen_at) < ?").run(cutoff).changes,
    );
  }

  close(): void {
    this.db.close();
  }

  private rows(sql: string, email: string): LocalMailMessageSummary[] {
    return this.db.prepare(sql).all(mailboxIdFor(email)).map((row) => rowToMessage(row as unknown as Record<string, unknown>));
  }

  private mark(column: "notified_at" | "extracted_at", email: string, messageUids: string[]): void {
    const statement = this.db.prepare(`UPDATE mail_messages SET ${column}=? WHERE mailbox_id=? AND uid=?`);
    const timestamp = new Date(this.now()).toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const uid of new Set(messageUids.map((item) => item.trim()).filter(Boolean))) {
        statement.run(timestamp, mailboxIdFor(email), uid);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

function rowToMessage(row: Record<string, unknown>): LocalMailMessageSummary {
  const names = JSON.parse(String(row.attachment_names_json)) as string[];
  return {
    uid: String(row.uid),
    subject: String(row.subject),
    from: typeof row.sender === "string" ? row.sender : undefined,
    date: typeof row.received_at === "string" ? row.received_at : undefined,
    attachmentCount: names.length,
    excelAttachmentNames: names,
    hasExcelAttachments: names.length > 0,
    extracted: typeof row.extracted_at === "string",
  };
}
```

- [ ] **Step 4: Run focused tests and typecheck**

```bash
npm test -- src/localMail/localMailStore.test.ts
npm run typecheck
```

Expected: 4 store tests pass; the only output noise allowed is Node's known `node:sqlite` experimental warning; TypeScript exits `0`.

- [ ] **Step 5: Commit the local cache**

```bash
git add src/localMail/localMailStore.ts src/localMail/localMailStore.test.ts
git diff --cached --check
git commit -m "feat: cache local order mail in sqlite"
```

---

### Task 3: Scan and classify only new order-workbook mail

**Files:**
- Modify: `src/core/emailSource.ts`
- Modify: `src/core/emailSource.test.ts`

**Interfaces:**
- Consumes: `ImapConfig`, existing metadata scan, `fetchExcelAttachments`, and `isOrderWorkbookContent`.
- Produces: `verifyImapConnection(config)`, `createImapClient(config)`, `listRecentOrderEmailMessages(config, options)`, `OrderEmailListOptions`, and `MAX_ORDER_ATTACHMENT_BYTES`.

- [ ] **Step 1: Add failing tests for verification, excluded UIDs, order-only results, and 25 MB**

Extend the `ImapFlow` mock in `src/core/emailSource.test.ts` with:

```typescript
async mailboxOpen(mailbox: string): Promise<void> {
  this.lockedMailbox = mailbox;
}
```

Import `listRecentOrderEmailMessages`, `MAX_ORDER_ATTACHMENT_BYTES`, and `verifyImapConnection`, then add:

```typescript
describe("local order-mail discovery", () => {
  test("verifies credentials by opening INBOX and logging out", async () => {
    await verifyImapConnection(testImapConfig());
    expect(imapMock.instances[0]).toMatchObject({ connectCalls: 1, lockedMailbox: "INBOX", logoutCalls: 1 });
  });

  test("downloads only unseen candidate UIDs and returns only valid order workbooks", async () => {
    imapMock.messages = [
      mockMessage("101", "known.xlsx"),
      mockMessage("102", "order.xlsx"),
      mockMessage("103", "report.xlsx"),
    ];
    imapMock.downloads = {
      "102": { "2": { content: await makeOrderWorkbookBuffer(), meta: { filename: "order.xlsx" } } },
      "103": { "2": { content: await makeReportWorkbookBuffer(), meta: { filename: "report.xlsx" } } },
    };

    const result = await listRecentOrderEmailMessages(testImapConfig(), { days: 7, excludeUids: ["101"] });

    expect(result.messages.map((item) => item.uid)).toEqual(["102"]);
    expect(result.messages[0]?.excelAttachmentNames).toEqual(["order.xlsx"]);
    const downloadCalls = imapMock.instances.flatMap((instance) => instance.downloadManyCalls.map((call) => call.range));
    expect(downloadCalls).toEqual(["102", "103"]);
    expect(result.nonOrderExcelAttachmentCount).toBe(1);
  });

  test("rejects order-looking candidates larger than 25 MB before classification", async () => {
    imapMock.messages = [mockMessage("104", "large.xlsx")];
    imapMock.downloads = {
      "104": { "2": { content: Buffer.alloc(MAX_ORDER_ATTACHMENT_BYTES + 1), meta: { filename: "large.xlsx" } } },
    };

    const result = await listRecentOrderEmailMessages(testImapConfig(), { days: 7 });

    expect(result.messages).toEqual([]);
    expect(result.nonOrderExcelAttachmentCount).toBe(1);
  });
});

function mockMessage(uid: string, filename: string) {
  return {
    uid: Number(uid),
    envelope: { subject: `PO ${uid}`, date: new Date("2026-07-13T00:00:00Z"), from: [{ address: "orders@example.com" }] },
    bodyStructure: { childNodes: [{ part: "2", dispositionParameters: { filename } }] },
  };
}
```

- [ ] **Step 2: Run the focused tests and confirm missing exports**

```bash
npm test -- src/core/emailSource.test.ts
```

Expected: FAIL because the three new exports do not exist.

- [ ] **Step 3: Export the client factory and credential verification**

Change the existing private `createClient` declaration to:

```typescript
export function createImapClient(config: ImapConfig): ImapFlow {
  return new ImapFlow({
    host: config.server,
    port: config.port,
    secure: true,
    auth: { user: config.email, pass: config.authCode },
    logger: false,
  });
}
```

Remove proxy propagation entirely; the local-only contract has no proxy. Replace every `createClient(config)` call with `createImapClient(config)`. Add:

```typescript
export async function verifyImapConnection(config: ImapConfig): Promise<void> {
  const client = createImapClient(config);
  await client.connect();
  try {
    await client.mailboxOpen("INBOX");
  } finally {
    await client.logout().catch(() => undefined);
  }
}
```

- [ ] **Step 4: Add order-only discovery using existing in-memory classification**

Add near the other option interfaces:

```typescript
export const MAX_ORDER_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export interface OrderEmailListOptions extends EmailListOptions {
  excludeUids?: string[];
}
```

Add:

```typescript
export async function listRecentOrderEmailMessages(
  config: ImapConfig,
  options: OrderEmailListOptions = {},
): Promise<EmailListResult> {
  const candidates = await listRecentEmailMessages(config, options);
  const excluded = new Set((options.excludeUids ?? []).map((uid) => uid.trim()).filter(Boolean));
  const unseen = candidates.messages.filter((message) => !excluded.has(message.uid));
  if (unseen.length === 0) {
    return { ...candidates, messages: [], orderAttachmentCount: 0, nonOrderExcelAttachmentCount: 0 };
  }

  const batch = await fetchExcelAttachments(config, { messageUids: unseen.map((message) => message.uid) });
  const namesByUid = new Map<string, string[]>();
  for (const attachment of batch.attachments) {
    if (!attachment.messageUid) continue;
    const names = namesByUid.get(attachment.messageUid) ?? [];
    names.push(attachment.filename);
    namesByUid.set(attachment.messageUid, names);
  }
  const messages = unseen.flatMap((message) => {
    const names = namesByUid.get(message.uid) ?? [];
    return names.length > 0
      ? [{ ...message, attachmentCount: names.length, excelAttachmentNames: names, hasExcelAttachments: true }]
      : [];
  });
  const candidateCount = unseen.reduce((sum, message) => sum + message.attachmentCount, 0);
  const orderAttachmentCount = messages.reduce((sum, message) => sum + message.attachmentCount, 0);
  return {
    ...candidates,
    messages: sortEmailMessagesByDateDesc(messages),
    orderAttachmentCount,
    nonOrderExcelAttachmentCount: Math.max(0, candidateCount - orderAttachmentCount),
  };
}
```

Enforce the size limit in `isOrderEmailAttachment` before calling `isOrderWorkbookContent`:

```typescript
async function isOrderEmailAttachment(attachment: OrderAttachmentCandidate): Promise<boolean> {
  if (attachment.content.byteLength > MAX_ORDER_ATTACHMENT_BYTES) {
    return false;
  }
  return isOrderWorkbookContent(attachment.filename, attachment.content);
}
```

- [ ] **Step 5: Remove proxy from `ImapConfig` and its tests**

Delete `proxy?: string` from `ImapConfig` in `src/shared/types.ts`, remove `proxy` from `EmailConnectionRequest` and `buildImapConfig()` in `src/core/extractionService.ts`, and replace the proxy test in `src/core/emailSource.test.ts` with:

```typescript
test("always creates a direct verified TLS IMAP client", async () => {
  await verifyImapConnection(testImapConfig());
  expect(imapMock.instances[0]?.options).toMatchObject({
    host: "imap.exmail.qq.com",
    port: 993,
    secure: true,
    auth: { user: "orders@example.com", pass: "secret" },
    logger: false,
  });
  expect(imapMock.instances[0]?.options).not.toHaveProperty("proxy");
});
```

- [ ] **Step 6: Run focused tests, extraction regression, and typecheck**

```bash
npm test -- src/core/emailSource.test.ts src/core/extractionService.test.ts
npm run typecheck
```

Expected: all email source/extraction tests pass and TypeScript exits `0`.

- [ ] **Step 7: Commit the order-only scanner**

```bash
git add src/shared/types.ts src/core/emailSource.ts src/core/emailSource.test.ts src/core/extractionService.ts src/core/extractionService.test.ts
git diff --cached --check
git commit -m "feat: discover local order mail over imap"
```

---
### Task 4: Add the IMAP IDLE connection and resilient mailbox monitor

**Files:**
- Create: `src/localMail/imapIdleConnection.ts`
- Create: `src/localMail/imapIdleConnection.test.ts`
- Create: `src/localMail/localMailboxMonitor.ts`
- Create: `src/localMail/localMailboxMonitor.test.ts`

**Interfaces:**
- Consumes: `createImapClient`, `listRecentOrderEmailMessages`, `buildImapConfig`, `LocalMailStore`, and decrypted `EmailSettings` supplied only inside the main process.
- Produces: `openImapIdleConnection(config, createClient?)`, `ImapIdleConnection`, `LocalMailboxMonitor`, `LocalMailboxMonitorEvent`, and methods `start`, `stop`, `refreshNow`, `reconnect`, `handleResume`, `status`, and `subscribe`.

- [ ] **Step 1: Write the failing IDLE connection tests**

Create `src/localMail/imapIdleConnection.test.ts`:

```typescript
import { EventEmitter } from "node:events";
import { describe, expect, test, vi } from "vitest";

import { openImapIdleConnection, type ImapIdleClient } from "./imapIdleConnection.js";
import type { ImapConfig } from "../shared/types.js";

describe("IMAP idle connection", () => {
  test("opens INBOX and resolves when the mailbox count changes", async () => {
    const client = new FakeIdleClient();
    const connection = await openImapIdleConnection(config(), () => client);
    const changed = connection.waitForChange(new AbortController().signal);

    client.emit("exists", { count: 2, prevCount: 1 });

    await expect(changed).resolves.toBe("changed");
    expect(client.connect).toHaveBeenCalledOnce();
    expect(client.mailboxOpen).toHaveBeenCalledWith("INBOX");
  });

  test("resolves closed on abort and logs out exactly once", async () => {
    const client = new FakeIdleClient();
    const connection = await openImapIdleConnection(config(), () => client);
    const controller = new AbortController();
    const waiting = connection.waitForChange(controller.signal);
    controller.abort();

    await expect(waiting).resolves.toBe("closed");
    await connection.close();
    await connection.close();
    expect(client.logout).toHaveBeenCalledOnce();
  });

  test("rejects a named network error and removes listeners", async () => {
    const client = new FakeIdleClient();
    const connection = await openImapIdleConnection(config(), () => client);
    const waiting = connection.waitForChange(new AbortController().signal);
    client.emit("error", new Error("socket hang up"));
    await expect(waiting).rejects.toThrow("socket hang up");
    await connection.close();
    expect(client.listenerCount("exists")).toBe(0);
  });
});

class FakeIdleClient extends EventEmitter implements ImapIdleClient {
  connect = vi.fn(async () => undefined);
  mailboxOpen = vi.fn(async () => undefined);
  logout = vi.fn(async () => undefined);
}

function config(): ImapConfig {
  return { email: "orders@example.com", authCode: "secret", server: "imap.exmail.qq.com", port: 993 };
}
```

- [ ] **Step 2: Run the IDLE test and confirm the missing-module failure**

```bash
npm test -- src/localMail/imapIdleConnection.test.ts
```

Expected: FAIL because `imapIdleConnection.ts` does not exist.

- [ ] **Step 3: Implement the complete IDLE connection wrapper**

Create `src/localMail/imapIdleConnection.ts`:

```typescript
import type { ImapFlow } from "imapflow";

import { createImapClient } from "../core/emailSource.js";
import type { ImapConfig } from "../shared/types.js";

export interface ImapIdleClient {
  connect(): Promise<void>;
  mailboxOpen(path: string): Promise<unknown>;
  logout(): Promise<void>;
  on(name: "exists", listener: (event: unknown) => void): unknown;
  on(name: "close", listener: () => void): unknown;
  on(name: "error", listener: (error: Error) => void): unknown;
  off(name: "exists" | "close" | "error", listener: (...args: any[]) => void): unknown;
}

export interface ImapIdleConnection {
  waitForChange(signal: AbortSignal): Promise<"changed" | "closed">;
  close(): Promise<void>;
}

export async function openImapIdleConnection(
  config: ImapConfig,
  createClient: (config: ImapConfig) => ImapIdleClient = (value) => createImapClient(value) as ImapFlow,
): Promise<ImapIdleConnection> {
  const client = createClient(config);
  try {
    await client.connect();
    await client.mailboxOpen("INBOX");
  } catch (error) {
    await client.logout().catch(() => undefined);
    throw error;
  }
  let closed = false;
  let queued: "changed" | "closed" | Error | undefined;
  let waiter:
    | {
        resolve(value: "changed" | "closed"): void;
        reject(error: Error): void;
        signal: AbortSignal;
        onAbort(): void;
      }
    | undefined;

  const deliver = (value: "changed" | "closed" | Error) => {
    if (!waiter) {
      queued = value;
      return;
    }
    const current = waiter;
    waiter = undefined;
    current.signal.removeEventListener("abort", current.onAbort);
    if (value instanceof Error) current.reject(value);
    else current.resolve(value);
  };
  const onExists = () => deliver("changed");
  const onClose = () => deliver("closed");
  const onError = (error: Error) => deliver(error);
  client.on("exists", onExists);
  client.on("close", onClose);
  client.on("error", onError);

  return {
    waitForChange(signal) {
      if (closed || signal.aborted) return Promise.resolve("closed");
      if (queued !== undefined) {
        const value = queued;
        queued = undefined;
        return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
      }
      if (waiter) return Promise.reject(new Error("Only one IMAP IDLE waiter is allowed"));
      return new Promise<"changed" | "closed">((resolve, reject) => {
        const onAbort = () => deliver("closed");
        waiter = { resolve, reject, signal, onAbort };
        signal.addEventListener("abort", onAbort, { once: true });
      });
    },
    async close() {
      if (closed) return;
      closed = true;
      client.off("exists", onExists);
      client.off("close", onClose);
      client.off("error", onError);
      deliver("closed");
      await client.logout().catch(() => undefined);
    },
  };
}
```

- [ ] **Step 4: Write deterministic failing monitor tests**

Create `src/localMail/localMailboxMonitor.test.ts` with fake timers and these cases:

```typescript
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { LocalMailboxMonitor, type LocalMailboxMonitorDependencies } from "./localMailboxMonitor.js";
import type { EmailListResult, EmailSettings } from "../shared/types.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("local mailbox monitor", () => {
  test("scans immediately, then every 60 seconds, without reinserting known UIDs", async () => {
    const fixture = createFixture();
    await fixture.monitor.start();
    await vi.waitFor(() => expect(fixture.scan).toHaveBeenCalledTimes(1));
    expect(fixture.scan.mock.calls[0]?.[1]).toMatchObject({ days: 7, excludeUids: [] });

    await vi.advanceTimersByTimeAsync(60_000);
    await vi.waitFor(() => expect(fixture.scan).toHaveBeenCalledTimes(2));
    expect(fixture.store.knownUids).toHaveBeenCalledTimes(2);
  });

  test("scans as soon as IDLE reports a change", async () => {
    const fixture = createFixture();
    await fixture.monitor.start();
    await vi.waitFor(() => expect(fixture.openIdle).toHaveBeenCalledOnce());
    fixture.resolveIdle?.("changed");
    await vi.waitFor(() => expect(fixture.scan).toHaveBeenCalledTimes(2));
  });

  test("pauses on an authorization error until reconnect", async () => {
    const fixture = createFixture();
    fixture.scan.mockRejectedValueOnce(new Error("AUTHENTICATIONFAILED Invalid credentials"));
    await fixture.monitor.start();
    await vi.waitFor(() => expect(fixture.monitor.status().state).toBe("attention_required"));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fixture.scan).toHaveBeenCalledTimes(1);
  });

  test("retries a transient network failure after one second and caps at 60 seconds", async () => {
    const fixture = createFixture();
    fixture.scan.mockRejectedValueOnce(new Error("ETIMEDOUT"));
    await fixture.monitor.start();
    await vi.waitFor(() => expect(fixture.monitor.status().state).toBe("offline"));
    await vi.advanceTimersByTimeAsync(999);
    expect(fixture.scan).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(fixture.scan).toHaveBeenCalledTimes(2));
  });

  test("runs an immediate recovery scan on resume", async () => {
    const fixture = createFixture();
    await fixture.monitor.start();
    await vi.waitFor(() => expect(fixture.scan).toHaveBeenCalledOnce());
    await fixture.monitor.handleResume();
    expect(fixture.scan).toHaveBeenCalledTimes(2);
  });
});

function createFixture() {
  const credentials: EmailSettings = { email: "orders@example.com", authCode: "secret" };
  const scan = vi.fn(async (): Promise<EmailListResult> => ({
    messages: [], scannedMessages: 1, days: 7, orderAttachmentCount: 0, nonOrderExcelAttachmentCount: 0,
  }));
  let resolveIdle: ((value: "changed" | "closed") => void) | undefined;
  const openIdle = vi.fn(async () => ({
    waitForChange: vi.fn(() => new Promise<"changed" | "closed">((resolve) => { resolveIdle = resolve; })),
    close: vi.fn(async () => undefined),
  }));
  const store = {
    knownUids: vi.fn((): string[] => []),
    syncMessages: vi.fn(() => ({ inserted: [], initialSync: false })),
    prune: vi.fn(() => 0),
  };
  const dependencies = {
    loadCredentials: vi.fn(async () => credentials),
    scan,
    openIdle,
    store,
    random: () => 0.5,
  } as unknown as LocalMailboxMonitorDependencies;
  return { monitor: new LocalMailboxMonitor(dependencies), scan, openIdle, store, get resolveIdle() { return resolveIdle; } };
}
```

- [ ] **Step 5: Run the monitor tests and confirm the missing-module failure**

```bash
npm test -- src/localMail/localMailboxMonitor.test.ts
```

Expected: FAIL because `localMailboxMonitor.ts` does not exist.

- [ ] **Step 6: Implement the monitor with one serialized scan loop**

Create `src/localMail/localMailboxMonitor.ts` with these exact public types and control flow:

```typescript
import { listRecentOrderEmailMessages } from "../core/emailSource.js";
import { buildImapConfig } from "../core/extractionService.js";
import type { EmailListResult, EmailSettings, LocalMailMessageSummary, LocalMailRuntimeStatus } from "../shared/types.js";
import { openImapIdleConnection, type ImapIdleConnection } from "./imapIdleConnection.js";
import type { LocalMailStore } from "./localMailStore.js";

export type LocalMailboxMonitorEvent =
  | { type: "messages-synced"; messages: LocalMailMessageSummary[]; initialSync: boolean }
  | { type: "status"; status: LocalMailRuntimeStatus };

export interface LocalMailboxMonitorDependencies {
  loadCredentials(): Promise<EmailSettings>;
  scan: typeof listRecentOrderEmailMessages;
  openIdle: typeof openImapIdleConnection;
  store: Pick<LocalMailStore, "knownUids" | "syncMessages" | "prune">;
  random?: () => number;
}

export class LocalMailboxMonitor {
  private readonly subscribers = new Set<(event: LocalMailboxMonitorEvent) => void>();
  private readonly random: () => number;
  private running = false;
  private pausedForAuth = false;
  private controller?: AbortController;
  private idle?: ImapIdleConnection;
  private scanInFlight?: Promise<void>;
  private currentStatus: LocalMailRuntimeStatus = { state: "stopped", detail: "邮箱监听未启动" };

  constructor(private readonly dependencies: LocalMailboxMonitorDependencies) {
    this.random = dependencies.random ?? Math.random;
  }

  status(): LocalMailRuntimeStatus {
    return { ...this.currentStatus };
  }

  subscribe(listener: (event: LocalMailboxMonitorEvent) => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.pausedForAuth = false;
    this.controller = new AbortController();
    void this.run(this.controller.signal);
  }

  async stop(): Promise<void> {
    this.running = false;
    this.controller?.abort();
    await this.idle?.close();
    this.idle = undefined;
    this.setStatus({ state: "stopped", detail: "邮箱监听已停止" });
  }

  async reconnect(): Promise<void> {
    await this.stop();
    await this.start();
  }

  async refreshNow(): Promise<void> {
    if (this.pausedForAuth) throw new Error("邮箱授权已失效，请重新登录。");
    await this.scanOnce();
  }

  async handleResume(): Promise<void> {
    if (this.running && !this.pausedForAuth) await this.scanOnce();
  }

  private async run(signal: AbortSignal): Promise<void> {
    let attempt = 0;
    while (this.running && !signal.aborted) {
      try {
        this.setStatus({ state: "connecting", detail: "正在连接企业邮箱" });
        await this.scanOnce();
        const credentials = await this.dependencies.loadCredentials();
        this.idle = await this.dependencies.openIdle(buildImapConfig(credentials));
        attempt = 0;
        this.setStatus({ state: "connected", detail: "邮箱已连接", lastSyncAt: new Date().toISOString() });
        while (this.running && !signal.aborted) {
          const reason = await waitForChangeOrFallback(this.idle, signal);
          if (reason === "closed") throw new Error("IMAP connection closed");
          await this.scanOnce();
        }
      } catch (error) {
        await this.idle?.close();
        this.idle = undefined;
        if (!this.running || signal.aborted) return;
        if (isAuthenticationError(error)) {
          this.pausedForAuth = true;
          this.setStatus({ state: "attention_required", detail: "邮箱授权已失效，请重新登录" });
          return;
        }
        this.setStatus({ state: "offline", detail: "网络不可用，正在显示本地缓存" });
        const base = Math.min(60_000, 1_000 * 2 ** attempt);
        attempt += 1;
        const jittered = Math.round(base * (0.75 + this.random() * 0.5));
        await delay(jittered, signal);
      }
    }
  }

  private scanOnce(): Promise<void> {
    if (this.scanInFlight) return this.scanInFlight;
    this.scanInFlight = (async () => {
      const credentials = await this.dependencies.loadCredentials();
      if (!credentials.email || !credentials.authCode) throw new Error("请先登录企业邮箱。");
      const known = this.dependencies.store.knownUids(credentials.email);
      const result = await this.dependencies.scan(buildImapConfig(credentials), { days: 7, excludeUids: known });
      const synced = this.dependencies.store.syncMessages(credentials.email, result);
      this.dependencies.store.prune();
      if (synced.inserted.length > 0) {
        this.emit({ type: "messages-synced", messages: synced.inserted, initialSync: synced.initialSync });
      }
      this.setStatus({ state: "connected", detail: "邮箱已连接", lastSyncAt: new Date().toISOString() });
    })().finally(() => { this.scanInFlight = undefined; });
    return this.scanInFlight;
  }

  private setStatus(status: LocalMailRuntimeStatus): void {
    this.currentStatus = status;
    this.emit({ type: "status", status: { ...status } });
  }

  private emit(event: LocalMailboxMonitorEvent): void {
    for (const subscriber of this.subscribers) subscriber(event);
  }
}

function isAuthenticationError(error: unknown): boolean {
  return /AUTHENTICATIONFAILED|Invalid credentials|authentication failed|authorization|授权|重新登录|安全存储不可用/i.test(
    error instanceof Error ? error.message : String(error),
  );
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, milliseconds);
    const onAbort = () => done();
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve();
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function waitForChangeOrFallback(
  idle: ImapIdleConnection,
  parentSignal: AbortSignal,
): Promise<"changed" | "closed" | "fallback"> {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  parentSignal.addEventListener("abort", onParentAbort, { once: true });
  try {
    return await Promise.race([
      idle.waitForChange(controller.signal),
      delay(60_000, controller.signal).then(() => "fallback" as const),
    ]);
  } finally {
    controller.abort();
    parentSignal.removeEventListener("abort", onParentAbort);
  }
}
```

- [ ] **Step 7: Run focused tests, monitor typecheck, and full root tests**

```bash
npm test -- src/localMail/imapIdleConnection.test.ts src/localMail/localMailboxMonitor.test.ts src/core/emailSource.test.ts
npm run typecheck
npm test
```

Expected: all focused/full tests pass and TypeScript exits `0`. A persistent timer or open handle is a failure; tests must finish cleanly.

- [ ] **Step 8: Commit the resilient monitor**

```bash
git add src/localMail/imapIdleConnection.ts src/localMail/imapIdleConnection.test.ts src/localMail/localMailboxMonitor.ts src/localMail/localMailboxMonitor.test.ts
git diff --cached --check
git commit -m "feat: monitor local mailbox in the background"
```

---

### Task 5: Orchestrate login, cache, notification, and manual extraction

**Files:**
- Create: `src/localMail/localMailService.ts`
- Create: `src/localMail/localMailService.test.ts`
- Modify: `src/localMail/localMailStore.ts`
- Modify: `src/localMail/localMailStore.test.ts`

**Interfaces:**
- Consumes: `LocalMailCredentialStore`, `LocalMailStore`, `LocalMailboxMonitor`, `verifyImapConnection`, `extractEmailOrders`, and injected notification/login-startup operations.
- Produces: `LocalMailService` with `start`, `stop`, `loadSettings`, `saveSettings`, `listEmails`, `refreshEmails`, `reconnect`, `extractEmail`, `status`, and `subscribe`.

- [ ] **Step 1: Extend the cache with the last scanned-message count**

Add to `LocalMailStore`:

```typescript
lastScannedMessages(email: string): number;
```

Implement next to `lastSyncAt`:

```typescript
lastScannedMessages(email: string): number {
  const row = this.db.prepare("SELECT scanned_messages FROM mailbox_state WHERE mailbox_id=?").get(mailboxIdFor(email)) as unknown as
    | { scanned_messages?: unknown }
    | undefined;
  return Number(row?.scanned_messages ?? 0);
}
```

Add to the first store test after synchronization:

```typescript
expect(store.lastScannedMessages("orders@example.com")).toBe(1);
```

- [ ] **Step 2: Write failing service tests**

Create `src/localMail/localMailService.test.ts` with a fixture of fake credential/store/monitor dependencies and these exact assertions:

```typescript
import { describe, expect, test, vi } from "vitest";

import { LocalMailService, type LocalMailServiceDependencies } from "./localMailService.js";
import type { EmailExtractionResult } from "../core/extractionService.js";
import type { ExtractionFailure, LocalMailMessageSummary, LocalMailRuntimeStatus } from "../shared/types.js";
import type { LocalMailboxMonitorEvent } from "./localMailboxMonitor.js";

describe("local mail service", () => {
  test("verifies new credentials before encrypting and enables login startup", async () => {
    const fixture = createFixture();
    await fixture.service.saveSettings({ email: " orders@example.com ", authCode: "new-secret", startAtLogin: true });
    expect(fixture.verify).toHaveBeenCalledWith({ email: "orders@example.com", authCode: "new-secret", server: "imap.exmail.qq.com", port: 993 });
    expect(fixture.verify.mock.invocationCallOrder[0]).toBeLessThan(fixture.credentials.save.mock.invocationCallOrder[0]!);
    expect(fixture.setStartAtLogin).toHaveBeenCalledWith(true);
    expect(fixture.monitor.reconnect).toHaveBeenCalledOnce();
  });

  test("starts the background monitor only when encrypted credentials exist", async () => {
    const fixture = createFixture();
    await fixture.service.start();
    expect(fixture.monitor.start).toHaveBeenCalledOnce();
    fixture.credentials.loadView.mockResolvedValueOnce({ email: "", hasAuthCode: false, startAtLogin: true });
    const second = new LocalMailService(fixture.dependencies);
    await second.start();
    expect(fixture.monitor.start).toHaveBeenCalledOnce();
  });

  test("shows each inserted order-mail notification once and emits a cache view", async () => {
    const fixture = createFixture();
    const events: string[] = [];
    fixture.service.subscribe((event) => events.push(event.type));
    await fixture.service.start();
    fixture.store.listUnnotified.mockReturnValue([message("101")]);
    fixture.emitMonitor({ type: "messages-synced", messages: [message("101")], initialSync: false });
    await vi.waitFor(() => expect(fixture.notify).toHaveBeenCalledOnce());
    expect(fixture.store.markNotified).toHaveBeenCalledWith("orders@example.com", ["101"]);
    expect(events).toContain("messages-updated");
  });

  test("fills the first seven-day cache without historical notifications", async () => {
    const fixture = createFixture();
    const events: string[] = [];
    fixture.service.subscribe((event) => events.push(event.type));
    await fixture.service.start();
    fixture.emitMonitor({ type: "messages-synced", messages: [message("101")], initialSync: true });
    await vi.waitFor(() => expect(events).toContain("messages-updated"));
    expect(fixture.notify).not.toHaveBeenCalled();
  });

  test("extracts only explicitly selected UIDs and marks success", async () => {
    const fixture = createFixture();
    await fixture.service.extractEmail({ messageUids: ["101"], inferManual: true });
    expect(fixture.extract).toHaveBeenCalledWith(
      expect.objectContaining({ email: "orders@example.com", authCode: "secret", messageUids: ["101"], hours: 168 }),
      undefined,
    );
    expect(fixture.store.markExtracted).toHaveBeenCalledWith("orders@example.com", ["101"]);
  });

  test("does not mark selected UIDs when extraction reports any failure", async () => {
    const fixture = createFixture();
    fixture.extract.mockResolvedValueOnce(emailExtractionResult([{ path: "order.xlsx", error: "invalid workbook" }]));
    await fixture.service.extractEmail({ messageUids: ["101"] });
    expect(fixture.store.markExtracted).not.toHaveBeenCalled();
  });
});

function createFixture() {
  let monitorSubscriber: ((event: LocalMailboxMonitorEvent) => void) | undefined;
  const credentials = {
    loadView: vi.fn(async () => ({ email: "orders@example.com", hasAuthCode: true, startAtLogin: true })),
    loadCredentials: vi.fn(async () => ({ email: "orders@example.com", authCode: "secret" })),
    save: vi.fn(async (input: { email: string; authCode?: string; startAtLogin: boolean }) => ({
      email: input.email.trim(),
      hasAuthCode: true,
      startAtLogin: input.startAtLogin,
    })),
  };
  const store = {
    listMessages: vi.fn((): LocalMailMessageSummary[] => [message("101")]),
    listUnnotified: vi.fn((): LocalMailMessageSummary[] => []),
    markNotified: vi.fn(),
    markExtracted: vi.fn(),
    lastSyncAt: vi.fn(() => "2026-07-13T00:00:00Z"),
    lastScannedMessages: vi.fn(() => 1),
  };
  const connected: LocalMailRuntimeStatus = { state: "connected", detail: "邮箱已连接" };
  const monitor = {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    refreshNow: vi.fn(async () => undefined),
    reconnect: vi.fn(async () => undefined),
    status: vi.fn(() => connected),
    subscribe: vi.fn((listener: (event: LocalMailboxMonitorEvent) => void) => {
      monitorSubscriber = listener;
      return () => { monitorSubscriber = undefined; };
    }),
  };
  const verify = vi.fn(async () => undefined);
  const extract = vi.fn(async (): Promise<EmailExtractionResult> => emailExtractionResult([]));
  const notify = vi.fn(async () => true);
  const setStartAtLogin = vi.fn();
  const dependencies: LocalMailServiceDependencies = {
    credentials,
    store,
    monitor,
    verify,
    extract,
    notify,
    setStartAtLogin,
  };
  return {
    dependencies,
    service: new LocalMailService(dependencies),
    credentials,
    store,
    monitor,
    verify,
    extract,
    notify,
    setStartAtLogin,
    emitMonitor(event: LocalMailboxMonitorEvent) { monitorSubscriber?.(event); },
  };
}

function message(uid: string): LocalMailMessageSummary {
  return {
    uid,
    subject: `PO ${uid}`,
    from: "orders@example.com",
    date: "2026-07-13T00:00:00Z",
    attachmentCount: 1,
    excelAttachmentNames: [`${uid}.xlsx`],
    hasExcelAttachments: true,
    extracted: false,
  };
}

function emailExtractionResult(failures: ExtractionFailure[]): EmailExtractionResult {
  return {
    emailFetch: { files: ["order.xlsx"], scannedMessages: 1, attachmentCount: 1, downloadDir: "/tmp/mail" },
    extraction: {
      inputFiles: ["order.xlsx"],
      rows: [],
      skippedFiles: [],
      failures,
      outputs: { outputDir: "/tmp/out", csvOutput: "", xlsxOutput: "/tmp/out/result.xlsx", auditOutput: "" },
    },
  };
}
```

- [ ] **Step 3: Run the service tests and confirm the missing-module failure**

```bash
npm test -- src/localMail/localMailService.test.ts
```

Expected: FAIL because `localMailService.ts` does not exist.

- [ ] **Step 4: Implement the complete service API and event flow**

Create `src/localMail/localMailService.ts` with this public contract:

```typescript
import { verifyImapConnection } from "../core/emailSource.js";
import { buildImapConfig, extractEmailOrders, type EmailExtractionResult } from "../core/extractionService.js";
import type {
  LocalEmailExtractionRequest,
  LocalMailEvent,
  LocalMailListResult,
  LocalMailRuntimeStatus,
  LocalMailSettingsView,
  LocalMailMessageSummary,
  ProgressEvent,
  SaveLocalMailSettingsInput,
} from "../shared/types.js";
import type { LocalMailCredentialStore } from "./localMailCredentialStore.js";
import type { LocalMailboxMonitor, LocalMailboxMonitorEvent } from "./localMailboxMonitor.js";
import type { LocalMailStore } from "./localMailStore.js";

export interface LocalMailServiceDependencies {
  credentials: Pick<LocalMailCredentialStore, "loadView" | "loadCredentials" | "save">;
  store: Pick<LocalMailStore, "listMessages" | "listUnnotified" | "markNotified" | "markExtracted" | "lastSyncAt" | "lastScannedMessages">;
  monitor: Pick<LocalMailboxMonitor, "start" | "stop" | "refreshNow" | "reconnect" | "status" | "subscribe">;
  verify?: typeof verifyImapConnection;
  extract?: typeof extractEmailOrders;
  notify(messages: LocalMailMessageSummary[]): Promise<boolean>;
  setStartAtLogin(enabled: boolean): void;
}

export class LocalMailService {
  private readonly subscribers = new Set<(event: LocalMailEvent) => void>();
  private readonly verify: typeof verifyImapConnection;
  private readonly extract: typeof extractEmailOrders;
  private unsubscribeMonitor?: () => void;

  constructor(private readonly dependencies: LocalMailServiceDependencies) {
    this.verify = dependencies.verify ?? verifyImapConnection;
    this.extract = dependencies.extract ?? extractEmailOrders;
  }

  async start(): Promise<void> {
    if (!this.unsubscribeMonitor) {
      this.unsubscribeMonitor = this.dependencies.monitor.subscribe((event) => { void this.handleMonitorEvent(event); });
    }
    const settings = await this.dependencies.credentials.loadView();
    this.dependencies.setStartAtLogin(settings.startAtLogin);
    if (settings.email && settings.hasAuthCode) {
      await this.notifyUnnotified(settings.email);
      await this.dependencies.monitor.start();
    }
  }

  async stop(): Promise<void> {
    this.unsubscribeMonitor?.();
    this.unsubscribeMonitor = undefined;
    await this.dependencies.monitor.stop();
  }

  loadSettings(): Promise<LocalMailSettingsView> {
    return this.dependencies.credentials.loadView();
  }

  async saveSettings(input: SaveLocalMailSettingsInput): Promise<LocalMailSettingsView> {
    const email = input.email.trim();
    const current = await this.dependencies.credentials.loadCredentials();
    const authCode = input.authCode?.trim() || (current.email.toLowerCase() === email.toLowerCase() ? current.authCode : "");
    if (!email || !authCode) throw new Error("请填写企业邮箱和客户端授权码。");
    await this.verify(buildImapConfig({ email, authCode }));
    const saved = await this.dependencies.credentials.save({ ...input, email, ...(input.authCode ? { authCode } : {}) });
    this.dependencies.setStartAtLogin(saved.startAtLogin);
    await this.dependencies.monitor.reconnect();
    return saved;
  }

  async listEmails(): Promise<LocalMailListResult> {
    const settings = await this.dependencies.credentials.loadView();
    const messages = settings.email ? this.dependencies.store.listMessages(settings.email) : [];
    const status = this.status();
    if (!status.lastSyncAt && settings.email) status.lastSyncAt = this.dependencies.store.lastSyncAt(settings.email);
    return {
      messages,
      scannedMessages: settings.email ? this.dependencies.store.lastScannedMessages(settings.email) : 0,
      days: 7,
      orderAttachmentCount: messages.reduce((sum, message) => sum + message.attachmentCount, 0),
      nonOrderExcelAttachmentCount: 0,
      status,
    };
  }

  async refreshEmails(): Promise<LocalMailListResult> {
    await this.dependencies.monitor.refreshNow();
    return this.listEmails();
  }

  async reconnect(): Promise<void> {
    await this.dependencies.monitor.reconnect();
  }

  status(): LocalMailRuntimeStatus {
    return this.dependencies.monitor.status();
  }

  subscribe(listener: (event: LocalMailEvent) => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  async extractEmail(
    request: LocalEmailExtractionRequest,
    progress?: (event: ProgressEvent) => void,
  ): Promise<EmailExtractionResult> {
    const messageUids = [...new Set(request.messageUids.map((uid) => uid.trim()).filter(Boolean))];
    if (messageUids.length === 0) throw new Error("请先勾选要提取的邮件。");
    const credentials = await this.dependencies.credentials.loadCredentials();
    const result = await this.extract(
      { ...credentials, server: "imap.exmail.qq.com", port: 993, hours: 168, messageUids, inferManual: request.inferManual ?? true },
      progress,
    );
    if (result.extraction.failures.length === 0) {
      this.dependencies.store.markExtracted(credentials.email, messageUids);
      await this.emitList([]);
    }
    return result;
  }

  private async handleMonitorEvent(event: LocalMailboxMonitorEvent): Promise<void> {
    if (event.type === "status") {
      this.emit({ type: "status-changed", data: event.status });
      return;
    }
    const credentials = await this.dependencies.credentials.loadCredentials();
    if (!event.initialSync) await this.notifyUnnotified(credentials.email);
    await this.emitList(event.initialSync ? [] : event.messages.map((message) => message.uid));
  }

  private async notifyUnnotified(email: string): Promise<void> {
    const unnotified = this.dependencies.store.listUnnotified(email);
    if (unnotified.length > 0 && (await this.dependencies.notify(unnotified))) {
      this.dependencies.store.markNotified(email, unnotified.map((message) => message.uid));
    }
  }

  private async emitList(newMessageUids: string[]): Promise<void> {
    this.emit({ type: "messages-updated", data: { newMessageUids, list: await this.listEmails() } });
  }

  private emit(event: LocalMailEvent): void {
    for (const subscriber of this.subscribers) subscriber(event);
  }
}
```

- [ ] **Step 5: Complete typed service fixtures, then run focused tests and typecheck**

```bash
npm test -- src/localMail/localMailService.test.ts src/localMail/localMailStore.test.ts
npm run typecheck
```

Expected: all service/store tests pass and TypeScript exits `0`. The test source must contain no `as any` and no empty assertions.

- [ ] **Step 6: Run the full root suite and commit**

```bash
npm test
git add src/localMail/localMailService.ts src/localMail/localMailService.test.ts src/localMail/localMailStore.ts src/localMail/localMailStore.test.ts
git diff --cached --check
git commit -m "feat: orchestrate local mail extraction"
```

Expected: full suite passes and the commit contains only Task 5 files.

---

### Task 6: Bind the local service to Electron IPC and a secret-free preload bridge

**Files:**
- Create: `src/main/localMailServices.ts`
- Create: `src/main/localMailServices.test.ts`
- Replace: `src/main/emailActions.ts`
- Replace: `src/main/emailActions.test.ts`
- Modify: `src/main/ipcHandlers.ts`
- Replace: `src/preload/preload.cts`
- Modify: `src/main/preloadBridge.test.ts`
- Modify: `src/core/settings.ts`
- Modify: `src/core/emailSource.test.ts`

**Interfaces:**
- Consumes: Electron `safeStorage`, `Notification`, `powerMonitor`, `app.getPath("userData")`, `app.setLoginItemSettings`, and `LocalMailService`.
- Produces: `createMainLocalMailServices`, `registerIpcHandlers({ localMail, extractLocalOrders })`, and `OrderOrganizerApi` methods that never return an authorization code.

- [ ] **Step 1: Replace preload/IPC tests with secret-free expectations**

Replace the notification test in `src/main/preloadBridge.test.ts` with:

```typescript
test("exposes only secret-free local-mail IPC", async () => {
  const [preloadSource, ipcSource] = await Promise.all([
    readFile(path.join(root, "src/preload/preload.cts"), "utf8"),
    readFile(path.join(root, "src/main/ipcHandlers.ts"), "utf8"),
  ]);

  for (const channel of [
    "local-mail:settings:load",
    "local-mail:settings:save",
    "local-mail:list",
    "local-mail:refresh",
    "local-mail:reconnect",
    "local-mail:extract",
    "local-mail:event",
  ]) expect(`${preloadSource}\n${ipcSource}`).toContain(channel);
  expect(preloadSource).not.toContain("notifyNewOrderEmails");
  expect(preloadSource).not.toContain("subscribeEmailUpdates");
  expect(preloadSource).not.toContain("authCode: settings.authCode");
  expect(ipcSource).not.toContain("loadEmailSettings");
  expect(ipcSource).not.toContain("saveEmailSettings");
});
```

Replace `src/main/emailActions.test.ts` with:

```typescript
import { describe, expect, test, vi } from "vitest";
import { extractDesktopLocalOrders } from "./emailActions.js";

test("keeps local file extraction on the local Python path", async () => {
  const extractLocalOrders = vi.fn(async (request: { paths: string[] }) => ({
    inputFiles: request.paths,
    rows: [],
    skippedFiles: [],
    failures: [],
    outputs: { outputDir: "/tmp/out", csvOutput: "", xlsxOutput: "/tmp/out/result.xlsx", auditOutput: "" },
  }));
  const result = await extractDesktopLocalOrders(
    { paths: ["/tmp/order.xlsx"], inferManual: true },
    undefined,
    { extractLocalOrders },
  );
  expect(extractLocalOrders).toHaveBeenCalledWith(
    { paths: ["/tmp/order.xlsx"], inferManual: true },
    undefined,
  );
  expect(result.inputFiles).toEqual(["/tmp/order.xlsx"]);
});
```

- [ ] **Step 2: Run the bridge/action tests and confirm they fail**

```bash
npm test -- src/main/preloadBridge.test.ts src/main/emailActions.test.ts
```

Expected: FAIL because the old remote/settings bridge is still present.

- [ ] **Step 3: Reduce `emailActions.ts` to the unchanged local-file path**

Replace `src/main/emailActions.ts` with:

```typescript
import { extractLocalOrders, type LocalExtractionRequest } from "../core/extractionService.js";
import type { ExtractionResult, ProgressEvent } from "../shared/types.js";

export async function extractDesktopLocalOrders(
  request: LocalExtractionRequest,
  progress?: (event: ProgressEvent) => void,
  dependencies: { extractLocalOrders?: typeof extractLocalOrders } = {},
): Promise<ExtractionResult> {
  return (dependencies.extractLocalOrders ?? extractLocalOrders)(request, progress);
}
```

- [ ] **Step 4: Remove plaintext settings functions but keep path helpers**

Replace `src/core/settings.ts` with:

```typescript
import os from "node:os";
import path from "node:path";

export function appConfigDir(): string {
  return path.join(os.homedir(), ".order_organizer_assistant");
}

export function defaultEmailSettingsPath(): string {
  return path.join(appConfigDir(), "email_settings.json");
}

export function defaultEmailDownloadRoot(): string {
  return path.join(appConfigDir(), "email_attachments");
}
```

Delete the old `describe("email settings")` block and its `loadEmailSettings/saveEmailSettings` imports from `src/core/emailSource.test.ts`.

- [ ] **Step 5: Create the Electron composition boundary**

Create `src/main/localMailServices.ts`:

```typescript
import path from "node:path";
import { app, BrowserWindow, Notification, powerMonitor, safeStorage } from "electron";

import { listRecentOrderEmailMessages } from "../core/emailSource.js";
import type { LocalMailEvent, LocalMailMessageSummary } from "../shared/types.js";
import { openImapIdleConnection } from "../localMail/imapIdleConnection.js";
import { LocalMailCredentialStore } from "../localMail/localMailCredentialStore.js";
import { LocalMailboxMonitor } from "../localMail/localMailboxMonitor.js";
import { LocalMailService } from "../localMail/localMailService.js";
import { openLocalMailStore } from "../localMail/localMailStore.js";

export interface MainLocalMailServices {
  localMail: LocalMailService;
  close(): Promise<void>;
}

export interface NotificationBindings {
  isSupported(): boolean;
  create(options: { title: string; body: string; silent: boolean }): {
    on(name: "click", listener: () => void): void;
    show(): void;
  };
  focusFirstWindow(): void;
}

export function loginItemSettings(enabled: boolean): Electron.Settings {
  return { openAtLogin: enabled, args: ["--hidden"] };
}

export async function createMainLocalMailServices(): Promise<MainLocalMailServices> {
  const credentialStore = new LocalMailCredentialStore({ safeStorage });
  const store = await openLocalMailStore({ databasePath: path.join(app.getPath("userData"), "mail-cache.sqlite") });
  const monitor = new LocalMailboxMonitor({
    loadCredentials: () => credentialStore.loadCredentials(),
    scan: listRecentOrderEmailMessages,
    openIdle: openImapIdleConnection,
    store,
  });
  const notificationBindings: NotificationBindings = {
    isSupported: () => Notification.isSupported(),
    create: (options) => new Notification(options),
    focusFirstWindow,
  };
  const localMail = new LocalMailService({
    credentials: credentialStore,
    store,
    monitor,
    notify: (messages) => showOrderMailNotification(messages, notificationBindings),
    setStartAtLogin: (enabled) => app.setLoginItemSettings(loginItemSettings(enabled)),
  });
  const resume = () => { void monitor.handleResume(); };
  powerMonitor.on("resume", resume);
  const unsubscribe = localMail.subscribe(broadcastLocalMailEvent);
  return {
    localMail,
    async close() {
      unsubscribe();
      powerMonitor.off("resume", resume);
      await localMail.stop();
      store.close();
    },
  };
}

export async function showOrderMailNotification(
  messages: LocalMailMessageSummary[],
  bindings: NotificationBindings,
): Promise<boolean> {
  if (messages.length === 0 || !bindings.isSupported()) return false;
  const notification = bindings.create({
    title: `发现 ${messages.length} 封新订单邮件`,
    body: messages[0]?.subject || "有新的订单邮件待提取。",
    silent: false,
  });
  notification.on("click", bindings.focusFirstWindow);
  notification.show();
  return true;
}

function broadcastLocalMailEvent(event: LocalMailEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.webContents.isDestroyed()) window.webContents.send("local-mail:event", event);
  }
}

function focusFirstWindow(): void {
  const window = BrowserWindow.getAllWindows()[0];
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}
```

- [ ] **Step 6: Write the composition test**

Create `src/main/localMailServices.test.ts`:

```typescript
import { describe, expect, test, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/tmp"), setLoginItemSettings: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  Notification: class { static isSupported() { return false; } },
  powerMonitor: { on: vi.fn(), off: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: vi.fn(), decryptString: vi.fn() },
}));

import { loginItemSettings, showOrderMailNotification } from "./localMailServices.js";

test("uses the hidden login argument", () => {
  expect(loginItemSettings(true)).toEqual({ openAtLogin: true, args: ["--hidden"] });
  expect(loginItemSettings(false)).toEqual({ openAtLogin: false, args: ["--hidden"] });
});

test("shows one main-process notification and focuses the window on click", async () => {
  let click: (() => void) | undefined;
  const show = vi.fn();
  const focusFirstWindow = vi.fn();
  const create = vi.fn(() => ({
    on: vi.fn((_name: "click", listener: () => void) => { click = listener; }),
    show,
  }));
  const shown = await showOrderMailNotification([
    {
      uid: "101", subject: "PO 101", attachmentCount: 1, excelAttachmentNames: ["101.xlsx"],
      hasExcelAttachments: true, extracted: false,
    },
  ], { isSupported: () => true, create, focusFirstWindow });

  expect(shown).toBe(true);
  expect(create).toHaveBeenCalledWith({ title: "发现 1 封新订单邮件", body: "PO 101", silent: false });
  expect(show).toHaveBeenCalledOnce();
  click?.();
  expect(focusFirstWindow).toHaveBeenCalledOnce();
});

test("does nothing when Windows notifications are unavailable", async () => {
  const create = vi.fn();
  await expect(showOrderMailNotification([], {
    isSupported: () => false,
    create,
    focusFirstWindow: vi.fn(),
  })).resolves.toBe(false);
  expect(create).not.toHaveBeenCalled();
});
```

- [ ] **Step 7: Replace IPC handlers with injected local-mail channels**

Change the signature to:

```typescript
export function registerIpcHandlers(dependencies: {
  localMail: Pick<LocalMailService, "loadSettings" | "saveSettings" | "listEmails" | "refreshEmails" | "reconnect" | "extractEmail">;
}): void
```

Register exactly:

```typescript
ipcMain.handle("local-mail:settings:load", () => dependencies.localMail.loadSettings());
ipcMain.handle("local-mail:settings:save", (_event, input: SaveLocalMailSettingsInput) => dependencies.localMail.saveSettings(input));
ipcMain.handle("local-mail:list", () => dependencies.localMail.listEmails());
ipcMain.handle("local-mail:refresh", () => dependencies.localMail.refreshEmails());
ipcMain.handle("local-mail:reconnect", () => dependencies.localMail.reconnect());
ipcMain.handle("local-mail:extract", (event, request: LocalEmailExtractionRequest) =>
  dependencies.localMail.extractEmail(request, sendProgress(event.sender)),
);
```

Keep local file selection/extraction, update check/download, and `shell:open-path` handlers unchanged. Delete `settings:*`, `emails:*`, `notifications:new-order-emails`, and `orders:extract-email` handlers.

- [ ] **Step 8: Replace the preload API with secret-free methods**

The `OrderOrganizerApi` local-mail members become:

```typescript
loadMailSettings: () => Promise<LocalMailSettingsView>;
saveMailSettings: (input: SaveLocalMailSettingsInput) => Promise<LocalMailSettingsView>;
listEmails: () => Promise<LocalMailListResult>;
refreshEmails: () => Promise<LocalMailListResult>;
reconnectEmail: () => Promise<void>;
extractEmail: (request: LocalEmailExtractionRequest) => Promise<EmailExtractionResult>;
onLocalMailEvent: (callback: (event: LocalMailEvent) => void) => () => void;
```

Implement them with the seven `local-mail:*` channels listed in Step 1. Keep local extraction, update, path, and progress methods byte-for-byte unchanged.

- [ ] **Step 9: Run focused tests, full tests, and typecheck**

```bash
npm test -- src/main/localMailServices.test.ts src/main/preloadBridge.test.ts src/main/emailActions.test.ts src/core/emailSource.test.ts
npm run typecheck
npm test
```

Expected: all checks pass; `rg "loadEmailSettings|saveEmailSettings|notifications:new-order-emails|emails:subscribe-updates" src` prints no production matches.

- [ ] **Step 10: Commit the Electron local-mail boundary**

```bash
git add src/main/localMailServices.ts src/main/localMailServices.test.ts src/main/emailActions.ts src/main/emailActions.test.ts src/main/ipcHandlers.ts src/preload/preload.cts src/main/preloadBridge.test.ts src/core/settings.ts src/core/emailSource.test.ts
git diff --cached --check
git commit -m "feat: expose local mail through electron"
```

---

### Task 7: Add tray lifecycle, close-to-tray, and Windows login startup

**Files:**
- Create: `src/main/windowLifecycle.ts`
- Create: `src/main/windowLifecycle.test.ts`
- Create: `src/main/trayController.ts`
- Create: `src/main/trayController.test.ts`
- Replace: `src/main/main.ts`
- Modify: `src/main/preloadBridge.test.ts`

**Interfaces:**
- Consumes: `MainLocalMailServices`, Electron `BrowserWindow`, `Tray`, `Menu`, `app`, and the `--hidden` login argument.
- Produces: `WindowLifecycle`, `createTrayController`, and one composed startup/shutdown path.

- [ ] **Step 1: Write failing close-to-tray and tray-menu tests**

Create `src/main/windowLifecycle.test.ts`:

```typescript
import { describe, expect, test, vi } from "vitest";
import { createWindowLifecycle } from "./windowLifecycle.js";

test("prevents close and hides the window until explicit quit", () => {
  const window = { hide: vi.fn(), show: vi.fn(), focus: vi.fn(), isMinimized: vi.fn(() => false), restore: vi.fn() };
  const lifecycle = createWindowLifecycle(window);
  const event = { preventDefault: vi.fn() };
  lifecycle.handleClose(event);
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(window.hide).toHaveBeenCalledOnce();
  lifecycle.allowQuit();
  lifecycle.handleClose(event);
  expect(event.preventDefault).toHaveBeenCalledOnce();
});

test("restores, shows, and focuses the window", () => {
  const window = { hide: vi.fn(), show: vi.fn(), focus: vi.fn(), isMinimized: vi.fn(() => true), restore: vi.fn() };
  const lifecycle = createWindowLifecycle(window);
  lifecycle.showWindow();
  expect(window.restore).toHaveBeenCalledOnce();
  expect(window.show).toHaveBeenCalledOnce();
  expect(window.focus).toHaveBeenCalledOnce();
});
```

Create `src/main/trayController.test.ts`:

```typescript
import { describe, expect, test, vi } from "vitest";
import { createTrayController } from "./trayController.js";

test("builds Open, Reconnect, and Exit tray commands", async () => {
  let template: Array<{ label?: string; type?: "separator"; click?: () => void }> = [];
  const tray = { setToolTip: vi.fn(), setContextMenu: vi.fn(), on: vi.fn(), destroy: vi.fn() };
  const showWindow = vi.fn();
  const reconnect = vi.fn(async () => undefined);
  const exit = vi.fn(async () => undefined);
  const controller = createTrayController({
    iconPath: "/app/icon.png",
    bindings: {
      createTray: vi.fn(() => tray),
      buildMenu: vi.fn((value) => { template = value; return { template: value }; }),
    },
    showWindow,
    reconnect,
    exit,
  });

  expect(template.filter((item) => item.label).map((item) => item.label)).toEqual(["打开主界面", "重新连接邮箱", "退出"]);
  template.find((item) => item.label === "打开主界面")?.click?.();
  template.find((item) => item.label === "重新连接邮箱")?.click?.();
  template.find((item) => item.label === "退出")?.click?.();
  await vi.waitFor(() => expect(reconnect).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(exit).toHaveBeenCalledOnce());
  expect(showWindow).toHaveBeenCalledOnce();
  controller.destroy();
  expect(tray.destroy).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Run lifecycle tests and confirm missing modules**

```bash
npm test -- src/main/windowLifecycle.test.ts src/main/trayController.test.ts
```

Expected: FAIL because both modules are missing.

- [ ] **Step 3: Implement the window lifecycle**

Create `src/main/windowLifecycle.ts`:

```typescript
export interface WindowLike {
  hide(): void;
  show(): void;
  focus(): void;
  isMinimized(): boolean;
  restore(): void;
}

export interface CloseEventLike {
  preventDefault(): void;
}

export function createWindowLifecycle(window: WindowLike) {
  let quitting = false;
  return {
    handleClose(event: CloseEventLike): void {
      if (quitting) return;
      event.preventDefault();
      window.hide();
    },
    showWindow(): void {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    },
    allowQuit(): void {
      quitting = true;
    },
  };
}

export type WindowLifecycle = ReturnType<typeof createWindowLifecycle>;
```

- [ ] **Step 4: Implement the tray controller with injectable Electron bindings**

Create `src/main/trayController.ts`:

```typescript
export interface TrayLike {
  setToolTip(value: string): void;
  setContextMenu(menu: unknown): void;
  on(name: "click", listener: () => void): void;
  destroy(): void;
}

export interface TrayControllerBindings {
  createTray(iconPath: string): TrayLike;
  buildMenu(template: Array<{ label?: string; type?: "separator"; click?: () => void }>): unknown;
}

export function createTrayController(options: {
  iconPath: string;
  bindings: TrayControllerBindings;
  showWindow(): void;
  reconnect(): Promise<void>;
  exit(): Promise<void>;
}) {
  const tray = options.bindings.createTray(options.iconPath);
  tray.setToolTip("订单整理助手");
  tray.setContextMenu(options.bindings.buildMenu([
    { label: "打开主界面", click: options.showWindow },
    { label: "重新连接邮箱", click: () => { void options.reconnect(); } },
    { type: "separator" },
    { label: "退出", click: () => { void options.exit(); } },
  ]));
  tray.on("click", options.showWindow);
  return { destroy: () => tray.destroy() };
}
```

- [ ] **Step 5: Compose main startup only after Electron is ready**

Replace `src/main/main.ts` so that `app.whenReady()` performs this order:

```typescript
const services = await createMainLocalMailServices();
registerIpcHandlers({ localMail: services.localMail });
const startHidden = process.argv.includes("--hidden");
const window = await createWindow({ show: !startHidden });
const lifecycle = createWindowLifecycle(window);
window.on("close", (event) => lifecycle.handleClose(event));
const tray = createTrayController({
  iconPath: trayIconPath(),
  bindings: { createTray: (icon) => new Tray(icon), buildMenu: (template) => Menu.buildFromTemplate(template) },
  showWindow: lifecycle.showWindow,
  reconnect: () => services.localMail.reconnect(),
  exit: async () => {
    lifecycle.allowQuit();
    tray.destroy();
    await services.close();
    app.quit();
  },
});
await services.localMail.start();
```

Keep the existing BrowserWindow dimensions, preload path, context isolation, and renderer file. Change `createWindow(options: { show: boolean })` to return the window and pass `show: options.show` into `new BrowserWindow(...)` so login startup never flashes the window. Add:

```typescript
function trayIconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "assets", "app_icon.png")
    : path.resolve("assets", "app_icon.png");
}
```

Delete the non-macOS `window-all-closed -> app.quit()` behavior; the tray owns explicit exit. On `activate`, call `lifecycle.showWindow()`.

- [ ] **Step 6: Add a source-level lifecycle assertion**

Append to `src/main/preloadBridge.test.ts`:

```typescript
test("starts local mail after app readiness and closes windows to tray", async () => {
  const mainSource = await readFile(path.join(root, "src/main/main.ts"), "utf8");
  expect(mainSource.indexOf("app.whenReady()")).toBeLessThan(mainSource.indexOf("await createMainLocalMailServices()"));
  expect(mainSource).toContain('process.argv.includes("--hidden")');
  expect(mainSource).toContain('window.on("close"');
  expect(mainSource).toContain("createTrayController");
  expect(mainSource).not.toContain('app.on("window-all-closed"');
});
```

- [ ] **Step 7: Run focused tests, typecheck, and main build**

```bash
npm test -- src/main/windowLifecycle.test.ts src/main/trayController.test.ts src/main/preloadBridge.test.ts
npm run typecheck
npm run build:main
```

Expected: all tests pass, TypeScript/build exit `0`, and `dist/main/main.js` exists.

- [ ] **Step 8: Commit tray lifecycle**

```bash
git add src/main/windowLifecycle.ts src/main/windowLifecycle.test.ts src/main/trayController.ts src/main/trayController.test.ts src/main/main.ts src/main/preloadBridge.test.ts
git diff --cached --check
git commit -m "feat: keep local mail running in the tray"
```

---

### Task 8: Convert the renderer to cache-first local mail

**Files:**
- Create: `src/renderer/localMailViewState.ts`
- Create: `src/renderer/localMailViewState.test.ts`
- Modify: `src/renderer/app.tsx`
- Modify: `src/renderer/styles.css`
- Delete: `src/renderer/mailExtractionState.ts`
- Delete: `src/renderer/mailExtractionState.test.ts`
- Delete: `src/renderer/mailNotifications.ts`
- Delete: `src/renderer/mailNotifications.test.ts`

**Interfaces:**
- Consumes: the Task 6 preload bridge and `LocalMailListResult`, `LocalMailEvent`, `LocalMailRuntimeStatus`, and `LocalMailSettingsView`.
- Produces: a secret-free login panel, local runtime banner, cache-first list, manual refresh/reconnect, event-driven new badges, and manual UID extraction.

- [ ] **Step 1: Write failing pure view-state tests**

Create `src/renderer/localMailViewState.test.ts`:

```typescript
import { describe, expect, test } from "vitest";
import { applyLocalMailEvent, connectionBadge, emptyMailCopy } from "./localMailViewState.js";

test.each([
  ["connected", "已连接", "success"],
  ["connecting", "连接中", "warning"],
  ["offline", "离线缓存", "warning"],
  ["attention_required", "需要重新登录", "danger"],
  ["stopped", "未登录", "subtle"],
] as const)("maps %s to a stable badge", (state, label, color) => {
  expect(connectionBadge({ state, detail: "detail" })).toEqual({ label, color });
});

test("applies a main-process message event and keeps new UID badges", () => {
  const next = applyLocalMailEvent(
    { list: undefined, newMessageUids: new Set<string>(), status: { state: "stopped", detail: "" } },
    {
      type: "messages-updated",
      data: {
        newMessageUids: ["101"],
        list: {
          messages: [{
            uid: "101",
            subject: "PO 101",
            from: "orders@example.com",
            date: "2026-07-13T00:00:00Z",
            attachmentCount: 1,
            excelAttachmentNames: ["101.xlsx"],
            hasExcelAttachments: true,
            extracted: false,
          }],
          scannedMessages: 1,
          days: 7,
          status: { state: "connected", detail: "ok" },
        },
      },
    },
  );
  expect(next.list?.messages[0]?.uid).toBe("101");
  expect(next.newMessageUids).toEqual(new Set(["101"]));
});

test("uses cache-aware empty copy", () => {
  expect(emptyMailCopy(false, false)).toBe("登录企业邮箱后显示订单邮件。");
  expect(emptyMailCopy(true, true)).toBe("离线，当前没有可显示的本地订单邮件。");
  expect(emptyMailCopy(true, false)).toBe("最近 7 天没有订单邮件。");
});
```

- [ ] **Step 2: Run the helper test and confirm the missing-module failure**

```bash
npm test -- src/renderer/localMailViewState.test.ts
```

Expected: FAIL because `localMailViewState.ts` does not exist.

- [ ] **Step 3: Implement the pure view-state helper**

Create `src/renderer/localMailViewState.ts`:

```typescript
import type { LocalMailEvent, LocalMailListResult, LocalMailRuntimeStatus } from "../shared/types.js";

export interface LocalMailRendererState {
  list?: LocalMailListResult;
  newMessageUids: Set<string>;
  status: LocalMailRuntimeStatus;
}

export function connectionBadge(status: LocalMailRuntimeStatus): {
  label: string;
  color: "success" | "warning" | "danger" | "subtle";
} {
  switch (status.state) {
    case "connected": return { label: "已连接", color: "success" };
    case "connecting": return { label: "连接中", color: "warning" };
    case "offline": return { label: "离线缓存", color: "warning" };
    case "attention_required": return { label: "需要重新登录", color: "danger" };
    default: return { label: "未登录", color: "subtle" };
  }
}

export function applyLocalMailEvent(state: LocalMailRendererState, event: LocalMailEvent): LocalMailRendererState {
  if (event.type === "status-changed") return { ...state, status: event.data };
  const newMessageUids = new Set(state.newMessageUids);
  event.data.newMessageUids.forEach((uid) => newMessageUids.add(uid));
  return { list: event.data.list, newMessageUids, status: event.data.list.status };
}

export function emptyMailCopy(hasCredentials: boolean, offline: boolean): string {
  if (!hasCredentials) return "登录企业邮箱后显示订单邮件。";
  return offline ? "离线，当前没有可显示的本地订单邮件。" : "最近 7 天没有订单邮件。";
}
```

- [ ] **Step 4: Replace secret-bearing renderer state and startup effects**

In `src/renderer/app.tsx`:

- Replace `EmailSettings`, remote notification helpers, and renderer localStorage helpers with the new local-mail types and `applyLocalMailEvent/connectionBadge/emptyMailCopy` imports.
- Keep `email` only as the editable address and rename `authCode` state to `authCodeInput`; never set it from `loadMailSettings()`.
- Add `settings: LocalMailSettingsView`, `runtimeStatus: LocalMailRuntimeStatus`, and use `message.extracted` instead of `extractedMessageUids`.
- Delete `seenMessageUids`, `hasLoadedMailbox`, renderer notification calls, remote subscription calls, and the five-minute timer.

Use these exact state declarations and derived values in place of the old credential/list state:

```typescript
const STOPPED_STATUS: LocalMailRuntimeStatus = { state: "stopped", detail: "请先登录企业邮箱" };
const [email, setEmail] = useState("");
const [authCodeInput, setAuthCodeInput] = useState("");
const [settings, setSettings] = useState<LocalMailSettingsView>({ email: "", hasAuthCode: false, startAtLogin: true });
const [settingsHidden, setSettingsHidden] = useState(false);
const [mailView, setMailView] = useState<LocalMailRendererState>({
  list: undefined,
  newMessageUids: new Set(),
  status: STOPPED_STATUS,
});
const emailMessages = mailView.list?.messages ?? [];
const runtimeStatus = mailView.status;
const badge = connectionBadge(runtimeStatus);
const canUseEmail = settings.hasAuthCode && !bridgeMissing;
```

Use this startup effect:

```typescript
useEffect(() => {
  const removeProgress = api.onProgress((event) => renderProgress(event, appendLog, setProgress));
  const removeMailEvent = api.onLocalMailEvent((event) => {
    setMailView((current) => applyLocalMailEvent(current, event));
  });
  void Promise.all([api.loadMailSettings(), api.listEmails()]).then(([saved, list]) => {
    setSettings(saved);
    setEmail(saved.email);
    setSettingsHidden(saved.hasAuthCode);
    setMailView({ list, newMessageUids: new Set(), status: list.status });
  });
  return () => { removeProgress(); removeMailEvent(); };
}, [appendLog]);
```

- [ ] **Step 5: Replace refresh, save, reconnect, and extraction calls**

Replace the old refresh/save/reconnect functions with:

```typescript
const applyList = useCallback((list: LocalMailListResult): void => {
  setMailView((current) => ({ ...current, list, status: list.status }));
}, []);

const loadCachedEmails = useCallback(async (): Promise<void> => {
  applyList(await api.listEmails());
}, [applyList]);

const refreshEmails = useCallback(async (): Promise<void> => {
  if (!canUseEmail || mailRefreshInFlight.current) return;
  mailRefreshInFlight.current = true;
  setMailLoading(true);
  try {
    const refreshed = await api.refreshEmails();
    applyList(refreshed);
    appendLog(`邮件列表已刷新：${refreshed.messages.length} 封订单邮件`);
  } catch (error) {
    appendLog(`邮件刷新失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    mailRefreshInFlight.current = false;
    setMailLoading(false);
  }
}, [appendLog, applyList, canUseEmail]);

async function saveSettings(): Promise<void> {
  await runUiTask(async () => {
    const saved = await api.saveMailSettings({
      email,
      ...(authCodeInput.trim() ? { authCode: authCodeInput.trim() } : {}),
      startAtLogin: true,
    });
    setSettings(saved);
    setEmail(saved.email);
    setAuthCodeInput("");
    setSettingsHidden(saved.hasAuthCode);
    appendLog("邮箱登录成功，授权码已由 Windows DPAPI 加密保存");
    await loadCachedEmails();
  });
}

async function reconnectEmail(): Promise<void> {
  await runUiTask(async () => {
    await api.reconnectEmail();
    appendLog("正在重新连接企业邮箱");
  });
}
```

Replace `extractEmailMessages` with:

```typescript
async function extractEmailMessages(messageUids: string[]): Promise<void> {
  await runUiTask(async () => {
    resetResult();
    setSummary("正在下载选中邮件附件");
    appendLog(`已选择 ${messageUids.length} 封邮件`);
    const result = await api.extractEmail({ messageUids, inferManual: true });
    renderEmailResult(result);
    applyList(await api.listEmails());
    setSelectedMessageUids((current) => {
      const next = new Set(current);
      messageUids.forEach((uid) => next.delete(uid));
      return next;
    });
    setMailView((current) => {
      const nextNew = new Set(current.newMessageUids);
      messageUids.forEach((uid) => nextNew.delete(uid));
      return { ...current, newMessageUids: nextNew };
    });
  });
}
```

The service leaves UIDs pending when the extraction result has failures, so this function must not synthesize an extracted state in the renderer.

- [ ] **Step 6: Update the visible copy and controls**

Apply these exact UI rules:

- Connection badge uses `connectionBadge(runtimeStatus)` rather than `email && authCode`.
- Add a banner below the command card with `runtimeStatus.detail`; add class `mail-runtime-banner offline` for `offline` and `attention` for `attention_required`.
- The settings subtitle becomes `邮箱授权码使用 Windows DPAPI 加密保存在本机。`.
- The authorization input value is `authCodeInput`; placeholder is `未修改时可留空` when `settings.hasAuthCode`, otherwise `邮箱客户端授权码`.
- Add a secondary `重新连接` button calling `api.reconnectEmail()`.
- The mail-list subtitle becomes `固定显示最近 7 天，本机后台实时监听。`.
- Empty content uses `emptyMailCopy(settings.hasAuthCode, runtimeStatus.state === "offline")`.
- Pending and extracted state come from `message.extracted`; ordinary/non-order messages never arrive from main.
- Keep per-day arrows inside the fixed seven-day cache; do not add a range selector.
- Keep local drag/drop extraction and all output buttons unchanged.

Append to `src/renderer/styles.css`:

```css
.mail-runtime-banner {
  margin: -8px 0 16px;
  padding: 10px 14px;
  border: 1px solid #c7ddd0;
  border-radius: 8px;
  background: #f0faf4;
  color: #245c3b;
  font-size: 13px;
}

.mail-runtime-banner.offline {
  border-color: #e6cf9a;
  background: #fff8e7;
  color: #76520b;
}

.mail-runtime-banner.attention {
  border-color: #e7b7b7;
  background: #fff1f1;
  color: #8b2222;
}
```

- [ ] **Step 7: Delete obsolete renderer notification/extraction-localStorage helpers**

```bash
git rm src/renderer/mailExtractionState.ts src/renderer/mailExtractionState.test.ts src/renderer/mailNotifications.ts src/renderer/mailNotifications.test.ts
```

- [ ] **Step 8: Update preview API and renderer tests**

Inside `createPreviewApi()`, define a `previewList: LocalMailListResult` and replace only the local-mail members of the returned object with:

```typescript
const previewList: LocalMailListResult = {
  days: 7,
  scannedMessages: 2,
  orderAttachmentCount: 2,
  nonOrderExcelAttachmentCount: 0,
  status: { state: "connected", detail: "预览：本地邮箱已连接" },
  messages: [
    {
      uid: "preview-2",
      subject: "今日订单附件",
      from: "Orders <orders@example.com>",
      date: new Date().toISOString(),
      attachmentCount: 1,
      excelAttachmentNames: ["today-order.xlsx"],
      hasExcelAttachments: true,
      extracted: false,
    },
  ],
};

return {
  loadMailSettings: async () => ({ email: "", hasAuthCode: false, startAtLogin: true }),
  saveMailSettings: async (input) => ({ email: input.email.trim(), hasAuthCode: Boolean(input.authCode), startAtLogin: true }),
  selectLocalInputs: async () => ["/preview/orders/order.xlsx"],
  listEmails: async () => previewList,
  refreshEmails: async () => previewList,
  reconnectEmail: async () => undefined,
  extractLocal: async () => extraction,
  extractEmail: async () => ({
    emailFetch: {
      files: ["/preview/orders/order.xlsx"],
      scannedMessages: 1,
      attachmentCount: 1,
      downloadDir: outputs.outputDir,
    },
    extraction,
  }),
  onLocalMailEvent: () => () => undefined,
  checkUpdates: async () => ({ updateAvailable: false, currentVersion: "preview", reason: "current" }),
  downloadAndOpenUpdate: async () => "/preview/downloads/orderflow-desktop-windows.exe",
  openPath: async () => undefined,
  onProgress: () => () => undefined,
};
```

Run:

```bash
npm test -- src/renderer/localMailViewState.test.ts src/renderer/mailDateFilter.test.ts src/main/preloadBridge.test.ts
npm run typecheck
npm run build:renderer
```

Expected: tests/typecheck/build pass; built renderer contains `Windows DPAPI` and `固定显示最近 7 天`, and contains no authorization code loaded from settings.

- [ ] **Step 9: Run full tests and commit the renderer migration**

```bash
npm test
git add src/renderer/localMailViewState.ts src/renderer/localMailViewState.test.ts src/renderer/app.tsx src/renderer/styles.css src/renderer/mailExtractionState.ts src/renderer/mailExtractionState.test.ts src/renderer/mailNotifications.ts src/renderer/mailNotifications.test.ts
git diff --cached --check
git commit -m "feat: show cache-first local mail in desktop"
```

---

### Task 9: Remove the remote mail/server surface and enforce a local-only package

**Files:**
- Delete: `src/core/remoteEmailApi.ts`
- Delete: `src/core/remoteEmailApi.test.ts`
- Delete: `src/server/`
- Delete: `services/orderflow-email-api/`
- Delete: `resources/remote-email-api.json`
- Delete: `scripts/write-remote-email-api-config.mjs`
- Delete: `scripts/server/mihomo_imap_node_keeper.py`
- Delete: `tests/test_mihomo_imap_node_keeper.py`
- Delete: `deploy/systemd/mihomo-imap-node-keeper.service`
- Delete: `deploy/systemd/mihomo-imap-node-keeper.timer`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tsconfig.build.json`
- Modify: `vitest.config.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/packaging/packageConfig.test.ts`
- Create: `src/packaging/localOnlyInvariant.test.ts`

**Interfaces:**
- Consumes: the completed local mail runtime and the preserved root `extract.py` Deluxe Dry Lining fix.
- Produces: one Electron-only package with no server command, remote configuration, mailparser dependency, native SQLite dependency, or production listener.

- [ ] **Step 1: Write the failing local-only package invariant**

Create `src/packaging/localOnlyInvariant.test.ts`:

```typescript
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";

const root = process.cwd();

test("ships no remote mail service, remote config, listener, or native sqlite package", async () => {
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
    dependencies: Record<string, string>;
    build: { extraResources: Array<{ from: string; to: string }> };
  };
  expect(packageJson.scripts).not.toHaveProperty("serve:email-api");
  expect(packageJson.dependencies).not.toHaveProperty("mailparser");
  for (const name of ["sqlite3", "better-sqlite3", "@libsql/client"]) expect(packageJson.dependencies).not.toHaveProperty(name);
  expect(packageJson.build.extraResources).not.toContainEqual(expect.objectContaining({ from: "resources/remote-email-api.json" }));
  await expect(access(path.join(root, "src/server"))).rejects.toMatchObject({ code: "ENOENT" });
  await expect(access(path.join(root, "services/orderflow-email-api"))).rejects.toMatchObject({ code: "ENOENT" });
  await expect(access(path.join(root, "src/core/remoteEmailApi.ts"))).rejects.toMatchObject({ code: "ENOENT" });
  const productionFiles = [
    "src/main/main.ts",
    "src/main/ipcHandlers.ts",
    "src/main/localMailServices.ts",
    "src/localMail/localMailService.ts",
  ];
  const source = (await Promise.all(productionFiles.map((file) => readFile(path.join(root, file), "utf8")))).join("\n");
  expect(source).not.toMatch(/createServer|WebSocketServer|orderflow\.ausmet\.ai|RemoteEmailApiClient/);
});
```

- [ ] **Step 2: Run the invariant and confirm the old server/config failure**

```bash
npm test -- src/packaging/localOnlyInvariant.test.ts
```

Expected: FAIL because the remote files, script, dependency, and resource still exist.

- [ ] **Step 3: Delete the obsolete runtime and deployment files**

After confirming the preflight extraction commit exists in `git log`, run:

```bash
git rm src/core/remoteEmailApi.ts src/core/remoteEmailApi.test.ts
git rm -r src/server services/orderflow-email-api
git rm resources/remote-email-api.json scripts/write-remote-email-api-config.mjs
git rm scripts/server/mihomo_imap_node_keeper.py tests/test_mihomo_imap_node_keeper.py
git rm deploy/systemd/mihomo-imap-node-keeper.service deploy/systemd/mihomo-imap-node-keeper.timer
```

Before continuing, run `git show main:extract.py | rg "Deluxe Dry Lining"` and confirm the retained root source contains the fixed rule.

- [ ] **Step 4: Update package and compiler boundaries**

In `package.json`:

- Delete `serve:email-api`.
- Delete `mailparser` and `@types/mailparser`.
- Delete the `resources/remote-email-api.json` extraResource.
- Add `{ "from": "assets/app_icon.png", "to": "assets/app_icon.png" }` to `build.extraResources`.

Change `tsconfig.build.json` includes to:

```json
["src/core/**/*.ts", "src/localMail/**/*.ts", "src/main/**/*.ts", "src/preload/**/*.cts", "src/shared/**/*.ts"]
```

Change `vitest.config.ts` include to:

```typescript
include: ["src/**/*.test.ts"]
```

Delete obsolete `EmailNewMessagesEvent` and `NewOrderEmailNotification` interfaces from `src/shared/types.ts`; the main-process service now uses `LocalMailEvent` and `LocalMailMessageSummary`.

Then regenerate the lockfile:

```bash
npm install
```

- [ ] **Step 5: Update packaging expectations**

In `src/packaging/packageConfig.test.ts`:

- Expect no `serve:email-api` script.
- Expect no `mailparser` dependency.
- Replace the remote config extraResource expectation with `{ from: "assets/app_icon.png", to: "assets/app_icon.png" }`.
- Expect the new `tsconfig.build.json` include list from Step 4 and no `src/server/**/*.ts`.
- Move remote-workflow expectations out; Task 10 replaces them with negative assertions.

- [ ] **Step 6: Run invariant, packaging, full tests, typecheck, and build**

```bash
npm test -- src/packaging/localOnlyInvariant.test.ts src/packaging/packageConfig.test.ts
npm run typecheck
npm test
npm run build
npm ls sqlite3 better-sqlite3 @libsql/client --all
```

Expected: all checks/build pass; npm reports an empty tree for native SQLite packages; `rg "RemoteEmailApiClient|serve:email-api|remote-email-api|orderflow\.ausmet\.ai" src package.json .github/workflows/release.yml` may still match only the release workflow until Task 10.

- [ ] **Step 7: Commit the local-only package boundary**

Stage all exact paths touched by Task 9, review the deletion list, and commit:

```bash
git add package.json package-lock.json tsconfig.build.json vitest.config.ts src/shared/types.ts src/packaging/packageConfig.test.ts src/packaging/localOnlyInvariant.test.ts
git add -u src/core src/server services/orderflow-email-api resources scripts deploy tests
git diff --cached --check
git commit -m "refactor: remove remote mail server stack"
```

---

### Task 10: Update release automation, operator docs, and final verification

**Files:**
- Modify: `.github/workflows/release.yml`
- Modify: `src/packaging/packageConfig.test.ts`
- Modify: `src/packaging/readme.test.ts`
- Modify: `README.md`
- Create: `docs/local-mail-workstation.md`
- Replace: `docs/email-api-server.md`
- Modify: `docs/superpowers/specs/2026-07-10-office-mail-gateway-design.md`
- Modify: `docs/superpowers/plans/2026-07-10-office-mail-gateway.md`
- Modify: `docs/superpowers/plans/2026-06-23-email-api-server.md`

**Interfaces:**
- Consumes: the local-only packaged app from Task 9.
- Produces: CI without remote secrets, a Windows operator runbook, superseded cloud docs, and final release evidence.

- [ ] **Step 1: Write failing documentation/release expectations**

Add to `src/packaging/packageConfig.test.ts`:

```typescript
expect(workflow).not.toContain("Write packaged remote email API config");
expect(workflow).not.toContain("ORDERFLOW_EMAIL_API_URL");
expect(workflow).not.toContain("ORDERFLOW_EMAIL_API_TOKEN");
expect(workflow).not.toContain("write-remote-email-api-config.mjs");
expect(workflow).toContain("Run local-only invariant");
```

Add to `src/packaging/readme.test.ts`:

```typescript
expect(readme).toContain("企业微信邮箱地址和客户端授权码");
expect(readme).toContain("授权码使用 Windows DPAPI 加密保存在本机");
expect(readme).toContain("关闭窗口后软件继续在系统托盘监听");
expect(readme).not.toContain("远程邮件 API");
expect(readme).not.toContain("ORDERFLOW_EMAIL_API");
```

- [ ] **Step 2: Run packaging/docs tests and confirm old text fails**

```bash
npm test -- src/packaging/packageConfig.test.ts src/packaging/readme.test.ts
```

Expected: FAIL because release workflow and README still describe remote configuration or omit local login guidance.

- [ ] **Step 3: Remove both remote-config steps from release CI**

Delete the complete `Write packaged remote email API config` step from both `build-windows` and `build-macos`. After root tests, add:

```yaml
      - name: Run local-only invariant
        run: npm test -- src/packaging/localOnlyInvariant.test.ts
```

Keep build info, Electron/Python caches, Windows portable build, macOS DMG build, and release publication unchanged.

- [ ] **Step 4: Write the user/operator runbook**

Create `docs/local-mail-workstation.md` with these exact sections and concrete instructions:

```markdown
# 本地邮箱工作站

## 首次登录
1. 打开订单整理助手。
2. 输入企业微信邮箱地址和客户端授权码。
3. 点击“保存并登录”。授权码使用 Windows DPAPI 加密保存在本机。

## 日常使用
- Windows 登录后软件自动进入系统托盘并监听新订单邮件。
- 固定显示最近 7 天的订单邮件；普通邮件不会进入列表或通知。
- 勾选邮件后点击“提取选中邮件”，软件才会下载附件并在本机提取。
- 关闭主窗口不会退出；从托盘选择“退出”才停止监听。

## 状态处理
- “离线缓存”：仍可查看本地列表，联网后自动补扫。
- “需要重新登录”：打开邮箱设置并输入新的客户端授权码。
- 休眠唤醒：软件立即补扫休眠期间的新邮件。

## 数据位置与安全
- 邮箱授权码只以 DPAPI 密文持久化。
- 邮件元数据保存在本机 SQLite，保留最近 7 天。
- 下载附件、提取结果和审计文件位于现有时间戳输出目录。
- 软件不开放入站端口，也不向远程邮件服务上传数据。

## 托盘菜单
- 打开主界面
- 重新连接邮箱
- 退出
```

Add this subsection under the README desktop download/opening instructions and before local developer setup:

```markdown
### 本地邮箱登录

打开软件后只需填写企业微信邮箱地址和客户端授权码。授权码使用 Windows DPAPI 加密保存在本机，不会上传到远程邮件服务。

Windows 登录后软件会自动在系统托盘运行并监听新订单邮件。关闭窗口后软件继续在系统托盘监听；只有从托盘选择“退出”才会停止。邮件列表固定保存最近 7 天，收到订单邮件后仍需手动勾选并点击提取。
```

Replace `docs/email-api-server.md` with:

```markdown
# 已停用：邮件 API 服务器

该远程服务器方案已由 `docs/local-mail-workstation.md` 的单机本地模式取代。不要部署或配置 `EMAIL_API_*`、远程 token、SSE 或邮件 Agent。
```

Prepend this notice to each old cloud spec/plan:

```markdown
> **SUPERSEDED (2026-07-13):** Do not implement this remote design. Use `docs/superpowers/specs/2026-07-13-local-mail-workstation-design.md` and `docs/superpowers/plans/2026-07-13-local-mail-workstation.md`.
```

- [ ] **Step 5: Run docs, package, source, and full regression checks**

```bash
npm run typecheck
npm test
npm run build
python3 -m pytest -q tests/test_desktop_runner.py tests/test_hardware_rules.py tests/test_jobtrack_compare.py
rg "RemoteEmailApiClient|serve:email-api|remote-email-api|ORDERFLOW_EMAIL_API|orderflow\.ausmet\.ai" src package.json .github/workflows/release.yml README.md docs/local-mail-workstation.md
```

Expected: TypeScript/tests/build/Python pass and the final `rg` prints no matches.

- [ ] **Step 6: Build the Windows portable artifact**

```bash
npm run dist:win:ci
ls -lh release/orderflow-desktop-windows.exe
```

Expected: command exits `0` and the portable executable exists. Cross-build limitations on macOS are reportable; the GitHub Windows job remains the authoritative artifact build.

- [ ] **Step 7: Run the Electron SQLite/runtime smoke check**

```bash
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron -e "const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync(':memory:'); console.log(db.prepare('select sqlite_version() as version').get()); db.close();"
```

Expected: prints a SQLite version; only the known experimental warning is allowed.

- [ ] **Step 8: Perform Windows acceptance on the built artifact**

On the office Windows computer, verify in order:

1. First launch asks only for enterprise email and client authorization code.
2. Saving valid credentials succeeds; reopening never displays the saved authorization code.
3. Windows Credential/DPAPI-backed ciphertext is present, and plaintext `authCode` is absent from `email_settings.json` and logs.
4. Closing the window keeps the tray icon and background monitoring alive.
5. A valid new order workbook email produces one Windows notification; an ordinary email and a non-order Excel report produce none.
6. Screen-off does not interrupt monitoring; sleep/resume causes an immediate catch-up scan.
7. Offline mode shows the cached seven-day list; reconnect fills missed mail.
8. Selecting one message extracts only that UID, uses the existing Python rules, and keeps output-folder/Excel buttons working.
9. Tray Reconnect works; tray Exit removes the process.
10. `netstat -ano` shows no listening socket owned by the application.

- [ ] **Step 9: Commit docs and release cleanup**

```bash
git add .github/workflows/release.yml src/packaging/packageConfig.test.ts src/packaging/readme.test.ts README.md docs/local-mail-workstation.md docs/email-api-server.md docs/superpowers/specs/2026-07-10-office-mail-gateway-design.md docs/superpowers/plans/2026-07-10-office-mail-gateway.md docs/superpowers/plans/2026-06-23-email-api-server.md
git diff --cached --check
git commit -m "docs: ship the local mail workstation"
```

---

## Final Branch Review Gate

- [ ] Run `git merge-base main HEAD` and generate one whole-branch review package from that SHA through `HEAD`.
- [ ] Dispatch a fresh high-capability reviewer with the approved design, this plan, implementer reports, and all recorded Minor findings.
- [ ] Fix all Critical and Important findings in one final fix wave; re-run the focused tests covering each amendment.
- [ ] Run `npm run typecheck && npm test && npm run build` and the three Python test files again after final fixes.
- [ ] Confirm `git status --short --branch` is clean and the original checkout has no uncommitted user changes.
- [ ] Use `superpowers:finishing-a-development-branch` to offer merge/PR/keep/cleanup choices.
