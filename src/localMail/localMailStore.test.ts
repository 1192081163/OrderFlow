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
    expect(store.lastScannedMessages("orders@example.com")).toBe(1);
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
