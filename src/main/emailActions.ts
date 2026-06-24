import {
  extractEmailOrders,
  listEmailMessages,
  type EmailExtractionRequest,
  type EmailExtractionResult,
  type EmailListRequest,
} from "../core/extractionService.js";
import { loadRemoteEmailApiConfig, RemoteEmailApiClient } from "../core/remoteEmailApi.js";
import type { EmailListResult, ProgressEvent } from "../shared/types.js";

export interface RemoteEmailClient {
  listEmails(request: EmailListRequest): Promise<EmailListResult>;
  extractEmail(request: EmailExtractionRequest): Promise<EmailExtractionResult>;
}

interface DesktopEmailDependencies {
  loadRemoteEmailClient?: () => Promise<RemoteEmailClient | undefined>;
  listEmailMessages?: (request: EmailListRequest) => Promise<EmailListResult>;
  extractEmailOrders?: (request: EmailExtractionRequest, progress?: (event: ProgressEvent) => void) => Promise<EmailExtractionResult>;
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

async function loadConfiguredRemoteEmailClient(dependencies: DesktopEmailDependencies): Promise<RemoteEmailClient | undefined> {
  if (dependencies.loadRemoteEmailClient) {
    return dependencies.loadRemoteEmailClient();
  }

  const config = await loadRemoteEmailApiConfig();
  return config ? new RemoteEmailApiClient(config) : undefined;
}
