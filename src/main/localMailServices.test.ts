import { expect, test, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/tmp"), setLoginItemSettings: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  Notification: class { static isSupported() { return false; } },
  powerMonitor: { on: vi.fn(), off: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: vi.fn(), decryptString: vi.fn() },
}));

import { loginItemSettings, showOrderMailNotification } from "./localMailServices.js";

test("uses the hidden login argument", () => {
  expect(loginItemSettings(true)).toEqual({ openAtLogin: true, args: ["--hidden"] });
  expect(loginItemSettings(false)).toEqual({ openAtLogin: false, args: ["--hidden"] });
});

test("shows one main-process notification and focuses the window on click", async () => {
  let click: (() => void) | undefined;
  const show = vi.fn();
  const focusFirstWindow = vi.fn();
  const create = vi.fn(() => ({
    on: vi.fn((_name: "click", listener: () => void) => { click = listener; }),
    show,
  }));
  const shown = await showOrderMailNotification([
    {
      uid: "101", subject: "PO 101", attachmentCount: 1, excelAttachmentNames: ["101.xlsx"],
      hasExcelAttachments: true, extracted: false,
    },
  ], { isSupported: () => true, create, focusFirstWindow });

  expect(shown).toBe(true);
  expect(create).toHaveBeenCalledWith({ title: "发现 1 封新订单邮件", body: "PO 101", silent: false });
  expect(show).toHaveBeenCalledOnce();
  click?.();
  expect(focusFirstWindow).toHaveBeenCalledOnce();
});

test("does nothing when Windows notifications are unavailable", async () => {
  const create = vi.fn();
  await expect(showOrderMailNotification([], {
    isSupported: () => false,
    create,
    focusFirstWindow: vi.fn(),
  })).resolves.toBe(false);
  expect(create).not.toHaveBeenCalled();
});
