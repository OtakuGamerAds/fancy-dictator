import { guestBubbleClassName } from "~/components/guestMessageStyle";
import { speakerName, type Turn } from "~/lib/dialogue";
import { cn, textDirection } from "~/lib/utils";

/**
 * Each speaker's bubble: the first in your message bubble, the second in T3's guest bubble,
 * the others in the guest bubble's other hues (then round again).
 */
const SPEAKER_SURFACES = [guestBubbleClassName(false), "bg-speaker-3-surface", "bg-speaker-4-surface", "bg-speaker-5-surface"];
export function speakerSurface(number: number): string {
  return number <= 1 ? "bg-message" : SPEAKER_SURFACES[(number - 2) % SPEAKER_SURFACES.length]!;
}

/** The speaker's hue, for a legend swatch (T3's telemetry legend: bg-info/70). */
const SPEAKER_HUES = ["bg-guest/70", "bg-speaker-3/70", "bg-speaker-4/70", "bg-speaker-5/70"];
export function speakerHue(number: number): string {
  return number <= 1 ? "bg-muted-foreground/70" : SPEAKER_HUES[(number - 2) % SPEAKER_HUES.length]!;
}

/**
 * One turn of a conversation, drawn as T3 Code draws a thread with a guest
 * (TimelineUserMessageRow): each speaker in a bubble of their own color; the color alone tells
 * them apart. Words still being recognized are faint at its end, as in the text box.
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
  return (
    <div className="flex flex-col items-end gap-1" data-speaker={number}>
      {/* Who said it, for screen readers (T3's MessageAuthorHeading); the bubble's color shows it. */}
      <h3 className="sr-only select-none">{speakerName(number)}</h3>
      <div
        dir={textDirection(turn.text + pending)}
        className={cn(
          "min-w-0 max-w-[80%] rounded-2xl p-3 text-message-foreground text-sm leading-relaxed",
          speakerSurface(number),
        )}
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
