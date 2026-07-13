> **SUPERSEDED (2026-07-13):** Do not implement this remote design. Use `docs/superpowers/specs/2026-07-13-local-mail-workstation-design.md` and `docs/superpowers/plans/2026-07-13-local-mail-workstation.md`.

# Office Mail Gateway Design

Date: 2026-07-10

## Summary

Move enterprise WeCom IMAP access from the `asumet` cloud server to one always-on Windows office computer. The office computer will run the Orderflow desktop application in tray mode, connect directly to WeCom IMAP, and maintain one outbound secure connection to `asumet`. Other desktop clients will continue to see one shared email list, receive new-mail notifications, and request extraction through the central server.

The office computer will not listen on any network port. All connections originate from the office computer, so screen lock or display power-off does not interrupt the gateway and no inbound firewall or router rule is required.

## Context

The current public email API runs on `38.92.9.4` (`asumet`). Its HTTP health check is available, but the host cannot establish outbound TCP 993 connections to Tencent Exmail, Gmail, or Outlook. The host firewall allows outbound traffic, and the hosting provider has confirmed that outbound TCP 993 is unsupported. The existing mihomo route is not a reliable replacement because every configured candidate also failed IMAP TLS checks.

An office Windows computer can connect to `imap.exmail.qq.com:993`, and multiple desktop clients need the same email list and real-time notifications. This rules out independent IMAP access on every client and makes one outbound-only office gateway the preferred architecture.

## Goals

- Remove cloud-server TCP 993 from the critical path.
- Keep one shared, near-real-time email list for all desktop clients.
- Deliver new-mail notifications to all connected clients.
- Let any client request extraction for selected messages.
- Keep the mailbox address and authorization code on the office computer only.
- Expose no inbound listener on the office computer.
- Survive application-window closure, screen lock, display power-off, and network interruption, then resume automatically when the designated Windows user signs in after a restart.
- Reuse the current Python extraction engine as the rules source of truth.

## Non-goals

- General-purpose email reading or sending.
- Remote desktop access to the office computer.
- Executing Excel macros or opening attachments in Microsoft Excel.
- Long-term archival of email bodies or attachments.
- Supporting multiple mailbox accounts in the first release.
- Continuing the server-side mihomo IMAP node-rotation design.
- Running before Windows user login or as a machine-level Windows service in the first release.

## Assumptions

- The office Windows computer remains powered on and does not enter sleep or hibernation during service hours.
- A Windows user remains signed in; display power-off and screen lock are allowed.
- The office network permits outbound TCP 993 to Tencent Exmail and outbound TCP 443 to `asumet`.
- DNS control for `ausmet.ai` is available. The public service hostname will be `orderflow.ausmet.ai`.
- Other clients can reach `https://orderflow.ausmet.ai` over TCP 443.

## Architecture

### 1. Windows office gateway

The existing Electron desktop application gains a gateway mode with these behaviors:

- Start automatically at Windows user login.
- Continue running in the notification tray when the main window closes.
- Use the existing ImapFlow-based mailbox code to maintain an IMAP connection.
- Prefer IMAP IDLE for near-real-time updates and fall back to a 60-second scan when IDLE is unavailable.
- Maintain one outbound WebSocket connection to `wss://orderflow.ausmet.ai/api/agent/connect`.
- Store mailbox credentials and the agent token encrypted with Electron `safeStorage`, which uses Windows DPAPI for the signed-in user.
- Persist only synchronization state, job state, and sanitized logs under `%USERPROFILE%\.order_organizer_assistant\gateway`.
- Download selected attachments to a per-job quarantine directory, invoke the current Python extractor, upload the result, and delete the quarantine directory after completion.

The gateway must not create an HTTP, WebSocket, SOCKS, file-sharing, or remote-control listener.

### 2. Central gateway API on `asumet`

The email API service gains agent synchronization and job routing while retaining the desktop-facing API shape:

- Nginx terminates TLS for `orderflow.ausmet.ai` on TCP 443 using a valid public certificate.
- Plain HTTP redirects to HTTPS; the raw public `http://38.92.9.4:8091` client endpoint is retired after migration.
- SQLite in WAL mode stores message summaries, gateway status, extraction jobs, result metadata, and notification delivery state in a mounted persistent volume.
- `/api/agent/connect` accepts an authenticated outbound WebSocket from the office gateway.
- `/api/agent/heartbeat` records gateway health and version.
- `/api/agent/messages/sync` upserts sanitized message summaries.
- `/api/agent/jobs/:id/result` accepts extraction JSON and the generated result workbook.
- `/api/email/messages` serves the synchronized central cache without accepting mailbox credentials.
- `/api/email/extract` creates an extraction job and routes it to the connected gateway.
- `/api/email/events` continues to provide server-sent new-message and gateway-status events to desktop clients.

The server never receives or stores the mailbox authorization code.

### 3. Desktop clients

All desktop clients use `https://orderflow.ausmet.ai` and the existing client API token to:

- Read the common email list.
- Subscribe to new-message and gateway-status events.
- Request extraction for selected message UIDs.
- Download the generated result workbook when a job completes.

Clients display the gateway's last successful synchronization time. When the gateway is offline, clients continue to show the last cached list with a visible stale/offline banner and disable new extraction requests.

## Data flow

### New-message synchronization

1. The gateway connects to WeCom IMAP and enters IDLE.
2. A new message wakes the connection, or the fallback scan discovers it.
3. The gateway sends only the UID, subject, sender display value, received time, Excel attachment names, and attachment counts to `asumet` over WSS/HTTPS.
4. The server idempotently upserts the summary using mailbox identity plus UID.
5. The server publishes a new-message SSE event to connected desktop clients.

Email bodies and mailbox credentials are not included in synchronization.

### Extraction request

1. A desktop client submits selected message UIDs to `/api/email/extract`.
2. The server creates a UUID job in `queued` state and sends an `extract` command over the existing agent WebSocket.
3. The gateway acknowledges the job, downloads only the selected Excel attachments, validates them, and runs the local Python extraction pipeline.
4. The gateway uploads the extraction JSON and `订单整理结果.xlsx` over HTTPS.
5. The server marks the job `completed`, stores the result for seven days, and emits a job-completed event.
6. The requesting client displays the result and download action.

## Security controls

### Network exposure

- No inbound ports or router forwarding on the office computer.
- Office traffic is restricted to outbound `imap.exmail.qq.com:993` and `orderflow.ausmet.ai:443`.
- Public server traffic is HTTPS/WSS only.
- TLS certificate validation is mandatory; there is no insecure-certificate bypass.

### Credentials and authorization

- Mailbox credentials remain on the office computer and are encrypted with Windows DPAPI through Electron `safeStorage`.
- The gateway agent token is separate from desktop client tokens.
- Agent and client tokens are independently rotatable and never written to logs.
- The server rejects agent endpoints when the agent token is missing or invalid.
- A connected agent has access only to synchronization and extraction-job endpoints.

### Attachment handling

- Accept only `.xlsx` and `.xlsm` names with valid ZIP/OpenXML signatures.
- Reject files over 25 MB compressed, more than 2,000 ZIP entries, or more than 250 MB total declared uncompressed size.
- Sanitize attachment names and never trust message-provided paths.
- Never execute macros, formulas, embedded objects, or external links.
- Run extraction under the normal non-administrator Windows user.
- Delete quarantine files after successful upload or after a 24-hour failed-job retention window.
- Retain generated server results for seven days, then delete them automatically.

### Logging

- Log event type, UID hash, job ID, status, duration, and safe error summaries.
- Do not log mailbox authorization codes, API tokens, full email bodies, attachment contents, or raw Authorization headers.

## Reliability and state management

- Gateway heartbeat interval: 30 seconds.
- Server marks the gateway offline after 90 seconds without a heartbeat.
- WebSocket reconnect uses exponential backoff from 1 to 60 seconds with jitter.
- IMAP reconnect uses exponential backoff and falls back to a 60-second scan after connection recovery.
- Synchronization is idempotent by mailbox identity plus UID.
- Extraction jobs use UUIDs and explicit `queued`, `dispatched`, `running`, `completed`, `failed`, and `expired` states.
- The gateway persists accepted unfinished jobs and resumes them after restart.
- A job result upload is idempotent by job ID and result checksum.
- Jobs remain queued for up to 15 minutes while the gateway is temporarily offline, then fail with a clear gateway-offline error.
- The server cache survives container restarts through the persistent SQLite volume.

## User experience

### Office gateway computer

- Tray icon states: connected, reconnecting, attention required.
- Tray actions: open application, synchronize now, view safe status, exit gateway.
- Closing the main window hides it to the tray rather than terminating the gateway.
- Explicit Exit stops the gateway after confirmation.
- Windows startup registration is opt-in during gateway setup and visible in settings.

### Other clients

- Show `Gateway online` with the last synchronization time.
- Show a persistent warning when the gateway is offline or the cache is stale.
- Disable extraction when the gateway is offline, while preserving cached message visibility.
- Show queued, running, completed, failed, and expired extraction states.
- Preserve the current output-folder and result-workbook actions where files are local; remote clients download the server-retained workbook instead.

## Error handling

- Invalid mailbox credentials: gateway enters attention-required state and stops retrying authentication until credentials change.
- IMAP network interruption: gateway reconnects automatically and clients see stale-cache status only after the heartbeat threshold.
- Server unavailable: gateway keeps its latest UID cursor and pending sync records locally, then replays them after reconnection.
- Invalid or oversized attachment: fail only that attachment, record a safe reason, and continue other selected attachments.
- Extraction failure: upload the sanitized failure list and mark the job failed without exposing local paths to remote clients.
- Result upload interruption: retry by job ID and checksum without rerunning successful extraction.
- Gateway restart during a job: resume accepted incomplete jobs from local durable state.

## Deployment and migration

1. Provision DNS for `orderflow.ausmet.ai` and a valid TLS certificate on `asumet`.
2. Deploy the SQLite-backed agent, message-cache, job, and HTTPS/WSS server changes without enabling them for clients.
3. Build and install the gateway-capable Windows desktop release on the designated office computer.
4. Configure mailbox credentials and the separate agent token through the gateway setup UI.
5. Enable Windows auto-start, close the window to the tray, and confirm the gateway remains online after display power-off and screen lock.
6. Switch one test desktop client to the HTTPS endpoint and verify list sync, SSE notification, extraction, and result download.
7. Switch remaining clients after the test client passes.
8. Remove mailbox credentials from `asumet`, disable the mihomo IMAP keeper timer, and retire the public HTTP 8091 client endpoint after 24 hours of stable operation.

Server and client deployment remain independently reversible. Rolling back the server or client code does not restore cloud IMAP access, but it does not affect the local file-extraction workflow.

## Testing strategy

### Unit tests

- Message summary normalization and UID idempotency.
- Agent/client token separation and authorization failures.
- Heartbeat online/offline state transitions.
- Job state transitions, expiration, retries, and duplicate result uploads.
- Attachment name, signature, ZIP-entry, and size validation.
- Credential encryption/decryption boundaries without logging plaintext.

### Integration tests

- Fake IMAP server to gateway synchronization.
- Gateway WebSocket reconnect and replay after server restart.
- Server SQLite persistence across container restart.
- Desktop list API and SSE events from agent-synchronized messages.
- End-to-end selected-message extraction through the real Python bridge.
- Gateway offline, credential failure, invalid attachment, and interrupted upload behavior.

### Live acceptance tests

- Send a test email with a known order workbook.
- Confirm it appears on a second desktop client within 30 seconds.
- Confirm the second client receives a new-message notification.
- Request extraction from the second client and verify the generated workbook values against the source workbook.
- Lock the office computer and power off its display, then repeat the test.
- Restart the gateway application and verify synchronization resumes without duplicate messages.
- Stop the gateway and confirm all clients show offline status within 90 seconds.
- Verify the office computer has no new listening ports.
- Verify packet flows are limited to outbound TCP 993 and 443.

## Success criteria

- New messages normally appear on all connected clients within 30 seconds.
- Clients show gateway-offline status within 90 seconds of loss.
- Selected extraction completes without any cloud TCP 993 dependency.
- Mailbox credentials never leave the office computer.
- The office computer exposes no new inbound listener.
- Screen lock and display power-off do not interrupt synchronization.
- Restart recovery produces no duplicate messages or duplicate completed jobs.
- All public client and agent traffic uses valid HTTPS/WSS.
- Existing local file extraction and workbook output behavior remains unchanged.
