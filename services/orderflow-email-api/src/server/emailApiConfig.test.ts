import { describe, expect, test } from "vitest";

import { loadEmailApiConfig } from "./emailApiConfig.js";

describe("standalone email API config", () => {
  test("loads cache refresh settings from environment", () => {
    expect(
      loadEmailApiConfig({
        EMAIL_API_TOKEN: "token",
        EMAIL_ACCOUNT: "orders@example.com",
        EMAIL_AUTH_CODE: "secret",
        EMAIL_CACHE_DAYS: "3",
        EMAIL_CACHE_REFRESH_SECONDS: "45",
      }),
    ).toMatchObject({
      cacheDays: 3,
      cacheRefreshMs: 45_000,
    });
  });

  test("uses cache defaults when not configured", () => {
    expect(
      loadEmailApiConfig({
        EMAIL_API_TOKEN: "token",
        EMAIL_ACCOUNT: "orders@example.com",
        EMAIL_AUTH_CODE: "secret",
      }),
    ).toMatchObject({
      cacheDays: 7,
      cacheRefreshMs: 120_000,
    });
  });
});
