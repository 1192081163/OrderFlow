import type { EmailMessageSummary } from "../shared/types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export function filterMessagesForMailDay<T extends EmailMessageSummary>(
  messages: T[],
  dayOffset: number,
  now = new Date(),
): T[] {
  const targetKey = localDateKey(dayForOffset(dayOffset, now));
  return messages.filter((message) => message.date && localDateKey(new Date(message.date)) === targetKey);
}

export function formatMailDayTitle(dayOffset: number, now = new Date()): string {
  if (dayOffset === 0) {
    return "今日邮件";
  }
  if (dayOffset === 1) {
    return "昨日邮件";
  }

  const day = dayForOffset(dayOffset, now);
  return `${String(day.getMonth() + 1).padStart(2, "0")}/${String(day.getDate()).padStart(2, "0")} 邮件`;
}

export function canMoveToNextMailDay(dayOffset: number): boolean {
  return dayOffset > 0;
}

export function canMoveToPreviousMailDay(dayOffset: number, dayWindow: number): boolean {
  return dayOffset < Math.max(0, dayWindow - 1);
}

function dayForOffset(dayOffset: number, now: Date): Date {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  day.setTime(day.getTime() - dayOffset * DAY_MS);
  return day;
}

function localDateKey(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return [date.getFullYear(), date.getMonth(), date.getDate()].join("-");
}
