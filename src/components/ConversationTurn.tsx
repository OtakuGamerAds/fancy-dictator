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
}: {
  turn: Turn;
  /** The speaker's number (1 for whoever spoke first). */
  number: number;
  pending?: string;
  clamp?: boolean;
}) {
  // The space before the faint words stays between the words, not at the isolated edge.
  const lead = /^\s*/.exec(pending)?.[0] ?? "";
  const colors = speakerColors(number);
  return (
    <div className="flex flex-col items-end gap-1" data-speaker={number}>
      {/* T3's GuestMessageName, in the speaker's color. */}
      <p className={cn("me-1 select-none text-2xs", colors.name)}>{speakerName(number)}</p>
      <div
        dir={textDirection(turn.text + pending)}
        className={cn("min-w-0 max-w-[80%] rounded-2xl p-3 text-message-foreground text-sm leading-relaxed", colors.surface)}
      >
        <p data-turn-text data-selectable className={cn("whitespace-pre-wrap wrap-break-word", clamp && "line-clamp-3")}>
          {turn.text}
          {lead}
          <bdi className="text-muted-foreground/70">{pending.slice(lead.length)}</bdi>
        </p>
      </div>
    </div>
  );
}
