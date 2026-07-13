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
  createClient: (config: ImapConfig) => ImapIdleClient = (value) => createImapClient(value) as unknown as ImapFlow,
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
    if (value instanceof Error) {
      current.reject(value);
    } else {
      current.resolve(value);
    }
  };
  const onExists = () => deliver("changed");
  const onClose = () => deliver("closed");
  const onError = (error: Error) => deliver(error);
  client.on("exists", onExists);
  client.on("close", onClose);
  client.on("error", onError);

  return {
    waitForChange(signal) {
      if (closed || signal.aborted) {
        return Promise.resolve("closed");
      }
      if (queued !== undefined) {
        const value = queued;
        queued = undefined;
        return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
      }
      if (waiter) {
        return Promise.reject(new Error("Only one IMAP IDLE waiter is allowed"));
      }
      return new Promise<"changed" | "closed">((resolve, reject) => {
        const onAbort = () => deliver("closed");
        waiter = { resolve, reject, signal, onAbort };
        signal.addEventListener("abort", onAbort, { once: true });
      });
    },
    async close() {
      if (closed) {
        return;
      }
      closed = true;
      client.off("exists", onExists);
      client.off("close", onClose);
      client.off("error", onError);
      deliver("closed");
      await client.logout().catch(() => undefined);
    },
  };
}
