import { type MouseEvent, useLayoutEffect, useRef, useState } from "react";

import { EditableText } from "~/components/editableText";
import { guestBubbleClassName } from "~/components/guestMessageStyle";
import { speakerName, type Turn } from "~/lib/dialogue";
import { cn, textDirection } from "~/lib/utils";

/**
 * Each speaker's colors: the first in your message bubble, the second as T3's guest (bubble and
 * name), the others in the guest's look in T3's other accent hues; then round again. The name
 * above each bubble tells them apart however many there are.
 */
const SPEAKER_COLORS = [
  { surface: guestBubbleClassName(false), name: "text-guest-foreground", hue: "bg-guest/70" },
  { surface: "bg-speaker-3-surface", name: "text-speaker-3-foreground", hue: "bg-speaker-3/70" },
  { surface: "bg-speaker-4-surface", name: "text-speaker-4-foreground", hue: "bg-speaker-4/70" },
  { surface: "bg-speaker-5-surface", name: "text-speaker-5-foreground", hue: "bg-speaker-5/70" },
];
const FIRST_SPEAKER = { surface: "bg-message", name: "text-muted-foreground", hue: "bg-muted-foreground/70" };

/**
 * A folded message, as T3 Code folds a long one (TimelineUserMessageRow's
 * CollapsibleUserMessageBody): cut to a height, its last line fading out when there is more.
 * (A line clamp would size the bubble to its longest word.)
 */
export const FOLDED_TEXT_CLASS_NAME = "max-h-[3lh] overflow-hidden";
const FADE_MASK = "linear-gradient(to bottom, black calc(100% - 1lh), transparent)";
export const FOLDED_TEXT_FADE = { WebkitMaskImage: FADE_MASK, maskImage: FADE_MASK };

/**
 * A saved message's words, folded to 3 lines (the last fading when there is more) until they
 * are clicked into to edit, and folded again once the focus leaves them.
 */
export function useFold(foldable: boolean, text: string) {
  const textRef = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [cut, setCut] = useState(false);
  const folded = foldable && !open;
  useLayoutEffect(() => {
    const element = textRef.current;
    if (!element || !folded) return setCut(false);
    const measure = () => setCut(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [folded, text]);
  return {
    textRef,
    textClassName: folded ? FOLDED_TEXT_CLASS_NAME : undefined,
    textStyle: folded && cut ? FOLDED_TEXT_FADE : undefined,
    onFocus: () => setOpen(true),
    onBlur: () => setOpen(false),
  };
}

/**
 * A click anywhere on a bubble edits its words (not on its recordings): off the words, the
 * caret goes to their end.
 */
export function editOnClick(event: MouseEvent<HTMLElement>) {
  const words = event.currentTarget.querySelector<HTMLElement>("[contenteditable]");
  const target = event.target as HTMLElement;
  if (!words || words.contains(document.activeElement) || target.closest("button, [data-slot=context-chip]")) return;
  words.focus();
  const caret = document.createRange();
  caret.selectNodeContents(words);
  caret.collapse(false);
  const selection = getSelection();
  selection?.removeAllRanges();
  selection?.addRange(caret);
}

export function speakerColors(number: number) {
  return number <= 1 ? FIRST_SPEAKER : SPEAKER_COLORS[(number - 2) % SPEAKER_COLORS.length]!;
}

/**
 * One turn of a conversation, drawn as T3 Code draws a guest's message in a thread
 * (TimelineUserMessageRow): the speaker's name above, then the bubble in the speaker's color.
 * Words still being recognized are faint at its end, as in the text box.
 */
export function ConversationTurn({
  turn,
  number,
  pending = "",
  foldable = false,
  onEdit,
  onLiveEdit,
  onFocus,
}: {
  turn: Turn;
  /** The speaker's number (1 for whoever spoke first). */
  number: number;
  pending?: string;
  /** Folded to 3 lines when longer, until clicked into (a saved message). */
  foldable?: boolean;
  /** Its words can be edited in place: given when editing finishes (a saved message)… */
  onEdit?: (text: string) => void;
  /** …or with every keystroke (a conversation being recorded). */
  onLiveEdit?: (text: string) => void;
  onFocus?: () => void;
}) {
  // The space before the faint words stays between the words, not at the isolated edge.
  const lead = /^\s*/.exec(pending)?.[0] ?? "";
  const colors = speakerColors(number);
  const fold = useFold(foldable, turn.text);
  const editable = (onEdit || onLiveEdit) && turn.text;
  return (
    // Full width, so the bubble's 80% is of the list, not of its own text.
    <div className="flex w-full flex-col items-end gap-1" data-speaker={number}>
      {/* T3's GuestMessageName, in the speaker's color. */}
      <p className={cn("me-1 select-none text-2xs", colors.name)}>{speakerName(number)}</p>
      <div
        dir={textDirection(turn.text + pending)}
        data-no-drag
        className={cn(
          "min-w-0 max-w-[80%] rounded-2xl p-3 text-message-foreground text-sm leading-relaxed",
          colors.surface,
          editable && "cursor-text",
        )}
        onClick={editable ? editOnClick : undefined}
      >
        <p
          ref={fold.textRef}
          data-turn-text
          data-selectable
          className={cn("whitespace-pre-wrap wrap-break-word", fold.textClassName)}
          style={fold.textStyle}
        >
          {editable ? (
            <EditableText
              text={turn.text}
              onCommit={onEdit}
              onInput={onLiveEdit}
              onFocus={() => {
                fold.onFocus(); // edited whole
                onFocus?.();
              }}
              onBlur={fold.onBlur}
            />
          ) : (
            turn.text
          )}
          {lead}
          <bdi className="text-muted-foreground/70">{pending.slice(lead.length)}</bdi>
        </p>
      </div>
    </div>
  );
}
