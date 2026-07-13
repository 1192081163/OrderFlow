import { expect, test } from "vitest";

import { applyLocalMailEvent, connectionBadge, emptyMailCopy } from "./localMailViewState.js";

test.each([
  ["connected", "已连接", "success"],
  ["connecting", "连接中", "warning"],
  ["offline", "离线缓存", "warning"],
  ["attention_required", "需要重新登录", "danger"],
  ["stopped", "未登录", "subtle"],
] as const)("maps %s to a stable badge", (state, label, color) => {
  expect(connectionBadge({ state, detail: "detail" })).toEqual({ label, color });
});

test("applies a main-process message event and keeps new UID badges", () => {
  const next = applyLocalMailEvent(
    { list: undefined, newMessageUids: new Set<string>(), status: { state: "stopped", detail: "" } },
    {
      type: "messages-updated",
      data: {
        newMessageUids: ["101"],
        list: {
          messages: [{
            uid: "101",
            subject: "PO 101",
            from: "orders@example.com",
            date: "2026-07-13T00:00:00Z",
            attachmentCount: 1,
            excelAttachmentNames: ["101.xlsx"],
            hasExcelAttachments: true,
            extracted: false,
          }],
          scannedMessages: 1,
          days: 7,
          orderAttachmentCount: 1,
          nonOrderExcelAttachmentCount: 0,
          status: { state: "connected", detail: "ok" },
        },
      },
    },
  );
  expect(next.list?.messages[0]?.uid).toBe("101");
  expect(next.newMessageUids).toEqual(new Set(["101"]));
});

test("uses cache-aware empty copy", () => {
  expect(emptyMailCopy(false, false)).toBe("登录企业邮箱后显示订单邮件。");
  expect(emptyMailCopy(true, true)).toBe("离线，当前没有可显示的本地订单邮件。");
  expect(emptyMailCopy(true, false)).toBe("最近 7 天没有订单邮件。");
});
