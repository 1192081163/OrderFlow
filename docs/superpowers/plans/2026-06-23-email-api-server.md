> **SUPERSEDED (2026-07-13):** Do not implement this remote design. Use `docs/superpowers/specs/2026-07-13-local-mail-workstation-design.md` and `docs/superpowers/plans/2026-07-13-local-mail-workstation.md`.

# Email API Server Implementation Plan

**For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) superpowers:executing-plans implement plan task-by-task. Steps use checkbox (`- [ ]`) syntax tracking.

**Goal:** Expose the existing enterprise WeCom email order pull/extract workflow as a reusable HTTP API service that other software can call.

**Architecture:** Add a small Node HTTP server layer under `src/server/` that wraps existing `src/core/extractionService.ts` APIs. The server reads mailbox credentials and API token from environment variables, authenticates all API calls with `Authorization: Bearer <token>`, and avoids duplicating order extraction rules.

**Tech Stack:** TypeScript, Node `http`, existing IMAP/extraction core modules, Vitest.

---

### Task 1: Server Config

**Files:**
- Create: `src/server/emailApiConfig.ts`
- Test: `src/server/emailApiConfig.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, test } from "vitest";
import { loadEmailApiConfig } from "./emailApiConfig.js";

describe("email API config", () => {
  test("loads mailbox and token settings from environment", () => {
    expect(
      loadEmailApiConfig({
        EMAIL_API_TOKEN: "token",
        EMAIL_ACCOUNT: "orders@example.com",
        EMAIL_AUTH_CODE: "secret",
        EMAIL_IMAP_SERVER: "imap.example.com",
        EMAIL_IMAP_PORT: "1993",
        EMAIL_API_HOST: "127.0.0.1",
        EMAIL_API_PORT: "9090",
      }),
    ).toEqual({
      token: "token",
      host: "127.0.0.1",
      port: 9090,
      email: "orders@example.com",
      authCode: "secret",
      server: "imap.example.com",
      imapPort: 1993,
    });
  });

  test("rejects missing required secrets", () => {
    expect(() => loadEmailApiConfig({})).toThrow("EMAIL_API_TOKEN");
  });
});
```

- [ ] **Step 2: Run test verify fails**

Run: `npm test -- src/server/emailApiConfig.test.ts`

Expected: FAIL because `src/server/emailApiConfig.ts` does not exist.

- [ ] **Step 3: Implement config loader**

Create `loadEmailApiConfig(env = process.env)` with required vars `EMAIL_API_TOKEN`, `EMAIL_ACCOUNT`, `EMAIL_AUTH_CODE`; defaults `EMAIL_API_HOST=127.0.0.1`, `EMAIL_API_PORT=8787`, `EMAIL_IMAP_SERVER=imap.exmail.qq.com`, `EMAIL_IMAP_PORT=993`.

- [ ] **Step 4: Run test verify passes**

Run: `npm test -- src/server/emailApiConfig.test.ts`

Expected: PASS.

### Task 2: HTTP Router

**Files:**
- Create: `src/server/emailApiServer.ts`
- Test: `src/server/emailApiServer.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, test } from "vitest";
import { createEmailApiServer } from "./emailApiServer.js";

describe("email API server", () => {
  test("rejects unauthenticated calls", async () => {
    const server = createEmailApiServer({
      config: testConfig(),
      listEmailMessages: async () => ({ days: 7, scannedMessages: 0, messages: [] }),
      extractEmailOrders: async () => {
        throw new Error("should not run");
      },
    });

    const response = await request(server, "POST", "/api/email/messages", {});
    expect(response.status).toBe(401);
  });

  test("lists candidate messages through the existing core service", async () => {
    const server = createEmailApiServer({
      config: testConfig(),
      listEmailMessages: async (request) => ({
        days: request.days ?? 7,
        scannedMessages: 1,
        orderAttachmentCount: 1,
        messages: [
          {
            uid: "101",
            subject: "PO",
            attachmentCount: 1,
            excelAttachmentNames: ["order.xlsx"],
            hasExcelAttachments: true,
          },
        ],
      }),
      extractEmailOrders: async () => {
        throw new Error("should not run");
      },
    });

    const response = await request(server, "POST", "/api/email/messages", { days: 3 }, "token");
    expect(response.status).toBe(200);
    expect(response.body.messages[0].uid).toBe("101");
  });
});
```

- [ ] **Step 2: Run test verify fails**

Run: `npm test -- src/server/emailApiServer.test.ts`

Expected: FAIL because `src/server/emailApiServer.ts` does not exist.

- [ ] **Step 3: Implement HTTP server**

Use Node `http.createServer`, parse JSON request bodies, authenticate bearer token, handle:
- `GET /health`
- `POST /api/email/messages`
- `POST /api/email/extract`

The implementation returns JSON only and maps thrown errors to HTTP 500 with `{ error: string }`.

- [ ] **Step 4: Run test verify passes**

Run: `npm test -- src/server/emailApiServer.test.ts`

Expected: PASS.

### Task 3: Server Entrypoint And Build Wiring

**Files:**
- Create: `src/server/main.ts`
- Modify: `tsconfig.build.json`
- Modify: `package.json`
- Test: `src/server/emailApiServer.test.ts`

- [ ] **Step 1: Write failing assertion for entrypoint export**

Add a test that imports `startEmailApiServer` and verifies it returns a Node server with `.close()`.

- [ ] **Step 2: Run test verify fails**

Run: `npm test -- src/server/emailApiServer.test.ts`

Expected: FAIL because `src/server/main.ts` does not exist.

- [ ] **Step 3: Implement entrypoint**

Create `startEmailApiServer()` that loads config, creates the server, listens on configured host/port, and logs the bound URL. Add package script:

```json
"serve:email-api": "npm run build:main && node dist/server/main.js"
```

Update `tsconfig.build.json` include list with `src/server/**/*.ts`.

- [ ] **Step 4: Run build verify server compiles**

Run: `npm run typecheck && npm run build:main`

Expected: PASS.

### Task 4: API Documentation

**Files:**
- Create: `docs/email-api-server.md`

- [ ] **Step 1: Document environment variables**

Include required variables:

```text
EMAIL_API_TOKEN
EMAIL_ACCOUNT
EMAIL_AUTH_CODE
```

Include optional variables:

```text
EMAIL_API_HOST
EMAIL_API_PORT
EMAIL_IMAP_SERVER
EMAIL_IMAP_PORT
```

- [ ] **Step 2: Document API calls**

Include curl examples for:

```bash
curl -X POST http://127.0.0.1:8787/api/email/messages \
  -H "Authorization: Bearer $EMAIL_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"days":7}'
```

```bash
curl -X POST http://127.0.0.1:8787/api/email/extract \
  -H "Authorization: Bearer $EMAIL_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"messageUids":["101"],"hours":168}'
```

- [ ] **Step 3: Run final verification**

Run: `npm run typecheck && npm test && npm run build`

Expected: PASS.
