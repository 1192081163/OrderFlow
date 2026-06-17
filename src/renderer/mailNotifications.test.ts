import { describe, expect, test } from "vitest";

import {
  buildNewOrderEmailNotification,
  findNewPendingOrderMessages,
  mergeSeenMessageUids,
} from "./mailNotifications.js";
import type { EmailMessageSummary } from "../shared/types.js";

describe("mail notification helpers", () => {
  test("detects only unseen pending order emails", () => {
    const messages = [
      orderMessage("101", "old order"),
      orderMessage("102", "new order"),
      { ...orderMessage("103", "already extracted"), uid: "103" },
      {
        uid: "104",
        subject: "plain notice",
        attachmentCount: 0,
        excelAttachmentNames: [],
        hasExcelAttachments: false,
      },
    ];

    const result = findNewPendingOrderMessages(messages, new Set(["101"]), new Set(["103"]));

    expect(result.map((message) => message.uid)).toEqual(["102"]);
  });

  test("merges refreshed message uids into the seen baseline", () => {
    const result = mergeSeenMessageUids(new Set(["101"]), [orderMessage("102", "new order"), orderMessage("103", "newer order")]);

    expect([...result].sort()).toEqual(["101", "102", "103"]);
  });

  test("builds a concise native notification payload", () => {
    const notification = buildNewOrderEmailNotification([
      orderMessage("102", "PO 1001"),
      orderMessage("103", "PO 1002"),
    ]);

    expect(notification).toEqual({
      title: "发现 2 封新订单邮件",
      body: "最新：PO 1001；还有 1 封待提取",
    });
  });
});

function orderMessage(uid: string, subject: string): EmailMessageSummary {
  return {
    uid,
    subject,
    from: "Orders <orders@example.com>",
    date: "2026-06-17T08:00:00.000Z",
    attachmentCount: 1,
    excelAttachmentNames: [`${uid}.xlsx`],
    hasExcelAttachments: true,
  };
}
