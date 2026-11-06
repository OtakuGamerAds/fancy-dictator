import { CheckIcon, CopyIcon, Trash2Icon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { ConversationTurn, speakerColors } from "~/components/ConversationTurn";
import { EDITABLE_TEXT_CLASS_NAME, editableText } from "~/components/editableText";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { formatConversation, speakerName, speakerNumbers, speakerText, type Turn } from "~/lib/dialogue";
import { InlineAudioPreview } from "~/components/files/InlineAudioPreview";
import { Button } from "~/components/ui/button";
import { UndoNotice } from "~/components/UndoNotice";
import { useUndoNotice } from "~/lib/undoNotice";
import type { HistoryEntry } from "~/lib/types";
import { cn, formatAgo, formatDuration, textDirection } from "~/lib/utils";

interface HistoryPanelProps {
  history: HistoryEntry[];
  /** Show "Deleted, Ctrl+Z to undo" here (when the box has text, so it cannot show there). */
  showUndo: boolean;
  onCopy(text: string): Promise<void>;
  /** A message's words were edited in its bubble. */
  onEdit(entry: HistoryEntry): void;
  onDelete(id: string): void;
  onClear(): void;
}

/** The list shows the latest session; each "Show more" adds this many older ones. */
const PAGE = 3;
/** A folded conversation shows its first few turns, three lines each. */
const FOLDED_TURNS = 3;

/**
 * Recent transcriptions under the composer, drawn like your own messages in T3 Code's
 * timeline (TimelineUserMessageRow): end-aligned bg-message bubbles, actions on hover.
 */
export function HistoryPanel({ history, showUndo, onCopy, onEdit, onDelete, onClear }: HistoryPanelProps) {
  const [extra, setExtra] = useState(0);
  // The notice and its separator only while there is something to undo.
  const undoActive = useUndoNotice() !== null;
  // One session at a time: the latest, until older ones are asked for.
  const base = history.slice(0, 1);
  const rest = history.filter((e) => !base.includes(e));
  const shown = new Set([...base, ...rest.slice(0, extra)]);
  const visible = history.filter((e) => shown.has(e)); // newest first, as stored
  const remaining = history.length - visible.length;
  return (
    // No side padding of its own: the list's px-2 lines the bubbles up with the text box above.
    <div className="pt-1 pb-2">
      {history.length === 0 ? (
        <p className="px-4 py-6 text-center text-muted-foreground text-xs">Your transcriptions will show up here.</p>
      ) : (
        <>
          <ul className="flex max-h-[340px] flex-col gap-3 overflow-y-auto px-2 py-2">
            {visible.map((entry) => (
              <HistoryMessage key={entry.id} entry={entry} onCopy={onCopy} onEdit={onEdit} onDelete={onDelete} />
            ))}
          </ul>
          <div className="flex items-center justify-center gap-1 pt-1">
            {/* A size container needs a definite width, or it collapses to nothing. */}
            {showUndo && undoActive && (
              <>
                {/* Packed to the right (row-reverse + justify-start), next to the separator. */}
                <UndoNotice className="w-48 justify-start" />
                <span className="text-muted-foreground/60 text-xs">·</span>
              </>
            )}
            {remaining > 0 && (
              <>
                <Button variant="ghost-muted" size="xs" onClick={() => setExtra((n) => n + PAGE)}>
                  Show {Math.min(PAGE, remaining)} more
                </Button>
                <span className="text-muted-foreground/60 text-xs">·</span>
              </>
            )}
            <Button variant="ghost-muted" size="xs" onClick={onClear}>
              Clear all
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** T3 Code's TimelineUserMessageRow: chips inside a user message take the message's ink when it sets one. */
const BUBBLE_CHIP_CLASS_NAME =
  "[&_[data-slot=context-chip]]:[--context-chip-ink:var(--context-chip-message,var(--context-chip-accent))]";

const SOURCE_NAME = { mic: "Microphone", computer: "Computer audio" } as const;

/**
 * "Recording", or "Recording 2" when "Keep dictating" added more. A conversation keeps each
 * side apart: "Microphone", "Computer audio" (numbered the same way).
 */
function clipName(entry: HistoryEntry, clip: number): string {
  const parts = entry.audioParts ?? [];
  const part = parts[clip];
  const recordings = new Set(parts.map((p) => p.recording)).size || (entry.audioClips ?? 0);
  const recording = part?.recording ?? clip + 1;
  const number = recordings > 1 ? ` ${recording}` : "";
  const sources = new Set(parts.map((p) => p.source).filter(Boolean));
  return part?.source && sources.size > 1 ? `${SOURCE_NAME[part.source]}${number}` : `Recording${number}`;
}

function HistoryMessage({
  entry,
  onCopy,
  onEdit,
  onDelete,
}: {
  entry: HistoryEntry;
  onCopy(text: string): Promise<void>;
  onEdit(entry: HistoryEntry): void;
  onDelete(id: string): void;
}) {
  const [copied, setCopied] = useState(false);
  // Long messages show 3 lines and a "Show more" link, like a post on social media.
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);
  const turnsRef = useRef<HTMLDivElement>(null);
  const turns = entry.turns?.length ? entry.turns : null;
  const numbers = turns && speakerNumbers(turns);
  const copyText = (text: string) => void onCopy(text).then(() => setCopied(true));
  // A turn edited: the written-out conversation (what Copy takes) follows the turns.
  const editTurn = (index: number, text: string) => {
    if (!turns) return;
    const next: Turn[] = turns.map((turn, i) => (i === index ? { ...turn, text } : turn));
    onEdit({ ...entry, turns: next, text: formatConversation(next) });
  };

  useLayoutEffect(() => {
    const el = textRef.current ?? turnsRef.current;
    if (!el) return;
    const clamped = (node: HTMLElement) => node.scrollHeight > node.clientHeight + 1;
    const measure = () =>
      setOverflows(
        turns
          ? turns.length > FOLDED_TURNS || [...el.querySelectorAll<HTMLElement>("[data-turn-text]")].some(clamped)
          : clamped(el),
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [entry.text, expanded]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  // The voice it was dictated with, one clip per recording, above the text, as T3 lists the
  // audio sent with a message.
  const audio = entry.audioClips ? (
    <div className="flex max-w-full flex-col gap-1">
      {Array.from({ length: entry.audioClips }, (_, clip) => (
        <InlineAudioPreview
          key={clip}
          name={clipName(entry, clip)}
          audioId={entry.id}
          clip={clip}
          variant="chip"
        />
      ))}
    </div>
  ) : null;
  const showMore = (overflows || expanded) && (
    <button
      type="button"
      className="mt-1 cursor-pointer font-medium text-muted-foreground text-xs hover:text-foreground hover:underline"
      onClick={() => setExpanded((v) => !v)}
    >
      {expanded ? "Show less" : "Show more"}
    </button>
  );

  return (
    <li className="group flex flex-col items-end">
      {turns ? (
        // A conversation: its recording on its own (as T3 shows an audio-only message), then each
        // turn as T3 shows a thread with a guest. Folded, the first few turns, 3 lines each.
        <div ref={turnsRef} className="flex w-full flex-col items-end gap-3">
          {audio && (
            <div
              dir={textDirection(turns.map((turn) => turn.text).join(" "))}
              className={cn("max-w-[80%] text-sm leading-relaxed", BUBBLE_CHIP_CLASS_NAME)}
            >
              {audio}
            </div>
          )}
          {(expanded ? turns : turns.slice(0, FOLDED_TURNS)).map((turn, index) => (
            <ConversationTurn
              key={index}
              turn={turn}
              number={numbers?.get(turn.speaker) ?? 1}
              clamp={!expanded}
              onEdit={(text) => editTurn(index, text)}
              onFocus={() => setExpanded(true)}
            />
          ))}
          {showMore && <div className="-mt-2 pe-1">{showMore}</div>}
        </div>
      ) : (
        <div
          dir={textDirection(entry.text)}
          data-no-drag
          className={cn(
            "min-w-0 max-w-[80%] rounded-2xl bg-message p-3 text-message-foreground text-sm leading-relaxed",
            BUBBLE_CHIP_CLASS_NAME,
          )}
        >
          {audio && <div className="mb-2">{audio}</div>}
          {/* The clamp is on the text itself, not the padded bubble, so no half line peeks out. */}
          <p
            key={entry.text}
            ref={textRef}
            data-selectable
            className={cn("whitespace-pre-wrap wrap-break-word", EDITABLE_TEXT_CLASS_NAME, !expanded && "line-clamp-3")}
            {...editableText(entry.text, (text) => onEdit({ ...entry, text }), () => setExpanded(true))}
          >
            {entry.text}
          </p>
          {showMore}
        </div>
      )}
      <div className="mt-1 flex h-6 items-center gap-0.5 pe-1 text-muted-foreground text-xs">
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 has-focus-visible:opacity-100 has-data-popup-open:opacity-100">
          {turns && numbers ? (
            // A conversation: all of it, or one speaker's words (T3's menu).
            <Menu>
              <MenuTrigger render={<Button variant="ghost-muted" size="icon-xs" aria-label="Copy" title="Copy" />}>
                {copied ? <CheckIcon className="text-success-foreground" /> : <CopyIcon />}
              </MenuTrigger>
              <MenuPopup align="end">
                <MenuItem onClick={() => copyText(entry.text)}>
                  <span aria-hidden className="w-3 shrink-0" />
                  Copy conversation
                </MenuItem>
                {[...numbers.values()].map((number) => (
                  <MenuItem key={number} onClick={() => copyText(speakerText(turns, number))}>
                    {/* The speaker's bubble color, as a legend swatch (T3's telemetry legend). */}
                    <span aria-hidden className={cn("h-1.5 w-3 shrink-0 rounded-full", speakerColors(number).hue)} />
                    Copy {speakerName(number)} only
                  </MenuItem>
                ))}
              </MenuPopup>
            </Menu>
          ) : (
            <Button variant="ghost-muted" size="icon-xs" aria-label="Copy" title="Copy" onClick={() => copyText(entry.text)}>
              {copied ? <CheckIcon className="text-success-foreground" /> : <CopyIcon />}
            </Button>
          )}
          <Button
            variant="ghost-destructive"
            size="icon-xs"
            aria-label="Delete"
            title="Delete"
            onClick={() => onDelete(entry.id)}
          >
            <Trash2Icon />
          </Button>
        </div>
        <span className="ps-1 tabular-nums">
          {formatAgo(entry.createdAt)} · {formatDuration(entry.durationMs)}
        </span>
      </div>
    </li>
  );
}
