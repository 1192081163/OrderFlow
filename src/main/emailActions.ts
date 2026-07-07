import {
  extractEmailOrders,
  extractLocalOrders,
  listEmailMessages,
  type EmailExtractionRequest,
  type EmailExtractionResult,
  type EmailListRequest,
  type LocalExtractionRequest,
} from "../core/extractionService.js";
import { loadRemoteEmailApiConfig, RemoteEmailApiClient } from "../core/remoteEmailApi.js";
import type { EmailListResult, EmailNewMessagesEvent, ProgressEvent } from "../shared/types.js";
import type { ExtractionResult } from "../shared/types.js";

export interface RemoteEmailClient {
  listEmails(request: EmailListRequest): Promise<EmailListResult>;
  extractEmail(request: EmailExtractionRequest): Promise<EmailExtractionResult>;
  extractLocal?(request: LocalExtractionRequest): Promise<ExtractionResult>;
  subscribeNewMessages?(
    onEvent: (event: EmailNewMessagesEvent) => void,
    options?: { signal?: AbortSignal },
  ): Promise<void>;
}

export interface DesktopEmailSubscription {
  close(): void;
}

interface DesktopEmailDependencies {
  loadRemoteEmailClient?: () => Promise<RemoteEmailClient | undefined>;
  listEmailMessages?: (request: EmailListRequest) => Promise<EmailListResult>;
  extractEmailOrders?: (request: EmailExtractionRequest, progress?: (event: ProgressEvent) => void) => Promise<EmailExtractionResult>;
  extractLocalOrders?: (request: LocalExtractionRequest, progress?: (event: ProgressEvent) => void) => Promise<ExtractionResult>;
}

export async function listDesktopEmails(
  request: EmailListRequest,
  dependencies: DesktopEmailDependencies = {},
): Promise<EmailListResult> {
  const remoteClient = await loadConfiguredRemoteEmailClient(dependencies);
  if (remoteClient) {
    return remoteClient.listEmails(request);
  }

  const localListEmails = dependencies.listEmailMessages ?? listEmailMessages;
  return localListEmails(request);
}

export async function extractDesktopEmailOrders(
  request: EmailExtractionRequest,
  progress?: (event: ProgressEvent) => void,
  dependencies: DesktopEmailDependencies = {},
): Promise<EmailExtractionResult> {
  const remoteClient = await loadConfiguredRemoteEmailClient(dependencies);
  if (remoteClient) {
    return remoteClient.extractEmail(request);
  }

  const localExtractEmailOrders = dependencies.extractEmailOrders ?? extractEmailOrders;
  return localExtractEmailOrders(request, progress);
}

export async function extractDesktopLocalOrders(
  request: LocalExtractionRequest,
  progress?: (event: ProgressEvent) => void,
  dependencies: DesktopEmailDependencies = {},
): Promise<ExtractionResult> {
  const localExtractLocalOrders = dependencies.extractLocalOrders ?? extractLocalOrders;
  return localExtractLocalOrders(request, progress);
}

export async function subscribeDesktopEmailUpdates(
  onEvent: (event: EmailNewMessagesEvent) => void,
  dependencies: DesktopEmailDependencies = {},
): Promise<DesktopEmailSubscription | undefined> {
  const remoteClient = await loadConfiguredRemoteEmailClient(dependencies);
  if (!remoteClient?.subscribeNewMessages) {
    return undefined;
  }

  const controller = new AbortController();
  void remoteClient.subscribeNewMessages(onEvent, { signal: controller.signal }).catch((error) => {
    if (!controller.signal.aborted) {
      console.warn(`Remote email update subscription failed: ${messageOf(error)}`);
    }
  });

  return {
    close: () => controller.abort(),
  };
}

async function loadConfiguredRemoteEmailClient(dependencies: DesktopEmailDependencies): Promise<RemoteEmailClient | undefined> {
  if (dependencies.loadRemoteEmailClient) {
    return dependencies.loadRemoteEmailClient();
  }

  const config = await loadRemoteEmailApiConfig();
  return config ? new RemoteEmailApiClient(config) : undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
