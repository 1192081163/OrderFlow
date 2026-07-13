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
  lastScannedMessages(email: string): number;
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
    return this.rows(
      "SELECT * FROM mail_messages WHERE mailbox_id=? ORDER BY COALESCE(received_at,first_seen_at) DESC,CAST(uid AS INTEGER) DESC,uid DESC",
      email,
    );
  }

  listUnnotified(email: string): LocalMailMessageSummary[] {
    return this.rows(
      "SELECT * FROM mail_messages WHERE mailbox_id=? AND notified_at IS NULL ORDER BY COALESCE(received_at,first_seen_at) DESC,CAST(uid AS INTEGER) DESC,uid DESC",
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

  lastScannedMessages(email: string): number {
    const row = this.db.prepare("SELECT scanned_messages FROM mailbox_state WHERE mailbox_id=?").get(mailboxIdFor(email)) as unknown as
      | { scanned_messages?: unknown }
      | undefined;
    return Number(row?.scanned_messages ?? 0);
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
