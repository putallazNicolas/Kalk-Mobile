import { useCallback, useEffect, useState } from 'react';

import { Toast, UNDO_TOAST_MS } from './Toast';

interface UndoRequest {
  message: string;
  onUndo: () => void;
}

interface Shown extends UndoRequest {
  key: number;
}

let present: ((request: UndoRequest) => void) | null = null;
let hide: (() => void) | null = null;
let counter = 0;

/**
 * Shows the undo toast (design/S6 UndoToast): the S4 toast with a trash icon and "Deshacer" in
 * accent, for 5 s. It lives at the root, so it survives the screen that asked for it closing.
 */
export function showUndoToast(request: UndoRequest) {
  present?.(request);
}

/**
 * Hides the undo toast when what it offers to undo was already written (e.g. the screen that
 * deferred a removal closed early): a "Deshacer" that does nothing must never stay on screen.
 */
export function hideUndoToast() {
  hide?.();
}

/** Mount once at the root, next to the confirm host. */
export function UndoToastHost() {
  const [shown, setShown] = useState<Shown | null>(null);

  useEffect(() => {
    present = (request) => {
      counter += 1;
      setShown({ ...request, key: counter });
    };
    hide = () => setShown(null);
    return () => {
      present = null;
      hide = null;
    };
  }, []);

  const dismiss = useCallback(() => setShown(null), []);

  if (!shown) return null;
  return (
    <Toast
      key={shown.key}
      tone="undo"
      durationMs={UNDO_TOAST_MS}
      message={shown.message}
      actionLabel="Deshacer"
      onAction={shown.onUndo}
      onDismiss={dismiss}
    />
  );
}
