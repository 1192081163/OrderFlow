import { expect, test, vi } from "vitest";

import { extractDesktopLocalOrders } from "./emailActions.js";

test("keeps local file extraction on the local Python path", async () => {
  const extractLocalOrders = vi.fn(async (request: { paths: string[] }) => ({
    inputFiles: request.paths,
    rows: [],
    skippedFiles: [],
    failures: [],
    outputs: { outputDir: "/tmp/out", csvOutput: "", xlsxOutput: "/tmp/out/result.xlsx", auditOutput: "" },
  }));
  const result = await extractDesktopLocalOrders(
    { paths: ["/tmp/order.xlsx"], inferManual: true },
    undefined,
    { extractLocalOrders },
  );
  expect(extractLocalOrders).toHaveBeenCalledWith(
    { paths: ["/tmp/order.xlsx"], inferManual: true },
    undefined,
  );
  expect(result.inputFiles).toEqual(["/tmp/order.xlsx"]);
});
