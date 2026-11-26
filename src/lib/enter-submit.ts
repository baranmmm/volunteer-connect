import type { KeyboardEvent } from "react";

/**
 * True when a key press in a textarea should submit its form: Enter without Shift (Shift+Enter is a new line), and not
 * while an input method (IME) is composing text (Enter then confirms the composition; Safari reports it as keyCode 229).
 */
export function isSubmitEnter(e: {
  key: string;
  shiftKey: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean };
  isComposing?: boolean;
}) {
  if (e.key !== "Enter" || e.shiftKey || e.altKey) return false;
  if (e.isComposing || e.nativeEvent?.isComposing || e.keyCode === 229) return false;
  return true;
}

/** onKeyDown for a textarea: Enter submits the surrounding form, Shift+Enter inserts a new line. */
export function submitOnEnter(e: KeyboardEvent<HTMLTextAreaElement>) {
  if (!isSubmitEnter(e)) return;
  e.preventDefault();
  e.currentTarget.form?.requestSubmit();
}
