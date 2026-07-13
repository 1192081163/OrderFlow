export interface WindowLike {
  hide(): void;
  show(): void;
  focus(): void;
  isMinimized(): boolean;
  restore(): void;
}

export interface CloseEventLike {
  preventDefault(): void;
}

export function createWindowLifecycle(window: WindowLike) {
  let quitting = false;
  return {
    handleClose(event: CloseEventLike): void {
      if (quitting) return;
      event.preventDefault();
      window.hide();
    },
    showWindow(): void {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    },
    allowQuit(): void {
      quitting = true;
    },
  };
}

export type WindowLifecycle = ReturnType<typeof createWindowLifecycle>;
