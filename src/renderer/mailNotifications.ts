import type { EmailMessageSummary, NewOrderEmailNotification } from "../shared/types.js";

export function findNewPendingOrderMessages(
  messages: EmailMessageSummary[],
  seenMessageUids: Set<string>,
  extractedMessageUids: Set<string>,
): EmailMessageSummary[] {
  return messages.filter(
    (message) => message.hasExcelAttachments && !seenMessageUids.has(message.uid) && !extractedMessageUids.has(message.uid),
  );
}

export function mergeSeenMessageUids(seenMessageUids: Set<string>, messages: EmailMessageSummary[]): Set<string> {
  const next = new Set(seenMessageUids);
  messages.forEach((message) => next.add(message.uid));
  return next;
}

export function buildNewOrderEmailNotification(messages: EmailMessageSummary[]): NewOrderEmailNotification {
  const count = messages.length;
  const latestSubject = truncateNotificationText(messages[0]?.subject?.trim() || "(无主题)", 64);
  return {
    title: `发现 ${count} 封新订单邮件`,
    body: count > 1 ? `最新：${latestSubject}；还有 ${count - 1} 封待提取` : `最新：${latestSubject}`,
  };
}

function truncateNotificationText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}
