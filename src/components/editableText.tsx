import { useLayoutEffect, useRef } from "react";

import { cn } from "~/lib/utils";

/**
 * A bubble's words, editable where they are: click into them and type. Enter or Esc finishes,
 * as does clicking away. Emptied, they go back to what they were.
 *
 * `onInput` follows every keystroke (a conversation being recorded keeps its turns in step);
 * `onCommit` gets the words once editing finishes (a saved message is saved then).
 *
 * The words may grow while they are being edited (Soniox settling more of a turn): new words
 * are added at the end without moving the caret. It is an inline element: a contenteditable
 * block is laid out as narrow as its longest word, and bubbles size to their text.
 */
export function EditableText({
  text,
  className,
  onInput,
  onCommit,
  onFocus,
  onBlur,
}: {
  text: string;
  className?: string;
  onInput?: (text: string) => void;
  onCommit?: (text: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const before = useRef(text); // the words when editing started

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const shown = element.textContent ?? "";
    if (shown === text) return;
    if (document.activeElement !== element) element.textContent = text;
    // Being edited: only words added at the end are taken, after the caret's text.
    else if (text.startsWith(shown)) element.append(text.slice(shown.length));
  }, [text]);

  const finish = (element: HTMLElement) => {
    const words = (element.textContent ?? "").trim();
    if (!words) {
      element.textContent = before.current;
      onInput?.(before.current);
      return;
    }
    if (words !== before.current.trim()) onCommit?.(words);
  };

  return (
    <span
      ref={ref}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck={false}
      className={cn("cursor-text outline-none", className)}
      onFocus={() => {
        before.current = text;
        onFocus?.();
      }}
      onInput={(event) => onInput?.(event.currentTarget.textContent ?? "")}
      onKeyDown={(event) => {
        if (event.key !== "Escape" && event.key !== "Enter") return;
        event.preventDefault(); // not the window's Esc, and no line break
        event.currentTarget.blur();
      }}
      onBlur={(event) => {
        finish(event.currentTarget);
        onBlur?.();
      }}
    />
  );
}
