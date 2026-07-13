import { extractLocalOrders, type LocalExtractionRequest } from "../core/extractionService.js";
import type { ExtractionResult, ProgressEvent } from "../shared/types.js";

export async function extractDesktopLocalOrders(
  request: LocalExtractionRequest,
  progress?: (event: ProgressEvent) => void,
  dependencies: { extractLocalOrders?: typeof extractLocalOrders } = {},
): Promise<ExtractionResult> {
  return (dependencies.extractLocalOrders ?? extractLocalOrders)(request, progress);
}
