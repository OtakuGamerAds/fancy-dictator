import { useLayoutEffect, useRef, useState } from "react";

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
  clamp = false,
  onEdit,
  onLiveEdit,
  onFocus,
}: {
  turn: Turn;
  /** The speaker's number (1 for whoever spoke first). */
  number: number;
  pending?: string;
  clamp?: boolean;
  /** Its words can be edited in place: given when editing finishes (a saved message)… */
  onEdit?: (text: string) => void;
  /** …or with every keystroke (a conversation being recorded). */
  onLiveEdit?: (text: string) => void;
  onFocus?: () => void;
}) {
  // The space before the faint words stays between the words, not at the isolated edge.
  const lead = /^\s*/.exec(pending)?.[0] ?? "";
  const colors = speakerColors(number);
  // Folded and longer than it shows: its last line fades.
  const textRef = useRef<HTMLParagraphElement>(null);
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const element = textRef.current;
    setCut(clamp && !!element && element.scrollHeight > element.clientHeight + 1);
  }, [clamp, turn.text]);
  return (
    // Full width, so the bubble's 80% is of the list, not of its own text.
    <div className="flex w-full flex-col items-end gap-1" data-speaker={number}>
      {/* T3's GuestMessageName, in the speaker's color. */}
      <p className={cn("me-1 select-none text-2xs", colors.name)}>{speakerName(number)}</p>
      <div
        dir={textDirection(turn.text + pending)}
        data-no-drag
        className={cn("min-w-0 max-w-[80%] rounded-2xl p-3 text-message-foreground text-sm leading-relaxed", colors.surface)}
      >
        <p
          ref={textRef}
          data-turn-text
          data-selectable
          className={cn("whitespace-pre-wrap wrap-break-word", clamp && FOLDED_TEXT_CLASS_NAME)}
          style={cut ? FOLDED_TEXT_FADE : undefined}
        >
          {(onEdit || onLiveEdit) && turn.text ? (
            <EditableText text={turn.text} onCommit={onEdit} onInput={onLiveEdit} onFocus={onFocus} />
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
