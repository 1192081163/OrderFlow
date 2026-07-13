export interface TrayLike {
  setToolTip(value: string): void;
  setContextMenu(menu: unknown): void;
  on(name: "click", listener: () => void): void;
  destroy(): void;
}

export interface TrayControllerBindings {
  createTray(iconPath: string): TrayLike;
  buildMenu(template: Array<{ label?: string; type?: "separator"; click?: () => void }>): unknown;
}

export function createTrayController(options: {
  iconPath: string;
  bindings: TrayControllerBindings;
  showWindow(): void;
  reconnect(): Promise<void>;
  exit(): Promise<void>;
}) {
  const tray = options.bindings.createTray(options.iconPath);
  tray.setToolTip("订单整理助手");
  tray.setContextMenu(options.bindings.buildMenu([
    { label: "打开主界面", click: options.showWindow },
    { label: "重新连接邮箱", click: () => { void options.reconnect(); } },
    { type: "separator" },
    { label: "退出", click: () => { void options.exit(); } },
  ]));
  tray.on("click", options.showWindow);
  return { destroy: () => tray.destroy() };
}
