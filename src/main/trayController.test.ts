import { expect, test, vi } from "vitest";

import { createTrayController } from "./trayController.js";

test("builds Open, Reconnect, and Exit tray commands", async () => {
  let template: Array<{ label?: string; type?: "separator"; click?: () => void }> = [];
  const tray = { setToolTip: vi.fn(), setContextMenu: vi.fn(), on: vi.fn(), destroy: vi.fn() };
  const showWindow = vi.fn();
  const reconnect = vi.fn(async () => undefined);
  const exit = vi.fn(async () => undefined);
  const controller = createTrayController({
    iconPath: "/app/icon.png",
    bindings: {
      createTray: vi.fn(() => tray),
      buildMenu: vi.fn((value) => { template = value; return { template: value }; }),
    },
    showWindow,
    reconnect,
    exit,
  });

  expect(template.filter((item) => item.label).map((item) => item.label)).toEqual(["打开主界面", "重新连接邮箱", "退出"]);
  template.find((item) => item.label === "打开主界面")?.click?.();
  template.find((item) => item.label === "重新连接邮箱")?.click?.();
  template.find((item) => item.label === "退出")?.click?.();
  await vi.waitFor(() => expect(reconnect).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(exit).toHaveBeenCalledOnce());
  expect(showWindow).toHaveBeenCalledOnce();
  controller.destroy();
  expect(tray.destroy).toHaveBeenCalledOnce();
});
