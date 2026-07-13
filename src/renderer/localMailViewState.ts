import type { LocalMailEvent, LocalMailListResult, LocalMailRuntimeStatus } from "../shared/types.js";

export interface LocalMailRendererState {
  list?: LocalMailListResult;
  newMessageUids: Set<string>;
  status: LocalMailRuntimeStatus;
}

export function connectionBadge(status: LocalMailRuntimeStatus): {
  label: string;
  color: "success" | "warning" | "danger" | "subtle";
} {
  switch (status.state) {
    case "connected": return { label: "已连接", color: "success" };
    case "connecting": return { label: "连接中", color: "warning" };
    case "offline": return { label: "离线缓存", color: "warning" };
    case "attention_required": return { label: "需要重新登录", color: "danger" };
    default: return { label: "未登录", color: "subtle" };
  }
}

export function applyLocalMailEvent(state: LocalMailRendererState, event: LocalMailEvent): LocalMailRendererState {
  if (event.type === "status-changed") return { ...state, status: event.data };
  const newMessageUids = new Set(state.newMessageUids);
  event.data.newMessageUids.forEach((uid) => newMessageUids.add(uid));
  return { list: event.data.list, newMessageUids, status: event.data.list.status };
}

export function emptyMailCopy(hasCredentials: boolean, offline: boolean): string {
  if (!hasCredentials) return "登录企业邮箱后显示订单邮件。";
  return offline ? "离线，当前没有可显示的本地订单邮件。" : "最近 7 天没有订单邮件。";
}
