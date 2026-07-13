> **SUPERSEDED (2026-07-13):** Do not implement this remote design. Use `docs/superpowers/specs/2026-07-13-local-mail-workstation-design.md` and `docs/superpowers/plans/2026-07-13-local-mail-workstation.md`.

# Office Mail Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an outbound-only Windows office mail gateway that synchronizes one WeCom mailbox through `asumet`, gives every desktop client one shared live mail list, and executes selected-email extraction on the office computer.

**Architecture:** The standalone Node 24 service on `asumet` becomes a SQLite/WAL cache and extraction-job broker with separate client and agent authentication. The office Electron app stores mailbox and agent credentials with `safeStorage`, watches IMAP locally, keeps an outbound WSS/HTTPS connection to the service, and runs the existing Python extractor in a quarantined per-job directory. All desktop clients read the central cache, receive SSE status events, and download completed workbooks over HTTPS; the office computer opens no listener.

**Tech Stack:** Electron 39, React 19, TypeScript 5.9, Node.js 24, `node:sqlite`, `ws`, ImapFlow, yauzl, Vitest, Python extraction bridge, Docker, Nginx, GitHub Actions.

## Global Constraints

- The deployed service runtime is Node.js `>=24`; use built-in `node:sqlite` and do not add a native SQLite package.
- The first release starts after the designated Windows user signs in; it is not a pre-login Windows service.
- The office computer opens no HTTP, WebSocket, SOCKS, file-sharing, or remote-control listener. Its only required outbound flows are `imap.exmail.qq.com:993` and `orderflow.ausmet.ai:443`.
- Public client and agent traffic is valid HTTPS/WSS only at `orderflow.ausmet.ai`; TLS verification is mandatory and there is no insecure-certificate bypass.
- Mailbox credentials never leave the office computer. Client API tokens and the gateway agent token are separate, independently rotatable secrets and must never be logged.
- The gateway heartbeat interval is 30 seconds; the server reports offline after 90 seconds without a heartbeat.
- IMAP IDLE is preferred, with a 60-second scan fallback. IMAP and WSS reconnect backoff is exponential from 1 to 60 seconds with jitter.
- Extraction jobs use UUIDs and `queued`, `dispatched`, `running`, `completed`, `failed`, and `expired` states. Offline queued jobs expire after 15 minutes.
- Server results are retained for 7 days. Failed local quarantine directories are retained for at most 24 hours. Successful quarantine directories are removed immediately after an acknowledged result upload.
- Accept only `.xlsx` and `.xlsm` attachments with ZIP/OpenXML signatures, at most 25 MB compressed, 2,000 ZIP entries, and 250 MB declared uncompressed bytes. Never execute macros, formulas, embedded objects, or external links.
- One mailbox is supported in v1. Synchronization is idempotent by `mailboxId + uid`; result upload is idempotent by `jobId + checksum`.
- Electron `safeStorage`/Windows DPAPI protects the mailbox authorization code and agent token. Plaintext secrets and raw Authorization headers never enter logs.
- `extract.py` and the existing Python bridge remain the extraction rules source of truth. Existing local-file extraction and local output buttons remain unchanged.
- Before implementation, preserve the existing uncommitted Deluxe Dry Lining fixes in `extract.py`, `services/orderflow-email-api/extract.py`, `src/core/orderExtractor.ts`, `src/core/orderExtractor.test.ts`, and `tests/test_hardware_rules.py`. Every gateway commit must use exact `git add` paths and must not stage those five files.

---

## File Structure

### Shared protocol

- Create `src/shared/gatewayProtocol.ts` and `services/orderflow-email-api/src/shared/gatewayProtocol.ts`: identical wire contracts for status, sync, jobs, SSE, and WebSocket frames.
- Create `src/shared/gatewayProtocol.test.ts`: contract invariants and a byte-for-byte parity check for the two protocol files.

### `asumet` service

- Modify `services/orderflow-email-api/src/server/emailApiConfig.ts`: client token, agent token, database/result paths, body limit, and timing configuration; no mailbox fields.
- Create `services/orderflow-email-api/src/server/gatewayStateMachine.ts`: legal job transitions.
- Create `services/orderflow-email-api/src/server/gatewayStore.ts`: SQLite schema, message synchronization, heartbeat state, job persistence, idempotent completion, expiration, and cleanup queries.
- Create `services/orderflow-email-api/src/server/agentConnectionHub.ts`: one authenticated outbound agent WebSocket and server-to-agent extraction commands.
- Create `services/orderflow-email-api/src/server/jobDispatcher.ts`: queued-job dispatch and agent acknowledgement/state handling.
- Modify `services/orderflow-email-api/src/server/emailEventHub.ts`: typed `new-messages`, `gateway-status`, and `job-status` SSE events plus keepalive.
- Replace `services/orderflow-email-api/src/server/emailApiServer.ts`: cache/list/job/result/client routes, agent sync/heartbeat/result routes, bounded JSON bodies, and separated authorization.
- Replace `services/orderflow-email-api/src/server/main.ts`: compose store, hub, dispatcher, HTTP server, WebSocket upgrade, timers, and clean shutdown.
- Delete `services/orderflow-email-api/src/server/emailMessageCache.ts` and its test: cloud IMAP polling is no longer part of the service.

### Office Electron gateway

- Create `src/gateway/attachmentPolicy.ts`: safe filename and OpenXML ZIP limits.
- Create `src/gateway/gatewayStateStore.ts`: atomic local sync/job state under `~/.order_organizer_assistant/gateway`.
- Create `src/gateway/gatewayCredentialStore.ts`: encrypted settings boundary backed by injected `safeStorage` operations.
- Create `src/gateway/gatewayAgentClient.ts`: outbound WSS plus agent HTTPS requests, heartbeat, backoff, and replay hooks.
- Create `src/gateway/gatewayMailboxMonitor.ts`: IMAP IDLE wakeups, 60-second scans, auth-failure pause, and replayable sync batches.
- Create `src/gateway/gatewayJobRunner.ts`: persist-then-ack, attachment validation, Python extraction, sanitized result upload, retry, and quarantine cleanup.
- Create `src/gateway/gatewayRuntime.ts`: start/stop/reconfigure orchestration and tray-safe runtime status.
- Modify `src/core/emailSource.ts`: expose raw selected Excel attachment download without changing existing local/direct extraction behavior.
- Create `src/main/gatewayServices.ts`: bind Electron `safeStorage`, `app.setLoginItemSettings`, notifications, and the gateway runtime.
- Create `src/main/trayController.ts` and `src/main/windowLifecycle.ts`: tray state/actions, close-to-tray, and explicit exit.
- Modify `src/main/main.ts`, `src/main/ipcHandlers.ts`, and `src/preload/preload.cts`: gateway lifecycle and renderer bridge.

### Desktop clients and UI

- Modify `src/core/remoteEmailApi.ts`: credential-free cached list, asynchronous extraction jobs, SSE status, polling fallback, and workbook download.
- Modify `src/main/emailActions.ts`: remote service is the only email-list/job path; local-file extraction remains local.
- Create `src/renderer/gatewayViewState.ts`: pure online/offline/stale/job presentation rules.
- Modify `src/renderer/app.tsx` and `src/renderer/styles.css`: shared list without mailbox credentials, gateway banner, job states, result download, and opt-in office gateway setup.

### Packaging, deployment, and migration

- Modify `package.json`, both lockfiles, `services/orderflow-email-api/package.json`, `services/orderflow-email-api/Dockerfile`, `.github/workflows/release.yml`, and `scripts/write-remote-email-api-config.mjs`.
- Create `services/orderflow-email-api/compose.production.yml`, `deploy/nginx/orderflow.ausmet.ai.conf`, and `deploy/systemd/orderflow-email-api.service`.
- Replace `services/orderflow-email-api/README.md` and `docs/email-api-server.md` with the gateway deployment/runbook.
- Delete the legacy root service `src/server/` and remove root `serve:email-api`; the standalone service becomes the only server implementation.
- Remove `scripts/server/mihomo_imap_node_keeper.py`, `tests/test_mihomo_imap_node_keeper.py`, and `deploy/systemd/mihomo-imap-node-keeper.*` only after the 24-hour migration gate.

---

### Task 1: Freeze the cross-process gateway protocol

**Files:**
- Create: `src/shared/gatewayProtocol.ts`
- Create: `services/orderflow-email-api/src/shared/gatewayProtocol.ts`
- Create: `src/shared/gatewayProtocol.test.ts`

**Interfaces:**
- Consumes: `EmailMessageSummary`, `EmailListResult`, and `ExtractionResult` from each package's `shared/types.ts`.
- Produces: `GatewayStatus`, `GatewayEmailListResult`, `GatewayMessageSyncRequest`, `CreateExtractionJobRequest`, `ExtractionJobView`, `GatewayJobResultUpload`, `AgentToServerFrame`, `ServerToAgentFrame`, and `GatewaySseEvent` with the exact definitions below.

- [ ] **Step 1: Write the failing contract and parity tests**

```typescript
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { GATEWAY_JOB_STATES, isTerminalGatewayJobState } from "./gatewayProtocol.js";

describe("gateway protocol", () => {
  test("has one exhaustive ordered job-state vocabulary", () => {
    expect(GATEWAY_JOB_STATES).toEqual(["queued", "dispatched", "running", "completed", "failed", "expired"]);
    expect(GATEWAY_JOB_STATES.filter(isTerminalGatewayJobState)).toEqual(["completed", "failed", "expired"]);
  });

  test("keeps desktop and standalone service contracts byte-identical", async () => {
    const desktop = await readFile(path.resolve("src/shared/gatewayProtocol.ts"), "utf8");
    const service = await readFile(path.resolve("services/orderflow-email-api/src/shared/gatewayProtocol.ts"), "utf8");
    expect(service).toBe(desktop);
  });
});
```

- [ ] **Step 2: Run the test and confirm the missing module failure**

Run: `npm test -- src/shared/gatewayProtocol.test.ts`

Expected: FAIL with `Cannot find module './gatewayProtocol.js'`.

- [ ] **Step 3: Create both protocol files with identical complete content**

```typescript
import type { EmailListResult, EmailMessageSummary, ExtractionFailure, ExtractionResult } from "./types.js";

export const GATEWAY_JOB_STATES = ["queued", "dispatched", "running", "completed", "failed", "expired"] as const;
export type GatewayJobState = (typeof GATEWAY_JOB_STATES)[number];
export type GatewayRuntimeState = "stopped" | "reconnecting" | "connected" | "attention_required";

export interface GatewayStatus {
  state: "online" | "offline" | "attention_required";
  stale: boolean;
  connectedAt?: string;
  lastHeartbeatAt?: string;
  lastSyncAt?: string;
  version?: string;
}

export interface GatewayRuntimeStatus {
  state: GatewayRuntimeState;
  detail: string;
  lastSyncAt?: string;
  lastHeartbeatAt?: string;
}

export interface GatewayEmailListRequest {
  days?: number;
}

export interface GatewayEmailListResult extends EmailListResult {
  gateway: GatewayStatus;
}

export interface GatewayMessageSyncRequest {
  mailboxId: string;
  syncId: string;
  days: number;
  scannedMessages: number;
  capturedAt: string;
  cursorUid?: string;
  messages: EmailMessageSummary[];
}

export interface GatewayMessageSyncResponse {
  accepted: number;
  inserted: number;
  initialSync: boolean;
  lastSyncAt: string;
}

export interface GatewayHeartbeatRequest {
  mailboxId: string;
  version: string;
  runtimeState: Exclude<GatewayRuntimeState, "stopped">;
  sentAt: string;
}

export interface CreateExtractionJobRequest {
  messageUids: string[];
  inferManual?: boolean;
}

export interface GatewayJobResult {
  emailFetch: {
    scannedMessages: number;
    attachmentCount: number;
  };
  extraction: ExtractionResult;
  workbookUrl: string;
  checksum: string;
}

export interface ExtractionJobView {
  id: string;
  state: GatewayJobState;
  messageUids: string[];
  inferManual: boolean;
  requestedAt: string;
  updatedAt: string;
  expiresAt: string;
  error?: string;
  failures?: ExtractionFailure[];
  result?: GatewayJobResult;
}

export interface GatewayJobResultUpload {
  checksum: string;
  emailFetch: {
    scannedMessages: number;
    attachmentCount: number;
  };
  extraction: ExtractionResult;
  workbookBase64: string;
}

export interface GatewaySettingsView {
  enabled: boolean;
  email: string;
  serverUrl: string;
  startAtLogin: boolean;
  hasAuthCode: boolean;
  hasAgentToken: boolean;
}

export interface SaveGatewaySettingsInput {
  enabled: boolean;
  email: string;
  serverUrl: string;
  startAtLogin: boolean;
  authCode?: string;
  agentToken?: string;
}

export interface AgentReadyFrame {
  type: "ready";
  mailboxId: string;
  version: string;
}

export interface AgentJobAcceptedFrame {
  type: "job-accepted";
  jobId: string;
}

export interface AgentJobFailedFrame {
  type: "job-failed";
  jobId: string;
  error: string;
  failures: ExtractionFailure[];
}

export type AgentToServerFrame = AgentReadyFrame | AgentJobAcceptedFrame | AgentJobFailedFrame;

export interface AgentExtractCommand {
  type: "extract";
  jobId: string;
  messageUids: string[];
  inferManual: boolean;
}

export type ServerToAgentFrame = AgentExtractCommand;

export interface EmailNewMessagesEvent {
  mailboxId: string;
  days: number;
  messages: EmailMessageSummary[];
}

export interface GatewayStatusEvent {
  gateway: GatewayStatus;
}

export interface GatewayJobStatusEvent {
  job: ExtractionJobView;
}

export type GatewaySseEvent =
  | { type: "new-messages"; data: EmailNewMessagesEvent }
  | { type: "gateway-status"; data: GatewayStatusEvent }
  | { type: "job-status"; data: GatewayJobStatusEvent };

export function isTerminalGatewayJobState(state: GatewayJobState): boolean {
  return state === "completed" || state === "failed" || state === "expired";
}
```

Copy this block without edits to both files; the relative `./types.js` import is valid in both locations.

- [ ] **Step 4: Run the focused test and typecheck**

Run: `npm test -- src/shared/gatewayProtocol.test.ts && npm run typecheck`

Expected: the two tests PASS and TypeScript exits `0`.

- [ ] **Step 5: Commit only the protocol files**

```bash
git add src/shared/gatewayProtocol.ts src/shared/gatewayProtocol.test.ts services/orderflow-email-api/src/shared/gatewayProtocol.ts
git commit -m "feat: define office gateway protocol"
```

### Task 2: Replace mailbox configuration with broker configuration

**Files:**
- Modify: `services/orderflow-email-api/package.json`
- Modify: `services/orderflow-email-api/package-lock.json`
- Replace: `services/orderflow-email-api/src/server/emailApiConfig.ts`
- Replace: `services/orderflow-email-api/src/server/emailApiConfig.test.ts`

**Interfaces:**
- Consumes: environment variables supplied by Docker/systemd.
- Produces: `EmailApiConfig` with `clientToken`, `agentToken`, `databasePath`, `resultDir`, `offlineAfterMs`, `jobTtlMs`, `resultRetentionMs`, `bodyLimitBytes`, `host`, and `port`. No mailbox address, authorization code, IMAP host, port, or proxy exists server-side.

- [ ] **Step 1: Replace the config tests with broker-only expectations**

```typescript
import { describe, expect, test } from "vitest";
import { loadEmailApiConfig } from "./emailApiConfig.js";

describe("gateway API config", () => {
  test("loads separated tokens and exact timing defaults", () => {
    expect(loadEmailApiConfig({ EMAIL_API_TOKEN: " client ", GATEWAY_AGENT_TOKEN: " agent " })).toEqual({
      clientToken: "client",
      agentToken: "agent",
      host: "127.0.0.1",
      port: 8787,
      databasePath: "/data/orderflow.sqlite",
      resultDir: "/data/results",
      offlineAfterMs: 90_000,
      jobTtlMs: 900_000,
      resultRetentionMs: 604_800_000,
      bodyLimitBytes: 67_108_864,
    });
  });

  test("rejects absent or reused tokens", () => {
    expect(() => loadEmailApiConfig({})).toThrow("EMAIL_API_TOKEN");
    expect(() => loadEmailApiConfig({ EMAIL_API_TOKEN: "same", GATEWAY_AGENT_TOKEN: "same" })).toThrow(
      "GATEWAY_AGENT_TOKEN must differ from EMAIL_API_TOKEN",
    );
  });

  test("ignores legacy mailbox variables because the server must never consume them", () => {
    const config = loadEmailApiConfig({
      EMAIL_API_TOKEN: "client",
      GATEWAY_AGENT_TOKEN: "agent",
      EMAIL_ACCOUNT: "orders@example.com",
      EMAIL_AUTH_CODE: "must-not-be-read",
    });
    expect(Object.keys(config)).not.toContain("email");
    expect(Object.keys(config)).not.toContain("authCode");
  });
});
```

- [ ] **Step 2: Run the config test and confirm it fails against the old mailbox config**

Run: `npm test -- services/orderflow-email-api/src/server/emailApiConfig.test.ts`

Expected: FAIL because `GATEWAY_AGENT_TOKEN` and the broker fields are not implemented.

- [ ] **Step 3: Replace `emailApiConfig.ts` with the complete broker configuration loader**

```typescript
export interface EmailApiConfig {
  clientToken: string;
  agentToken: string;
  host: string;
  port: number;
  databasePath: string;
  resultDir: string;
  offlineAfterMs: number;
  jobTtlMs: number;
  resultRetentionMs: number;
  bodyLimitBytes: number;
}

type EnvLike = Record<string, string | undefined>;

export function loadEmailApiConfig(env: EnvLike = process.env): EmailApiConfig {
  const clientToken = required(env, "EMAIL_API_TOKEN");
  const agentToken = required(env, "GATEWAY_AGENT_TOKEN");
  if (clientToken === agentToken) {
    throw new Error("GATEWAY_AGENT_TOKEN must differ from EMAIL_API_TOKEN");
  }
  return {
    clientToken,
    agentToken,
    host: text(env, "EMAIL_API_HOST", "127.0.0.1"),
    port: integer(env, "EMAIL_API_PORT", 8787, 1, 65_535),
    databasePath: text(env, "EMAIL_API_DB_PATH", "/data/orderflow.sqlite"),
    resultDir: text(env, "EMAIL_API_RESULT_DIR", "/data/results"),
    offlineAfterMs: integer(env, "GATEWAY_OFFLINE_AFTER_SECONDS", 90, 1, 86_400) * 1_000,
    jobTtlMs: integer(env, "GATEWAY_JOB_TTL_SECONDS", 900, 1, 86_400) * 1_000,
    resultRetentionMs: integer(env, "GATEWAY_RESULT_RETENTION_DAYS", 7, 1, 365) * 86_400_000,
    bodyLimitBytes: integer(env, "EMAIL_API_BODY_LIMIT_MB", 64, 1, 256) * 1_048_576,
  };
}

function required(env: EnvLike, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`缺少服务配置：${name}`);
  return value;
}

function text(env: EnvLike, name: string, fallback: string): string {
  return env[name]?.trim() || fallback;
}

function integer(env: EnvLike, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`无效整数配置：${name}`);
  return value;
}
```

- [ ] **Step 4: Add standalone service test/runtime dependencies**

Change the scripts and dependency sections to:

```json
{
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server/main.js",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "imapflow": "^1.2.1",
    "ws": "^8.18.3"
  },
  "devDependencies": {
    "@types/node": "^24.10.1",
    "@types/ws": "^8.18.1",
    "typescript": "^5.9.3",
    "vitest": "^4.0.14"
  }
}
```

Run: `npm install --prefix services/orderflow-email-api`

Expected: `services/orderflow-email-api/package-lock.json` updates without native SQLite packages.

Keep `imapflow` temporarily because the old standalone `src/core` files are still included by TypeScript at this checkpoint; Task 16 deletes that obsolete core and removes the dependency.

- [ ] **Step 5: Run config tests and standalone typecheck**

Run: `npm test -- services/orderflow-email-api/src/server/emailApiConfig.test.ts && npm --prefix services/orderflow-email-api run typecheck`

Expected: config tests PASS and typecheck exits `0`.

- [ ] **Step 6: Commit configuration and dependency changes**

```bash
git add services/orderflow-email-api/package.json services/orderflow-email-api/package-lock.json services/orderflow-email-api/src/server/emailApiConfig.ts services/orderflow-email-api/src/server/emailApiConfig.test.ts
git commit -m "refactor: configure email service as gateway broker"
```

### Task 3: Add the SQLite WAL store and legal job state machine

**Files:**
- Create: `services/orderflow-email-api/src/server/gatewayStateMachine.ts`
- Create: `services/orderflow-email-api/src/server/gatewayStateMachine.test.ts`
- Create: `services/orderflow-email-api/src/server/gatewayStore.ts`
- Create: `services/orderflow-email-api/src/server/gatewayStore.test.ts`

**Interfaces:**
- Consumes: protocol requests and job states from `../shared/gatewayProtocol.ts`.
- Produces: `openGatewayStore(options): Promise<GatewayStore>` and methods `syncMessages`, `listMessages`, `recordHeartbeat`, `getGatewayStatus`, `createJob`, `listDispatchableJobs`, `transitionJob`, `failJob`, `completeJob`, `expireQueuedJobs`, `deleteExpiredResults`, and `close`.

- [ ] **Step 1: Write state-transition tests**

```typescript
import { describe, expect, test } from "vitest";
import { assertGatewayJobTransition } from "./gatewayStateMachine.js";

describe("gateway job state machine", () => {
  test.each([
    ["queued", "dispatched"], ["queued", "expired"], ["dispatched", "running"],
    ["dispatched", "queued"], ["dispatched", "failed"], ["running", "completed"], ["running", "failed"],
  ] as const)("allows %s -> %s", (from, to) => expect(() => assertGatewayJobTransition(from, to)).not.toThrow());

  test.each([
    ["queued", "completed"], ["running", "queued"], ["completed", "running"], ["failed", "queued"], ["expired", "dispatched"],
  ] as const)("rejects %s -> %s", (from, to) => expect(() => assertGatewayJobTransition(from, to)).toThrow("Illegal gateway job transition"));
});
```

- [ ] **Step 2: Write store tests for idempotency, status, expiration, and duplicate results**

```typescript
import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { openGatewayStore, type GatewayStore } from "./gatewayStore.js";

let store: GatewayStore | undefined;
afterEach(() => store?.close());

describe("gateway SQLite store", () => {
  test("uses WAL and idempotently synchronizes mailboxId plus uid", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gateway-store-"));
    store = await openGatewayStore({ databasePath: path.join(root, "db.sqlite"), resultDir: path.join(root, "results"), offlineAfterMs: 90_000, jobTtlMs: 900_000, resultRetentionMs: 604_800_000, now: () => Date.parse("2026-07-10T01:00:00Z") });
    const input = { mailboxId: "mailbox-hash", syncId: "sync-1", days: 7, scannedMessages: 2, capturedAt: "2026-07-10T01:00:00Z", messages: [{ uid: "101", subject: "PO 101", attachmentCount: 1, excelAttachmentNames: ["order.xlsx"], hasExcelAttachments: true }] };
    expect(store.syncMessages(input)).toMatchObject({ inserted: 1, initialSync: true });
    expect(store.syncMessages({ ...input, syncId: "sync-2" })).toMatchObject({ inserted: 0, initialSync: false });
    expect(store.listMessages(7).messages.map((message) => message.uid)).toEqual(["101"]);
    expect(store.journalMode()).toBe("wal");
  });

  test("reports offline at 90 seconds and expires queued work at 15 minutes", async () => {
    let now = Date.parse("2026-07-10T01:00:00Z");
    const root = await mkdtemp(path.join(os.tmpdir(), "gateway-clock-"));
    store = await openGatewayStore({ databasePath: path.join(root, "db.sqlite"), resultDir: path.join(root, "results"), offlineAfterMs: 90_000, jobTtlMs: 900_000, resultRetentionMs: 604_800_000, now: () => now });
    store.recordHeartbeat({ mailboxId: "mailbox-hash", version: "build-1", runtimeState: "connected", sentAt: new Date(now).toISOString() });
    const job = store.createJob({ messageUids: ["101"], inferManual: true });
    expect(store.getGatewayStatus().state).toBe("online");
    now += 90_001;
    expect(store.getGatewayStatus()).toMatchObject({ state: "offline", stale: true });
    now += 810_000;
    expect(store.expireQueuedJobs()).toBe(1);
    expect(store.getJob(job.id)?.state).toBe("expired");
  });

  test("keeps heartbeat fresh but marks cache stale when mailbox credentials need attention", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gateway-attention-"));
    store = await openGatewayStore({ databasePath: path.join(root, "db.sqlite"), resultDir: path.join(root, "results"), offlineAfterMs: 90_000, jobTtlMs: 900_000, resultRetentionMs: 604_800_000 });
    store.recordHeartbeat({ mailboxId: "mailbox-hash", version: "build-1", runtimeState: "attention_required", sentAt: new Date().toISOString() });
    expect(store.getGatewayStatus()).toMatchObject({ state: "attention_required", stale: true });
  });

  test("accepts the same checksum twice and rejects a conflicting completed result", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gateway-result-"));
    store = await openGatewayStore({ databasePath: path.join(root, "db.sqlite"), resultDir: path.join(root, "results"), offlineAfterMs: 90_000, jobTtlMs: 900_000, resultRetentionMs: 604_800_000 });
    const job = store.createJob({ messageUids: ["101"], inferManual: true });
    store.transitionJob(job.id, "dispatched");
    store.transitionJob(job.id, "running");
    const checksum = createHash("sha256").update(Buffer.from("xlsx")).digest("hex");
    const upload = { checksum, emailFetch: { scannedMessages: 1, attachmentCount: 1 }, extraction: { inputFiles: ["order.xlsx"], rows: [], skippedFiles: [], failures: [], outputs: { outputDir: "", csvOutput: "", xlsxOutput: "", auditOutput: "" } }, workbookBase64: Buffer.from("xlsx").toString("base64") };
    expect((await store.completeJob(job.id, upload)).state).toBe("completed");
    expect((await store.completeJob(job.id, upload)).state).toBe("completed");
    await expect(store.completeJob(job.id, { ...upload, checksum: "0".repeat(64) })).rejects.toThrow("checksum conflict");
    await expect(readFile(store.resultPath(job.id))).resolves.toEqual(Buffer.from("xlsx"));
  });

  test("persists sanitized extraction failure details", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gateway-failure-"));
    store = await openGatewayStore({ databasePath: path.join(root, "db.sqlite"), resultDir: path.join(root, "results"), offlineAfterMs: 90_000, jobTtlMs: 900_000, resultRetentionMs: 604_800_000 });
    const job = store.createJob({ messageUids: ["101"], inferManual: true }); store.transitionJob(job.id, "dispatched"); store.transitionJob(job.id, "running");
    const failed = store.failJob(job.id, "Python extraction failed", [{ path: "order.xlsx", error: "Invalid workbook" }]);
    expect(failed).toMatchObject({ state: "failed", failures: [{ path: "order.xlsx", error: "Invalid workbook" }] });
  });

  test("deletes completed workbook bytes after seven days", async () => {
    let now = Date.parse("2026-07-10T00:00:00Z"); const root = await mkdtemp(path.join(os.tmpdir(), "gateway-retention-"));
    store = await openGatewayStore({ databasePath: path.join(root, "db.sqlite"), resultDir: path.join(root, "results"), offlineAfterMs: 90_000, jobTtlMs: 900_000, resultRetentionMs: 604_800_000, now: () => now });
    const job = store.createJob({ messageUids: ["101"], inferManual: true }); store.transitionJob(job.id, "dispatched"); store.transitionJob(job.id, "running"); const bytes = Buffer.from("xlsx");
    await store.completeJob(job.id, { checksum: createHash("sha256").update(bytes).digest("hex"), emailFetch: { scannedMessages: 1, attachmentCount: 1 }, extraction: { inputFiles: [], rows: [], skippedFiles: [], failures: [], outputs: { outputDir: "", csvOutput: "", xlsxOutput: "", auditOutput: "" } }, workbookBase64: bytes.toString("base64") });
    now += 604_800_001; expect(await store.deleteExpiredResults()).toBe(1); await expect(readFile(store.resultPath(job.id))).rejects.toThrow(); expect(store.getJob(job.id)?.result).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run the tests and confirm both modules are missing**

Run: `npm test -- services/orderflow-email-api/src/server/gatewayStateMachine.test.ts services/orderflow-email-api/src/server/gatewayStore.test.ts`

Expected: FAIL with missing `gatewayStateMachine.js` and `gatewayStore.js`.

- [ ] **Step 4: Implement the state machine exactly**

```typescript
import type { GatewayJobState } from "../shared/gatewayProtocol.js";

const NEXT: Record<GatewayJobState, ReadonlySet<GatewayJobState>> = {
  queued: new Set(["dispatched", "expired"]),
  dispatched: new Set(["queued", "running", "failed"]),
  running: new Set(["completed", "failed"]),
  completed: new Set(),
  failed: new Set(),
  expired: new Set(),
};

export function assertGatewayJobTransition(from: GatewayJobState, to: GatewayJobState): void {
  if (!NEXT[from].has(to)) throw new Error(`Illegal gateway job transition: ${from} -> ${to}`);
}
```

- [ ] **Step 5: Implement `gatewayStore.ts` with the following complete public surface and schema**

```typescript
import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { EmailMessageSummary } from "../shared/types.js";
import type { CreateExtractionJobRequest, ExtractionJobView, GatewayEmailListResult, GatewayHeartbeatRequest, GatewayJobResultUpload, GatewayMessageSyncRequest, GatewayMessageSyncResponse, GatewayStatus, GatewayJobState } from "../shared/gatewayProtocol.js";
import { assertGatewayJobTransition } from "./gatewayStateMachine.js";

export interface GatewayStoreOptions { databasePath: string; resultDir: string; offlineAfterMs: number; jobTtlMs: number; resultRetentionMs: number; now?: () => number; }
export interface GatewayStore {
  syncMessages(input: GatewayMessageSyncRequest): GatewayMessageSyncResponse;
  claimPendingNotifications(mailboxId: string): EmailMessageSummary[];
  listMessages(days: number): GatewayEmailListResult;
  recordHeartbeat(input: GatewayHeartbeatRequest): GatewayStatus;
  markAgentConnected(version: string): GatewayStatus;
  markAgentDisconnected(): GatewayStatus;
  getGatewayStatus(): GatewayStatus;
  createJob(input: CreateExtractionJobRequest): ExtractionJobView;
  getJob(id: string): ExtractionJobView | undefined;
  listDispatchableJobs(): ExtractionJobView[];
  transitionJob(id: string, state: GatewayJobState, error?: string): ExtractionJobView;
  failJob(id: string, error: string, failures: Array<{ path: string; error: string }>): ExtractionJobView;
  completeJob(id: string, upload: GatewayJobResultUpload): Promise<ExtractionJobView>;
  expireQueuedJobs(): number;
  deleteExpiredResults(): Promise<number>;
  resultPath(id: string): string;
  journalMode(): string;
  close(): void;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS messages(mailbox_id TEXT NOT NULL, uid TEXT NOT NULL, subject TEXT NOT NULL, sender TEXT, received_at TEXT, attachment_count INTEGER NOT NULL, attachment_names_json TEXT NOT NULL, has_excel INTEGER NOT NULL, first_seen_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, PRIMARY KEY(mailbox_id, uid));
CREATE TABLE IF NOT EXISTS sync_state(mailbox_id TEXT PRIMARY KEY, sync_id TEXT NOT NULL, last_sync_at INTEGER NOT NULL, scanned_messages INTEGER NOT NULL, days INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS notification_state(mailbox_id TEXT NOT NULL, uid TEXT NOT NULL, emitted_at INTEGER NOT NULL, PRIMARY KEY(mailbox_id, uid));
CREATE TABLE IF NOT EXISTS gateway_state(singleton INTEGER PRIMARY KEY CHECK(singleton=1), connected INTEGER NOT NULL DEFAULT 0, connected_at INTEGER, last_heartbeat_at INTEGER, last_sync_at INTEGER, version TEXT, runtime_state TEXT);
INSERT OR IGNORE INTO gateway_state(singleton, connected, runtime_state) VALUES(1, 0, 'reconnecting');
CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, state TEXT NOT NULL, message_uids_json TEXT NOT NULL, infer_manual INTEGER NOT NULL, requested_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, error TEXT, failures_json TEXT, result_json TEXT, result_path TEXT, result_checksum TEXT, completed_at INTEGER);
CREATE INDEX IF NOT EXISTS jobs_state_expires_idx ON jobs(state, expires_at);
`;

export async function openGatewayStore(options: GatewayStoreOptions): Promise<GatewayStore> {
  await mkdir(path.dirname(options.databasePath), { recursive: true });
  await mkdir(options.resultDir, { recursive: true });
  const db = new DatabaseSync(options.databasePath);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  db.exec(SCHEMA);
  return new SqliteGatewayStore(db, options);
}

class SqliteGatewayStore implements GatewayStore {
  private readonly now: () => number;
  constructor(private readonly db: DatabaseSync, private readonly options: GatewayStoreOptions) { this.now = options.now ?? Date.now; }

  journalMode(): string { return String((this.db.prepare("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode).toLowerCase(); }
  resultPath(id: string): string { return path.join(this.options.resultDir, `${id}.xlsx`); }
  close(): void { this.db.close(); }

  syncMessages(input: GatewayMessageSyncRequest): GatewayMessageSyncResponse {
    const now = this.now();
    const previous = this.db.prepare("SELECT 1 FROM sync_state WHERE mailbox_id=?").get(input.mailboxId);
    let inserted = 0;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const message of input.messages) {
        const result = this.db.prepare("INSERT OR IGNORE INTO messages VALUES(?,?,?,?,?,?,?,?,?,?)").run(input.mailboxId, message.uid, message.subject, message.from ?? null, message.date ?? null, message.attachmentCount, JSON.stringify(message.excelAttachmentNames), message.hasExcelAttachments ? 1 : 0, now, now);
        inserted += Number(result.changes);
        this.db.prepare("UPDATE messages SET subject=?,sender=?,received_at=?,attachment_count=?,attachment_names_json=?,has_excel=?,last_seen_at=? WHERE mailbox_id=? AND uid=?").run(message.subject, message.from ?? null, message.date ?? null, message.attachmentCount, JSON.stringify(message.excelAttachmentNames), message.hasExcelAttachments ? 1 : 0, now, input.mailboxId, message.uid);
        if (!previous) this.db.prepare("INSERT OR IGNORE INTO notification_state VALUES(?,?,?)").run(input.mailboxId, message.uid, now);
      }
      this.db.prepare("INSERT INTO sync_state VALUES(?,?,?,?,?) ON CONFLICT(mailbox_id) DO UPDATE SET sync_id=excluded.sync_id,last_sync_at=excluded.last_sync_at,scanned_messages=excluded.scanned_messages,days=excluded.days").run(input.mailboxId, input.syncId, now, input.scannedMessages, input.days);
      this.db.prepare("UPDATE gateway_state SET last_sync_at=? WHERE singleton=1").run(now);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return { accepted: input.messages.length, inserted, initialSync: !previous, lastSyncAt: new Date(now).toISOString() };
  }

  claimPendingNotifications(mailboxId: string): EmailMessageSummary[] {
    const rows = this.db.prepare("SELECT m.* FROM messages m LEFT JOIN notification_state n ON n.mailbox_id=m.mailbox_id AND n.uid=m.uid WHERE m.mailbox_id=? AND n.uid IS NULL ORDER BY m.received_at DESC").all(mailboxId) as MessageRow[];
    const now = this.now();
    for (const row of rows) this.db.prepare("INSERT OR IGNORE INTO notification_state VALUES(?,?,?)").run(mailboxId, row.uid, now);
    return rows.map(messageFromRow);
  }

  listMessages(days: number): GatewayEmailListResult {
    const cutoff = new Date(this.now() - days * 86_400_000).toISOString();
    const sync = this.db.prepare("SELECT mailbox_id,scanned_messages FROM sync_state ORDER BY last_sync_at DESC LIMIT 1").get() as { mailbox_id: string; scanned_messages: number } | undefined;
    const rows = sync ? this.db.prepare("SELECT * FROM messages WHERE mailbox_id=? AND (received_at IS NULL OR received_at>=?) ORDER BY received_at DESC").all(sync.mailbox_id, cutoff) as MessageRow[] : [];
    return { days, scannedMessages: sync?.scanned_messages ?? 0, orderAttachmentCount: rows.reduce((sum, row) => sum + row.attachment_count, 0), nonOrderExcelAttachmentCount: 0, messages: rows.map(messageFromRow), gateway: this.getGatewayStatus() };
  }

  recordHeartbeat(input: GatewayHeartbeatRequest): GatewayStatus {
    const now = this.now();
    this.db.prepare("UPDATE gateway_state SET connected=1,connected_at=COALESCE(connected_at,?),last_heartbeat_at=?,version=?,runtime_state=? WHERE singleton=1").run(now, now, input.version, input.runtimeState);
    return this.getGatewayStatus();
  }
  markAgentConnected(version: string): GatewayStatus { const now = this.now(); this.db.prepare("UPDATE gateway_state SET connected=1,connected_at=?,version=? WHERE singleton=1").run(now, version); return this.getGatewayStatus(); }
  markAgentDisconnected(): GatewayStatus { this.db.prepare("UPDATE gateway_state SET connected=0 WHERE singleton=1").run(); return this.getGatewayStatus(); }
  getGatewayStatus(): GatewayStatus {
    const row = this.db.prepare("SELECT * FROM gateway_state WHERE singleton=1").get() as GatewayRow;
    const online = row.connected === 1 && row.last_heartbeat_at !== null && this.now() - row.last_heartbeat_at < this.options.offlineAfterMs;
    const state = !online ? "offline" : row.runtime_state === "attention_required" ? "attention_required" : row.runtime_state === "connected" ? "online" : "offline";
    return { state, stale: state !== "online" || row.last_sync_at === null, connectedAt: iso(row.connected_at), lastHeartbeatAt: iso(row.last_heartbeat_at), lastSyncAt: iso(row.last_sync_at), version: row.version ?? undefined };
  }

  createJob(input: CreateExtractionJobRequest): ExtractionJobView {
    const now = this.now(); const id = randomUUID(); const uids = [...new Set(input.messageUids.map((uid) => uid.trim()).filter(Boolean))];
    if (uids.length === 0) throw new Error("messageUids must contain at least one UID");
    this.db.prepare("INSERT INTO jobs(id,state,message_uids_json,infer_manual,requested_at,updated_at,expires_at) VALUES(?,?,?,?,?,?,?)").run(id, "queued", JSON.stringify(uids), input.inferManual === false ? 0 : 1, now, now, now + this.options.jobTtlMs);
    return this.getJob(id)!;
  }
  getJob(id: string): ExtractionJobView | undefined { const row = this.db.prepare("SELECT * FROM jobs WHERE id=?").get(id) as JobRow | undefined; return row ? jobFromRow(row) : undefined; }
  listDispatchableJobs(): ExtractionJobView[] { return (this.db.prepare("SELECT * FROM jobs WHERE state='queued' AND expires_at>? ORDER BY requested_at").all(this.now()) as JobRow[]).map(jobFromRow); }
  transitionJob(id: string, state: GatewayJobState, error?: string): ExtractionJobView {
    const current = this.getJob(id); if (!current) throw new Error("job not found"); assertGatewayJobTransition(current.state, state);
    this.db.prepare("UPDATE jobs SET state=?,updated_at=?,error=? WHERE id=?").run(state, this.now(), error ?? null, id); return this.getJob(id)!;
  }
  failJob(id: string, error: string, failures: Array<{ path: string; error: string }>): ExtractionJobView { const current = this.getJob(id); if (!current) throw new Error("job not found"); assertGatewayJobTransition(current.state, "failed"); const safe = failures.slice(0, 100).map((failure) => ({ path: path.win32.basename(path.posix.basename(failure.path)).slice(0, 255), error: redactAgentError(failure.error) })); this.db.prepare("UPDATE jobs SET state='failed',updated_at=?,error=?,failures_json=? WHERE id=?").run(this.now(), redactAgentError(error), JSON.stringify(safe), id); return this.getJob(id)!; }
  async completeJob(id: string, upload: GatewayJobResultUpload): Promise<ExtractionJobView> {
    const current = this.getJob(id); if (!current) throw new Error("job not found");
    const row = this.db.prepare("SELECT result_checksum FROM jobs WHERE id=?").get(id) as { result_checksum: string | null };
    if (current.state === "completed") { if (row.result_checksum !== upload.checksum) throw new Error("result checksum conflict"); return current; }
    if (current.state !== "running") throw new Error(`job ${id} is not running`);
    const bytes = Buffer.from(upload.workbookBase64, "base64");
    if (createHash("sha256").update(bytes).digest("hex") !== upload.checksum) throw new Error("result checksum mismatch");
    const finalPath = this.resultPath(id); const temporaryPath = `${finalPath}.tmp`; await writeFile(temporaryPath, bytes); await rename(temporaryPath, finalPath);
    const now = this.now();
    this.db.prepare("UPDATE jobs SET state='completed',updated_at=?,completed_at=?,result_json=?,result_path=?,result_checksum=? WHERE id=?").run(now, now, JSON.stringify({ emailFetch: upload.emailFetch, extraction: upload.extraction }), finalPath, upload.checksum, id);
    return this.getJob(id)!;
  }
  expireQueuedJobs(): number { const now = this.now(); return Number(this.db.prepare("UPDATE jobs SET state='expired',updated_at=?,error='Gateway offline for more than 15 minutes' WHERE state='queued' AND expires_at<=?").run(now, now).changes); }
  async deleteExpiredResults(): Promise<number> { const cutoff = this.now() - this.options.resultRetentionMs; const rows = this.db.prepare("SELECT id,result_path FROM jobs WHERE state='completed' AND completed_at<? AND result_path IS NOT NULL").all(cutoff) as Array<{ id: string; result_path: string }>; for (const row of rows) { await rm(row.result_path, { force: true }); this.db.prepare("UPDATE jobs SET result_path=NULL,result_json=NULL WHERE id=?").run(row.id); } return rows.length; }
}

interface MessageRow { uid: string; subject: string; sender: string | null; received_at: string | null; attachment_count: number; attachment_names_json: string; has_excel: number; }
interface GatewayRow { connected: number; connected_at: number | null; last_heartbeat_at: number | null; last_sync_at: number | null; version: string | null; runtime_state: string | null; }
interface JobRow { id: string; state: GatewayJobState; message_uids_json: string; infer_manual: number; requested_at: number; updated_at: number; expires_at: number; error: string | null; failures_json: string | null; result_json: string | null; result_checksum: string | null; }
function iso(value: number | null): string | undefined { return value === null ? undefined : new Date(value).toISOString(); }
function redactAgentError(value: string): string { return value.replace(/[\r\n]+/g, " ").replace(/[A-Za-z]:\\[^ ]+|\/Users\/[^ ]+/g, "[local-path]").slice(0, 500); }
function messageFromRow(row: MessageRow): EmailMessageSummary { return { uid: row.uid, subject: row.subject, from: row.sender ?? undefined, date: row.received_at ?? undefined, attachmentCount: row.attachment_count, excelAttachmentNames: JSON.parse(row.attachment_names_json) as string[], hasExcelAttachments: row.has_excel === 1 }; }
function jobFromRow(row: JobRow): ExtractionJobView { const stored = row.result_json ? JSON.parse(row.result_json) as Omit<NonNullable<ExtractionJobView["result"]>, "workbookUrl" | "checksum"> : undefined; return { id: row.id, state: row.state, messageUids: JSON.parse(row.message_uids_json) as string[], inferManual: row.infer_manual === 1, requestedAt: new Date(row.requested_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(), expiresAt: new Date(row.expires_at).toISOString(), error: row.error ?? undefined, failures: row.failures_json ? JSON.parse(row.failures_json) as Array<{ path: string; error: string }> : undefined, result: stored && row.result_checksum ? { ...stored, workbookUrl: `/api/email/jobs/${row.id}/workbook`, checksum: row.result_checksum } : undefined }; }
```

- [ ] **Step 6: Run the store tests and service typecheck**

Run: `npm test -- services/orderflow-email-api/src/server/gatewayStateMachine.test.ts services/orderflow-email-api/src/server/gatewayStore.test.ts && npm --prefix services/orderflow-email-api run typecheck`

Expected: all store/state tests PASS and typecheck exits `0`.

- [ ] **Step 7: Commit the persistence layer**

```bash
git add services/orderflow-email-api/src/server/gatewayStateMachine.ts services/orderflow-email-api/src/server/gatewayStateMachine.test.ts services/orderflow-email-api/src/server/gatewayStore.ts services/orderflow-email-api/src/server/gatewayStore.test.ts
git commit -m "feat: persist gateway messages and jobs in sqlite"
```

### Task 4: Authenticate the agent WebSocket and dispatch queued jobs

**Files:**
- Create: `services/orderflow-email-api/src/server/agentConnectionHub.ts`
- Create: `services/orderflow-email-api/src/server/agentConnectionHub.test.ts`
- Create: `services/orderflow-email-api/src/server/jobDispatcher.ts`
- Create: `services/orderflow-email-api/src/server/jobDispatcher.test.ts`
- Modify: `services/orderflow-email-api/src/server/gatewayStore.ts`

**Interfaces:**
- Consumes: `GatewayStore`, `AgentToServerFrame`, `ServerToAgentFrame`, and the dedicated agent bearer token.
- Produces: `AgentConnectionHub`, `attachAgentWebSocket(server, hub, token)`, and `JobDispatcher.dispatchQueued()`. At most one agent is active; replacing or losing it requeues only `dispatched` jobs, while `running` jobs remain owned by the gateway's durable local state.

- [ ] **Step 1: Add the dispatched-job recovery method to the store contract and implementation**

Add to `GatewayStore`:

```typescript
requeueDispatchedJobs(): number;
```

Add to `SqliteGatewayStore`:

```typescript
requeueDispatchedJobs(): number {
  const now = this.now();
  return Number(
    this.db.prepare("UPDATE jobs SET state='queued',updated_at=? WHERE state='dispatched'").run(now).changes,
  );
}
```

Add this assertion to `gatewayStore.test.ts`:

```typescript
const redispatched = store.createJob({ messageUids: ["102"], inferManual: true });
store.transitionJob(redispatched.id, "dispatched");
expect(store.requeueDispatchedJobs()).toBe(1);
expect(store.getJob(redispatched.id)?.state).toBe("queued");
```

- [ ] **Step 2: Write WebSocket authentication and replacement tests**

```typescript
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, test, vi } from "vitest";
import WebSocket from "ws";
import { AgentConnectionHub, attachAgentWebSocket } from "./agentConnectionHub.js";

let server: Server | undefined;
afterEach(async () => { if (server?.listening) await new Promise<void>((resolve) => server!.close(() => resolve())); server = undefined; });

describe("agent WebSocket", () => {
  test("rejects client tokens and accepts only the agent token", async () => {
    server = createServer();
    const hub = new AgentConnectionHub();
    attachAgentWebSocket(server, hub, "agent-secret");
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    await expect(open(`ws://127.0.0.1:${port}/api/agent/connect`, "client-secret")).rejects.toThrow("401");
    const socket = await open(`ws://127.0.0.1:${port}/api/agent/connect`, "agent-secret");
    expect(hub.connected).toBe(true);
    socket.close();
  });

  test("closes the old connection when one replacement gateway connects", async () => {
    const first = fakeSocket();
    const second = fakeSocket();
    const hub = new AgentConnectionHub();
    hub.accept(first.socket);
    hub.accept(second.socket);
    expect(first.close).toHaveBeenCalledWith(4000, "Gateway replaced");
    expect(hub.connected).toBe(true);
  });
});

function open(url: string, token: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers: { Authorization: `Bearer ${token}` } });
    socket.once("open", () => resolve(socket));
    socket.once("unexpected-response", (_request, response) => reject(new Error(String(response.statusCode))));
    socket.once("error", reject);
  });
}

function fakeSocket() {
  const listeners = new Map<string, (...args: any[]) => void>();
  const close = vi.fn();
  return { close, socket: { readyState: WebSocket.OPEN, send: vi.fn(), close, on: vi.fn((name: string, fn: (...args: any[]) => void) => { listeners.set(name, fn); }) } };
}
```

- [ ] **Step 3: Write dispatcher tests for persist-before-running and reconnect replay**

```typescript
import { describe, expect, test, vi } from "vitest";
import { JobDispatcher } from "./jobDispatcher.js";

test("dispatches queued jobs and moves them to running only after agent acceptance", () => {
  const job = { id: "job-1", state: "queued", messageUids: ["101"], inferManual: true, requestedAt: "2026-07-10T00:00:00Z", updatedAt: "2026-07-10T00:00:00Z", expiresAt: "2026-07-10T00:15:00Z" } as const;
  const store = { listDispatchableJobs: vi.fn(() => [job]), transitionJob: vi.fn((_id, state) => ({ ...job, state })), failJob: vi.fn(), requeueDispatchedJobs: vi.fn(() => 1) };
  const hub = { connected: true, send: vi.fn(() => true), setFrameHandler: vi.fn(), setConnectionHandler: vi.fn() };
  const broadcastJob = vi.fn();
  const dispatcher = new JobDispatcher(store as any, hub as any, broadcastJob);
  dispatcher.dispatchQueued();
  expect(hub.send).toHaveBeenCalledWith({ type: "extract", jobId: "job-1", messageUids: ["101"], inferManual: true });
  expect(store.transitionJob).toHaveBeenCalledWith("job-1", "dispatched");
  dispatcher.handleFrame({ type: "job-accepted", jobId: "job-1" });
  expect(store.transitionJob).toHaveBeenCalledWith("job-1", "running");
  dispatcher.handleFrame({ type: "job-failed", jobId: "job-1", error: "Invalid workbook", failures: [{ path: "order.xlsx", error: "Invalid workbook" }] });
  expect(store.failJob).toHaveBeenCalledWith("job-1", "Invalid workbook", [{ path: "order.xlsx", error: "Invalid workbook" }]);
});
```

- [ ] **Step 4: Run the focused tests and confirm the modules are missing**

Run: `npm test -- services/orderflow-email-api/src/server/agentConnectionHub.test.ts services/orderflow-email-api/src/server/jobDispatcher.test.ts`

Expected: FAIL with missing implementation modules.

- [ ] **Step 5: Implement `agentConnectionHub.ts`**

```typescript
import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import type { AgentToServerFrame, ServerToAgentFrame } from "../shared/gatewayProtocol.js";

interface AgentSocket {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(name: "message" | "close" | "error", listener: (...args: any[]) => void): void;
}

export class AgentConnectionHub {
  private socket?: AgentSocket;
  private frameHandler: (frame: AgentToServerFrame) => void = () => undefined;
  private connectionHandler: (connected: boolean) => void = () => undefined;
  get connected(): boolean { return this.socket?.readyState === WebSocket.OPEN; }
  setFrameHandler(handler: (frame: AgentToServerFrame) => void): void { this.frameHandler = handler; }
  setConnectionHandler(handler: (connected: boolean) => void): void { this.connectionHandler = handler; }

  accept(socket: AgentSocket): void {
    this.socket?.close(4000, "Gateway replaced");
    this.socket = socket;
    this.connectionHandler(true);
    socket.on("message", (data: RawData) => { try { this.frameHandler(parseAgentFrame(data.toString())); } catch { socket.close(1008, "Invalid agent frame"); } });
    socket.on("close", () => { if (this.socket === socket) { this.socket = undefined; this.connectionHandler(false); } });
    socket.on("error", () => undefined);
  }

  send(frame: ServerToAgentFrame): boolean {
    if (!this.connected || !this.socket) return false;
    this.socket.send(JSON.stringify(frame));
    return true;
  }

  close(): void { this.socket?.close(1001, "Server shutting down"); this.socket = undefined; }
}

export function attachAgentWebSocket(server: Server, hub: AgentConnectionHub, token: string): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  server.on("upgrade", (request, socket, head) => {
    if (new URL(request.url ?? "/", "http://localhost").pathname !== "/api/agent/connect" || !authorized(request, token)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (websocket) => hub.accept(websocket));
  });
  return wss;
}

function authorized(request: IncomingMessage, expected: string): boolean {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ")) return false;
  const actual = Buffer.from(value.slice(7));
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

function parseAgentFrame(text: string): AgentToServerFrame {
  const value = JSON.parse(text) as Record<string, unknown>;
  if (value.type === "ready" && typeof value.mailboxId === "string" && typeof value.version === "string") return value as unknown as AgentToServerFrame;
  if (value.type === "job-accepted" && typeof value.jobId === "string") return value as unknown as AgentToServerFrame;
  if (value.type === "job-failed" && typeof value.jobId === "string" && typeof value.error === "string" && Array.isArray(value.failures) && value.failures.every((failure) => failure && typeof failure === "object" && typeof (failure as Record<string, unknown>).path === "string" && typeof (failure as Record<string, unknown>).error === "string")) return value as unknown as AgentToServerFrame;
  throw new Error("Invalid agent frame");
}
```

- [ ] **Step 6: Implement `jobDispatcher.ts`**

```typescript
import type { AgentToServerFrame, ExtractionJobView } from "../shared/gatewayProtocol.js";
import type { GatewayStore } from "./gatewayStore.js";
import type { AgentConnectionHub } from "./agentConnectionHub.js";

type JobBroadcaster = (job: ExtractionJobView) => void;

export class JobDispatcher {
  constructor(private readonly store: Pick<GatewayStore, "listDispatchableJobs" | "transitionJob" | "failJob" | "requeueDispatchedJobs">, private readonly hub: Pick<AgentConnectionHub, "connected" | "send" | "setFrameHandler" | "setConnectionHandler">, private readonly broadcast: JobBroadcaster) {
    hub.setFrameHandler((frame) => this.handleFrame(frame));
    hub.setConnectionHandler((connected) => {
      if (!connected) this.store.requeueDispatchedJobs();
      else this.dispatchQueued();
    });
  }

  dispatchQueued(): void {
    if (!this.hub.connected) return;
    for (const job of this.store.listDispatchableJobs()) {
      if (!this.hub.send({ type: "extract", jobId: job.id, messageUids: job.messageUids, inferManual: job.inferManual })) break;
      this.broadcast(this.store.transitionJob(job.id, "dispatched"));
    }
  }

  handleFrame(frame: AgentToServerFrame): void {
    if (frame.type === "ready") { this.dispatchQueued(); return; }
    if (frame.type === "job-accepted") { this.broadcast(this.store.transitionJob(frame.jobId, "running")); return; }
    this.broadcast(this.store.failJob(frame.jobId, safeError(frame.error), frame.failures));
  }
}

function safeError(value: string): string { return value.replace(/[\r\n]+/g, " ").slice(0, 500); }
```

- [ ] **Step 7: Run focused tests and typecheck**

Run: `npm test -- services/orderflow-email-api/src/server/agentConnectionHub.test.ts services/orderflow-email-api/src/server/jobDispatcher.test.ts services/orderflow-email-api/src/server/gatewayStore.test.ts && npm --prefix services/orderflow-email-api run typecheck`

Expected: all focused tests PASS and typecheck exits `0`.

- [ ] **Step 8: Commit the agent transport and dispatcher**

```bash
git add services/orderflow-email-api/src/server/agentConnectionHub.ts services/orderflow-email-api/src/server/agentConnectionHub.test.ts services/orderflow-email-api/src/server/jobDispatcher.ts services/orderflow-email-api/src/server/jobDispatcher.test.ts services/orderflow-email-api/src/server/gatewayStore.ts services/orderflow-email-api/src/server/gatewayStore.test.ts
git commit -m "feat: route extraction jobs to connected gateway"
```

### Task 5: Replace the cloud-IMAP HTTP API with cache, job, and agent routes

**Files:**
- Replace: `services/orderflow-email-api/src/server/emailEventHub.ts`
- Replace: `services/orderflow-email-api/src/server/emailApiServer.ts`
- Replace: `services/orderflow-email-api/src/server/emailApiServer.test.ts`
- Delete: `services/orderflow-email-api/src/server/emailMessageCache.ts`
- Delete: `services/orderflow-email-api/src/server/emailMessageCache.test.ts`

**Interfaces:**
- Consumes: `EmailApiConfig`, `GatewayStore`, `JobDispatcher`, and protocol payloads.
- Produces client routes `POST /api/email/messages`, `POST /api/email/extract`, `GET /api/email/jobs/:id`, `GET /api/email/jobs/:id/workbook`, `GET /api/email/events`; agent routes `POST /api/agent/heartbeat`, `POST /api/agent/messages/sync`, and `POST /api/agent/jobs/:id/result`. `/health` remains public. The server no longer accepts `email`, `authCode`, IMAP host, IMAP port, or proxy fields.

- [ ] **Step 1: Write route tests that prove token separation and no server IMAP**

```typescript
test("serves cached messages without accepting mailbox credentials", async () => {
  const { server, store } = testServer();
  const response = await json(server, "POST", "/api/email/messages", { days: 7, email: "leak@example.com", authCode: "leak" }, "client-token");
  expect(response.status).toBe(200);
  expect(store.listMessages).toHaveBeenCalledWith(7);
  expect(JSON.stringify(store.listMessages.mock.calls)).not.toContain("leak");
});

test("separates client and agent bearer tokens", async () => {
  const { server } = testServer();
  expect((await json(server, "POST", "/api/agent/heartbeat", heartbeat(), "client-token")).status).toBe(401);
  expect((await json(server, "POST", "/api/email/messages", { days: 7 }, "agent-token")).status).toBe(401);
  expect((await json(server, "POST", "/api/agent/heartbeat", heartbeat(), "agent-token")).status).toBe(200);
});

test("creates a queued UUID job and returns 202", async () => {
  const { server, dispatcher } = testServer();
  const response = await json(server, "POST", "/api/email/extract", { messageUids: ["101"], inferManual: true }, "client-token");
  expect(response.status).toBe(202);
  expect(response.body).toMatchObject({ state: "queued", messageUids: ["101"] });
  expect(dispatcher.dispatchQueued).toHaveBeenCalled();
});

test("syncs summaries and emits only post-baseline new messages", async () => {
  const { server, store, events } = testServer();
  vi.mocked(store.syncMessages).mockReturnValue({ accepted: 1, inserted: 1, initialSync: false, lastSyncAt: "2026-07-10T00:00:00Z" });
  vi.mocked(store.claimPendingNotifications).mockReturnValue([{ uid: "101", subject: "PO", attachmentCount: 1, excelAttachmentNames: ["order.xlsx"], hasExcelAttachments: true }]);
  const response = await json(server, "POST", "/api/agent/messages/sync", syncBody(), "agent-token");
  expect(response.status).toBe(200);
  expect(events.broadcast).toHaveBeenCalledWith({ type: "new-messages", data: { mailboxId: "mailbox-hash", days: 7, messages: expect.any(Array) } });
});

test("rejects JSON bodies above the configured 64 MiB limit", async () => {
  const { server } = testServer({ bodyLimitBytes: 8 });
  const response = await json(server, "POST", "/api/agent/messages/sync", { value: "123456789" }, "agent-token");
  expect(response.status).toBe(413);
});
```

Use these complete local helpers below the tests:

```typescript
const activeServers: Server[] = [];
afterEach(async () => { await Promise.all(activeServers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))); });

function testServer(configOverrides: Partial<EmailApiConfig> = {}) {
  const store = createMockStore();
  const events = { subscribe: vi.fn(), broadcast: vi.fn(), close: vi.fn() } as unknown as EmailEventHub;
  const dispatcher = { dispatchQueued: vi.fn() };
  const config: EmailApiConfig = { clientToken: "client-token", agentToken: "agent-token", host: "127.0.0.1", port: 0, databasePath: "/tmp/test.sqlite", resultDir: "/tmp/results", offlineAfterMs: 90_000, jobTtlMs: 900_000, resultRetentionMs: 604_800_000, bodyLimitBytes: 67_108_864, ...configOverrides };
  const server = createEmailApiServer({ config, store, events, dispatcher }); activeServers.push(server);
  return { server, store, events, dispatcher };
}

function createMockStore(): GatewayStore {
  return {
    syncMessages: vi.fn(() => ({ accepted: 0, inserted: 0, initialSync: false, lastSyncAt: "2026-07-10T00:00:00Z" })),
    claimPendingNotifications: vi.fn(() => []), listMessages: vi.fn(() => emptyList()), recordHeartbeat: vi.fn(() => online()),
    markAgentConnected: vi.fn(() => online()), markAgentDisconnected: vi.fn(() => offline()), getGatewayStatus: vi.fn(() => online()),
    createJob: vi.fn(() => queuedJob()), getJob: vi.fn(), listDispatchableJobs: vi.fn(() => []), transitionJob: vi.fn(), failJob: vi.fn(), requeueDispatchedJobs: vi.fn(() => 0),
    completeJob: vi.fn(), expireQueuedJobs: vi.fn(() => 0), deleteExpiredResults: vi.fn(async () => 0), resultPath: vi.fn((id) => `/tmp/${id}.xlsx`), journalMode: vi.fn(() => "wal"), close: vi.fn(),
  };
}

async function json(server: Server, method: string, pathname: string, body: unknown, token?: string) {
  if (!server.listening) await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, body: JSON.parse(await response.text()) };
}

function online() { return { state: "online", stale: false, lastHeartbeatAt: "2026-07-10T00:00:00Z" } as const; }
function offline() { return { state: "offline", stale: true } as const; }
function emptyList() { return { days: 7, scannedMessages: 0, orderAttachmentCount: 0, nonOrderExcelAttachmentCount: 0, messages: [], gateway: online() }; }
function queuedJob(): ExtractionJobView { return { id: "11111111-1111-1111-1111-111111111111", state: "queued", messageUids: ["101"], inferManual: true, requestedAt: "2026-07-10T00:00:00Z", updatedAt: "2026-07-10T00:00:00Z", expiresAt: "2026-07-10T00:15:00Z" }; }
function heartbeat(): GatewayHeartbeatRequest { return { mailboxId: "mailbox-hash", version: "build-1", runtimeState: "connected", sentAt: "2026-07-10T00:00:00Z" }; }
function syncBody(): GatewayMessageSyncRequest { return { mailboxId: "mailbox-hash", syncId: "sync-1", days: 7, scannedMessages: 1, capturedAt: "2026-07-10T00:00:00Z", messages: [{ uid: "101", subject: "PO", attachmentCount: 1, excelAttachmentNames: ["order.xlsx"], hasExcelAttachments: true }] }; }
```

- [ ] **Step 2: Run the route tests against the old API**

Run: `npm test -- services/orderflow-email-api/src/server/emailApiServer.test.ts`

Expected: FAIL because the old service uses one token, calls IMAP, and returns synchronous extraction.

- [ ] **Step 3: Replace `emailEventHub.ts` with typed SSE and keepalive behavior**

```typescript
import type { ServerResponse } from "node:http";
import type { GatewaySseEvent, GatewayStatus } from "../shared/gatewayProtocol.js";

export class EmailEventHub {
  private readonly clients = new Set<ServerResponse>();
  private readonly keepalive = setInterval(() => this.writeRaw(": keepalive\n\n"), 25_000);
  constructor() { this.keepalive.unref?.(); }
  subscribe(response: ServerResponse, current: GatewayStatus): void {
    response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    response.write(": connected\n\n");
    this.clients.add(response);
    this.broadcastTo(response, { type: "gateway-status", data: { gateway: current } });
    response.on("close", () => this.clients.delete(response));
  }
  broadcast(event: GatewaySseEvent): void { for (const client of this.clients) this.broadcastTo(client, event); }
  close(): void { clearInterval(this.keepalive); for (const client of this.clients) client.end(); this.clients.clear(); }
  private broadcastTo(client: ServerResponse, event: GatewaySseEvent): void { client.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`); }
  private writeRaw(text: string): void { for (const client of this.clients) client.write(text); }
}
```

- [ ] **Step 4: Replace `emailApiServer.ts` with an explicit route table and bounded readers**

Use this exact dependency surface and routing body; keep helper functions in the same file so no route depends on an undefined utility:

```typescript
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { EmailApiConfig } from "./emailApiConfig.js";
import type { EmailEventHub } from "./emailEventHub.js";
import type { GatewayStore } from "./gatewayStore.js";
import type { JobDispatcher } from "./jobDispatcher.js";
import type { CreateExtractionJobRequest, GatewayHeartbeatRequest, GatewayJobResultUpload, GatewayMessageSyncRequest } from "../shared/gatewayProtocol.js";
import type { EmailMessageSummary, ExtractionResult } from "../shared/types.js";

export interface EmailApiServerDependencies { config: EmailApiConfig; store: GatewayStore; events: EmailEventHub; dispatcher: Pick<JobDispatcher, "dispatchQueued">; }

export function createEmailApiServer(deps: EmailApiServerDependencies): Server {
  return createServer((request, response) => void route(request, response, deps));
}

async function route(request: IncomingMessage, response: ServerResponse, deps: EmailApiServerDependencies): Promise<void> {
  try {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (request.method === "GET" && url.pathname === "/health") return json(response, 200, { ok: true, gateway: deps.store.getGatewayStatus() });
    const agentRoute = url.pathname.startsWith("/api/agent/");
    if (!authorized(request, agentRoute ? deps.config.agentToken : deps.config.clientToken)) return json(response, 401, { error: "Unauthorized" });

    if (request.method === "GET" && url.pathname === "/api/email/events") { deps.events.subscribe(response, deps.store.getGatewayStatus()); return; }
    if (request.method === "POST" && url.pathname === "/api/email/messages") {
      const body = await readObject(request, deps.config.bodyLimitBytes);
      return json(response, 200, deps.store.listMessages(optionalInteger(body.days, 7, 1, 30)));
    }
    if (request.method === "POST" && url.pathname === "/api/email/extract") {
      const body = await readObject(request, deps.config.bodyLimitBytes);
      const job = deps.store.createJob({ messageUids: stringArray(body.messageUids), inferManual: body.inferManual !== false } satisfies CreateExtractionJobRequest);
      deps.events.broadcast({ type: "job-status", data: { job } }); deps.dispatcher.dispatchQueued(); return json(response, 202, job);
    }

    const jobMatch = url.pathname.match(/^\/api\/email\/jobs\/([0-9a-f-]+)$/i);
    if (request.method === "GET" && jobMatch) { const job = deps.store.getJob(jobMatch[1]!); return job ? json(response, 200, job) : json(response, 404, { error: "Job not found" }); }
    const workbookMatch = url.pathname.match(/^\/api\/email\/jobs\/([0-9a-f-]+)\/workbook$/i);
    if (request.method === "GET" && workbookMatch) {
      const job = deps.store.getJob(workbookMatch[1]!); if (!job?.result) return json(response, 404, { error: "Workbook not available" });
      const bytes = await readFile(deps.store.resultPath(job.id)); response.writeHead(200, { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${job.id}.xlsx"`, "Content-Length": bytes.length }); response.end(bytes); return;
    }

    if (request.method === "POST" && url.pathname === "/api/agent/heartbeat") {
      const status = deps.store.recordHeartbeat(parseHeartbeat(await readObject(request, deps.config.bodyLimitBytes)));
      deps.events.broadcast({ type: "gateway-status", data: { gateway: status } }); deps.dispatcher.dispatchQueued(); return json(response, 200, status);
    }
    if (request.method === "POST" && url.pathname === "/api/agent/messages/sync") {
      const input = parseSync(await readObject(request, deps.config.bodyLimitBytes));
      const result = deps.store.syncMessages(input); const messages = deps.store.claimPendingNotifications(input.mailboxId);
      if (messages.length) deps.events.broadcast({ type: "new-messages", data: { mailboxId: input.mailboxId, days: input.days, messages } });
      deps.events.broadcast({ type: "gateway-status", data: { gateway: deps.store.getGatewayStatus() } }); return json(response, 200, result);
    }
    const resultMatch = url.pathname.match(/^\/api\/agent\/jobs\/([0-9a-f-]+)\/result$/i);
    if (request.method === "POST" && resultMatch) {
      const upload = parseResult(await readObject(request, deps.config.bodyLimitBytes));
      const job = await deps.store.completeJob(resultMatch[1]!, upload); deps.events.broadcast({ type: "job-status", data: { job } }); return json(response, 200, job);
    }
    json(response, 404, { error: "Not Found" });
  } catch (error) {
    const message = safeError(error); const status = message === "Request body too large" ? 413 : /not found/i.test(message) ? 404 : /checksum conflict|not running/i.test(message) ? 409 : /must|invalid|allowed|required|JSON|at most/i.test(message) ? 400 : 500;
    json(response, status, { error: message });
  }
}

function authorized(request: IncomingMessage, expected: string): boolean { const value = request.headers.authorization; if (!value?.startsWith("Bearer ")) return false; const actual = Buffer.from(value.slice(7)); const wanted = Buffer.from(expected); return actual.length === wanted.length && timingSafeEqual(actual, wanted); }
async function readObject(request: IncomingMessage, limit: number): Promise<Record<string, unknown>> { const chunks: Buffer[] = []; let size = 0; for await (const chunk of request) { const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += bytes.length; if (size > limit) throw new Error("Request body too large"); chunks.push(bytes); } if (!chunks.length) return {}; const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("JSON body must be an object"); return parsed as Record<string, unknown>; }
function stringArray(value: unknown): string[] { if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error("messageUids must be an array of strings"); const items = value.map((item) => String(item).trim()).filter(Boolean); if (items.length > 500) throw new Error("At most 500 values are allowed"); return items; }
function optionalInteger(value: unknown, fallback: number, min: number, max: number): number { if (value === undefined) return fallback; if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) throw new Error("Invalid integer"); return Number(value); }
function parseHeartbeat(body: Record<string, unknown>): GatewayHeartbeatRequest { const runtimeState = requiredString(body.runtimeState, "runtimeState"); if (!(["connected", "reconnecting", "attention_required"] as string[]).includes(runtimeState)) throw new Error("Invalid runtimeState"); return { mailboxId: requiredString(body.mailboxId, "mailboxId"), version: requiredString(body.version, "version"), runtimeState: runtimeState as GatewayHeartbeatRequest["runtimeState"], sentAt: requiredIso(body.sentAt, "sentAt") }; }
function parseSync(body: Record<string, unknown>): GatewayMessageSyncRequest { if (!Array.isArray(body.messages) || body.messages.length > 5_000) throw new Error("messages must be an array with at most 5000 items"); return { mailboxId: requiredString(body.mailboxId, "mailboxId"), syncId: requiredString(body.syncId, "syncId"), days: optionalInteger(body.days, 7, 1, 30), scannedMessages: optionalInteger(body.scannedMessages, 0, 0, 1_000_000), capturedAt: requiredIso(body.capturedAt, "capturedAt"), cursorUid: optionalString(body.cursorUid), messages: body.messages.map(parseMessage) }; }
function parseMessage(value: unknown): EmailMessageSummary { const body = object(value, "message"); const names = stringArray(body.excelAttachmentNames); return { uid: requiredString(body.uid, "uid"), subject: requiredString(body.subject, "subject"), from: optionalString(body.from), date: body.date === undefined ? undefined : requiredIso(body.date, "date"), attachmentCount: optionalInteger(body.attachmentCount, names.length, 0, 2_000), excelAttachmentNames: names, hasExcelAttachments: requiredBoolean(body.hasExcelAttachments, "hasExcelAttachments") }; }
function parseResult(body: Record<string, unknown>): GatewayJobResultUpload { const checksum = requiredString(body.checksum, "checksum"); if (!/^[0-9a-f]{64}$/i.test(checksum)) throw new Error("Invalid result checksum"); const emailFetch = object(body.emailFetch, "emailFetch"); const extraction = object(body.extraction, "extraction") as unknown as ExtractionResult; const workbookBase64 = largeString(body.workbookBase64, "workbookBase64"); if (!/^[A-Za-z0-9+/]+={0,2}$/.test(workbookBase64)) throw new Error("Invalid workbookBase64"); return { checksum, emailFetch: { scannedMessages: optionalInteger(emailFetch.scannedMessages, 0, 0, 1_000_000), attachmentCount: optionalInteger(emailFetch.attachmentCount, 0, 0, 2_000) }, extraction, workbookBase64 }; }
function object(value: unknown, name: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`); return value as Record<string, unknown>; }
function requiredString(value: unknown, name: string): string { if (typeof value !== "string" || !value.trim() || value.length > 1_000) throw new Error(`${name} must be a non-empty string`); return value.trim(); }
function largeString(value: unknown, name: string): string { if (typeof value !== "string" || !value) throw new Error(`${name} must be a non-empty string`); return value; }
function optionalString(value: unknown): string | undefined { return value === undefined ? undefined : requiredString(value, "value"); }
function requiredBoolean(value: unknown, name: string): boolean { if (typeof value !== "boolean") throw new Error(`${name} must be a boolean`); return value; }
function requiredIso(value: unknown, name: string): string { const text = requiredString(value, name); if (!Number.isFinite(Date.parse(text))) throw new Error(`${name} must be an ISO date`); return text; }
function json(response: ServerResponse, status: number, payload: unknown): void { response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); response.end(JSON.stringify(payload)); }
function safeError(error: unknown): string { return (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, " ").replace(/\/(?:data|tmp|var)\/[^ ]+/g, "[server-path]").slice(0, 500); }
```

- [ ] **Step 5: Delete the direct-IMAP cache and update tests to use the complete mock store**

Run: `git rm services/orderflow-email-api/src/server/emailMessageCache.ts services/orderflow-email-api/src/server/emailMessageCache.test.ts`

The `createMockStore()` helper above defines every `GatewayStore` method so type drift is caught. Keep this exact object in the test:

```typescript
const store: GatewayStore = {
  syncMessages: vi.fn(), claimPendingNotifications: vi.fn(() => []), listMessages: vi.fn(() => emptyList()),
  recordHeartbeat: vi.fn(() => online()), markAgentConnected: vi.fn(() => online()), markAgentDisconnected: vi.fn(() => offline()), getGatewayStatus: vi.fn(() => online()),
  createJob: vi.fn(() => queuedJob()), getJob: vi.fn(), listDispatchableJobs: vi.fn(() => []), transitionJob: vi.fn(), failJob: vi.fn(), requeueDispatchedJobs: vi.fn(() => 0), completeJob: vi.fn(), expireQueuedJobs: vi.fn(() => 0), deleteExpiredResults: vi.fn(async () => 0), resultPath: vi.fn((id) => `/tmp/${id}.xlsx`), journalMode: vi.fn(() => "wal"), close: vi.fn(),
};
```

- [ ] **Step 6: Run routes, protocol parity, and service typecheck**

Run: `npm test -- services/orderflow-email-api/src/server/emailApiServer.test.ts src/shared/gatewayProtocol.test.ts && npm --prefix services/orderflow-email-api run typecheck`

Expected: tests PASS, typecheck exits `0`, and `rg "EMAIL_AUTH_CODE|EMAIL_ACCOUNT|EMAIL_IMAP" services/orderflow-email-api/src/server` prints no matches. The obsolete standalone `src/core` still contains legacy IMAP types until Task 16 removes that directory.

- [ ] **Step 7: Commit the HTTP/SSE broker API**

```bash
git add services/orderflow-email-api/src/server/emailApiServer.ts services/orderflow-email-api/src/server/emailApiServer.test.ts services/orderflow-email-api/src/server/emailEventHub.ts
git commit -m "feat: expose cached mail and gateway job APIs"
```

### Task 6: Compose the standalone service and maintenance timers

**Files:**
- Replace: `services/orderflow-email-api/src/server/main.ts`
- Replace: `services/orderflow-email-api/src/server/main.test.ts`

**Interfaces:**
- Consumes: `loadEmailApiConfig`, `openGatewayStore`, `EmailEventHub`, `AgentConnectionHub`, `JobDispatcher`, `createEmailApiServer`, and `attachAgentWebSocket`.
- Produces: `startEmailApiServer(options): Promise<RunningEmailApiServer>` where `RunningEmailApiServer` exposes `server`, `store`, and an idempotent `close()`.

- [ ] **Step 1: Write a restart-persistence integration test**

```typescript
import type { Server } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, expect } from "vitest";
import type { GatewayMessageSyncRequest } from "../shared/gatewayProtocol.js";
import type { EmailApiConfig } from "./emailApiConfig.js";
import { startEmailApiServer } from "./main.js";

test("reopens synchronized mail and queued jobs from the same SQLite file", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gateway-main-"));
  const config = testConfig(root);
  let running = await startEmailApiServer({ config });
  await agentJson(running.server, "/api/agent/messages/sync", syncBody(), config.agentToken);
  const created = await clientJson(running.server, "/api/email/extract", { messageUids: ["101"] }, config.clientToken);
  await running.close();
  running = await startEmailApiServer({ config });
  expect((await clientJson(running.server, "/api/email/messages", { days: 7 }, config.clientToken)).body.messages[0].uid).toBe("101");
  expect((await clientGet(running.server, `/api/email/jobs/${created.body.id}`, config.clientToken)).body.state).toBe("queued");
  await running.close();
});
```

Use these exact test helpers:

```typescript
function testConfig(root: string): EmailApiConfig { return { clientToken: "client-token", agentToken: "agent-token", host: "127.0.0.1", port: 0, databasePath: path.join(root, "orderflow.sqlite"), resultDir: path.join(root, "results"), offlineAfterMs: 90_000, jobTtlMs: 900_000, resultRetentionMs: 604_800_000, bodyLimitBytes: 67_108_864 }; }
function syncBody(): GatewayMessageSyncRequest { return { mailboxId: "mailbox-hash", syncId: "sync-1", days: 7, scannedMessages: 1, capturedAt: "2026-07-10T00:00:00Z", messages: [{ uid: "101", subject: "PO", attachmentCount: 1, excelAttachmentNames: ["order.xlsx"], hasExcelAttachments: true }] }; }
async function request(server: Server, method: string, pathname: string, body: unknown, token: string) { const port = (server.address() as { port: number }).port; const response = await fetch(`http://127.0.0.1:${port}${pathname}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, ...(method === "GET" ? {} : { body: JSON.stringify(body) }) }); return { status: response.status, body: JSON.parse(await response.text()) }; }
function agentJson(server: Server, pathname: string, body: unknown, token: string) { return request(server, "POST", pathname, body, token); }
function clientJson(server: Server, pathname: string, body: unknown, token: string) { return request(server, "POST", pathname, body, token); }
function clientGet(server: Server, pathname: string, token: string) { return request(server, "GET", pathname, {}, token); }
```

- [ ] **Step 2: Run the integration test against the old entrypoint**

Run: `npm test -- services/orderflow-email-api/src/server/main.test.ts`

Expected: FAIL because the old entrypoint requires mailbox credentials and has no persistent store.

- [ ] **Step 3: Replace `main.ts` with complete composition and shutdown**

```typescript
import type { Server } from "node:http";
import { pathToFileURL } from "node:url";
import { AgentConnectionHub, attachAgentWebSocket } from "./agentConnectionHub.js";
import { loadEmailApiConfig, type EmailApiConfig } from "./emailApiConfig.js";
import { createEmailApiServer } from "./emailApiServer.js";
import { EmailEventHub } from "./emailEventHub.js";
import { openGatewayStore, type GatewayStore } from "./gatewayStore.js";
import { JobDispatcher } from "./jobDispatcher.js";

export interface RunningEmailApiServer { server: Server; store: GatewayStore; close(): Promise<void>; }
export interface StartEmailApiServerOptions { config?: EmailApiConfig; log?: (message: string) => void; maintenanceIntervalMs?: number; }

export async function startEmailApiServer(options: StartEmailApiServerOptions = {}): Promise<RunningEmailApiServer> {
  const config = options.config ?? loadEmailApiConfig();
  const store = await openGatewayStore(config);
  const events = new EmailEventHub();
  const agent = new AgentConnectionHub();
  const dispatcher = new JobDispatcher(store, agent, (job) => events.broadcast({ type: "job-status", data: { job } }));
  const server = createEmailApiServer({ config, store, events, dispatcher });
  const wss = attachAgentWebSocket(server, agent, config.agentToken);
  const interval = setInterval(() => {
    const expired = store.expireQueuedJobs();
    if (expired) options.log?.(`Expired ${expired} offline gateway jobs`);
    void store.deleteExpiredResults().catch((error) => options.log?.(`Result cleanup failed: ${safeError(error)}`));
    events.broadcast({ type: "gateway-status", data: { gateway: store.getGatewayStatus() } });
  }, options.maintenanceIntervalMs ?? 30_000);
  interval.unref?.();
  await new Promise<void>((resolve) => server.listen(config.port, config.host, resolve));
  options.log?.(`Email gateway API listening on http://${config.host}:${config.port}`);
  let closed = false;
  return { server, store, close: async () => { if (closed) return; closed = true; clearInterval(interval); agent.close(); events.close(); wss.close(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); store.close(); } };
}

function safeError(error: unknown): string { return (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, " ").replace(/\/(?:data|tmp|var)\/[^ ]+/g, "[server-path]").slice(0, 500); }
function isDirectRun(): boolean { return Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href); }
if (isDirectRun()) { startEmailApiServer({ log: console.log }).then((running) => { const stop = () => void running.close().finally(() => process.exit(0)); process.once("SIGINT", stop); process.once("SIGTERM", stop); }).catch((error) => { console.error(safeError(error)); process.exitCode = 1; }); }
```

- [ ] **Step 4: Run all standalone service tests and build**

Run: `npm --prefix services/orderflow-email-api test && npm --prefix services/orderflow-email-api run typecheck && npm --prefix services/orderflow-email-api run build`

Expected: all service tests PASS, typecheck/build exit `0`, and `dist/server/main.js` exists.

- [ ] **Step 5: Commit the standalone broker entrypoint**

```bash
git add services/orderflow-email-api/src/server/main.ts services/orderflow-email-api/src/server/main.test.ts
git commit -m "feat: start persistent office gateway broker"
```

### Task 7: Encrypt gateway credentials and persist replayable local state

**Files:**
- Create: `src/gateway/gatewayCredentialStore.ts`
- Create: `src/gateway/gatewayCredentialStore.test.ts`
- Create: `src/gateway/gatewayStateStore.ts`
- Create: `src/gateway/gatewayStateStore.test.ts`
- Create: `src/gateway/gatewayAuditLog.ts`
- Create: `src/gateway/gatewayAuditLog.test.ts`

**Interfaces:**
- Consumes: an injected `SecretCipher` implemented later with Electron `safeStorage`.
- Produces: `GatewayCredentialStore.loadView()`, `loadCredentials()`, `save(input)`, and `GatewayStateStore` methods for pending sync and durable accepted jobs. JSON files contain encrypted base64 blobs or non-secret state only.
- Produces: `GatewayAuditLogger.write(event)` for bounded JSONL logs containing event type, UID hash, job ID, status, duration, and sanitized error only.

- [ ] **Step 1: Write credential-boundary tests**

```typescript
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { GatewayCredentialStore } from "./gatewayCredentialStore.js";

const cipher = { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(`encrypted:${value}`), decryptString: (value: Buffer) => value.toString().replace(/^encrypted:/, "") };

test("stores no plaintext authorization code or agent token", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gateway-credentials-"));
  const file = path.join(root, "settings.json");
  const store = new GatewayCredentialStore(file, cipher);
  await store.save({ enabled: true, email: "orders@example.com", authCode: "mail-secret", agentToken: "agent-secret", serverUrl: "https://orderflow.ausmet.ai", startAtLogin: true });
  const disk = await readFile(file, "utf8");
  expect(disk).not.toContain("mail-secret");
  expect(disk).not.toContain("agent-secret");
  expect(await store.loadCredentials()).toMatchObject({ authCode: "mail-secret", agentToken: "agent-secret" });
});

test("refuses enabled gateway mode when safe encryption is unavailable", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gateway-unsafe-"));
  const store = new GatewayCredentialStore(path.join(root, "settings.json"), { ...cipher, isEncryptionAvailable: () => false });
  await expect(store.save({ enabled: true, email: "orders@example.com", authCode: "secret", agentToken: "token", serverUrl: "https://orderflow.ausmet.ai", startAtLogin: false })).rejects.toThrow("safeStorage encryption is unavailable");
});

```

- [ ] **Step 2: Write durable-state restart tests**

```typescript
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { GatewayStateStore } from "./gatewayStateStore.js";

test("reopens pending sync and accepted unfinished jobs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gateway-state-"));
  let store = new GatewayStateStore(root);
  await store.savePendingSync({ mailboxId: "mailbox", syncId: "sync-1", days: 7, scannedMessages: 1, capturedAt: "2026-07-10T00:00:00Z", messages: [] });
  await store.saveCursor({ mailboxId: "mailbox", lastUid: "101", updatedAt: "2026-07-10T00:00:00Z" });
  await store.saveJob({ command: { type: "extract", jobId: "job-1", messageUids: ["101"], inferManual: true }, phase: "accepted", updatedAt: "2026-07-10T00:00:00Z" });
  store = new GatewayStateStore(root);
  expect((await store.loadPendingSync())?.syncId).toBe("sync-1");
  expect((await store.loadCursor())?.lastUid).toBe("101");
  expect((await store.loadJobs()).map((job) => job.command.jobId)).toEqual(["job-1"]);
});
```

Add the log redaction test:

```typescript
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { GatewayAuditLogger, uidHash } from "./gatewayAuditLog.js";

test("writes only UID hash and redacts bearer tokens and local paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gateway-log-"));
  const logger = new GatewayAuditLogger(root, () => new Date("2026-07-10T00:00:00Z"));
  await logger.write({ eventType: "job-failed", uidHash: uidHash("raw-uid-secret-value"), jobId: "job-1", status: "failed", durationMs: 1200, error: "Bearer agent-secret C:\\Users\\Office\\secret.xlsx" });
  const text = await readFile(path.join(root, "gateway.jsonl"), "utf8");
  expect(text).toContain(uidHash("raw-uid-secret-value")); expect(text).not.toContain("raw-uid-secret-value"); expect(text).not.toContain("agent-secret"); expect(text).not.toContain("C:\\Users");
});
```

- [ ] **Step 3: Run the tests and confirm both modules are missing**

Run: `npm test -- src/gateway/gatewayCredentialStore.test.ts src/gateway/gatewayStateStore.test.ts src/gateway/gatewayAuditLog.test.ts`

Expected: FAIL with missing implementation modules.

- [ ] **Step 4: Implement encrypted settings storage**

```typescript
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GatewaySettingsView, SaveGatewaySettingsInput } from "../shared/gatewayProtocol.js";

export interface SecretCipher { isEncryptionAvailable(): boolean; encryptString(value: string): Buffer; decryptString(value: Buffer): string; }
export interface GatewayCredentials extends GatewaySettingsView { authCode: string; agentToken: string; }
interface StoredSettings { enabled: boolean; email: string; serverUrl: string; startAtLogin: boolean; authCodeEncrypted?: string; agentTokenEncrypted?: string; }

export class GatewayCredentialStore {
  constructor(private readonly filePath: string, private readonly cipher: SecretCipher) {}
  async loadView(): Promise<GatewaySettingsView> { const value = await this.read(); return { enabled: value.enabled, email: value.email, serverUrl: value.serverUrl, startAtLogin: value.startAtLogin, hasAuthCode: Boolean(value.authCodeEncrypted), hasAgentToken: Boolean(value.agentTokenEncrypted) }; }
  async loadCredentials(): Promise<GatewayCredentials> { const value = await this.read(); return { ...(await this.loadView()), authCode: decrypt(value.authCodeEncrypted, this.cipher), agentToken: decrypt(value.agentTokenEncrypted, this.cipher) }; }
  async save(input: SaveGatewaySettingsInput): Promise<GatewaySettingsView> {
    const previous = await this.read(); const email = input.email.trim(); const serverUrl = normalizeServerUrl(input.serverUrl);
    const authCode = input.authCode?.trim(); const agentToken = input.agentToken?.trim();
    if (input.enabled && !this.cipher.isEncryptionAvailable()) throw new Error("safeStorage encryption is unavailable");
    const next: StoredSettings = { enabled: input.enabled, email, serverUrl, startAtLogin: input.startAtLogin, authCodeEncrypted: authCode ? this.cipher.encryptString(authCode).toString("base64") : previous.authCodeEncrypted, agentTokenEncrypted: agentToken ? this.cipher.encryptString(agentToken).toString("base64") : previous.agentTokenEncrypted };
    if (input.enabled && (!email || !next.authCodeEncrypted || !next.agentTokenEncrypted)) throw new Error("邮箱、授权码和 agent token 均为必填项");
    await atomicJson(this.filePath, next); return this.loadView();
  }
  private async read(): Promise<StoredSettings> { try { const value = JSON.parse(await readFile(this.filePath, "utf8")) as Partial<StoredSettings>; return { enabled: value.enabled === true, email: typeof value.email === "string" ? value.email.trim() : "", serverUrl: typeof value.serverUrl === "string" ? value.serverUrl : "https://orderflow.ausmet.ai", startAtLogin: value.startAtLogin === true, authCodeEncrypted: typeof value.authCodeEncrypted === "string" ? value.authCodeEncrypted : undefined, agentTokenEncrypted: typeof value.agentTokenEncrypted === "string" ? value.agentTokenEncrypted : undefined }; } catch { return { enabled: false, email: "", serverUrl: "https://orderflow.ausmet.ai", startAtLogin: false }; } }
}

function decrypt(value: string | undefined, cipher: SecretCipher): string { return value ? cipher.decryptString(Buffer.from(value, "base64")) : ""; }
function normalizeServerUrl(value: string): string { const url = new URL(value.trim()); if (url.protocol !== "https:") throw new Error("Gateway server URL must use HTTPS"); return url.toString().replace(/\/$/, ""); }
async function atomicJson(filePath: string, value: unknown): Promise<void> { await mkdir(path.dirname(filePath), { recursive: true }); const temp = `${filePath}.tmp`; await writeFile(temp, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 }); await rename(temp, filePath); }
```

- [ ] **Step 5: Implement atomic pending-sync and job state**

```typescript
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GatewayMessageSyncRequest, ServerToAgentFrame } from "../shared/gatewayProtocol.js";
import type { ExtractionFailure } from "../shared/types.js";

export interface GatewaySyncCursor { mailboxId: string; lastUid: string; updatedAt: string; }
export interface DurableGatewayJob { command: ServerToAgentFrame; phase: "accepted" | "extracting" | "uploading" | "failed"; updatedAt: string; checksum?: string; resultJsonPath?: string; workbookPath?: string; error?: string; failures?: ExtractionFailure[]; }

export class GatewayStateStore {
  constructor(private readonly root: string) {}
  async loadPendingSync(): Promise<GatewayMessageSyncRequest | undefined> { return readJson<GatewayMessageSyncRequest>(path.join(this.root, "pending-sync.json")); }
  async savePendingSync(value: GatewayMessageSyncRequest): Promise<void> { await atomic(path.join(this.root, "pending-sync.json"), value); }
  async clearPendingSync(syncId: string): Promise<void> { const current = await this.loadPendingSync(); if (current?.syncId === syncId) await rm(path.join(this.root, "pending-sync.json"), { force: true }); }
  async loadCursor(): Promise<GatewaySyncCursor | undefined> { return readJson<GatewaySyncCursor>(path.join(this.root, "cursor.json")); }
  async saveCursor(value: GatewaySyncCursor): Promise<void> { await atomic(path.join(this.root, "cursor.json"), value); }
  async saveJob(job: DurableGatewayJob): Promise<void> { await atomic(this.jobPath(job.command.jobId), job); }
  async deleteJob(jobId: string): Promise<void> { await rm(this.jobPath(jobId), { force: true }); }
  async loadJobs(): Promise<DurableGatewayJob[]> { try { const names = await readdir(path.join(this.root, "jobs")); const values = await Promise.all(names.filter((name) => name.endsWith(".json")).map((name) => readJson<DurableGatewayJob>(path.join(this.root, "jobs", name)))); return values.filter((value): value is DurableGatewayJob => Boolean(value)); } catch { return []; } }
  quarantineDir(jobId: string): string { return path.join(this.root, "quarantine", jobId); }
  private jobPath(jobId: string): string { if (!/^[0-9a-f-]+$/i.test(jobId)) throw new Error("Invalid job id"); return path.join(this.root, "jobs", `${jobId}.json`); }
}

async function readJson<T>(file: string): Promise<T | undefined> { try { return JSON.parse(await readFile(file, "utf8")) as T; } catch { return undefined; } }
async function atomic(file: string, value: unknown): Promise<void> { await mkdir(path.dirname(file), { recursive: true }); const temporary = `${file}.tmp`; await writeFile(temporary, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 }); await rename(temporary, file); }
```

- [ ] **Step 6: Implement bounded sanitized JSONL logging**

```typescript
import { createHash } from "node:crypto";
import { appendFile, mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

export interface GatewayAuditEvent { eventType: string; uidHash?: string; jobId?: string; status?: string; durationMs?: number; error?: string; }
export class GatewayAuditLogger {
  constructor(private readonly root: string, private readonly now: () => Date = () => new Date(), private readonly maxBytes = 5 * 1024 * 1024) {}
  async write(event: GatewayAuditEvent): Promise<void> { await mkdir(this.root, { recursive: true }); const file = path.join(this.root, "gateway.jsonl"); await this.rotate(file); const safe = { at: this.now().toISOString(), eventType: clean(event.eventType, 80), uidHash: event.uidHash ? clean(event.uidHash, 64) : undefined, jobId: event.jobId ? clean(event.jobId, 64) : undefined, status: event.status ? clean(event.status, 40) : undefined, durationMs: Number.isFinite(event.durationMs) ? event.durationMs : undefined, error: event.error ? redact(event.error) : undefined }; await appendFile(file, `${JSON.stringify(safe)}\n`, { encoding: "utf8", mode: 0o600 }); }
  private async rotate(file: string): Promise<void> { try { if ((await stat(file)).size < this.maxBytes) return; const previous = `${file}.1`; await rm(previous, { force: true }); await rename(file, previous); } catch { return; } }
}
export function uidHash(uid: string): string { return createHash("sha256").update(uid).digest("hex").slice(0, 16); }
function clean(value: string, length: number): string { return value.replace(/[\r\n\u0000-\u001f]+/g, " ").slice(0, length); }
function redact(value: string): string { return clean(value, 500).replace(/Bearer\s+\S+/gi, "Bearer [redacted]").replace(/[A-Za-z]:\\[^ ]+|\/Users\/[^ ]+/g, "[local-path]"); }
```

- [ ] **Step 7: Run focused tests and typecheck**

Run: `npm test -- src/gateway/gatewayCredentialStore.test.ts src/gateway/gatewayStateStore.test.ts src/gateway/gatewayAuditLog.test.ts && npm run typecheck`

Expected: tests PASS and typecheck exits `0`.

- [ ] **Step 8: Commit the local secure-state boundary**

```bash
git add src/gateway/gatewayCredentialStore.ts src/gateway/gatewayCredentialStore.test.ts src/gateway/gatewayStateStore.ts src/gateway/gatewayStateStore.test.ts src/gateway/gatewayAuditLog.ts src/gateway/gatewayAuditLog.test.ts
git commit -m "feat: protect and persist office gateway state"
```

### Task 8: Enforce attachment quarantine limits before extraction

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/gateway/attachmentPolicy.ts`
- Create: `src/gateway/attachmentPolicy.test.ts`
- Create: `src/gateway/testZip.ts`

**Interfaces:**
- Consumes: attachment filename and `Buffer` downloaded from IMAP.
- Produces: `validateOpenXmlAttachment(input): Promise<{ filename: string; content: Buffer }>`; rejects unsafe names, suffixes, signatures, ZIP paths, entry counts, and declared sizes without extracting the ZIP.

- [ ] **Step 1: Install ZIP reader types and write limit tests**

Run: `npm install yauzl@^3.2.0 && npm install --save-dev @types/yauzl@^2.10.3`

Create tests with a local `makeZip(entries)` helper using `yazl` as a dev dependency (`npm install --save-dev yazl@^3.3.1 @types/yazl@^3.3.0`):

```typescript
import { describe, expect, test } from "vitest";
import { enforceZipEntryLimits, validateOpenXmlAttachment } from "./attachmentPolicy.js";
import { makeZip } from "./testZip.js";

test("accepts xlsx and xlsm OpenXML packages", async () => {
  const content = await makeZip([{ name: "[Content_Types].xml", content: "types" }, { name: "xl/workbook.xml", content: "book" }]);
  await expect(validateOpenXmlAttachment({ filename: "order.xlsx", content })).resolves.toMatchObject({ filename: "order.xlsx" });
  await expect(validateOpenXmlAttachment({ filename: "macro.xlsm", content })).resolves.toMatchObject({ filename: "macro.xlsm" });
});

test.each([
  ["order.xls", Buffer.from("PK\u0003\u0004"), "Only .xlsx and .xlsm"],
  ["../order.xlsx", Buffer.from("not-a-zip"), "Invalid OpenXML ZIP signature"],
] as const)("rejects invalid attachment %s", async (filename, content, message) => {
  await expect(validateOpenXmlAttachment({ filename, content })).rejects.toThrow(message);
});

test("rejects more than 2000 entries and more than 250 MiB declared uncompressed", async () => {
  const tooMany = await makeZip(Array.from({ length: 2001 }, (_, index) => ({ name: `xl/a-${index}.xml`, content: "x" })));
  await expect(validateOpenXmlAttachment({ filename: "many.xlsx", content: tooMany })).rejects.toThrow("more than 2000 ZIP entries");
  expect(() => enforceZipEntryLimits([{ fileName: "xl/workbook.xml", uncompressedSize: 251 * 1024 * 1024 }])).toThrow("more than 250 MiB uncompressed");
});
```

Create the test ZIP helper with complete content:

```typescript
import { ZipFile } from "yazl";

export function makeZip(entries: Array<{ name: string; content: string | Buffer }>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zip = new ZipFile(); const chunks: Buffer[] = [];
    zip.outputStream.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    zip.outputStream.on("error", reject);
    zip.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    for (const entry of entries) zip.addBuffer(Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content), entry.name);
    zip.end();
  });
}
```

- [ ] **Step 2: Run the focused tests and confirm the validator is missing**

Run: `npm test -- src/gateway/attachmentPolicy.test.ts`

Expected: FAIL with missing `attachmentPolicy.js`.

- [ ] **Step 3: Implement the complete ZIP policy**

```typescript
import path from "node:path";
import { fromBuffer, type Entry, type ZipFile } from "yauzl";

const MAX_COMPRESSED = 25 * 1024 * 1024;
const MAX_ENTRIES = 2_000;
const MAX_UNCOMPRESSED = 250 * 1024 * 1024;
const ALLOWED = new Set([".xlsx", ".xlsm"]);

export interface AttachmentInput { filename: string; content: Buffer; }

export async function validateOpenXmlAttachment(input: AttachmentInput): Promise<AttachmentInput> {
  const filename = safeName(input.filename);
  if (input.content.length > MAX_COMPRESSED) throw new Error("Attachment exceeds 25 MiB compressed");
  if (input.content.length < 4 || !input.content.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) throw new Error("Invalid OpenXML ZIP signature");
  await inspectZip(input.content);
  return { filename, content: input.content };
}

function safeName(value: string): string {
  const base = path.basename(value).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!base || base !== value.trim() || !ALLOWED.has(path.extname(base).toLowerCase())) throw new Error("Only .xlsx and .xlsm attachment names are allowed");
  return base;
}

function inspectZip(content: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    fromBuffer(content, { lazyEntries: true, autoClose: true }, (error, zip) => {
      if (error || !zip) { reject(error ?? new Error("Invalid ZIP")); return; }
      let entries = 0; let uncompressed = 0; let hasTypes = false; let hasWorkbook = false;
      const fail = (reason: Error) => { zip.close(); reject(reason); };
      zip.on("error", reject);
      zip.on("entry", (entry: Entry) => {
        entries += 1; uncompressed += entry.uncompressedSize;
        try { enforceZipEntryLimits([{ fileName: entry.fileName, uncompressedSize: entry.uncompressedSize }], entries, uncompressed); } catch (error) { return fail(error as Error); }
        const normalized = entry.fileName.replace(/\\/g, "/");
        if (normalized.startsWith("/") || normalized.split("/").includes("..")) return fail(new Error("Attachment contains an unsafe ZIP path"));
        if (normalized === "[Content_Types].xml") hasTypes = true;
        if (normalized === "xl/workbook.xml") hasWorkbook = true;
        zip.readEntry();
      });
      zip.on("end", () => hasTypes && hasWorkbook ? resolve() : reject(new Error("Missing OpenXML workbook members")));
      zip.readEntry();
    });
  });
}

export function enforceZipEntryLimits(entries: Array<{ fileName: string; uncompressedSize: number }>, entryCount = entries.length, uncompressedTotal = entries.reduce((sum, entry) => sum + entry.uncompressedSize, 0)): void {
  if (entryCount > MAX_ENTRIES) throw new Error("Attachment contains more than 2000 ZIP entries");
  if (uncompressedTotal > MAX_UNCOMPRESSED) throw new Error("Attachment declares more than 250 MiB uncompressed");
}
```

- [ ] **Step 4: Run attachment tests and the existing email-source tests**

Run: `npm test -- src/gateway/attachmentPolicy.test.ts src/core/emailSource.test.ts && npm run typecheck`

Expected: all tests PASS and typecheck exits `0`.

- [ ] **Step 5: Commit the quarantine policy and dependencies**

```bash
git add package.json package-lock.json src/gateway/attachmentPolicy.ts src/gateway/attachmentPolicy.test.ts src/gateway/testZip.ts
git commit -m "feat: validate gateway workbook attachments"
```

### Task 9: Expose raw selected attachments and build the IMAP IDLE monitor

**Files:**
- Modify: `src/core/emailSource.ts`
- Modify: `src/core/emailSource.test.ts`
- Modify: `src/shared/types.ts`
- Create: `src/gateway/gatewayMailboxMonitor.ts`
- Create: `src/gateway/gatewayMailboxMonitor.test.ts`

**Interfaces:**
- Consumes: `ImapConfig`, `GatewayStateStore`, and a sync sender.
- Produces: `downloadSelectedExcelAttachments(config, options): Promise<EmailAttachmentBatch>` and `GatewayMailboxMonitor.start()/stop()/syncNow()`. Authentication failures enter `attention_required` and wait for reconfiguration; network failures retry automatically.
- Produces: a durable latest UID cursor; successful scans request only summaries after that cursor while the central SQLite cache keeps the full seven-day list.

- [ ] **Step 1: Add a failing raw-download regression test**

```typescript
test("returns selected Excel bytes before order classification for gateway quarantine", async () => {
  imapMock.messages = [makeMetadataMessage({ uid: 101, subject: "PO", date: new Date(), attachments: ["order.xlsx"] })];
  imapMock.downloads["101"] = { "1": { content: Buffer.from("raw-openxml"), meta: { filename: "order.xlsx" } } };
  const result = await downloadSelectedExcelAttachments(testImapConfig(), { messageUids: ["101"] });
  expect(result.scannedMessages).toBe(1);
  expect(result.attachments).toEqual([expect.objectContaining({ filename: "order.xlsx", messageUid: "101", content: Buffer.from("raw-openxml") })]);
});
```

- [ ] **Step 2: Refactor without changing current direct extraction behavior**

Export the batch interface and raw function:

```typescript
export interface EmailAttachmentBatch { attachments: EmailAttachment[]; scannedMessages: number; }

export async function downloadSelectedExcelAttachments(config: ImapConfig, options: EmailFetchOptions = {}): Promise<EmailAttachmentBatch> {
  return retryTransientImapConnection(() => fetchExcelAttachmentsOnce(config, options));
}
```

Extend the root `EmailListResult` and `EmailListOptions` with `latestUid?: string` and `afterUid?: string`. In `listRecentEmailMessages`, track the greatest fetched numeric UID before filtering, increment `scannedMessages` for every message in the date window, and add a summary only when `isUidAfter(uid, options.afterUid)` is true:

```typescript
export function isUidAfter(uid: string, cursor?: string): boolean { if (!cursor) return true; try { return BigInt(uid) > BigInt(cursor); } catch { return uid !== cursor; } }
function laterUid(current: string | undefined, candidate: string): string { if (!current) return candidate; try { return BigInt(candidate) > BigInt(current) ? candidate : current; } catch { return candidate > current ? candidate : current; } }
```

Return `latestUid` alongside the existing list fields. Add a unit test with UIDs `100` and `101`, `afterUid: "100"`, and assert that only `101` is returned while `latestUid === "101"`.

In `fetchExcelAttachmentsOnce`, push every supported Excel part after download without calling `isOrderEmailAttachment`. Keep `fetchEmailOrderFiles` behavior by filtering before saving:

```typescript
const raw = await downloadSelectedExcelAttachments(config, options);
const attachments: EmailAttachment[] = [];
for (const attachment of raw.attachments) {
  if (await isOrderEmailAttachment(attachment)) attachments.push(attachment);
}
if (attachments.length === 0) throw new Error("没有找到订单 Excel 附件，请先刷新近一周邮件并选择带订单附件的邮件。");
const files = await saveEmailAttachments(attachments, downloadDir);
return { files, scannedMessages: raw.scannedMessages, attachmentCount: attachments.length, downloadDir };
```

- [ ] **Step 3: Write monitor tests for immediate sync, replay, fallback, and auth pause**

```typescript
import { expect, test, vi } from "vitest";
import type { EmailListResult } from "../shared/types.js";
import type { GatewayMessageSyncRequest } from "../shared/gatewayProtocol.js";
import { GatewayMailboxMonitor } from "./gatewayMailboxMonitor.js";

test("persists a sync batch before sending and clears it only after acknowledgement", async () => {
  const order: string[] = [];
  const state = { loadPendingSync: vi.fn(async () => undefined), savePendingSync: vi.fn(async () => { order.push("persist"); }), clearPendingSync: vi.fn(async () => { order.push("clear"); }), loadCursor: vi.fn(async () => undefined), saveCursor: vi.fn(async () => { order.push("cursor"); }) };
  const monitor = new GatewayMailboxMonitor({ mailboxId: "mailbox", scan: vi.fn(async () => listResult()), waitForChange: vi.fn(async () => undefined), state: state as any, sendSync: vi.fn(async () => { order.push("send"); }), onStatus: vi.fn(), now: () => new Date("2026-07-10T00:00:00Z"), randomUUID: () => "sync-1", fallbackMs: 60_000 });
  await monitor.syncNow();
  expect(order).toEqual(["persist", "send", "cursor", "clear"]);
});

test("replays a persisted batch before scanning again", async () => {
  const pending = syncRequest(); const scan = vi.fn(); const sendSync = vi.fn(async () => undefined);
  const monitor = new GatewayMailboxMonitor({ mailboxId: "mailbox", scan, waitForChange: vi.fn(), state: { loadPendingSync: vi.fn(async () => pending), savePendingSync: vi.fn(), clearPendingSync: vi.fn(), loadCursor: vi.fn(), saveCursor: vi.fn() } as any, sendSync, onStatus: vi.fn() });
  await monitor.replayPending();
  expect(sendSync).toHaveBeenCalledWith(pending); expect(scan).not.toHaveBeenCalled();
});

test("reports attention required and stops retrying authentication errors", async () => {
  const onStatus = vi.fn(); const monitor = new GatewayMailboxMonitor({ mailboxId: "mailbox", scan: vi.fn(async () => { throw new Error("AUTHENTICATIONFAILED invalid credentials"); }), waitForChange: vi.fn(), state: emptyState(), sendSync: vi.fn(), onStatus });
  await monitor.start();
  await vi.waitFor(() => expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({ state: "attention_required" })));
  monitor.stop();
});

function listResult(): EmailListResult { return { days: 7, scannedMessages: 1, latestUid: "101", orderAttachmentCount: 1, nonOrderExcelAttachmentCount: 0, messages: [{ uid: "101", subject: "PO", attachmentCount: 1, excelAttachmentNames: ["order.xlsx"], hasExcelAttachments: true }] }; }
function syncRequest(): GatewayMessageSyncRequest { return { mailboxId: "mailbox", syncId: "sync-pending", days: 7, scannedMessages: 1, capturedAt: "2026-07-10T00:00:00Z", cursorUid: "101", messages: [] }; }
function emptyState() { return { loadPendingSync: vi.fn(async () => undefined), savePendingSync: vi.fn(async () => undefined), clearPendingSync: vi.fn(async () => undefined), loadCursor: vi.fn(async () => undefined), saveCursor: vi.fn(async () => undefined) }; }
```

- [ ] **Step 4: Run monitor and existing email tests to see the intended failures**

Run: `npm test -- src/core/emailSource.test.ts src/gateway/gatewayMailboxMonitor.test.ts`

Expected: raw download test and missing monitor module fail while unrelated email tests remain green.

- [ ] **Step 5: Implement the monitor with injected IDLE/fallback primitives**

```typescript
import { randomUUID } from "node:crypto";
import { ImapFlow } from "imapflow";
import type { ImapConfig } from "../shared/types.js";
import type { EmailListResult } from "../shared/types.js";
import type { GatewayMessageSyncRequest, GatewayRuntimeStatus } from "../shared/gatewayProtocol.js";
import type { GatewayStateStore } from "./gatewayStateStore.js";

export interface GatewayMailboxMonitorOptions {
  mailboxId: string;
  scan: (afterUid?: string) => Promise<EmailListResult>;
  waitForChange: (signal: AbortSignal) => Promise<void>;
  state: Pick<GatewayStateStore, "loadPendingSync" | "savePendingSync" | "clearPendingSync" | "loadCursor" | "saveCursor">;
  sendSync: (request: GatewayMessageSyncRequest) => Promise<unknown>;
  onStatus: (status: GatewayRuntimeStatus) => void;
  now?: () => Date;
  randomUUID?: () => string;
  fallbackMs?: number;
  random?: () => number;
  log?: { write(event: { eventType: string; status?: string; error?: string; durationMs?: number }): Promise<void> };
}

export class GatewayMailboxMonitor {
  private controller?: AbortController;
  private readonly now: () => Date;
  private readonly uuid: () => string;
  constructor(private readonly options: GatewayMailboxMonitorOptions) { this.now = options.now ?? (() => new Date()); this.uuid = options.randomUUID ?? randomUUID; }
  async start(): Promise<void> { if (this.controller) return; this.controller = new AbortController(); void this.loop(this.controller.signal); }
  stop(): void { this.controller?.abort(); this.controller = undefined; }
  async replayPending(): Promise<void> { const pending = await this.options.state.loadPendingSync(); if (!pending) return; await this.options.sendSync(pending); if (pending.cursorUid) await this.options.state.saveCursor({ mailboxId: pending.mailboxId, lastUid: pending.cursorUid, updatedAt: pending.capturedAt }); await this.options.state.clearPendingSync(pending.syncId); }
  async syncNow(): Promise<void> { const started = Date.now(); const cursor = await this.options.state.loadCursor(); const result = await this.options.scan(cursor?.mailboxId === this.options.mailboxId ? cursor.lastUid : undefined); const capturedAt = this.now().toISOString(); const request: GatewayMessageSyncRequest = { mailboxId: this.options.mailboxId, syncId: this.uuid(), days: result.days, scannedMessages: result.scannedMessages, capturedAt, cursorUid: result.latestUid ?? cursor?.lastUid, messages: result.messages }; await this.options.state.savePendingSync(request); await this.options.sendSync(request); if (request.cursorUid) await this.options.state.saveCursor({ mailboxId: request.mailboxId, lastUid: request.cursorUid, updatedAt: capturedAt }); await this.options.state.clearPendingSync(request.syncId); await this.options.log?.write({ eventType: "mail-sync", status: "completed", durationMs: Date.now() - started }); this.options.onStatus({ state: "connected", detail: "Mailbox synchronized", lastSyncAt: capturedAt }); }
  private async loop(signal: AbortSignal): Promise<void> {
    let retryMs = 1_000;
    while (!signal.aborted) {
      try { await this.replayPending(); await this.syncNow(); retryMs = 1_000; await waitForWake(this.options.waitForChange, this.options.fallbackMs ?? 60_000, signal); }
      catch (error) { if (signal.aborted) return; const message = safe(error); await this.options.log?.write({ eventType: "mail-monitor-error", status: "failed", error: message }); if (/AUTHENTICATIONFAILED|authentication failed|invalid credentials/i.test(message)) { this.options.onStatus({ state: "attention_required", detail: "Mailbox authentication failed" }); return; } this.options.onStatus({ state: "reconnecting", detail: message }); const jittered = Math.min(60_000, Math.round(retryMs * (0.8 + (this.options.random ?? Math.random)() * 0.4))); await delay(jittered, signal); retryMs = Math.min(60_000, retryMs * 2); }
    }
  }
}

export async function waitForImapChange(config: ImapConfig, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  const client = new ImapFlow({ host: config.server, port: config.port, secure: true, auth: { user: config.email, pass: config.authCode }, ...(config.proxy ? { proxy: config.proxy } : {}), logger: false });
  await client.connect();
  try {
    await client.mailboxOpen("INBOX");
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: unknown) => { if (settled) return; settled = true; signal.removeEventListener("abort", abort); client.off("exists", changed); error ? reject(error) : resolve(); };
      const changed = () => { client.close(); finish(); };
      const abort = () => { client.close(); finish(); };
      client.on("exists", changed); signal.addEventListener("abort", abort, { once: true });
      void client.idle().then(() => finish()).catch((error) => finish(error));
    });
  } finally {
    await client.logout().catch(() => undefined);
  }
}

async function waitForWake(waitForChange: (signal: AbortSignal) => Promise<void>, fallbackMs: number, outer: AbortSignal): Promise<void> { const cycle = new AbortController(); const abort = () => cycle.abort(); outer.addEventListener("abort", abort, { once: true }); try { await Promise.race([waitForChange(cycle.signal), delay(fallbackMs, cycle.signal)]); } finally { cycle.abort(); outer.removeEventListener("abort", abort); } }
function delay(ms: number, signal: AbortSignal): Promise<void> { return new Promise((resolve) => { const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); }; const timer = setTimeout(finish, ms); signal.addEventListener("abort", finish, { once: true }); }); }
function safe(error: unknown): string { return (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, " ").slice(0, 300); }
```

Pass `waitForChange: (signal) => waitForImapChange(imapConfig, signal)` from the concrete runtime factory. The code above passes only host, port, username, authorization code, optional proxy, `secure: true`, and `logger: false`; it does not set `tls.rejectUnauthorized` or create a listener.

- [ ] **Step 6: Run focused tests and typecheck**

Run: `npm test -- src/core/emailSource.test.ts src/gateway/gatewayMailboxMonitor.test.ts && npm run typecheck`

Expected: all focused tests PASS and typecheck exits `0`.

- [ ] **Step 7: Commit IMAP monitor changes**

```bash
git add src/core/emailSource.ts src/core/emailSource.test.ts src/shared/types.ts src/gateway/gatewayMailboxMonitor.ts src/gateway/gatewayMailboxMonitor.test.ts
git commit -m "feat: monitor office mailbox with idle fallback"
```

### Task 10: Build the outbound HTTPS/WSS agent client

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/gateway/gatewayAgentClient.ts`
- Create: `src/gateway/gatewayAgentClient.test.ts`

**Interfaces:**
- Consumes: HTTPS server URL, agent token, mailbox ID, release version, and an extraction-command callback.
- Produces: `GatewayAgentClient.start()/stop()`, `sendSync`, `uploadResult`, `acceptJob`, and `failJob`. It opens only outbound WSS/HTTPS, sends a heartbeat every 30 seconds, and reconnects with jittered 1–60 second exponential backoff.

- [ ] **Step 1: Install the WebSocket dependency in the Electron package**

Run: `npm install ws@^8.18.3 && npm install --save-dev @types/ws@^8.18.1`

Expected: only root `package.json` and `package-lock.json` change.

- [ ] **Step 2: Write URL, heartbeat, frame, and backoff tests**

```typescript
import { describe, expect, test, vi } from "vitest";
import WebSocket from "ws";
import { GatewayAgentClient, reconnectDelayMs, websocketUrl } from "./gatewayAgentClient.js";

test("requires HTTPS and derives the exact WSS route", () => {
  expect(websocketUrl("https://orderflow.ausmet.ai")).toBe("wss://orderflow.ausmet.ai/api/agent/connect");
  expect(() => websocketUrl("http://38.92.9.4:8091")).toThrow("must use HTTPS");
});

test("caps reconnect backoff at 60 seconds and applies bounded jitter", () => {
  expect(reconnectDelayMs(1, () => 0.5)).toBe(1_000);
  expect(reconnectDelayMs(20, () => 1)).toBe(60_000);
  expect(reconnectDelayMs(20, () => 0)).toBe(48_000);
});

test("authenticates WSS with the agent token and sends ready before commands", async () => {
  const socket = fakeSocket();
  const client = new GatewayAgentClient({ serverUrl: "https://orderflow.ausmet.ai", agentToken: "agent-secret", mailboxId: "mailbox-hash", version: "build-1", onCommand: vi.fn(), onStatus: vi.fn(), websocketFactory: vi.fn((_url, options) => { expect(options.headers.Authorization).toBe("Bearer agent-secret"); return socket as any; }), fetch: vi.fn() as any });
  client.start(); socket.emit("open");
  expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: "ready", mailboxId: "mailbox-hash", version: "build-1" }));
  client.stop();
});

test("posts heartbeat and sync with no token in the body", async () => {
  const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
  const client = new GatewayAgentClient({ serverUrl: "https://orderflow.ausmet.ai", agentToken: "agent-secret", mailboxId: "mailbox-hash", version: "build-1", onCommand: vi.fn(), onStatus: vi.fn(), websocketFactory: vi.fn(() => fakeSocket() as any), fetch });
  await client.sendHeartbeat();
  expect(fetch).toHaveBeenCalledWith("https://orderflow.ausmet.ai/api/agent/heartbeat", expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer agent-secret" }) }));
  expect(String(fetch.mock.calls[0]?.[1]?.body)).not.toContain("agent-secret");
});

function fakeSocket() {
  const listeners = new Map<string, Array<(...args: any[]) => void>>();
  return {
    readyState: WebSocket.OPEN,
    send: vi.fn(),
    close: vi.fn(),
    on: vi.fn((name: string, listener: (...args: any[]) => void) => { const current = listeners.get(name) ?? []; current.push(listener); listeners.set(name, current); }),
    emit: (name: string, ...args: any[]) => { for (const listener of listeners.get(name) ?? []) listener(...args); },
  };
}
```

- [ ] **Step 3: Run the tests and confirm the agent client is missing**

Run: `npm test -- src/gateway/gatewayAgentClient.test.ts`

Expected: FAIL with missing `gatewayAgentClient.js`.

- [ ] **Step 4: Implement the complete outbound client**

```typescript
import WebSocket from "ws";
import type { AgentToServerFrame, GatewayHeartbeatRequest, GatewayJobResultUpload, GatewayMessageSyncRequest, GatewayRuntimeStatus, ServerToAgentFrame } from "../shared/gatewayProtocol.js";
import type { ExtractionFailure } from "../shared/types.js";

interface SocketLike { readyState: number; send(value: string): void; close(): void; on(name: "open" | "message" | "close" | "error", listener: (...args: any[]) => void): void; }
interface ClientOptions {
  serverUrl: string; agentToken: string; mailboxId: string; version: string;
  onCommand: (command: ServerToAgentFrame) => void; onStatus: (status: GatewayRuntimeStatus) => void;
  websocketFactory?: (url: string, options: { headers: Record<string, string> }) => SocketLike;
  fetch?: typeof fetch; now?: () => Date; random?: () => number; heartbeatMs?: number;
  runtimeState?: () => GatewayHeartbeatRequest["runtimeState"];
}

export class GatewayAgentClient {
  private socket?: SocketLike; private stopped = true; private reconnectAttempt = 0; private reconnectTimer?: ReturnType<typeof setTimeout>; private heartbeatTimer?: ReturnType<typeof setInterval>;
  private readonly fetcher: typeof fetch; private readonly now: () => Date; private readonly random: () => number; private readonly socketFactory: NonNullable<ClientOptions["websocketFactory"]>;
  constructor(private readonly options: ClientOptions) { websocketUrl(options.serverUrl); this.fetcher = options.fetch ?? fetch; this.now = options.now ?? (() => new Date()); this.random = options.random ?? Math.random; this.socketFactory = options.websocketFactory ?? ((url, init) => new WebSocket(url, init)); }
  start(): void { if (!this.stopped) return; this.stopped = false; this.connect(); this.heartbeatTimer = setInterval(() => void this.sendHeartbeat().catch(() => undefined), this.options.heartbeatMs ?? 30_000); this.heartbeatTimer.unref?.(); }
  stop(): void { this.stopped = true; if (this.reconnectTimer) clearTimeout(this.reconnectTimer); if (this.heartbeatTimer) clearInterval(this.heartbeatTimer); this.socket?.close(); this.socket = undefined; }
  async sendHeartbeat(): Promise<void> { const body: GatewayHeartbeatRequest = { mailboxId: this.options.mailboxId, version: this.options.version, runtimeState: this.options.runtimeState?.() ?? (this.socket?.readyState === WebSocket.OPEN ? "connected" : "reconnecting"), sentAt: this.now().toISOString() }; await this.post("/api/agent/heartbeat", body); }
  async sendSync(body: GatewayMessageSyncRequest): Promise<void> { await this.post("/api/agent/messages/sync", body); }
  async uploadResult(jobId: string, body: GatewayJobResultUpload): Promise<void> { await this.post(`/api/agent/jobs/${jobId}/result`, body); }
  acceptJob(jobId: string): void { this.sendFrame({ type: "job-accepted", jobId }); }
  failJob(jobId: string, error: string, failures: ExtractionFailure[]): void { this.sendFrame({ type: "job-failed", jobId, error: sanitize(error), failures: failures.slice(0, 100).map((failure) => ({ path: failure.path.slice(0, 255), error: sanitize(failure.error) })) }); }
  private connect(): void {
    if (this.stopped) return;
    this.options.onStatus({ state: "reconnecting", detail: "Connecting to gateway service" });
    const socket = this.socketFactory(websocketUrl(this.options.serverUrl), { headers: { Authorization: `Bearer ${this.options.agentToken}` } }); this.socket = socket;
    socket.on("open", () => { this.reconnectAttempt = 0; this.options.onStatus({ state: "connected", detail: "Gateway service connected" }); this.sendFrame({ type: "ready", mailboxId: this.options.mailboxId, version: this.options.version }); void this.sendHeartbeat(); });
    socket.on("message", (raw) => { try { this.options.onCommand(parseCommand(String(raw))); } catch { socket.close(); } });
    socket.on("close", () => this.scheduleReconnect()); socket.on("error", () => undefined);
  }
  private scheduleReconnect(): void { if (this.stopped || this.reconnectTimer) return; this.socket = undefined; this.reconnectAttempt += 1; const delay = reconnectDelayMs(this.reconnectAttempt, this.random); this.options.onStatus({ state: "reconnecting", detail: `Reconnect in ${Math.ceil(delay / 1000)}s` }); this.reconnectTimer = setTimeout(() => { this.reconnectTimer = undefined; this.connect(); }, delay); this.reconnectTimer.unref?.(); }
  private sendFrame(frame: AgentToServerFrame): void { if (this.socket?.readyState !== WebSocket.OPEN) throw new Error("Gateway WebSocket is offline"); this.socket.send(JSON.stringify(frame)); }
  private async post(pathname: string, body: unknown): Promise<unknown> { const response = await this.fetcher(`${normalizedBase(this.options.serverUrl)}${pathname}`, { method: "POST", headers: { Authorization: `Bearer ${this.options.agentToken}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }); const text = await response.text(); if (!response.ok) throw new Error(sanitize(serverError(text, response.statusText))); return text ? JSON.parse(text) : undefined; }
}

export function websocketUrl(base: string): string { const url = new URL(base); if (url.protocol !== "https:") throw new Error("Gateway server URL must use HTTPS"); url.protocol = "wss:"; url.pathname = "/api/agent/connect"; url.search = ""; url.hash = ""; return url.toString(); }
export function reconnectDelayMs(attempt: number, random: () => number): number { const base = Math.min(60_000, 1_000 * 2 ** Math.max(0, attempt - 1)); return Math.min(60_000, Math.round(base * (0.8 + random() * 0.4))); }
function normalizedBase(value: string): string { return value.replace(/\/+$/, ""); }
function sanitize(value: string): string { return value.replace(/[\r\n]+/g, " ").slice(0, 500); }
function serverError(text: string, fallback: string): string { try { const value = JSON.parse(text) as { error?: unknown }; return typeof value.error === "string" ? value.error : fallback; } catch { return fallback; } }
function parseCommand(text: string): ServerToAgentFrame { const value = JSON.parse(text) as Record<string, unknown>; if (value.type !== "extract" || typeof value.jobId !== "string" || !Array.isArray(value.messageUids) || value.messageUids.some((uid) => typeof uid !== "string") || typeof value.inferManual !== "boolean") throw new Error("Invalid extract command"); return value as unknown as ServerToAgentFrame; }
```

- [ ] **Step 5: Run focused tests and typecheck**

Run: `npm test -- src/gateway/gatewayAgentClient.test.ts && npm run typecheck`

Expected: all agent client tests PASS and typecheck exits `0`.

- [ ] **Step 6: Commit the outbound agent client**

```bash
git add package.json package-lock.json src/gateway/gatewayAgentClient.ts src/gateway/gatewayAgentClient.test.ts
git commit -m "feat: connect office gateway over outbound wss"
```

### Task 11: Run durable extraction jobs locally and upload idempotent results

**Files:**
- Create: `src/gateway/gatewayJobRunner.ts`
- Create: `src/gateway/gatewayJobRunner.test.ts`

**Interfaces:**
- Consumes: `ServerToAgentFrame`, `GatewayStateStore`, raw selected attachments, `validateOpenXmlAttachment`, `isOrderWorkbookContent`, and `runPythonOrderExtraction`.
- Produces: `GatewayJobRunner.accept(command)`, `resume()`, and `cleanupFailedQuarantines()`. It persists before acknowledgement, sanitizes local paths from results, retries interrupted uploads without rerunning extraction, and retains failed quarantine for at most 24 hours.

- [ ] **Step 1: Write the persist-before-ack and successful-cleanup test**

```typescript
import { expect, test, vi } from "vitest";
import type { GatewayJobResultUpload, ServerToAgentFrame } from "../shared/gatewayProtocol.js";
import type { ExtractionResult, ImapConfig } from "../shared/types.js";
import { GatewayJobRunner } from "./gatewayJobRunner.js";

test("persists acceptance before ack, extracts safely, uploads, then removes quarantine", async () => {
  const { dependencies, order } = fakeRunner();
  const runner = new GatewayJobRunner(dependencies);
  await runner.accept({ type: "extract", jobId: "11111111-1111-1111-1111-111111111111", messageUids: ["101"], inferManual: true });
  expect(order.slice(0, 2)).toEqual(["persist:accepted", "ack"]);
  expect(dependencies.uploadResult).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ extraction: expect.objectContaining({ inputFiles: ["0001-order.xlsx"], outputs: { outputDir: "", csvOutput: "", xlsxOutput: "", auditOutput: "" } }) }));
  expect(order).toContain("remove");
});
```

- [ ] **Step 2: Write partial rejection, interrupted upload, and restart tests**

```typescript
test("continues safe attachments when one selected attachment is invalid", async () => {
  const { dependencies } = fakeRunner({ download: vi.fn(async () => ({ scannedMessages: 1, attachments: [{ filename: "bad.xlsx", content: Buffer.from("bad"), messageUid: "101" }, { filename: "good.xlsx", content: Buffer.from("good"), messageUid: "101" }] })) });
  await new GatewayJobRunner(dependencies).accept(command());
  expect(dependencies.extract).toHaveBeenCalledWith([expect.stringMatching(/good\.xlsx$/)], expect.anything());
});

test("persists uploading phase and resume uploads saved bytes without rerunning Python", async () => {
  const { dependencies } = fakeRunner({ uploadResult: vi.fn().mockRejectedValueOnce(new Error("network down")).mockResolvedValue(undefined) });
  const runner = new GatewayJobRunner(dependencies);
  await runner.accept(command());
  expect(dependencies.extract).toHaveBeenCalledTimes(1);
  await runner.resume();
  expect(dependencies.extract).toHaveBeenCalledTimes(1);
  expect(dependencies.uploadResult).toHaveBeenCalledTimes(2);
});

function command(): ServerToAgentFrame { return { type: "extract", jobId: "11111111-1111-1111-1111-111111111111", messageUids: ["101"], inferManual: true }; }
function extractionResult(input: string): ExtractionResult { return { inputFiles: [input], rows: [], skippedFiles: [], failures: [], outputs: { outputDir: "C:\\Users\\Office\\out", csvOutput: "", xlsxOutput: "C:\\Users\\Office\\out\\订单整理结果.xlsx", auditOutput: "" } }; }
function fakeRunner(overrides: Record<string, unknown> = {}) {
  const order: string[] = []; const jobs: any[] = []; const files = new Map<string, Buffer>();
  const state = { loadJobs: vi.fn(async () => [...jobs]), saveJob: vi.fn(async (job: any) => { const index = jobs.findIndex((item) => item.command.jobId === job.command.jobId); if (index === -1) jobs.push(job); else jobs[index] = job; order.push(`persist:${job.phase}`); }), deleteJob: vi.fn(async (jobId: string) => { const index = jobs.findIndex((item) => item.command.jobId === jobId); if (index >= 0) jobs.splice(index, 1); }), quarantineDir: vi.fn((jobId: string) => `C:\\Users\\Office\\gateway\\quarantine\\${jobId}`) };
  const fileSystem = { mkdir: vi.fn(async () => undefined), writeFile: vi.fn(async (file: string, value: string | Buffer) => { files.set(file, Buffer.isBuffer(value) ? value : Buffer.from(value)); }), readFile: vi.fn(async (file: string, encoding?: string) => { const value = files.get(file) ?? Buffer.from("office-workbook"); return encoding ? value.toString(encoding as BufferEncoding) : value; }), rm: vi.fn(async () => { order.push("remove"); }) };
  const defaults = { imapConfig: { email: "orders@example.com", authCode: "secret", server: "imap.example.com", port: 993 } satisfies ImapConfig, state, download: vi.fn(async () => ({ scannedMessages: 1, attachments: [{ filename: "order.xlsx", content: Buffer.from("good"), messageUid: "101" }] })), extract: vi.fn(async (paths: string[]) => extractionResult(paths[0]!)), acceptJob: vi.fn(() => order.push("ack")), failJob: vi.fn(), uploadResult: vi.fn(async (_jobId: string, _upload: GatewayJobResultUpload) => order.push("upload")), validateAttachment: vi.fn(async (input: { filename: string; content: Buffer }) => { if (input.content.toString() === "bad") throw new Error("Invalid OpenXML ZIP signature"); return input; }), classifyAttachment: vi.fn(async () => true), fileSystem, now: () => new Date("2026-07-10T00:00:00Z") };
  return { dependencies: { ...defaults, ...overrides } as any, order };
}
```

- [ ] **Step 3: Run the tests and confirm the job runner is missing**

Run: `npm test -- src/gateway/gatewayJobRunner.test.ts`

Expected: FAIL with missing `gatewayJobRunner.js`.

- [ ] **Step 4: Implement the complete job runner**

```typescript
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { isOrderWorkbookContent } from "../core/orderFileClassifier.js";
import type { OrderExtractionRunner } from "../core/pythonExtractor.js";
import type { EmailAttachmentBatch } from "../core/emailSource.js";
import type { ExtractionFailure, ExtractionResult, ImapConfig } from "../shared/types.js";
import type { GatewayJobResultUpload, ServerToAgentFrame } from "../shared/gatewayProtocol.js";
import { validateOpenXmlAttachment } from "./attachmentPolicy.js";
import type { DurableGatewayJob, GatewayStateStore } from "./gatewayStateStore.js";

interface Dependencies {
  imapConfig: ImapConfig;
  state: GatewayStateStore;
  download: (config: ImapConfig, options: { messageUids: string[] }) => Promise<EmailAttachmentBatch>;
  extract: OrderExtractionRunner;
  acceptJob: (jobId: string) => void;
  failJob: (jobId: string, error: string, failures: ExtractionFailure[]) => void;
  uploadResult: (jobId: string, upload: GatewayJobResultUpload) => Promise<void>;
  validateAttachment?: typeof validateOpenXmlAttachment;
  classifyAttachment?: typeof isOrderWorkbookContent;
  fileSystem?: { mkdir: typeof mkdir; readFile: typeof readFile; rm: typeof rm; writeFile: typeof writeFile };
  log?: { write(event: { eventType: string; uidHash?: string; jobId?: string; status?: string; durationMs?: number; error?: string }): Promise<void> };
  now?: () => Date;
}

export class GatewayJobRunner {
  private readonly now: () => Date;
  private readonly fs: NonNullable<Dependencies["fileSystem"]>;
  private running = new Set<string>();
  constructor(private readonly deps: Dependencies) { this.now = deps.now ?? (() => new Date()); this.fs = deps.fileSystem ?? { mkdir, readFile, rm, writeFile }; }
  async accept(command: ServerToAgentFrame): Promise<void> { const existing = (await this.deps.state.loadJobs()).find((job) => job.command.jobId === command.jobId); if (!existing) await this.deps.state.saveJob({ command, phase: "accepted", updatedAt: this.now().toISOString() }); await this.deps.log?.write({ eventType: "job-accepted", uidHash: uidHash(command.messageUids.join(",")), jobId: command.jobId, status: "accepted" }); this.deps.acceptJob(command.jobId); if (existing?.phase === "uploading" && existing.resultJsonPath && existing.workbookPath && existing.checksum) { try { await this.uploadSaved(existing); } catch { return; } return; } if (existing?.phase === "failed") { const error = existing.error ?? "Previous extraction attempt failed"; this.deps.failJob(command.jobId, error, existing.failures ?? [{ path: "", error }]); return; } await this.run(existing ?? { command, phase: "accepted", updatedAt: this.now().toISOString() }); }
  async resume(): Promise<void> { for (const job of await this.deps.state.loadJobs()) { if (job.phase === "failed") continue; if (job.phase === "uploading" && job.resultJsonPath && job.workbookPath && job.checksum) { try { await this.uploadSaved(job); } catch (error) { await this.deps.log?.write({ eventType: "result-upload-retry", jobId: job.command.jobId, status: "failed", error: safeError(error) }); } } else await this.run(job); } }
  async cleanupFailedQuarantines(): Promise<void> { const cutoff = this.now().getTime() - 86_400_000; for (const job of await this.deps.state.loadJobs()) { if (job.phase !== "failed" || new Date(job.updatedAt).getTime() > cutoff) continue; await this.fs.rm(this.deps.state.quarantineDir(job.command.jobId), { recursive: true, force: true }); await this.deps.state.deleteJob(job.command.jobId); } }
  private async run(job: DurableGatewayJob): Promise<void> {
    const id = job.command.jobId; if (this.running.has(id)) return; this.running.add(id); const started = Date.now(); const failures: ExtractionFailure[] = [];
    try {
      const quarantine = this.deps.state.quarantineDir(id); await this.fs.mkdir(quarantine, { recursive: true }); await this.deps.state.saveJob({ ...job, phase: "extracting", updatedAt: this.now().toISOString() });
      const batch = await this.deps.download(this.deps.imapConfig, { messageUids: job.command.messageUids }); const paths: string[] = [];
      for (const [index, attachment] of batch.attachments.entries()) {
        try { const safe = await (this.deps.validateAttachment ?? validateOpenXmlAttachment)({ filename: attachment.filename, content: attachment.content }); if (!(await (this.deps.classifyAttachment ?? isOrderWorkbookContent)(safe.filename, safe.content))) continue; const file = path.join(quarantine, `${String(index + 1).padStart(4, "0")}-${safe.filename}`); await this.fs.writeFile(file, safe.content, { mode: 0o600 }); paths.push(file); }
        catch (error) { failures.push({ path: safeBaseName(attachment.filename), error: safeError(error) }); }
      }
      if (!paths.length) throw new Error(failures[0]?.error ?? "No valid order workbooks in selected messages");
      const extraction = await this.deps.extract(paths, { recursive: false, inferManual: job.command.inferManual }); extraction.failures.push(...failures);
      const workbookPath = extraction.outputs.xlsxOutput; const workbook = await this.fs.readFile(workbookPath); if (workbook.length > 45 * 1024 * 1024) throw new Error("Generated workbook exceeds the 45 MiB upload limit"); const checksum = createHash("sha256").update(workbook).digest("hex"); const upload = buildUpload(batch.scannedMessages, paths.length, extraction, workbook, checksum);
      const resultJsonPath = path.join(quarantine, "result-upload.json"); await this.fs.writeFile(resultJsonPath, JSON.stringify(upload), { encoding: "utf8", mode: 0o600 }); const uploading: DurableGatewayJob = { command: job.command, phase: "uploading", updatedAt: this.now().toISOString(), checksum, resultJsonPath, workbookPath }; await this.deps.state.saveJob(uploading); await this.uploadSaved(uploading);
    } catch (error) { const current = (await this.deps.state.loadJobs()).find((item) => item.command.jobId === id); if (current?.phase !== "uploading") { const message = safeError(error); const safeFailures = failures.length ? failures : [{ path: "", error: message }]; await this.deps.state.saveJob({ command: job.command, phase: "failed", updatedAt: this.now().toISOString(), error: message, failures: safeFailures }); await this.deps.log?.write({ eventType: "job-failed", uidHash: uidHash(job.command.messageUids.join(",")), jobId: id, status: "failed", durationMs: Date.now() - started, error: message }); this.deps.failJob(id, message, safeFailures); } }
    finally { this.running.delete(id); }
  }
  private async uploadSaved(job: DurableGatewayJob): Promise<void> { const upload = JSON.parse(await this.fs.readFile(job.resultJsonPath!, "utf8")) as GatewayJobResultUpload; await this.deps.uploadResult(job.command.jobId, upload); await this.deps.log?.write({ eventType: "job-completed", uidHash: uidHash(job.command.messageUids.join(",")), jobId: job.command.jobId, status: "completed" }); await this.fs.rm(this.deps.state.quarantineDir(job.command.jobId), { recursive: true, force: true }); await this.deps.state.deleteJob(job.command.jobId); }
}

function buildUpload(scannedMessages: number, attachmentCount: number, result: ExtractionResult, workbook: Buffer, checksum: string): GatewayJobResultUpload { return { checksum, emailFetch: { scannedMessages, attachmentCount }, extraction: { ...result, inputFiles: result.inputFiles.map(safeBaseName), skippedFiles: result.skippedFiles.map(safeBaseName), failures: result.failures.map((failure) => ({ path: safeBaseName(failure.path), error: safeError(failure.error) })), rows: result.rows.map((row) => ({ ...row, sourceFile: safeBaseName(row.sourceFile) })), outputs: { outputDir: "", csvOutput: "", xlsxOutput: "", auditOutput: "" } }, workbookBase64: workbook.toString("base64") }; }
function safeBaseName(value: string): string { return path.win32.basename(path.posix.basename(value)); }
function uidHash(value: string): string { return createHash("sha256").update(value).digest("hex").slice(0, 16); }
function safeError(error: unknown): string { return (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, " ").replace(/[A-Za-z]:\\[^ ]+|\/Users\/[^ ]+/g, "[local-path]").slice(0, 500); }
```

- [ ] **Step 5: Run job-runner, attachment, Python-bridge tests, and typecheck**

Run: `npm test -- src/gateway/gatewayJobRunner.test.ts src/gateway/attachmentPolicy.test.ts src/core/pythonExtractor.test.ts && npm run typecheck`

Expected: all tests PASS and typecheck exits `0`; no test result payload contains a Windows drive path or `/Users/`.

- [ ] **Step 6: Commit the durable local job runner**

```bash
git add src/gateway/gatewayJobRunner.ts src/gateway/gatewayJobRunner.test.ts
git commit -m "feat: execute gateway extraction jobs locally"
```

### Task 12: Compose gateway runtime state without creating a listener

**Files:**
- Create: `src/gateway/gatewayRuntime.ts`
- Create: `src/gateway/gatewayRuntime.test.ts`

**Interfaces:**
- Consumes: decrypted `GatewayCredentials` and factories for the agent client, mailbox monitor, and job runner.
- Produces: `GatewayRuntime.start(credentials)`, `reconfigure(credentials)`, `stop()`, `syncNow()`, `status`, and status subscriptions. The runtime itself imports no `node:http`, `node:https.createServer`, `net.createServer`, or WebSocket server APIs.

- [ ] **Step 1: Write lifecycle and reconfiguration tests**

```typescript
import { expect, test, vi } from "vitest";
import type { GatewayCredentials } from "./gatewayCredentialStore.js";
import { GatewayRuntime } from "./gatewayRuntime.js";

test("starts only when enabled and all encrypted credentials are present", async () => {
  const parts = fakeParts(); const runtime = new GatewayRuntime(parts.factories);
  await runtime.start({ enabled: false, email: "", authCode: "", agentToken: "", serverUrl: "https://orderflow.ausmet.ai", startAtLogin: false, hasAuthCode: false, hasAgentToken: false });
  expect(parts.agent.start).not.toHaveBeenCalled();
  await runtime.reconfigure(credentials());
  expect(parts.agent.start).toHaveBeenCalledOnce(); expect(parts.monitor.start).toHaveBeenCalledOnce(); expect(parts.runner.resume).toHaveBeenCalledOnce();
});

test("stops the previous runtime before applying changed credentials", async () => {
  const parts = fakeParts(); const runtime = new GatewayRuntime(parts.factories);
  await runtime.start(credentials()); await runtime.reconfigure({ ...credentials(), email: "new@example.com" });
  expect(parts.monitor.stop).toHaveBeenCalled(); expect(parts.agent.stop).toHaveBeenCalled();
});

function credentials(): GatewayCredentials { return { enabled: true, email: "orders@example.com", authCode: "mail-secret", agentToken: "agent-secret", serverUrl: "https://orderflow.ausmet.ai", startAtLogin: true, hasAuthCode: true, hasAgentToken: true }; }
function fakeParts() { const agent = { start: vi.fn(), stop: vi.fn() }; const monitor = { start: vi.fn(async () => undefined), stop: vi.fn(), syncNow: vi.fn(async () => undefined) }; const runner = { resume: vi.fn(async () => undefined), cleanupFailedQuarantines: vi.fn(async () => undefined) }; return { agent, monitor, runner, factories: { create: vi.fn(() => ({ agent, monitor, runner })) } }; }
```

- [ ] **Step 2: Run the lifecycle test and confirm the runtime is missing**

Run: `npm test -- src/gateway/gatewayRuntime.test.ts`

Expected: FAIL with missing `gatewayRuntime.js`.

- [ ] **Step 3: Implement the runtime orchestrator**

```typescript
import { createHash } from "node:crypto";
import type { GatewayRuntimeStatus } from "../shared/gatewayProtocol.js";
import type { GatewayCredentials } from "./gatewayCredentialStore.js";

interface AgentPart { start(): void; stop(): void; }
interface MonitorPart { start(): Promise<void>; stop(): void; syncNow(): Promise<void>; }
interface RunnerPart { resume(): Promise<void>; cleanupFailedQuarantines(): Promise<void>; }
interface RuntimeParts { agent: AgentPart; monitor: MonitorPart; runner: RunnerPart; }
export interface GatewayRuntimeFactories { create(credentials: GatewayCredentials, mailboxId: string, onStatus: (status: GatewayRuntimeStatus) => void): RuntimeParts; }

export class GatewayRuntime {
  private parts?: RuntimeParts; private cleanupTimer?: ReturnType<typeof setInterval>; private listeners = new Set<(status: GatewayRuntimeStatus) => void>();
  status: GatewayRuntimeStatus = { state: "stopped", detail: "Gateway disabled" };
  constructor(private readonly factories: GatewayRuntimeFactories) {}
  subscribe(listener: (status: GatewayRuntimeStatus) => void): () => void { this.listeners.add(listener); listener(this.status); return () => this.listeners.delete(listener); }
  async start(credentials: GatewayCredentials): Promise<void> { if (!credentials.enabled) { this.setStatus({ state: "stopped", detail: "Gateway disabled" }); return; } if (!credentials.email || !credentials.authCode || !credentials.agentToken) throw new Error("Gateway credentials are incomplete"); const parts = this.factories.create(credentials, mailboxIdFor(credentials.email), (status) => this.setStatus(status)); this.parts = parts; parts.agent.start(); await parts.runner.resume(); await parts.runner.cleanupFailedQuarantines(); this.cleanupTimer = setInterval(() => void parts.runner.cleanupFailedQuarantines(), 60 * 60 * 1_000); this.cleanupTimer.unref?.(); await parts.monitor.start(); }
  async reconfigure(credentials: GatewayCredentials): Promise<void> { await this.stop(); await this.start(credentials); }
  async stop(): Promise<void> { if (this.cleanupTimer) clearInterval(this.cleanupTimer); this.cleanupTimer = undefined; this.parts?.monitor.stop(); this.parts?.agent.stop(); this.parts = undefined; this.setStatus({ state: "stopped", detail: "Gateway stopped" }); }
  async syncNow(): Promise<void> { if (!this.parts) throw new Error("Gateway is not running"); await this.parts.monitor.syncNow(); }
  private setStatus(status: GatewayRuntimeStatus): void { this.status = status; for (const listener of this.listeners) listener(status); }
}

export function mailboxIdFor(email: string): string { return createHash("sha256").update(email.trim().toLowerCase()).digest("hex"); }
```

- [ ] **Step 4: Add a source-level no-listener guard test**

```typescript
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

test("gateway runtime source contains no inbound server primitive", async () => {
  const names = await readdir("src/gateway", { recursive: true });
  const files = names.filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts")).map((name) => path.join("src/gateway", name));
  const source = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");
  expect(source).not.toMatch(/createServer\s*\(|WebSocketServer|\.listen\s*\(/);
});
```

- [ ] **Step 5: Run gateway tests and typecheck**

Run: `npm test -- src/gateway && npm run typecheck`

Expected: all gateway tests PASS, the no-listener guard passes, and typecheck exits `0`.

- [ ] **Step 6: Commit runtime composition**

```bash
git add src/gateway/gatewayRuntime.ts src/gateway/gatewayRuntime.test.ts
git commit -m "feat: compose outbound-only gateway runtime"
```

### Task 13: Add tray lifecycle, DPAPI binding, auto-start, and gateway IPC

**Files:**
- Create: `src/main/windowLifecycle.ts`
- Create: `src/main/windowLifecycle.test.ts`
- Create: `src/main/trayController.ts`
- Create: `src/main/gatewayServices.ts`
- Modify: `src/core/settings.ts`
- Modify: `src/core/emailSource.test.ts`
- Modify: `src/main/main.ts`
- Modify: `src/main/ipcHandlers.ts`
- Modify: `src/preload/preload.cts`
- Modify: `src/shared/types.ts`
- Modify: `src/main/preloadBridge.test.ts`
- Modify: `src/shared/types.ts`

**Interfaces:**
- Consumes: Electron `safeStorage`, `app.setLoginItemSettings`, `Tray`, `Menu`, and `GatewayRuntime`.
- Produces: `GatewayDesktopServices` with load/save/status/sync methods, close-to-tray window behavior, explicit confirmed exit, opt-in Windows login registration, and preload methods `loadGatewaySettings`, `saveGatewaySettings`, `gatewayStatus`, `syncGatewayNow`, and `onGatewayStatus`.

- [ ] **Step 1: Write pure window-lifecycle tests**

```typescript
import { expect, test, vi } from "vitest";
import { handleMainWindowClose } from "./windowLifecycle.js";
import { loginExecutablePath } from "./gatewayServices.js";

test("hides instead of quitting while gateway tray lifecycle is active", () => {
  const event = { preventDefault: vi.fn() }; const window = { hide: vi.fn() };
  expect(handleMainWindowClose(event, window, false)).toBe("hidden");
  expect(event.preventDefault).toHaveBeenCalled(); expect(window.hide).toHaveBeenCalled();
});

test("allows close during explicit application exit", () => {
  const event = { preventDefault: vi.fn() }; const window = { hide: vi.fn() };
  expect(handleMainWindowClose(event, window, true)).toBe("closed");
  expect(event.preventDefault).not.toHaveBeenCalled();
});

test("uses the stable outer portable exe for Windows login startup", () => {
  vi.stubGlobal("process", { ...process, platform: "win32", env: { ...process.env, PORTABLE_EXECUTABLE_FILE: "C:\\Users\\Office\\Orderflow\\orderflow-desktop-windows.exe" }, execPath: "C:\\Temp\\portable-app.exe" });
  expect(loginExecutablePath()).toBe("C:\\Users\\Office\\Orderflow\\orderflow-desktop-windows.exe");
  vi.unstubAllGlobals();
});
```

- [ ] **Step 2: Extend the preload contract test before implementation**

Add exact expectations:

```typescript
expect(source).toContain('ipcRenderer.invoke("gateway:settings:load")');
expect(source).toContain('ipcRenderer.invoke("gateway:settings:save", settings)');
expect(source).toContain('ipcRenderer.invoke("gateway:status")');
expect(source).toContain('ipcRenderer.invoke("gateway:sync-now")');
expect(source).toContain('ipcRenderer.on("gateway:status", listener)');
expect(source).not.toContain('ipcRenderer.invoke("settings:load")');
```

- [ ] **Step 3: Run lifecycle/preload tests and confirm they fail**

Run: `npm test -- src/main/windowLifecycle.test.ts src/main/preloadBridge.test.ts`

Expected: FAIL because the lifecycle module and gateway IPC methods do not exist.

- [ ] **Step 4: Implement the pure lifecycle helper**

```typescript
interface CloseEvent { preventDefault(): void; }
interface HideableWindow { hide(): void; }
export function handleMainWindowClose(event: CloseEvent, window: HideableWindow, exiting: boolean): "hidden" | "closed" {
  if (exiting) return "closed";
  event.preventDefault(); window.hide(); return "hidden";
}
```

- [ ] **Step 5: Implement `GatewayDesktopServices` with Electron security and startup bindings**

Before adding the service binding, delete `loadEmailSettings` and `saveEmailSettings` from `src/core/settings.ts`, delete their plaintext persistence tests/imports from `src/core/emailSource.test.ts`, and keep only `defaultEmailSettingsPath()` so startup can remove the legacy file. Delete `EmailSettings` from `src/shared/types.ts` and define `ImapConfig` directly as `{ email: string; authCode: string; server: string; port: number; proxy?: string }`. No active code may write `email_settings.json`.

The complete remaining `settings.ts` is:

```typescript
import os from "node:os";
import path from "node:path";
export function appConfigDir(): string { return path.join(os.homedir(), ".order_organizer_assistant"); }
export function defaultEmailSettingsPath(): string { return path.join(appConfigDir(), "email_settings.json"); }
export function defaultEmailDownloadRoot(): string { return path.join(appConfigDir(), "email_attachments"); }
```

The replacement shared type is:

```typescript
export interface ImapConfig { email: string; authCode: string; server: string; port: number; proxy?: string; }
```

```typescript
import { app, safeStorage } from "electron";
import { rm } from "node:fs/promises";
import path from "node:path";
import { CURRENT_RELEASE_TAG } from "../core/buildInfo.js";
import { DEFAULT_IMAP_PORT, DEFAULT_IMAP_SERVER, downloadSelectedExcelAttachments, listRecentEmailMessages } from "../core/emailSource.js";
import { runPythonOrderExtraction } from "../core/pythonExtractor.js";
import { appConfigDir, defaultEmailSettingsPath } from "../core/settings.js";
import type { ImapConfig } from "../shared/types.js";
import type { GatewayRuntimeStatus, SaveGatewaySettingsInput } from "../shared/gatewayProtocol.js";
import { GatewayAgentClient } from "../gateway/gatewayAgentClient.js";
import { GatewayAuditLogger } from "../gateway/gatewayAuditLog.js";
import { GatewayCredentialStore } from "../gateway/gatewayCredentialStore.js";
import { GatewayJobRunner } from "../gateway/gatewayJobRunner.js";
import { GatewayMailboxMonitor, waitForImapChange } from "../gateway/gatewayMailboxMonitor.js";
import { GatewayRuntime } from "../gateway/gatewayRuntime.js";
import { GatewayStateStore } from "../gateway/gatewayStateStore.js";

export class GatewayDesktopServices {
  readonly credentials = new GatewayCredentialStore(path.join(appConfigDir(), "gateway", "settings.json"), {
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptString: (value) => safeStorage.encryptString(value),
    decryptString: (value) => safeStorage.decryptString(value),
  });
  constructor(readonly runtime: GatewayRuntime) {}
  async initialize(): Promise<void> { await rm(defaultEmailSettingsPath(), { force: true }); await this.runtime.start(await this.credentials.loadCredentials()); }
  loadSettings() { return this.credentials.loadView(); }
  status(): GatewayRuntimeStatus { return this.runtime.status; }
  async saveSettings(input: SaveGatewaySettingsInput) { const view = await this.credentials.save(input); app.setLoginItemSettings({ openAtLogin: process.platform === "win32" && view.enabled && view.startAtLogin, path: loginExecutablePath(), args: [] }); await this.runtime.reconfigure(await this.credentials.loadCredentials()); return view; }
  syncNow(): Promise<void> { return this.runtime.syncNow(); }
}

export function loginExecutablePath(): string { return process.platform === "win32" && process.env.PORTABLE_EXECUTABLE_FILE ? process.env.PORTABLE_EXECUTABLE_FILE : process.execPath; }

export function createGatewayDesktopServices(onStatus: (status: GatewayRuntimeStatus) => void): GatewayDesktopServices {
  const root = path.join(appConfigDir(), "gateway");
  const state = new GatewayStateStore(root);
  const log = new GatewayAuditLogger(path.join(root, "logs"));
  const runtime = new GatewayRuntime({
    create(credentials, mailboxId, emitStatus) {
      const imapConfig: ImapConfig = { email: credentials.email, authCode: credentials.authCode, server: DEFAULT_IMAP_SERVER, port: DEFAULT_IMAP_PORT };
      let transportStatus: GatewayRuntimeStatus = { state: "reconnecting", detail: "Connecting to gateway service" };
      let mailboxStatus: GatewayRuntimeStatus = { state: "reconnecting", detail: "Connecting to mailbox" };
      let agent!: GatewayAgentClient;
      const combined = (): GatewayRuntimeStatus => mailboxStatus.state === "attention_required" ? mailboxStatus : transportStatus.state === "reconnecting" ? transportStatus : mailboxStatus.state === "reconnecting" ? mailboxStatus : { ...mailboxStatus, state: "connected" };
      const reportTransport = (status: GatewayRuntimeStatus) => { transportStatus = status; emitStatus(combined()); };
      const reportMailbox = (status: GatewayRuntimeStatus) => { mailboxStatus = status; emitStatus(combined()); if (agent) void agent.sendHeartbeat().catch(() => undefined); };
      let runner!: GatewayJobRunner;
      agent = new GatewayAgentClient({ serverUrl: credentials.serverUrl, agentToken: credentials.agentToken, mailboxId, version: CURRENT_RELEASE_TAG, onStatus: reportTransport, runtimeState: () => { const state = combined().state; return state === "stopped" ? "reconnecting" : state; }, onCommand: (command) => void runner.accept(command) });
      runner = new GatewayJobRunner({ imapConfig, state, download: downloadSelectedExcelAttachments, extract: runPythonOrderExtraction, acceptJob: (jobId) => agent.acceptJob(jobId), failJob: (jobId, error, failures) => agent.failJob(jobId, error, failures), uploadResult: (jobId, upload) => agent.uploadResult(jobId, upload), log });
      const monitor = new GatewayMailboxMonitor({ mailboxId, scan: (afterUid) => listRecentEmailMessages(imapConfig, { days: 7, afterUid }), waitForChange: (signal) => waitForImapChange(imapConfig, signal), state, sendSync: (request) => agent.sendSync(request), onStatus: reportMailbox, log });
      return { agent, monitor, runner };
    },
  });
  runtime.subscribe(onStatus);
  return new GatewayDesktopServices(runtime);
}
```

- [ ] **Step 6: Implement tray states and actions**

```typescript
import { BrowserWindow, Menu, Tray, app, dialog, nativeImage } from "electron";
import type { GatewayRuntimeStatus } from "../shared/gatewayProtocol.js";

export class TrayController {
  private tray?: Tray;
  private status: GatewayRuntimeStatus = { state: "stopped", detail: "Gateway stopped" };
  constructor(private readonly window: () => BrowserWindow | undefined, private readonly syncNow: () => Promise<void>, private readonly requestExit: () => Promise<void>) {}
  create(): void { if (this.tray) return; this.tray = new Tray(iconFor(this.status.state)); this.tray.on("double-click", () => this.showWindow()); this.render(); }
  update(status: GatewayRuntimeStatus): void { this.status = status; if (this.tray) { this.tray.setImage(iconFor(status.state)); this.render(); } }
  destroy(): void { this.tray?.destroy(); this.tray = undefined; }
  private showWindow(): void { const window = this.window(); if (!window) return; if (window.isMinimized()) window.restore(); window.show(); window.focus(); }
  private render(): void { if (!this.tray) return; this.tray.setToolTip(`订单整理助手 - ${label(this.status)}`); this.tray.setContextMenu(Menu.buildFromTemplate([{ label: "打开应用", click: () => this.showWindow() }, { label: "立即同步", enabled: this.status.state !== "attention_required", click: () => void this.syncNow() }, { label: `状态：${label(this.status)}`, enabled: false }, { type: "separator" }, { label: "退出网关", click: () => void this.requestExit() }])); }
}

export async function confirmGatewayExit(window?: BrowserWindow): Promise<boolean> { const options = { type: "warning", buttons: ["取消", "退出"], defaultId: 0, cancelId: 0, title: "退出办公室邮件网关", message: "退出后其他电脑仍可查看缓存邮件，但无法同步新邮件或提取。" } satisfies Electron.MessageBoxOptions; const target = window ?? BrowserWindow.getFocusedWindow(); const result = target ? await dialog.showMessageBox(target, options) : await dialog.showMessageBox(options); return result.response === 1; }
function label(status: GatewayRuntimeStatus): string { return status.state === "connected" ? "已连接" : status.state === "reconnecting" ? "正在重连" : status.state === "attention_required" ? "需要处理" : "已停止"; }
function iconFor(state: GatewayRuntimeStatus["state"]) { const color = state === "connected" ? "#16803c" : state === "attention_required" ? "#c42b1c" : "#b26a00"; const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect x="3" y="6" width="26" height="20" rx="4" fill="${color}"/><path d="M5 9l11 8 11-8" fill="none" stroke="white" stroke-width="2"/></svg>`; return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`).resize({ width: 16, height: 16 }); }
```

- [ ] **Step 7: Update `main.ts` to keep the Windows app alive in the tray**

Use one `BrowserWindow` reference, one `exiting` flag, and this lifecycle:

```typescript
let mainWindow: BrowserWindow | undefined;
let exiting = false;
const services = createGatewayDesktopServices((status) => { tray?.update(status); mainWindow?.webContents.send("gateway:status", status); });
let tray: TrayController | undefined;

app.whenReady().then(async () => {
  registerIpcHandlers(services);
  mainWindow = await createWindow();
  mainWindow.on("close", (event) => handleMainWindowClose(event, mainWindow!, exiting));
  tray = new TrayController(() => mainWindow, () => services.syncNow(), async () => { if (!(await confirmGatewayExit(mainWindow))) return; exiting = true; await services.runtime.stop(); tray?.destroy(); app.quit(); });
  tray.create(); await services.initialize();
  app.on("activate", () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } else void createWindow().then((window) => { mainWindow = window; window.on("close", (event) => handleMainWindowClose(event, window, exiting)); }); });
});

app.on("window-all-closed", () => { if (process.platform === "darwin" && !exiting) return; if (exiting) app.quit(); });
app.on("before-quit", () => { exiting = true; });
```

Move the existing early `registerIpcHandlers()` call into `whenReady`; preserve current BrowserWindow security options.

- [ ] **Step 8: Replace plaintext settings IPC and expose gateway methods**

In `registerIpcHandlers(services: GatewayDesktopServices)`, remove `settings:load` and `settings:save`, then add:

```typescript
ipcMain.handle("gateway:settings:load", () => services.loadSettings());
ipcMain.handle("gateway:settings:save", (_event, input: SaveGatewaySettingsInput) => services.saveSettings(input));
ipcMain.handle("gateway:status", () => services.status());
ipcMain.handle("gateway:sync-now", () => services.syncNow());
```

Extend `OrderOrganizerApi` and `api` in preload:

```typescript
loadGatewaySettings: () => Promise<GatewaySettingsView>;
saveGatewaySettings: (settings: SaveGatewaySettingsInput) => Promise<GatewaySettingsView>;
gatewayStatus: () => Promise<GatewayRuntimeStatus>;
syncGatewayNow: () => Promise<void>;
onGatewayStatus: (callback: (status: GatewayRuntimeStatus) => void) => () => void;
```

```typescript
loadGatewaySettings: () => ipcRenderer.invoke("gateway:settings:load"),
saveGatewaySettings: (settings) => ipcRenderer.invoke("gateway:settings:save", settings),
gatewayStatus: () => ipcRenderer.invoke("gateway:status"),
syncGatewayNow: () => ipcRenderer.invoke("gateway:sync-now"),
onGatewayStatus: (callback) => { const listener = (_event: Electron.IpcRendererEvent, status: GatewayRuntimeStatus) => callback(status); ipcRenderer.on("gateway:status", listener); return () => ipcRenderer.off("gateway:status", listener); },
```

- [ ] **Step 9: Run main/preload/gateway tests and build**

Run: `npm test -- src/main/windowLifecycle.test.ts src/main/preloadBridge.test.ts src/gateway && npm run typecheck && npm run build:main`

Expected: tests PASS, typecheck/build exit `0`, and `rg "authCode.*JSON.stringify|settings:load|settings:save" src/main src/gateway` prints no plaintext-settings handler.

- [ ] **Step 10: Commit tray, DPAPI, startup, and IPC integration**

```bash
git add src/main/windowLifecycle.ts src/main/windowLifecycle.test.ts src/main/trayController.ts src/main/gatewayServices.ts src/main/main.ts src/main/ipcHandlers.ts src/preload/preload.cts src/main/preloadBridge.test.ts src/core/settings.ts src/core/emailSource.test.ts src/shared/types.ts
git commit -m "feat: run office gateway from windows tray"
```

### Task 14: Convert the desktop remote API client to cache and asynchronous jobs

**Files:**
- Replace: `src/core/remoteEmailApi.ts`
- Replace: `src/core/remoteEmailApi.test.ts`
- Modify: `src/main/emailActions.ts`
- Modify: `src/main/emailActions.test.ts`
- Modify: `src/main/ipcHandlers.ts`
- Modify: `src/preload/preload.cts`

**Interfaces:**
- Consumes: client `baseUrl`/token only; never mailbox credentials.
- Produces: `RemoteEmailApiClient.listEmails(GatewayEmailListRequest)`, `extractEmail(CreateExtractionJobRequest, onJob?)`, and `subscribeEvents(onEvent)`. Extraction polls until terminal if SSE is interrupted, downloads the gateway-produced workbook, and returns existing `EmailExtractionResult` with local output paths.

- [ ] **Step 1: Replace old credential-leak tests with cache/job tests**

```typescript
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import type { GatewayEmailListResult, GatewayJobState, GatewaySseEvent, ExtractionJobView } from "../shared/gatewayProtocol.js";
import { RemoteEmailApiClient } from "./remoteEmailApi.js";

test("posts only days to the cached message endpoint", async () => {
  const received: unknown[] = []; const baseUrl = await listenJson((request, body) => { received.push({ url: request.url, body }); return emptyGatewayList(); });
  await new RemoteEmailApiClient({ baseUrl, token: "client-token" }).listEmails({ days: 7 });
  expect(received).toEqual([{ url: "/api/email/messages", body: { days: 7 } }]);
  expect(JSON.stringify(received)).not.toContain("authCode");
});

test("creates, polls, downloads, and stores the completed gateway workbook", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "remote-job-")); let polls = 0;
  const baseUrl = await listenRaw((request, response, body) => {
    if (request.url === "/api/email/extract") return sendJson(response, 202, job("queued"));
    if (request.url === "/api/email/jobs/job-1") return sendJson(response, 200, ++polls < 2 ? job("running") : completedJob());
    if (request.url === "/api/email/jobs/job-1/workbook") { response.writeHead(200, { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }); response.end(Buffer.from("office-workbook")); return; }
    sendJson(response, 404, {});
  });
  const result = await new RemoteEmailApiClient({ baseUrl, token: "client-token" }, { emailOutputRoot: root, pollMs: 1 }).extractEmail({ messageUids: ["101"], inferManual: true });
  expect(await readFile(result.extraction.outputs.xlsxOutput)).toEqual(Buffer.from("office-workbook"));
});

test("parses new-message, gateway-status, and job-status SSE events", async () => {
  const events: GatewaySseEvent[] = []; const client = new RemoteEmailApiClient({ baseUrl: await sseServer(), token: "client-token" });
  await client.subscribeEvents((event) => events.push(event));
  expect(events.map((event) => event.type)).toEqual(["new-messages", "gateway-status", "job-status"]);
});

let activeServer: Server | undefined;
afterEach(async () => { if (activeServer?.listening) await new Promise<void>((resolve) => activeServer!.close(() => resolve())); activeServer = undefined; });
function emptyGatewayList(): GatewayEmailListResult { return { days: 7, scannedMessages: 0, orderAttachmentCount: 0, nonOrderExcelAttachmentCount: 0, messages: [], gateway: { state: "online", stale: false, lastSyncAt: "2026-07-10T00:00:00Z" } }; }
function job(state: GatewayJobState): ExtractionJobView { return { id: "job-1", state, messageUids: ["101"], inferManual: true, requestedAt: "2026-07-10T00:00:00Z", updatedAt: "2026-07-10T00:00:01Z", expiresAt: "2026-07-10T00:15:00Z" }; }
function completedJob(): ExtractionJobView { return { ...job("completed"), result: { emailFetch: { scannedMessages: 1, attachmentCount: 1 }, extraction: { inputFiles: ["order.xlsx"], rows: [], skippedFiles: [], failures: [], outputs: { outputDir: "", csvOutput: "", xlsxOutput: "", auditOutput: "" } }, workbookUrl: "/api/email/jobs/job-1/workbook", checksum: "checksum" } }; }
async function listenJson(handler: (request: IncomingMessage, body: unknown) => unknown): Promise<string> { return listenRaw(async (request, response, body) => sendJson(response, 200, await handler(request, body))); }
async function listenRaw(handler: (request: IncomingMessage, response: ServerResponse, body: unknown) => void | Promise<void>): Promise<string> { activeServer = createServer((request, response) => { void (async () => { const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk)); const text = Buffer.concat(chunks).toString("utf8"); await handler(request, response, text ? JSON.parse(text) : undefined); })(); }); await new Promise<void>((resolve) => activeServer!.listen(0, "127.0.0.1", resolve)); return `http://127.0.0.1:${(activeServer.address() as { port: number }).port}`; }
async function sseServer(): Promise<string> { return listenRaw((_request, response) => { response.writeHead(200, { "Content-Type": "text/event-stream" }); response.end([`event: new-messages\ndata: ${JSON.stringify({ mailboxId: "mailbox", days: 7, messages: [] })}\n\n`, `event: gateway-status\ndata: ${JSON.stringify({ gateway: { state: "online", stale: false } })}\n\n`, `event: job-status\ndata: ${JSON.stringify({ job: job("running") })}\n\n`].join("")); }); }
function sendJson(response: ServerResponse, status: number, body: unknown): void { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(body)); }
```

- [ ] **Step 2: Run remote-client tests and confirm old synchronous behavior fails**

Run: `npm test -- src/core/remoteEmailApi.test.ts src/main/emailActions.test.ts`

Expected: FAIL because the old client sends mailbox credentials and expects a synchronous extraction result.

- [ ] **Step 3: Implement cache list, job polling, workbook download, and typed SSE**

Keep the current config loading functions, `fetchRemote`, and SSE line parser; replace the class methods with:

```typescript
async listEmails(request: GatewayEmailListRequest): Promise<GatewayEmailListResult> { return this.post("/api/email/messages", { days: request.days }); }

async extractEmail(request: CreateExtractionJobRequest, onJob: (job: ExtractionJobView) => void = () => undefined): Promise<EmailExtractionResult> {
  let job = await this.post<ExtractionJobView>("/api/email/extract", { messageUids: request.messageUids, inferManual: request.inferManual }); onJob(job);
  const deadline = Date.parse(job.expiresAt) + 90_000;
  while (!isTerminalGatewayJobState(job.state)) { await delay(this.pollMs); try { job = await this.get<ExtractionJobView>(`/api/email/jobs/${job.id}`); onJob(job); } catch (error) { if (job.state === "queued" && Date.now() > deadline) throw error; } }
  if (job.state !== "completed" || !job.result) throw new Error(job.error || `提取任务${job.state}`);
  const workbook = await this.getBytes(job.result.workbookUrl); const outputs = defaultOutputPaths(timestampedEmailOutputDir(this.now(), this.emailOutputRoot)); await mkdir(outputs.outputDir, { recursive: true }); await writeFile(outputs.xlsxOutput, workbook);
  return { emailFetch: { files: [], scannedMessages: job.result.emailFetch.scannedMessages, attachmentCount: job.result.emailFetch.attachmentCount, downloadDir: outputs.outputDir }, extraction: { ...job.result.extraction, outputs } };
}

async subscribeEvents(onEvent: (event: GatewaySseEvent) => void, options: { signal?: AbortSignal } = {}): Promise<void> {
  const response = await this.request("/api/email/events", { method: "GET", signal: options.signal }); if (!response.body) throw new Error("远程邮件服务事件流不可读。");
  await readSseEvents(response.body, (eventName, data) => { if (!data || !["new-messages", "gateway-status", "job-status"].includes(eventName)) return; onEvent({ type: eventName, data: JSON.parse(data) } as GatewaySseEvent); });
}
```

Add exact helpers and fields:

```typescript
private readonly pollMs: number;
private async request(pathname: string, init: RequestInit): Promise<Response> { const headers = new Headers(init.headers); if (this.token) headers.set("Authorization", `Bearer ${this.token}`); const response = await fetchRemote(`${this.baseUrl}${pathname}`, { ...init, headers }, this.baseUrl); if (!response.ok) { const text = await response.text(); throw new Error(errorMessage(text, response.statusText)); } return response; }
private async get<T>(pathname: string): Promise<T> { const response = await this.request(pathname, { method: "GET" }); return JSON.parse(await response.text()) as T; }
private async getBytes(pathname: string): Promise<Buffer> { return Buffer.from(await (await this.request(pathname, { method: "GET" })).arrayBuffer()); }
private async post<T>(pathname: string, body: unknown): Promise<T> { const response = await this.request(pathname, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); return JSON.parse(await response.text()) as T; }
function delay(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
function errorMessage(text: string, fallback: string): string { try { const parsed = JSON.parse(text) as { error?: unknown }; return typeof parsed.error === "string" ? parsed.error : fallback; } catch { return fallback; } }
```

Set `this.pollMs = options.pollMs ?? 1_000` in the constructor and add `pollMs?: number` to options.
Delete the old `extractLocal()` method and its `/api/orders/extract` tests from this client. `extractDesktopLocalOrders` continues to call the local Python bridge directly and never depends on the broker.

- [ ] **Step 4: Make email actions remote-only while preserving local-file extraction**

Replace `listDesktopEmails` and `extractDesktopEmailOrders` signatures with protocol request types. If no remote config exists, throw `未配置共享邮件服务地址。` rather than falling back to direct IMAP. Keep `extractDesktopLocalOrders` exactly on `extractLocalOrders`/the Python bridge. Replace `subscribeDesktopEmailUpdates` with `subscribeDesktopEmailEvents(onEvent)` and forward all three SSE event types.

```typescript
export interface RemoteEmailClient { listEmails(request: GatewayEmailListRequest): Promise<GatewayEmailListResult>; extractEmail(request: CreateExtractionJobRequest, onJob?: (job: ExtractionJobView) => void): Promise<EmailExtractionResult>; subscribeEvents(onEvent: (event: GatewaySseEvent) => void, options?: { signal?: AbortSignal }): Promise<void>; }
export async function listDesktopEmails(request: GatewayEmailListRequest, dependencies: DesktopEmailDependencies = {}): Promise<GatewayEmailListResult> { const client = await requireRemoteClient(dependencies); return client.listEmails(request); }
export async function extractDesktopEmailOrders(request: CreateExtractionJobRequest, onJob?: (job: ExtractionJobView) => void, dependencies: DesktopEmailDependencies = {}): Promise<EmailExtractionResult> { const client = await requireRemoteClient(dependencies); return client.extractEmail(request, onJob); }
async function requireRemoteClient(dependencies: DesktopEmailDependencies): Promise<RemoteEmailClient> { const client = await loadConfiguredRemoteEmailClient(dependencies); if (!client) throw new Error("未配置共享邮件服务地址。"); return client; }
export async function subscribeDesktopEmailEvents(onEvent: (event: GatewaySseEvent) => void, dependencies: DesktopEmailDependencies = {}): Promise<DesktopEmailSubscription> { const client = await requireRemoteClient(dependencies); const controller = new AbortController(); void (async () => { let attempt = 0; while (!controller.signal.aborted) { try { await client.subscribeEvents(onEvent, { signal: controller.signal }); attempt = 0; } catch (error) { if (controller.signal.aborted) return; console.warn(`Remote gateway event subscription failed: ${safeMessage(error)}`); } attempt += 1; await abortableDelay(Math.min(60_000, 1_000 * 2 ** Math.min(attempt - 1, 6)), controller.signal); } })(); return { close: () => controller.abort() }; }
function safeMessage(error: unknown): string { return (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, " ").slice(0, 300); }
function abortableDelay(ms: number, signal: AbortSignal): Promise<void> { return new Promise((resolve) => { const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); }; const timer = setTimeout(finish, ms); signal.addEventListener("abort", finish, { once: true }); }); }
```

- [ ] **Step 5: Forward job and SSE events through IPC/preload**

Replace the email IPC handlers with:

```typescript
ipcMain.handle("emails:list", async (_event, payload: GatewayEmailListRequest) => listDesktopEmails(payload));
ipcMain.handle("emails:subscribe-updates", async (event): Promise<boolean> => {
  closeEmailUpdateSubscription(event.sender.id);
  const subscription = await subscribeDesktopEmailEvents((gatewayEvent) => { if (!event.sender.isDestroyed()) event.sender.send("emails:event", gatewayEvent); });
  emailUpdateSubscriptions.set(event.sender.id, subscription);
  event.sender.once("destroyed", () => closeEmailUpdateSubscription(event.sender.id));
  return true;
});
ipcMain.handle("orders:extract-email", async (event, payload: CreateExtractionJobRequest) =>
  extractDesktopEmailOrders(payload, (job) => { if (!event.sender.isDestroyed()) event.sender.send("emails:job-status", job); }),
);
```

Replace the preload email contract and callbacks with:

```typescript
listEmails: (payload: GatewayEmailListRequest) => Promise<GatewayEmailListResult>;
extractEmail: (payload: CreateExtractionJobRequest) => Promise<EmailExtractionResult>;
onEmailEvent: (callback: (event: GatewaySseEvent) => void) => () => void;
onEmailJobStatus: (callback: (job: ExtractionJobView) => void) => () => void;
```

```typescript
listEmails: (payload) => ipcRenderer.invoke("emails:list", payload),
extractEmail: (payload) => ipcRenderer.invoke("orders:extract-email", payload),
onEmailEvent: (callback) => { const listener = (_event: Electron.IpcRendererEvent, gatewayEvent: GatewaySseEvent) => callback(gatewayEvent); ipcRenderer.on("emails:event", listener); return () => ipcRenderer.off("emails:event", listener); },
onEmailJobStatus: (callback) => { const listener = (_event: Electron.IpcRendererEvent, job: ExtractionJobView) => callback(job); ipcRenderer.on("emails:job-status", listener); return () => ipcRenderer.off("emails:job-status", listener); },
```

Remove the old `EmailListRequest`/`EmailExtractionRequest` bridge imports and `onEmailUpdate` method so renderer code cannot send mailbox credentials.
Delete the old `EmailNewMessagesEvent` declaration from `src/shared/types.ts`; import the protocol event from `src/shared/gatewayProtocol.ts` everywhere so only one event shape exists.

- [ ] **Step 6: Run remote client, action, preload, and type tests**

Run: `npm test -- src/core/remoteEmailApi.test.ts src/main/emailActions.test.ts src/main/preloadBridge.test.ts src/shared/gatewayProtocol.test.ts && npm run typecheck`

Expected: all tests PASS; `rg "authCode" src/core/remoteEmailApi.ts src/main/emailActions.ts src/preload/preload.cts` prints no matches.

- [ ] **Step 7: Commit the shared-client API migration**

```bash
git add src/core/remoteEmailApi.ts src/core/remoteEmailApi.test.ts src/main/emailActions.ts src/main/emailActions.test.ts src/main/ipcHandlers.ts src/preload/preload.cts src/main/preloadBridge.test.ts src/shared/types.ts
git commit -m "feat: consume shared gateway cache and jobs"
```

### Task 15: Show shared gateway state and office setup in the renderer

**Files:**
- Create: `src/renderer/gatewayViewState.ts`
- Create: `src/renderer/gatewayViewState.test.ts`
- Modify: `src/renderer/app.tsx`
- Modify: `src/renderer/styles.css`

**Interfaces:**
- Consumes: `GatewayEmailListResult.gateway`, gateway/job SSE events, local `GatewaySettingsView`, and runtime status.
- Produces: always-visible status banner, last-sync time, cached list while offline, disabled email extraction while offline, job phase text, remote workbook action, and opt-in office gateway setup. Standard clients never see or need mailbox credentials unless the user opens gateway setup and enables this machine.

- [ ] **Step 1: Write pure presentation-state tests**

```typescript
import { expect, test } from "vitest";
import { gatewayBanner, gatewayExtractionDisabled, jobLabel } from "./gatewayViewState.js";

test("keeps cached list visible but disables extraction offline", () => {
  const status = { state: "offline", stale: true, lastSyncAt: "2026-07-10T01:02:03Z" } as const;
  expect(gatewayBanner(status)).toMatchObject({ tone: "warning", text: expect.stringContaining("缓存邮件") });
  expect(gatewayExtractionDisabled(status)).toBe(true);
});

test("shows credential attention without treating the cache as fresh", () => {
  const status = { state: "attention_required", stale: true, lastSyncAt: "2026-07-10T01:02:03Z" } as const;
  expect(gatewayBanner(status).text).toContain("更新邮箱凭据"); expect(gatewayExtractionDisabled(status)).toBe(true);
});

test.each([["queued", "排队中"], ["dispatched", "已发送到办公室网关"], ["running", "正在提取"], ["completed", "已完成"], ["failed", "失败"], ["expired", "已过期"]] as const)("labels %s", (state, label) => expect(jobLabel(state)).toBe(label));
```

- [ ] **Step 2: Run the presentation test and confirm the helper is missing**

Run: `npm test -- src/renderer/gatewayViewState.test.ts`

Expected: FAIL with missing `gatewayViewState.js`.

- [ ] **Step 3: Implement presentation rules**

```typescript
import type { GatewayJobState, GatewayStatus } from "../shared/gatewayProtocol.js";
export function gatewayBanner(status: GatewayStatus): { tone: "success" | "warning"; text: string } { if (status.state === "online") return { tone: "success", text: `Gateway online · 上次同步 ${format(status.lastSyncAt)}` }; if (status.state === "attention_required") return { tone: "warning", text: `办公室网关需要更新邮箱凭据 · 显示缓存邮件 · 上次同步 ${format(status.lastSyncAt)}` }; return { tone: "warning", text: `办公室网关离线 · 显示缓存邮件 · 上次同步 ${format(status.lastSyncAt)}` }; }
export function gatewayExtractionDisabled(status: GatewayStatus | undefined): boolean { return !status || status.state !== "online"; }
export function jobLabel(state: GatewayJobState): string { return { queued: "排队中", dispatched: "已发送到办公室网关", running: "正在提取", completed: "已完成", failed: "失败", expired: "已过期" }[state]; }
function format(value?: string): string { return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "尚未同步"; }
```

- [ ] **Step 4: Refactor app state and email calls**

Remove renderer `email`/`authCode` as prerequisites for shared list calls. Call:

```typescript
const result = await api.listEmails({ days: EMAIL_LIST_DAYS });
setGatewayStatus(result.gateway);
```

Set `const canUseEmail = !bridgeMissing`, initialize the mail status to `正在连接共享邮件服务`, and replace the old empty text with `暂无缓存候选邮件，点击刷新邮件重试。`. Delete `DEFAULT_IMAP_SERVER`, `DEFAULT_IMAP_PORT`, and every renderer request field named `email`, `authCode`, `server`, or `port`.

Call extraction with:

```typescript
const result = await api.extractEmail({ messageUids: selectedExtractableUids, inferManual: true });
```

Use a constant storage scope such as `"shared-gateway-mailbox"` for extracted UID UI state, because client responses no longer reveal the mailbox address. Keep the current five-minute refresh as a safety fallback and merge `new-messages` events immediately.

- [ ] **Step 5: Add the persistent status banner and job progress**

Place this immediately above the mail list workspace:

```tsx
{gatewayStatus && <div className={`gateway-banner ${gatewayBanner(gatewayStatus).tone}`} role="status"><span>{gatewayBanner(gatewayStatus).text}</span><Button size="small" onClick={() => refreshEmails("manual")}>刷新缓存</Button></div>}
{activeJob && <div className="gateway-job-status" aria-live="polite"><div>任务 {activeJob.id.slice(0, 8)} · {jobLabel(activeJob.state)}{activeJob.error ? ` · ${activeJob.error}` : ""}</div>{activeJob.failures?.map((failure) => <div key={`${failure.path}:${failure.error}`}>{failure.path || "任务"}：{failure.error}</div>)}</div>}
```

Set the selected-email button's disabled expression to:

```tsx
disabled={busy || selectedExtractableUids.length === 0 || gatewayExtractionDisabled(gatewayStatus)}
```

Do not clear `emailMessages` when the status changes to offline.

- [ ] **Step 6: Replace mailbox settings with opt-in office gateway setup**

Add these state values and initialization. Password fields start empty, so decrypted secrets never return to the renderer:

```typescript
const [gatewaySettings, setGatewaySettings] = useState<GatewaySettingsView>({ enabled: false, email: "", serverUrl: "https://orderflow.ausmet.ai", startAtLogin: false, hasAuthCode: false, hasAgentToken: false });
const [gatewayRuntimeStatus, setGatewayRuntimeStatus] = useState<GatewayRuntimeStatus>({ state: "stopped", detail: "Gateway disabled" });
const [gatewaySetupOpen, setGatewaySetupOpen] = useState(false);
const [gatewayEnabled, setGatewayEnabled] = useState(false);
const [gatewayEmail, setGatewayEmail] = useState("");
const [newAuthCode, setNewAuthCode] = useState("");
const [newAgentToken, setNewAgentToken] = useState("");
const [startAtLogin, setStartAtLogin] = useState(false);

useEffect(() => {
  void api.loadGatewaySettings().then((settings) => { setGatewaySettings(settings); setGatewayEnabled(settings.enabled); setGatewayEmail(settings.email); setStartAtLogin(settings.startAtLogin); });
  void api.gatewayStatus().then((status) => setGatewayRuntimeStatus(status));
  return api.onGatewayStatus((status) => setGatewayRuntimeStatus(status));
}, []);

const saveGatewaySetup = async () => {
  const saved = await api.saveGatewaySettings({ enabled: gatewayEnabled, email: gatewayEmail, authCode: newAuthCode || undefined, agentToken: newAgentToken || undefined, serverUrl: "https://orderflow.ausmet.ai", startAtLogin });
  setGatewaySettings(saved); setNewAuthCode(""); setNewAgentToken(""); setGatewaySetupOpen(false);
};
```

Render this card in the side column:

```tsx
<Card className="surface settings-card">
  <div className="section-heading"><div><div className="section-title">办公室网关设置</div><div className="section-subtitle">只有持续开机的办公室电脑需要启用。</div></div><Button size="small" onClick={() => setGatewaySetupOpen((value) => !value)}>{gatewaySetupOpen ? "收起" : "设置"}</Button></div>
  {gatewaySetupOpen && <div className="settings-grid">
    <Checkbox label="启用此电脑作为办公室网关" checked={gatewayEnabled} onChange={(_, data) => setGatewayEnabled(Boolean(data.checked))} />
    <Field label="企业微信邮箱"><Input autoComplete="username" value={gatewayEmail} onChange={(_, data) => setGatewayEmail(data.value)} /></Field>
    <Field label="新授权码"><Input type="password" autoComplete="new-password" value={newAuthCode} onChange={(_, data) => setNewAuthCode(data.value)} /><span className="gateway-secret-state">{gatewaySettings.hasAuthCode ? "已安全保存" : "尚未保存"}</span></Field>
    <Field label="Agent token"><Input type="password" autoComplete="new-password" value={newAgentToken} onChange={(_, data) => setNewAgentToken(data.value)} /><span className="gateway-secret-state">{gatewaySettings.hasAgentToken ? "已安全保存" : "尚未保存"}</span></Field>
    <Field label="服务地址"><Input value="https://orderflow.ausmet.ai" readOnly /></Field>
    <Checkbox label="Windows 登录后自动启动" checked={startAtLogin} disabled={!gatewayEnabled} onChange={(_, data) => setStartAtLogin(Boolean(data.checked))} />
    <Button appearance="primary" onClick={() => void saveGatewaySetup()}>保存网关设置</Button>
  </div>}
</Card>
```

Use this exact save payload:

```typescript
await api.saveGatewaySettings({ enabled: gatewayEnabled, email: gatewayEmail, authCode: newAuthCode || undefined, agentToken: newAgentToken || undefined, serverUrl: "https://orderflow.ausmet.ai", startAtLogin });
```

- [ ] **Step 7: Subscribe to typed events and preserve notifications**

Remove the old email-address comparison at the start of `handleEmailUpdate`; the server already scopes v1 to the single configured mailbox. For `new-messages`, merge rows and call the existing native notification path. For `gateway-status`, update the banner. For `job-status`, update `activeJob`; completed extraction still resolves through the polling fallback and sets `latestOutputs` to the downloaded local workbook.

```typescript
useEffect(() => api.onEmailEvent((event) => { if (event.type === "new-messages") handleEmailUpdate(event.data); else if (event.type === "gateway-status") setGatewayStatus(event.data.gateway); else setActiveJob(event.data.job); }), [handleEmailUpdate]);
```

The new-message merge begins with this credential-free block:

```typescript
const handleEmailUpdate = useCallback((event: EmailNewMessagesEvent): void => {
  const currentMessages = emailMessagesRef.current;
  const currentUids = new Set(currentMessages.map((message) => message.uid));
  const incoming = sortMessages(event.messages);
  const newlyPending = incoming.filter((message) => !currentUids.has(message.uid) && message.hasExcelAttachments && !extractedMessageUidsRef.current.has(message.uid));
  setEmailMessages(sortMessages([...incoming, ...currentMessages.filter((message) => !incoming.some((item) => item.uid === message.uid))]));
  if (newlyPending.length) void api.notifyNewOrderEmails(buildNewOrderEmailNotification(newlyPending));
}, []);
```

- [ ] **Step 8: Add restrained status styles**

```css
.gateway-banner { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 14px; border:1px solid #d7d7d7; border-radius:8px; background:#fff; }
.gateway-banner.success { border-color:#9bc8aa; background:#f3fbf5; color:#145c2e; }
.gateway-banner.warning { border-color:#e2bd72; background:#fff8e8; color:#704800; }
.gateway-job-status { padding:8px 12px; border-left:3px solid #5b5fc7; background:#f5f5ff; color:#323130; }
.gateway-secret-state { color:#16803c; font-size:12px; }
```

- [ ] **Step 9: Run renderer helper tests, full typecheck, and production build**

Run: `npm test -- src/renderer/gatewayViewState.test.ts src/renderer/mailNotifications.test.ts src/renderer/mailExtractionState.test.ts && npm run typecheck && npm run build`

Expected: tests PASS; typecheck/build exit `0`; the built renderer contains `Gateway online` and contains no mailbox authorization code.

- [ ] **Step 10: Commit the shared-list and gateway-status UI**

```bash
git add src/renderer/gatewayViewState.ts src/renderer/gatewayViewState.test.ts src/renderer/app.tsx src/renderer/styles.css
git commit -m "feat: show gateway health and shared mail jobs"
```

### Task 16: Remove duplicate/obsolete server paths and create production deployment files

**Files:**
- Delete: `src/server/emailApiConfig.ts`
- Delete: `src/server/emailApiConfig.test.ts`
- Delete: `src/server/emailApiServer.ts`
- Delete: `src/server/emailApiServer.test.ts`
- Delete: `src/server/main.ts`
- Modify: `tsconfig.build.json`
- Modify: `package.json`
- Delete: `services/orderflow-email-api/src/core/*.ts`
- Modify: `services/orderflow-email-api/package.json`
- Modify: `services/orderflow-email-api/package-lock.json`
- Replace: `services/orderflow-email-api/Dockerfile`
- Create: `services/orderflow-email-api/compose.production.yml`
- Create: `deploy/nginx/orderflow.ausmet.ai.conf`
- Create: `deploy/systemd/orderflow-email-api.service`
- Replace: `services/orderflow-email-api/README.md`
- Replace: `docs/email-api-server.md`

**Interfaces:**
- Consumes: the Task 2–6 standalone broker build only.
- Produces: one authoritative server implementation, a Node-only image, loopback-only Docker publishing, a persistent `/data` volume, Nginx HTTPS/WSS/SSE proxying, and a reproducible deployment runbook. The existing root Python extractor remains packaged in Electron; the uncommitted service-side `extract.py` fix is not staged or deleted by this task.

- [ ] **Step 1: Write a repository guard test before deleting duplicates**

Create `src/packaging/gatewayServerLayout.test.ts`:

```typescript
import { access, readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

test("has one standalone server implementation and no root server build", async () => {
  await expect(access("src/server/main.ts")).rejects.toThrow();
  const buildConfig = await readFile("tsconfig.build.json", "utf8");
  expect(buildConfig).not.toContain("src/server");
  const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as { scripts: Record<string, string> };
  expect(rootPackage.scripts["serve:email-api"]).toBeUndefined();
});

test("production container has no IMAP or Python runtime", async () => {
  const dockerfile = await readFile("services/orderflow-email-api/Dockerfile", "utf8");
  const servicePackage = await readFile("services/orderflow-email-api/package.json", "utf8");
  expect(dockerfile).not.toMatch(/python|pip|993/i);
  expect(servicePackage).not.toContain("imapflow");
});
```

- [ ] **Step 2: Run the guard and confirm the legacy layout fails**

Run: `npm test -- src/packaging/gatewayServerLayout.test.ts`

Expected: FAIL because root `src/server` and server IMAP/Python packaging still exist.

- [ ] **Step 3: Remove the duplicate root server and obsolete service TypeScript core**

Run:

```bash
git rm -r src/server services/orderflow-email-api/src/core
```

Remove `src/server/**/*.ts` from `tsconfig.build.json` and remove `serve:email-api` from the root scripts. Remove `imapflow` from the standalone service dependencies, then run:

```bash
npm install --prefix services/orderflow-email-api
```

Do not stage or remove `services/orderflow-email-api/extract.py`, `desktop_runner.py`, `python_extraction_bridge.py`, or `rules/` in this task; they become unused compatibility files and can be removed only after the separate Deluxe Dry Lining changes are committed and backed up.

- [ ] **Step 4: Replace the service Dockerfile with a Node-only two-stage image**

```dockerfile
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV EMAIL_API_HOST=0.0.0.0
ENV EMAIL_API_PORT=8787
ENV EMAIL_API_DB_PATH=/data/orderflow.sqlite
ENV EMAIL_API_RESULT_DIR=/data/results
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
RUN mkdir -p /data/results && chown -R node:node /app /data
USER node
EXPOSE 8787
CMD ["node", "dist/server/main.js"]
```

- [ ] **Step 5: Create the production Compose file**

```yaml
services:
  orderflow-email-api:
    build: .
    image: orderflow-email-api:gateway
    restart: unless-stopped
    env_file:
      - /etc/orderflow-email-api/gateway.env
    ports:
      - "127.0.0.1:8787:8787"
    volumes:
      - /var/lib/orderflow-email-api:/data
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:8787/health').then(r=>{if(!r.ok)process.exit(1)})"]
      interval: 30s
      timeout: 5s
      retries: 3
```

- [ ] **Step 6: Create the systemd unit**

```ini
[Unit]
Description=Orderflow office mail gateway broker
After=docker.service network-online.target
Requires=docker.service
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/orderflow-email-api
ExecStart=/usr/bin/docker compose -f compose.production.yml up -d --build --remove-orphans
ExecStop=/usr/bin/docker compose -f compose.production.yml down
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 7: Create the Nginx HTTP redirect and HTTPS/WSS/SSE proxy**

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}

server {
    listen 80;
    listen [::]:80;
    server_name orderflow.ausmet.ai;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name orderflow.ausmet.ai;
    ssl_certificate /etc/letsencrypt/live/orderflow.ausmet.ai/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/orderflow.ausmet.ai/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    client_max_body_size 64m;

    location /api/agent/connect {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Authorization $http_authorization;
        proxy_set_header Host $host;
        proxy_read_timeout 75s;
    }

    location /api/email/events {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Authorization $http_authorization;
        proxy_set_header Host $host;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 1h;
    }

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Authorization $http_authorization;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 120s;
    }
}
```

- [ ] **Step 8: Rewrite both server documents as one operational contract**

Replace `services/orderflow-email-api/README.md` with this complete deployment contract, and use the same content under the existing title in `docs/email-api-server.md` followed by the live-acceptance section from Task 18:

````markdown
# Orderflow Office Mail Gateway Broker

This Node 24 service is a cache and extraction-job broker. It never connects to IMAP and never receives a mailbox authorization code. The designated Windows office app connects outbound to WeCom IMAP and to this service.

## Required environment

| Variable | Value or default |
|---|---|
| `EMAIL_API_TOKEN` | Required desktop-client bearer token |
| `GATEWAY_AGENT_TOKEN` | Required office-agent bearer token; must differ from the client token |
| `EMAIL_API_HOST` | `0.0.0.0` in the container |
| `EMAIL_API_PORT` | `8787` |
| `EMAIL_API_DB_PATH` | `/data/orderflow.sqlite` |
| `EMAIL_API_RESULT_DIR` | `/data/results` |
| `GATEWAY_OFFLINE_AFTER_SECONDS` | `90` |
| `GATEWAY_JOB_TTL_SECONDS` | `900` |
| `GATEWAY_RESULT_RETENTION_DAYS` | `7` |
| `EMAIL_API_BODY_LIMIT_MB` | `64` |

`EMAIL_ACCOUNT`, `EMAIL_AUTH_CODE`, every `EMAIL_IMAP_*` variable, and public port `8091` are prohibited after migration.

## Token audiences and routes

Public: `GET /health`.

Desktop client token: `POST /api/email/messages`, `POST /api/email/extract`, `GET /api/email/jobs/:id`, `GET /api/email/jobs/:id/workbook`, and `GET /api/email/events`.

Agent token: `GET /api/agent/connect` as a WebSocket upgrade, `POST /api/agent/heartbeat`, `POST /api/agent/messages/sync`, and `POST /api/agent/jobs/:id/result`.

The service rejects a desktop token on agent routes and an agent token on desktop routes.

## Production operation

`compose.production.yml` publishes `127.0.0.1:8787` only and mounts `/var/lib/orderflow-email-api` at `/data`. Nginx is the only public entry point and terminates valid TLS for `orderflow.ausmet.ai` on 443. HTTP redirects to HTTPS. The SSE location disables proxy buffering and the agent location forwards WebSocket upgrades.

Start and inspect:

```bash
systemctl enable --now orderflow-email-api
docker compose -f /opt/orderflow-email-api/compose.production.yml ps
curl -fsS http://127.0.0.1:8787/health
curl -fsS https://orderflow.ausmet.ai/health
```

Back up `/var/lib/orderflow-email-api/orderflow.sqlite` and `/var/lib/orderflow-email-api/results`. Restore both together while the service is stopped.

Never log or paste client tokens, agent tokens, raw Authorization headers, mailbox credentials, email bodies, attachment bytes, or local office paths.
````

- [ ] **Step 9: Run layout, full tests, service build, and image build**

Run:

```bash
npm test -- src/packaging/gatewayServerLayout.test.ts
npm run typecheck
npm --prefix services/orderflow-email-api test
npm --prefix services/orderflow-email-api run build
docker build -t orderflow-email-api:gateway services/orderflow-email-api
```

Expected: tests/builds PASS; Docker build succeeds; `docker history orderflow-email-api:gateway` has no Python layer; `rg "EMAIL_AUTH_CODE|EMAIL_ACCOUNT|EMAIL_IMAP" services/orderflow-email-api/src services/orderflow-email-api/Dockerfile` prints no matches.

- [ ] **Step 10: Commit only authoritative-server and deployment files**

```bash
git add package.json package-lock.json tsconfig.build.json src/packaging/gatewayServerLayout.test.ts services/orderflow-email-api/package.json services/orderflow-email-api/package-lock.json services/orderflow-email-api/Dockerfile services/orderflow-email-api/compose.production.yml services/orderflow-email-api/README.md docs/email-api-server.md deploy/nginx/orderflow.ausmet.ai.conf deploy/systemd/orderflow-email-api.service
git commit -m "refactor: deploy one gateway broker behind tls"
```

### Task 17: Extend CI and package a gateway-capable Windows release

**Files:**
- Modify: `.github/workflows/release.yml`
- Modify: `scripts/write-remote-email-api-config.mjs`
- Modify: `src/packaging/packageConfig.test.ts`
- Modify: `src/packaging/readme.test.ts`

**Interfaces:**
- Consumes: GitHub variable `ORDERFLOW_EMAIL_API_URL=https://orderflow.ausmet.ai` and secret `ORDERFLOW_EMAIL_API_TOKEN` for desktop clients. The agent token is never a build secret or packaged resource.
- Produces: root and standalone-service tests on Ubuntu, a service Docker build check, and the existing portable Windows executable containing the HTTPS client endpoint only.

- [ ] **Step 1: Add packaging tests that reject HTTP and agent-token leakage**

```typescript
test("packaged remote API requires HTTPS and never contains an agent token", async () => {
  const script = await readFile("scripts/write-remote-email-api-config.mjs", "utf8");
  expect(script).toContain('url.protocol !== "https:"');
  expect(script).not.toContain("GATEWAY_AGENT_TOKEN");
  const packageConfig = JSON.parse(await readFile("package.json", "utf8")) as { build: { extraResources: unknown[] } };
  expect(JSON.stringify(packageConfig.build.extraResources)).toContain("remote-email-api.json");
});
```

- [ ] **Step 2: Run the packaging test and confirm HTTP is still accepted**

Run: `npm test -- src/packaging/packageConfig.test.ts`

Expected: FAIL until the config writer rejects non-HTTPS URLs.

- [ ] **Step 3: Enforce HTTPS in the config writer**

After reading `ORDERFLOW_EMAIL_API_URL`, add:

```javascript
const url = new URL(baseUrl);
if (url.protocol !== "https:") {
  throw new Error("ORDERFLOW_EMAIL_API_URL must use HTTPS");
}
```

Write only `{ baseUrl: url.toString().replace(/\/$/, ""), token }` to the packaged file.

- [ ] **Step 4: Add standalone service checks to the CI test job**

Add these steps after root `npm ci`:

```yaml
- name: Install standalone gateway service dependencies
  run: npm ci --prefix services/orderflow-email-api

- name: Typecheck standalone gateway service
  run: npm run typecheck --prefix services/orderflow-email-api

- name: Test standalone gateway service
  run: npm test --prefix services/orderflow-email-api

- name: Build standalone gateway service image
  run: docker build -t orderflow-email-api:ci services/orderflow-email-api
```

- [ ] **Step 5: Keep the Windows build secret boundary explicit**

The existing `Write packaged remote email API config` step remains client-token-only:

```yaml
env:
  ORDERFLOW_EMAIL_API_URL: ${{ vars.ORDERFLOW_EMAIL_API_URL }}
  ORDERFLOW_EMAIL_API_TOKEN: ${{ secrets.ORDERFLOW_EMAIL_API_TOKEN }}
run: node scripts/write-remote-email-api-config.mjs
```

Add no `GATEWAY_AGENT_TOKEN` environment variable anywhere in `.github/workflows/release.yml`.

- [ ] **Step 6: Run local CI-equivalent tests and a distributable build**

Run:

```bash
npm ci
npm run typecheck
npm test
npm ci --prefix services/orderflow-email-api
npm run typecheck --prefix services/orderflow-email-api
npm test --prefix services/orderflow-email-api
npm run build
```

Expected: root and service tests PASS, both typechecks exit `0`, and the Electron build succeeds.

- [ ] **Step 7: Commit CI and packaging security**

```bash
git add .github/workflows/release.yml scripts/write-remote-email-api-config.mjs src/packaging/packageConfig.test.ts src/packaging/readme.test.ts
git commit -m "ci: build and verify office gateway release"
```

### Task 18: Deploy dark, install the office gateway, and execute live acceptance

**Files:**
- Operational changes on DNS, `asumet`, GitHub configuration, and the designated Windows office computer.
- Update after acceptance: `docs/email-api-server.md`

**Interfaces:**
- Consumes: the tested Docker image, Windows portable EXE, generated client token, generated agent token, and the known workbook `30820 LA VIDA DELUXE DRY LINING .xlsx`.
- Produces: live `https://orderflow.ausmet.ai`, one connected office gateway, shared lists/notifications, local extraction with downloadable results, no office listener, and a recorded acceptance checklist.

- [ ] **Step 1: Provision DNS and verify propagation before TLS work**

Create an A record:

```text
orderflow.ausmet.ai.  A  38.92.9.4
```

Run: `dig +short orderflow.ausmet.ai A`

Expected: exactly `38.92.9.4`.

- [ ] **Step 2: Install the service tree and generate separate secrets on `asumet`**

Run from the Mac checkout:

```bash
rsync -az --delete services/orderflow-email-api/ root@38.92.9.4:/opt/orderflow-email-api/
scp deploy/systemd/orderflow-email-api.service root@38.92.9.4:/etc/systemd/system/orderflow-email-api.service
scp deploy/nginx/orderflow.ausmet.ai.conf root@38.92.9.4:/etc/nginx/conf.d/orderflow.ausmet.ai.conf
ssh root@38.92.9.4
```

Run inside the server shell:

```bash
install -d -m 700 /etc/orderflow-email-api
install -d -o 1000 -g 1000 -m 700 /var/lib/orderflow-email-api /var/lib/orderflow-email-api/results
CLIENT_TOKEN=$(openssl rand -hex 32)
AGENT_TOKEN=$(openssl rand -hex 32)
umask 077
printf 'EMAIL_API_TOKEN=%s\nGATEWAY_AGENT_TOKEN=%s\nEMAIL_API_HOST=0.0.0.0\nEMAIL_API_PORT=8787\nEMAIL_API_DB_PATH=/data/orderflow.sqlite\nEMAIL_API_RESULT_DIR=/data/results\nGATEWAY_OFFLINE_AFTER_SECONDS=90\nGATEWAY_JOB_TTL_SECONDS=900\nGATEWAY_RESULT_RETENTION_DAYS=7\nEMAIL_API_BODY_LIMIT_MB=64\n' "$CLIENT_TOKEN" "$AGENT_TOKEN" > /etc/orderflow-email-api/gateway.env
printf '%s' "$CLIENT_TOKEN" > /etc/orderflow-email-api/client.token
printf '%s' "$AGENT_TOKEN" > /etc/orderflow-email-api/agent.token
chmod 600 /etc/orderflow-email-api/gateway.env /etc/orderflow-email-api/*.token
systemctl daemon-reload
systemctl enable --now orderflow-email-api
curl -fsS http://127.0.0.1:8787/health
```

Expected: health JSON contains `"ok":true` and gateway state `offline`; `ss -ltnp` shows the container published only on `127.0.0.1:8787`.

- [ ] **Step 3: Obtain a valid certificate and enable Nginx**

Run on `asumet`:

```bash
apt-get update && apt-get install -y certbot
systemctl stop nginx
certbot certonly --standalone -d orderflow.ausmet.ai --non-interactive --agree-tos -m admin@ausmet.ai
nginx -t
systemctl start nginx
curl -fsS https://orderflow.ausmet.ai/health
```

Expected: certificate validation succeeds, Nginx config test is successful, and public health returns `ok` over HTTPS. `curl -I http://orderflow.ausmet.ai/health` returns `301` to HTTPS.

- [ ] **Step 4: Configure GitHub client endpoint and trigger the Windows build**

On the Mac, securely pipe the server client token without printing it:

```bash
gh variable set ORDERFLOW_EMAIL_API_URL --body 'https://orderflow.ausmet.ai'
ssh root@38.92.9.4 'cat /etc/orderflow-email-api/client.token' | gh secret set ORDERFLOW_EMAIL_API_TOKEN
git push origin main
RUN_ID=$(gh run list --workflow release.yml --branch main --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$RUN_ID" --exit-status
```

Expected: tests, service image build, Windows portable EXE, macOS DMG, and release publication all succeed.

- [ ] **Step 5: Install the EXE in a stable per-user path on the office Windows computer**

Place the released EXE at:

```text
%LOCALAPPDATA%\AUSMET\Orderflow\orderflow-desktop-windows.exe
```

Start it once as the normal, non-administrator office user. In `办公室网关设置`, enter the mailbox address, WeCom authorization code, `https://orderflow.ausmet.ai`, and the agent token transferred from `/etc/orderflow-email-api/agent.token`; enable this computer as the office gateway and enable Windows login startup.

Verify the active AC power plan does not sleep or hibernate the computer:

```powershell
powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE
powercfg /query SCHEME_CURRENT SUB_SLEEP HIBERNATEIDLE
```

Expected: both `Current AC Power Setting Index` values are `0x00000000`; the display timeout may remain nonzero.

Expected: UI and tray show connected, `curl -fsS https://orderflow.ausmet.ai/health` reports gateway online, and no secret appears in `%USERPROFILE%\.order_organizer_assistant\gateway\settings.json`.

- [ ] **Step 6: Prove the office process opens no listener**

In PowerShell before and after starting the app:

```powershell
$process = Get-Process | Where-Object { $_.Path -like "*orderflow-desktop-windows.exe" } | Select-Object -First 1
Get-NetTCPConnection -State Listen | Where-Object OwningProcess -eq $process.Id
Get-NetTCPConnection -State Established | Where-Object OwningProcess -eq $process.Id | Select-Object RemoteAddress,RemotePort,State
```

Expected: the first command returns no listening connection; established destinations use remote port 993 or 443 only.

- [ ] **Step 7: Execute the known-workbook cross-client acceptance**

Email `30820 LA VIDA DELUXE DRY LINING .xlsx` to the configured WeCom mailbox. On a second desktop client:

1. Confirm the message appears within 30 seconds.
2. Confirm a native new-mail notification appears.
3. Select the message and request extraction.
4. Confirm job states progress through queued/dispatched/running/completed.
5. Download/open `订单整理结果.xlsx` and confirm `订单整理!L2` is exactly `Deluxe Dry Lining`.

Expected: the result contains the corrected product name and no cloud connection to TCP 993 is involved.

- [ ] **Step 8: Execute lock, display-off, restart, duplicate, and offline tests**

Lock the office PC with `Win+L`, allow the display to turn off, send another known test message, and repeat list/notification/extraction from the second client. Then restart the Electron app and repeat a manual sync.

Expected: lock/display-off does not interrupt sync; restart creates no duplicate message and no duplicate completed job. After explicitly exiting the gateway, every client shows offline within 90 seconds, keeps cached mail visible, and disables new extraction.

- [ ] **Step 9: Hold the migration for 24 stable hours**

During the gate, verify at least once per business period:

```bash
ssh root@38.92.9.4 'systemctl is-active orderflow-email-api; docker compose -f /opt/orderflow-email-api/compose.production.yml ps; curl -fsS http://127.0.0.1:8787/health'
```

Expected: service active, container healthy, gateway normally online, no growing failed-job backlog, and synchronized messages survive a container restart.

- [ ] **Step 10: Retire raw HTTP 8091, server mailbox secrets, and mihomo keeper after the gate**

On `asumet`:

```bash
systemctl disable --now mihomo-imap-node-keeper.timer mihomo-imap-node-keeper.service || true
rm -f /etc/systemd/system/mihomo-imap-node-keeper.timer /etc/systemd/system/mihomo-imap-node-keeper.service
docker ps -q --filter publish=8091 | xargs -r docker rm -f
systemctl daemon-reload
sed -i '/^EMAIL_ACCOUNT=/d;/^EMAIL_AUTH_CODE=/d;/^EMAIL_IMAP_/d' /etc/orderflow-email-api/gateway.env
for file in $(grep -RIlE 'listen[[:space:]]+8091|38\.92\.9\.4:8091' /etc/nginx/conf.d /etc/nginx/sites-enabled 2>/dev/null); do mv "$file" "$file.disabled"; done
while iptables -C INPUT -p tcp --dport 8091 -j ACCEPT 2>/dev/null; do iptables -D INPUT -p tcp --dport 8091 -j ACCEPT; done
nginx -t && systemctl reload nginx
ss -ltnp | grep ':8091 ' && exit 1 || true
```

Run: `curl --max-time 5 http://38.92.9.4:8091/health`

Expected: connection fails; `https://orderflow.ausmet.ai/health` remains healthy.

- [ ] **Step 11: Remove obsolete mihomo source only after live retirement is confirmed**

```bash
git rm scripts/server/mihomo_imap_node_keeper.py tests/test_mihomo_imap_node_keeper.py deploy/systemd/mihomo-imap-node-keeper.service deploy/systemd/mihomo-imap-node-keeper.timer
git add docs/email-api-server.md
git commit -m "chore: retire cloud imap proxy path"
```

- [ ] **Step 12: Record the final verification evidence**

Append to `docs/email-api-server.md`: deployment timestamp, released build tag, DNS/TLS check, message appearance time, offline detection time, known workbook result (`订单整理!L2 = Deluxe Dry Lining`), no-listener PowerShell result, restart duplicate check, and 24-hour gate result. Do not record tokens, mailbox authorization codes, raw Authorization headers, full email bodies, or attachment contents.

---

## Final Verification Gate

- [ ] Run `git status --short --branch` and confirm gateway commits did not accidentally include the five pre-existing Deluxe Dry Lining working-tree files.
- [ ] Run `npm run typecheck && npm test && npm run build` and confirm all root checks pass.
- [ ] Run `npm --prefix services/orderflow-email-api run typecheck && npm --prefix services/orderflow-email-api test && npm --prefix services/orderflow-email-api run build` and confirm all standalone checks pass.
- [ ] Run `docker build -t orderflow-email-api:final services/orderflow-email-api` and confirm the Node-only image builds.
- [ ] Run `rg -n "EMAIL_AUTH_CODE|EMAIL_ACCOUNT|EMAIL_IMAP_|rejectUnauthorized|38\.92\.9\.4:8091" src services/orderflow-email-api deploy .github scripts --glob '!**/*.test.ts'` and confirm no active implementation or release config contains legacy cloud IMAP credentials, insecure TLS bypasses, or the raw client endpoint.
- [ ] Run `rg -n "GATEWAY_AGENT_TOKEN" .github resources src/core/remoteEmailApi.ts` and confirm the agent token is never packaged or injected into CI desktop builds.
- [ ] Confirm the office Windows process has no listening sockets and only established remote ports 993 and 443.
- [ ] Confirm second-client mail visibility is normally under 30 seconds and offline status appears within 90 seconds.
- [ ] Confirm restart recovery produces no duplicate message or duplicate completed job.
- [ ] Confirm the known workbook still produces `订单整理!L2 = Deluxe Dry Lining` and ordinary local-file extraction retains its current output paths/buttons.
