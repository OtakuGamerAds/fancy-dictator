import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, CopyIcon, Trash2Icon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  ConversationTurn,
  FOLDED_TEXT_CLASS_NAME,
  FOLDED_TEXT_FADE,
  ShowMoreButton,
  speakerColors,
} from "~/components/ConversationTurn";
import { EditableText } from "~/components/editableText";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { formatConversation, speakerName, speakerNumbers, speakerText, type Turn } from "~/lib/dialogue";
import { InlineAudioPreview } from "~/components/files/InlineAudioPreview";
import { QuietSelect } from "~/components/QuietSelect";
import { Button } from "~/components/ui/button";
import { UndoNotice } from "~/components/UndoNotice";
import { useUndoNotice } from "~/lib/undoNotice";
import type { HistoryEntry } from "~/lib/types";
import { cn, formatAgo, formatDuration, formatWhen, textDirection } from "~/lib/utils";

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

/**
 * The sessions below the text box, one at a time: the latest, until another is picked with the
 * arrows or from the list between them (each named by when it was recorded).
 */
export function HistoryPanel({ history, showUndo, onCopy, onEdit, onDelete, onClear }: HistoryPanelProps) {
  // The notice and its separator only while there is something to undo.
  const undoActive = useUndoNotice() !== null;
  const [selectedId, setSelectedId] = useState<string | null>(history[0]?.id ?? null);
  // Where it was in the list, for when it is deleted: the next one down takes its place.
  const lastIndex = useRef(0);
  const found = history.findIndex((entry) => entry.id === selectedId);
  const index = found >= 0 ? found : Math.min(lastIndex.current, history.length - 1);
  lastIndex.current = Math.max(0, index);
  const entry = history[index];
  const go = (to: number) => setSelectedId(history[to]?.id ?? null);
  return (
    // No side padding of its own: the list's px-2 lines the bubbles up with the text box above.
    <div className="pt-1 pb-2">
      {!entry ? (
        <p className="px-4 py-6 text-center text-muted-foreground text-xs">Your transcriptions will show up here.</p>
      ) : (
        <>
          <ul className="flex max-h-[340px] flex-col gap-3 overflow-y-auto px-2 py-2">
            <HistoryMessage key={entry.id} entry={entry} onCopy={onCopy} onEdit={onEdit} onDelete={onDelete} />
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
            {/* Older on the left, newer on the right; the session itself picked in between. */}
            <Button
              variant="ghost-muted"
              size="icon-xs"
              aria-label="Older session"
              title="Older session"
              disabled={index >= history.length - 1}
              onClick={() => go(index + 1)}
            >
              <ChevronLeftIcon />
            </Button>
            <QuietSelect
              value={entry.id}
              items={history.map((session) => ({ value: session.id, label: formatWhen(session.createdAt) }))}
              label={formatWhen(entry.createdAt)}
              title="Pick a session"
              ariaLabel="Session"
              side="top"
              align="center"
              onChange={setSelectedId}
            />
            <Button
              variant="ghost-muted"
              size="icon-xs"
              aria-label="Newer session"
              title="Newer session"
              disabled={index <= 0}
              onClick={() => go(index - 1)}
            >
              <ChevronRightIcon />
            </Button>
            <span className="text-muted-foreground/60 text-xs">·</span>
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
  const turns = entry.turns?.length ? entry.turns : null;
  const numbers = turns && speakerNumbers(turns);
  const copyText = (text: string) => void onCopy(text).then(() => setCopied(true));
  // A turn edited: the written-out conversation (what Copy takes) follows the turns.
  const editTurn = (index: number, text: string) => {
    if (!turns) return;
    const next: Turn[] = turns.map((turn, i) => (i === index ? { ...turn, text } : turn));
    onEdit({ ...entry, turns: next, text: formatConversation(next) });
  };

  // A single message folds to 3 lines (a conversation's turns fold each on its own).
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
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
    <ShowMoreButton expanded={expanded} onToggle={() => setExpanded((v) => !v)} />
  );

  return (
    <li className="group flex flex-col items-end">
      {turns ? (
        // A conversation: its recording on its own (as T3 shows an audio-only message), then each
        // turn as T3 shows a thread with a guest, each folded to 3 lines with its own "Show more".
        <div className="flex w-full flex-col items-end gap-3">
          {audio && (
            <div
              dir={textDirection(turns.map((turn) => turn.text).join(" "))}
              className={cn("max-w-[80%] text-sm leading-relaxed", BUBBLE_CHIP_CLASS_NAME)}
            >
              {audio}
            </div>
          )}
          {turns.map((turn, index) => (
            <ConversationTurn
              key={index}
              turn={turn}
              number={numbers?.get(turn.speaker) ?? 1}
              foldable
              onEdit={(text) => editTurn(index, text)}
            />
          ))}
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
            ref={textRef}
            data-selectable
            className={cn("whitespace-pre-wrap wrap-break-word", !expanded && FOLDED_TEXT_CLASS_NAME)}
            style={overflows && !expanded ? FOLDED_TEXT_FADE : undefined}
          >
            <EditableText
              text={entry.text}
              onCommit={(text) => onEdit({ ...entry, text })}
              onFocus={() => setExpanded(true)}
            />
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
