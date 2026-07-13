import { expect, test, vi } from "vitest";

import { createSingleInstanceGate } from "./singleInstance.js";

test("quits a second application process before it creates services or windows", () => {
  const quit = vi.fn();
  const onSecondInstance = vi.fn();

  expect(createSingleInstanceGate({ requestLock: () => false, onSecondInstance, quit })).toBeNull();
  expect(quit).toHaveBeenCalledOnce();
  expect(onSecondInstance).not.toHaveBeenCalled();
});

test("restores the existing window when the application is opened again", () => {
  let secondInstanceListener: (() => void) | undefined;
  const gate = createSingleInstanceGate({
    requestLock: () => true,
    onSecondInstance: (listener) => {
      secondInstanceListener = listener;
    },
    quit: vi.fn(),
  });
  const showWindow = vi.fn();

  gate?.attachWindow(showWindow);
  secondInstanceListener?.();

  expect(showWindow).toHaveBeenCalledOnce();
});

test("remembers an early reopen request until the main window is ready", () => {
  let secondInstanceListener: (() => void) | undefined;
  const gate = createSingleInstanceGate({
    requestLock: () => true,
    onSecondInstance: (listener) => {
      secondInstanceListener = listener;
    },
    quit: vi.fn(),
  });
  const showWindow = vi.fn();

  secondInstanceListener?.();
  gate?.attachWindow(showWindow);

  expect(showWindow).toHaveBeenCalledOnce();
});
