export interface SingleInstanceBindings {
  requestLock(): boolean;
  onSecondInstance(listener: () => void): void;
  quit(): void;
}

export interface SingleInstanceGate {
  attachWindow(showWindow: () => void): void;
}

export function createSingleInstanceGate(bindings: SingleInstanceBindings): SingleInstanceGate | null {
  if (!bindings.requestLock()) {
    bindings.quit();
    return null;
  }

  let showWindow: (() => void) | undefined;
  let reopenPending = false;
  bindings.onSecondInstance(() => {
    if (showWindow) {
      showWindow();
    } else {
      reopenPending = true;
    }
  });

  return {
    attachWindow(nextShowWindow): void {
      showWindow = nextShowWindow;
      if (reopenPending) {
        reopenPending = false;
        showWindow();
      }
    },
  };
}
