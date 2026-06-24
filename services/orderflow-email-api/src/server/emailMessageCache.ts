import type { EmailListRequest } from "../core/extractionService.js";
import type { EmailListResult, EmailMessageSummary } from "../shared/types.js";

export interface CachedEmailMessageServiceOptions {
  listEmailMessages: (request: EmailListRequest) => Promise<EmailListResult>;
  defaultRequest?: EmailListRequest;
  refreshIntervalMs: number;
  now?: () => number;
  log?: (message: string) => void;
  onNewMessages?: (event: EmailCacheNewMessagesEvent) => void;
}

export interface EmailCacheNewMessagesEvent {
  email: string;
  days: number;
  messages: EmailMessageSummary[];
}

interface CacheEntry {
  request: EmailListRequest;
  result?: EmailListResult;
  updatedAt: number;
  refresh?: Promise<EmailListResult>;
}

const DEFAULT_LIST_DAYS = 7;

export class CachedEmailMessageService {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly listEmailMessages: (request: EmailListRequest) => Promise<EmailListResult>;
  private readonly defaultRequest?: EmailListRequest;
  private readonly refreshIntervalMs: number;
  private readonly now: () => number;
  private readonly log?: (message: string) => void;
  private readonly onNewMessages?: (event: EmailCacheNewMessagesEvent) => void;
  private timer?: ReturnType<typeof setInterval>;

  constructor(options: CachedEmailMessageServiceOptions) {
    this.listEmailMessages = options.listEmailMessages;
    this.defaultRequest = options.defaultRequest;
    this.refreshIntervalMs = Math.max(0, options.refreshIntervalMs);
    this.now = options.now ?? Date.now;
    this.log = options.log;
    this.onNewMessages = options.onNewMessages;
  }

  start(): void {
    if (this.defaultRequest) {
      void this.primeDefault();
    }

    if (this.refreshIntervalMs <= 0 || this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      void this.refreshAll();
    }, this.refreshIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) {
      return;
    }
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async primeDefault(): Promise<void> {
    if (!this.defaultRequest) {
      return;
    }
    await this.refresh(this.defaultRequest).catch((error) => {
      this.log?.(`Email cache warmup failed: ${messageOf(error)}`);
      throw error;
    });
  }

  async list(request: EmailListRequest): Promise<EmailListResult> {
    const normalized = normalizeRequest(request);
    const entry = this.entryFor(normalized);

    if (!entry.result) {
      return cloneEmailListResult(await this.refresh(normalized));
    }

    if (this.isStale(entry)) {
      void this.refresh(normalized).catch((error) => {
        this.log?.(`Email cache refresh failed: ${messageOf(error)}`);
      });
    }

    return cloneEmailListResult(entry.result);
  }

  async refreshNow(request: EmailListRequest): Promise<EmailListResult> {
    return cloneEmailListResult(await this.refresh(request));
  }

  private async refreshAll(): Promise<void> {
    await Promise.allSettled(
      [...this.entries.values()].map((entry) =>
        this.refresh(entry.request).catch((error) => {
          this.log?.(`Email cache refresh failed: ${messageOf(error)}`);
          throw error;
        }),
      ),
    );
  }

  private refresh(request: EmailListRequest): Promise<EmailListResult> {
    const normalized = normalizeRequest(request);
    const entry = this.entryFor(normalized);
    if (entry.refresh) {
      return entry.refresh;
    }

    entry.request = normalized;
    const previousResult = entry.result;
    entry.refresh = this.listEmailMessages(normalized)
      .then((result) => {
        const newMessages = previousResult ? findNewMessages(previousResult, result) : [];
        entry.result = cloneEmailListResult(result);
        entry.updatedAt = this.now();
        if (newMessages.length > 0) {
          this.onNewMessages?.({
            email: normalized.email,
            days: normalized.days ?? DEFAULT_LIST_DAYS,
            messages: newMessages.map(cloneMessage),
          });
        }
        return entry.result;
      })
      .finally(() => {
        entry.refresh = undefined;
      });

    return entry.refresh;
  }

  private entryFor(request: EmailListRequest): CacheEntry {
    const key = cacheKey(request);
    const existing = this.entries.get(key);
    if (existing) {
      return existing;
    }

    const entry: CacheEntry = {
      request,
      updatedAt: 0,
    };
    this.entries.set(key, entry);
    return entry;
  }

  private isStale(entry: CacheEntry): boolean {
    return this.refreshIntervalMs > 0 && this.now() - entry.updatedAt >= this.refreshIntervalMs;
  }
}

function normalizeRequest(request: EmailListRequest): EmailListRequest {
  return {
    ...request,
    email: request.email.trim(),
    authCode: request.authCode,
    server: request.server?.trim(),
    proxy: request.proxy?.trim() || undefined,
    days: request.days ?? DEFAULT_LIST_DAYS,
  };
}

function cacheKey(request: EmailListRequest): string {
  return JSON.stringify({
    email: request.email.trim().toLowerCase(),
    server: request.server?.trim().toLowerCase() ?? "",
    port: request.port ?? "",
    proxy: request.proxy?.trim() ?? "",
    days: request.days ?? DEFAULT_LIST_DAYS,
  });
}

function cloneEmailListResult(result: EmailListResult): EmailListResult {
  return {
    ...result,
    messages: result.messages.map(cloneMessage),
  };
}

function cloneMessage(message: EmailMessageSummary): EmailMessageSummary {
  return {
    ...message,
    excelAttachmentNames: [...message.excelAttachmentNames],
  };
}

function findNewMessages(previous: EmailListResult, next: EmailListResult): EmailMessageSummary[] {
  const seenUids = new Set(previous.messages.map((message) => message.uid));
  return next.messages.filter((message) => !seenUids.has(message.uid));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
