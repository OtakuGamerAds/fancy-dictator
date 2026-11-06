import { guestBubbleClassName } from "~/components/guestMessageStyle";
import { SPEAKER_LABEL, type Turn } from "~/lib/dialogue";
import { cn, textDirection } from "~/lib/utils";

/**
 * One turn of a conversation, drawn as T3 Code draws a thread with a guest
 * (TimelineUserMessageRow): yours in your message bubble, theirs in the guest's bubble; the
 * color alone tells them apart. Words still being recognized are faint at its end, as in the text box.
 */
export function ConversationTurn({ turn, pending = "", clamp = false }: { turn: Turn; pending?: string; clamp?: boolean }) {
  // The space before the faint words stays between the words, not at the isolated edge.
  const lead = /^\s*/.exec(pending)?.[0] ?? "";
  return (
    <div className="flex flex-col items-end gap-1" data-speaker={turn.speaker}>
      {/* Who said it, for screen readers (T3's MessageAuthorHeading); the bubble's color shows it. */}
      <h3 className="sr-only select-none">{SPEAKER_LABEL[turn.speaker]}</h3>
      <div
        dir={textDirection(turn.text + pending)}
        className={cn(
          "min-w-0 max-w-[80%] rounded-2xl p-3 text-message-foreground text-sm leading-relaxed",
          turn.speaker === "them" ? guestBubbleClassName(false) : "bg-message",
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
