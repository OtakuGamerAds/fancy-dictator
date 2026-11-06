import type { FocusEvent, KeyboardEvent } from "react";

/**
 * Makes a bubble's text editable in place: click into it and type; it is saved when the focus
 * leaves (Esc too). Emptied, it goes back to what it was. Give the element `key={text}`, so it
 * is drawn afresh from the saved words.
 */
export function editableText(original: string, onSave: (text: string) => void, onFocus?: () => void) {
  return {
    contentEditable: "plaintext-only" as const,
    suppressContentEditableWarning: true,
    spellCheck: false,
    onFocus,
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); // not the window's Esc
      event.currentTarget.blur();
    },
    onBlur: (event: FocusEvent<HTMLElement>) => {
      const text = event.currentTarget.innerText.trim();
      if (!text) event.currentTarget.textContent = original;
      else if (text !== original.trim()) onSave(text);
    },
  };
}

/** How an editable bubble's text looks: a text cursor, and no outline while editing. */
export const EDITABLE_TEXT_CLASS_NAME = "cursor-text outline-none";
