import { expect, test, vi } from "vitest";

import { createWindowLifecycle } from "./windowLifecycle.js";

test("prevents close and hides the window until explicit quit", () => {
  const window = { hide: vi.fn(), show: vi.fn(), focus: vi.fn(), isMinimized: vi.fn(() => false), restore: vi.fn() };
  const lifecycle = createWindowLifecycle(window);
  const event = { preventDefault: vi.fn() };
  lifecycle.handleClose(event);
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(window.hide).toHaveBeenCalledOnce();
  lifecycle.allowQuit();
  lifecycle.handleClose(event);
  expect(event.preventDefault).toHaveBeenCalledOnce();
});

test("restores, shows, and focuses the window", () => {
  const window = { hide: vi.fn(), show: vi.fn(), focus: vi.fn(), isMinimized: vi.fn(() => true), restore: vi.fn() };
  const lifecycle = createWindowLifecycle(window);
  lifecycle.showWindow();
  expect(window.restore).toHaveBeenCalledOnce();
  expect(window.show).toHaveBeenCalledOnce();
  expect(window.focus).toHaveBeenCalledOnce();
});
