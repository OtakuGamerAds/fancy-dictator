import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  CopyIcon,
  LanguagesIcon,
  LoaderCircleIcon,
  Trash2Icon,
} from "lucide-react";
import { type ComponentProps, Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  ConversationTurn,
  editOnClick,
  FoldReport,
  useFold,
  speakerColors,
} from "~/components/ConversationTurn";
import { AnimatedDots } from "~/components/Composer";
import { EditableText } from "~/components/editableText";
import { ScrollToEndButton, useFollowEnd } from "~/components/FollowEnd";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { type DialogueBlock, formatConversation, speakerName, speakerNumbers, speakerText, type Turn } from "~/lib/dialogue";
import { InlineAudioPreview } from "~/components/files/InlineAudioPreview";
import { QuietSelect } from "~/components/QuietSelect";
import { Button } from "~/components/ui/button";
import { UndoNotice } from "~/components/UndoNotice";
import { useUndoNotice } from "~/lib/undoNotice";
import { type HistoryEntry, LANGUAGES } from "~/lib/types";
import { cn, formatWhen, textDirection } from "~/lib/utils";

/**
 * The session being recorded, shown where it is saved: what is said goes straight in, words
 * still being recognized faint at the end, and it can be read, edited, copied and translated
 * meanwhile.
 */
export interface LiveSession {
  /** The session (one continued keeps its id, date and recordings); `text` is what it says now. */
  entry: HistoryEntry;
  /** A conversation's turns, the words still being recognized in each (null: plain text). */
  blocks: DialogueBlock[] | null;
  /** Plain text: the words still being recognized, as they will join the text. */
  pending: string;
  /** "Connecting" or "Listening", shown while nothing has been said yet. */
  status: string;
  /** Replay's earlier part is being transcribed, ahead of this live recording. */
  pastPending: boolean;
  onTextInput(text: string): void;
  onTurnInput(id: string, text: string): void;
  /** A turn's live translation edited while recording. */
  onTranslationInput(id: string, text: string): void;
}

interface HistoryPanelProps {
  history: HistoryEntry[];
  /** The session shown; null: the latest. */
  selectedId: string | null;
  /** A new session, nothing recorded in it yet: the next recording starts it. */
  blank: boolean;
  /** Being recorded: shown instead, and the other sessions wait until it ends. */
  live: LiveSession | null;
  onSelect(id: string): void;
  /** Show "Deleted, Ctrl+Z to undo" here. */
  showUndo: boolean;
  /** The language selected words are translated into. */
  translateTo: string;
  onTranslateToChange(code: string): void;
  onCopy(text: string): Promise<void>;
  /** A message's words were edited in its bubble. */
  onEdit(entry: HistoryEntry): void;
  onDelete(id: string): void;
  onClear(): void;
}

/**
 * The sessions under the box, one at a time: the latest, until another is picked with the
 * arrows or from the list between them (each named by when it was recorded). Recording goes
 * into the one shown (the toolbar's new-session button starts a new one); it fills in as you speak.
 */
export function HistoryPanel({
  history,
  selectedId,
  blank,
  live,
  onSelect,
  showUndo,
  translateTo,
  onTranslateToChange,
  onCopy,
  onEdit,
  onDelete,
  onClear,
}: HistoryPanelProps) {
  // The notice and its separator only while there is something to undo.
  const undoActive = useUndoNotice() !== null;
  const found = history.findIndex((entry) => entry.id === selectedId);
  // Being recorded, or a new one: not in the list (yet), so "older" is the latest.
  const index = live || blank ? -1 : Math.max(0, found);
  const entry = live ? live.entry : history[index];
  const go = (to: number) => {
    const next = history[to];
    if (next) onSelect(next.id);
  };
  const listRef = useRef<HTMLUListElement>(null);
  const selection = useListSelection(listRef, entry?.id);
  // While recording, the bubble pressed to select words in (and then while they are selected)
  // holds still: its words keep changing, faint ones several times a second, and every change
  // would undo the selection. It catches up once nothing in it is selected.
  const [pressed, setPressed] = useState<number | null>(null);
  useEffect(() => {
    if (pressed === null) return;
    // A moment after letting go, so the selection it made is known by then (and holds instead).
    let timer = 0;
    const release = () => (timer = window.setTimeout(() => setPressed(null), 100));
    document.addEventListener("pointerup", release);
    return () => {
      document.removeEventListener("pointerup", release);
      clearTimeout(timer);
    };
  }, [pressed]);
  // Words being edited (a bubble clicked into): it takes the words still coming as they come,
  // added after what is there, and the list stays where it is under the caret.
  const [editing, setEditing] = useState(false);
  const held = live && !editing ? (pressed ?? selection?.turn ?? null) : null;
  // Every bubble of the session unfolded at once ("Show all"), offered while one is folded.
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setExpanded(false), [entry?.id]);
  const cuts = useRef(new Set<string>());
  const [anyCut, setAnyCut] = useState(false);
  const reportCut = useCallback((id: string, cut: boolean) => {
    if (cut) cuts.current.add(id);
    else cuts.current.delete(id);
    setAnyCut(cuts.current.size > 0);
  }, []);
  const [translation, setTranslation] = useState<Translation | null>(null);
  const [translating, setTranslating] = useState(false);
  const translate = async () => {
    if (!selection || !entry) return;
    setTranslating(true);
    const result = await window.api.translate(selection.text, translateTo);
    setTranslating(false);
    setTranslation({ entryId: entry.id, turn: selection.turn, to: translateTo, ...result });
  };

  // While recording, the newest words stay in view, unless scrolled up to read (T3's follow).
  const scroll = useFollowEnd(listRef, live?.entry.id ?? null);
  useLayoutEffect(() => {
    const list = listRef.current;
    // Not while words are being selected: the list would move under the pointer.
    if (list && live && held === null && !editing && scroll.following.current) list.scrollTop = list.scrollHeight;
  }, [live, live?.entry.text, live?.pending, live?.blocks, held, editing, scroll.following]);

  if (!entry && !blank) {
    return <p className="px-4 pt-1 pb-6 text-center text-muted-foreground text-xs">Your transcriptions will show up here.</p>;
  }
  const isNew = live ? !history.some((saved) => saved.id === live.entry.id) : blank;
  return (
    // No side padding of its own: the list's px-2 lines the bubbles up with the box above.
    <div className="pt-1 pb-2">
      <div className="relative">
        <ul
          ref={listRef}
          className="flex max-h-[340px] flex-col gap-3 overflow-y-auto px-2 py-2"
          onScroll={scroll.onScroll}
          onFocus={(event) => setEditing((event.target as HTMLElement).isContentEditable)}
          onBlur={() => setEditing(false)}
          onPointerDown={(event) => {
            if (!live || event.button !== 0) return;
            const turn = (event.target as Element).closest("[data-turn-index]");
            setPressed(turn ? Number(turn.getAttribute("data-turn-index")) : -1);
          }}
        >
          {entry ? (
            <FoldReport.Provider value={reportCut}>
              <HistoryMessage
                key={entry.id}
                entry={entry}
                live={live}
                held={held}
                expanded={expanded}
                translation={translation?.entryId === entry.id ? translation : null}
                onEdit={onEdit}
                onCopy={onCopy}
              />
            </FoldReport.Provider>
          ) : (
            <li className="py-4 text-center text-muted-foreground text-xs">A new session: click to talk, above.</li>
          )}
        </ul>
        {live && scroll.awayFromEnd && <ScrollToEndButton onScrollToEnd={scroll.scrollToEnd} />}
      </div>
      {/* Three columns: on the left, translating the selected words (or the undo notice when
          there is one), the sessions centered, the shown session's actions on the right. */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1 px-2 pt-1">
        {/* A size container needs a definite width, or it collapses to nothing. */}
        <span className="flex min-w-0 justify-start">
          {selection ? (
            <span className="flex min-w-0 items-center">
              <QuietSelect
                value={translateTo}
                items={TRANSLATE_CHOICES}
                label={translateTo.toUpperCase()}
                title={`Translate into ${languageName(translateTo)}`}
                ariaLabel="Translate into"
                side="top"
                align="start"
                onChange={onTranslateToChange}
              />
              {/* Only the icon: with the sessions centered, the left of the bar is narrow. */}
              <Button
                variant="ghost-muted"
                size="icon-xs"
                aria-label="Translate"
                title={`Translate the selected words into ${languageName(translateTo)}`}
                disabled={translating}
                // The selected words stay selected.
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => void translate()}
              >
                {translating ? <LoaderCircleIcon className="animate-spin" /> : <LanguagesIcon />}
              </Button>
            </span>
          ) : (
            showUndo && undoActive && <UndoNotice className="w-32 justify-start" />
          )}
        </span>
        {/* Older on the left, newer on the right; the session itself picked in between. While one
            is being recorded, it stays. */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost-muted"
            size="icon-xs"
            aria-label="Older session"
            title="Older session"
            disabled={!!live || index + 1 >= history.length}
            onClick={() => go(index + 1)}
          >
            <ChevronLeftIcon />
          </Button>
          <QuietSelect
            value={entry?.id ?? ""}
            items={history.map((session) => ({ value: session.id, label: formatWhen(session.createdAt) }))}
            label={isNew ? "New session" : formatWhen(entry!.createdAt)}
            title="Pick a session"
            ariaLabel="Session"
            side="top"
            align="center"
            disabled={!!live}
            onChange={onSelect}
            footer={
              // Every session at once: rare and not to be hit by mistake, so not on the bar.
              <button
                type="button"
                className="flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-destructive-foreground text-base outline-none hover:bg-accent sm:min-h-7 sm:text-sm"
                onClick={onClear}
              >
                <Trash2Icon className="size-4" />
                Clear all sessions
              </button>
            }
          />
          <Button
            variant="ghost-muted"
            size="icon-xs"
            aria-label="Newer session"
            title="Newer session"
            disabled={!!live || index <= 0}
            onClick={() => go(index - 1)}
          >
            <ChevronRightIcon />
          </Button>
        </div>
        <span className="flex items-center justify-end gap-0.5">
          {entry && (anyCut || expanded) && (
            // T3's expand / collapse all (ChangedFilesTree).
            <Button
              variant="ghost-muted"
              size="icon-xs"
              aria-label={expanded ? "Fold all" : "Show all"}
              title={expanded ? "Fold all" : "Show all"}
              aria-pressed={expanded}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? <ChevronsDownUpIcon /> : <ChevronsUpDownIcon />}
            </Button>
          )}
          {entry && <SessionActions entry={entry} recording={!!live} onCopy={onCopy} onDelete={onDelete} />}
        </span>
      </div>
    </div>
  );
}

/** T3 Code's TimelineUserMessageRow: chips inside a user message take the message's ink when it sets one. */
const BUBBLE_CHIP_CLASS_NAME =
  "[&_[data-slot=context-chip]]:[--context-chip-ink:var(--context-chip-message,var(--context-chip-accent))]";

const SOURCE_NAME = { mic: "Microphone", computer: "Computer audio" } as const;

/**
 * "Recording", or "Recording 2" when the session was continued. A conversation keeps each
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
  live,
  held,
  expanded,
  translation,
  onEdit,
  onCopy,
}: {
  entry: HistoryEntry;
  /** Being recorded: words come in, and edits follow every keystroke. */
  live: LiveSession | null;
  /** The turn (-1: the single bubble) holding still while words are selected in it. */
  held: number | null;
  /** "Show all": nothing folded. */
  expanded: boolean;
  /** Words selected in it, translated: shown under the bubble they were selected in. */
  translation: Translation | null;
  onEdit(entry: HistoryEntry): void;
  onCopy(text: string): Promise<void>;
}) {
  const savedTurns = entry.turns?.length ? entry.turns : null;
  // Being recorded, a conversation's turns carry the words still being recognized.
  const blocks: DialogueBlock[] | null = live
    ? live.blocks
    : savedTurns && savedTurns.map((turn, index) => ({ ...turn, id: String(index), pending: "" }));
  const turns = blocks?.length ? blocks : null;
  const numbers = turns && speakerNumbers(turns);
  // One voice (a dictation talked into again, a bubble per recording): no names above them.
  const named = !!numbers && numbers.size > 1;
  // A saved turn edited: the written-out conversation (what Copy takes) follows the turns.
  const editTurn = (index: number, change: Partial<Turn>) => {
    if (!savedTurns) return;
    const next: Turn[] = savedTurns.map((turn, i) => (i === index ? { ...turn, ...change } : turn));
    onEdit({ ...entry, turns: next, text: formatConversation(next) });
  };

  // A single message folds to 3 lines (a session's bubbles fold each on their own; while it is
  // being recorded, all but the one being said).
  const fold = useFold(!turns && !live && !expanded, entry.text);
  const text = useHeld(entry.text, held === -1);
  const pending = useHeld(live && !turns ? live.pending : "", held === -1);
  const lead = /^\s*/.exec(pending)?.[0] ?? "";

  // The voice it was dictated with, one clip per recording (and source). Each recording whose
  // bubbles are known is marked where it began; the others are above the text, as T3 lists
  // the audio sent with a message.
  const parts = entry.audioParts ?? [];
  const placed = new Set(turns?.flatMap((turn) => (turn.recording ? [turn.recording] : [])));
  const clips = Array.from({ length: entry.audioClips ?? 0 }, (_, clip) => clip);
  const chips = (list: number[]) => (
    <div className="flex max-w-full flex-col gap-1">
      {list.map((clip) => (
        <InlineAudioPreview key={clip} name={clipName(entry, clip)} audioId={entry.id} clip={clip} variant="chip" />
      ))}
    </div>
  );
  const unplaced = clips.filter((clip) => !placed.has(parts[clip]?.recording ?? 0));
  const audio = unplaced.length ? chips(unplaced) : null;
  /** Where a recording began: its clips, on a line across the session. */
  const marker = (recording: number) => {
    const own = clips.filter((clip) => parts[clip]?.recording === recording);
    return own.length ? (
      <div className="flex w-full select-none items-center gap-2" data-recording-marker={recording}>
        <span className="h-px flex-1 bg-border" />
        {chips(own)}
      </div>
    ) : null;
  };

  // Nothing said yet: "Listening…", where the words will appear.
  const waiting =
    live && !entry.text.trim() && !pending.trim() && !turns ? (
      <p className="py-1 text-center text-placeholder text-sm">
        {live.status}
        <AnimatedDots />
      </p>
    ) : null;

  return (
    <li className="flex flex-col items-end">
      {live?.pastPending && (
        <p className="w-full pb-2 text-center text-placeholder text-sm">
          Transcribing the earlier part
          <AnimatedDots />
        </p>
      )}
      {turns ? (
        // A conversation: its recording on its own (as T3 shows an audio-only message), then each
        // turn as T3 shows a thread with a guest, each folded to 3 lines until clicked into.
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
            <Fragment key={turn.id ?? index}>
              {turn.recording !== undefined && turn.recording !== turns[index - 1]?.recording && marker(turn.recording)}
              {/* Which turn words are selected in (it lays out as if it were not there). */}
              <div data-turn-index={index} className="contents">
                <HeldTurn
                  held={held === index}
                  turn={turn}
                  number={numbers?.get(turn.speaker) ?? 1}
                  named={named}
                  pending={turn.pending}
                  // Folded, but not the one being said (the newest words would be cut off).
                  foldable={!expanded && !(live && (index === turns.length - 1 || turn.pending.trim()))}
                  onEdit={live ? undefined : (text) => editTurn(index, { text })}
                  onTranslationEdit={live ? undefined : (translation) => editTurn(index, { translation })}
                  onTranslationLiveEdit={
                    live && !turn.id.startsWith("pending:") ? (text) => live.onTranslationInput(turn.id, text) : undefined
                  }
                  // Its settled words can be edited while recording, as plain dictation can.
                  onLiveEdit={live && !turn.id.startsWith("pending:") ? (text) => live.onTurnInput(turn.id, text) : undefined}
                />
              </div>
              {translation?.turn === index && <TranslationBox translation={translation} onCopy={onCopy} />}
            </Fragment>
          ))}
        </div>
      ) : (
        (audio || !waiting) && (
          <div
            dir={textDirection(text + pending)}
            data-no-drag
            className={cn(
              "min-w-0 max-w-[80%] cursor-text rounded-2xl bg-message p-3 text-message-foreground text-sm leading-relaxed",
              BUBBLE_CHIP_CLASS_NAME,
            )}
            onClick={editOnClick}
          >
            {audio && <div className={cn((text || pending) && "mb-2")}>{audio}</div>}
            {/* The clamp is on the text itself, not the padded bubble, so no half line peeks out. */}
            {(text || pending || !live) && (
              <p
                ref={fold.textRef}
                data-selectable
                className={cn("whitespace-pre-wrap wrap-break-word", fold.textClassName)}
                style={fold.textStyle}
              >
                <EditableText
                  text={text}
                  onCommit={live ? undefined : (words) => onEdit({ ...entry, text: words })}
                  onInput={live?.onTextInput}
                  onFocus={fold.onFocus}
                  onBlur={fold.onBlur}
                />
                {/* Isolated (<bdi>): mixed Arabic and English words around it keep their order. */}
                {lead}
                {pending && <bdi className="text-muted-foreground/70">{pending.slice(lead.length)}</bdi>}
              </p>
            )}
          </div>
        )
      )}
      {waiting}
      {!turns && translation && (
        <div className="mt-2 flex w-full justify-end">
          <TranslationBox translation={translation} onCopy={onCopy} />
        </div>
      )}
    </li>
  );
}

/**
 * The shown session's actions, on the bar under it: copy (a conversation's offers one speaker
 * only, in T3's menu) and delete.
 */
function SessionActions({
  entry,
  recording,
  onCopy,
  onDelete,
}: {
  entry: HistoryEntry;
  /** Being recorded: it can be copied, not deleted. */
  recording: boolean;
  onCopy(text: string): Promise<void>;
  onDelete(id: string): void;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  const copyText = (text: string) => void onCopy(text).then(() => setCopied(true));
  const turns = entry.turns?.length ? entry.turns : null;
  const numbers = turns && speakerNumbers(turns);
  const icon = copied ? <CheckIcon className="text-success-foreground" /> : <CopyIcon />;
  return (
    <div className="flex items-center gap-0.5">
      {turns && numbers && numbers.size > 1 ? (
        <Menu>
          <MenuTrigger render={<Button variant="ghost-muted" size="icon-xs" aria-label="Copy" title="Copy" />}>
            {icon}
          </MenuTrigger>
          <MenuPopup side="top" align="end">
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
          {icon}
        </Button>
      )}
      <Button
        variant="ghost-destructive"
        size="icon-xs"
        aria-label="Delete"
        title={recording ? "Delete (after the recording)" : "Delete"}
        disabled={recording}
        onClick={() => onDelete(entry.id)}
      >
        <Trash2Icon />
      </Button>
    </div>
  );
}

const languageName = (code: string) => LANGUAGES.find((l) => l.code === code)?.name ?? code.toUpperCase();
const TRANSLATE_CHOICES = LANGUAGES.map((language) => ({ value: language.code, label: language.name }));

/** Words selected in a session, translated (or why they could not be). */
interface Translation {
  entryId: string;
  /** The conversation turn they were selected in; -1 for a single message. */
  turn: number;
  to: string;
  text?: string;
  error?: string;
}

/**
 * The words selected in the session shown, and in which turn; null when none are. A selection
 * moving out of the list (a dropdown opening) leaves what was selected as it was.
 */
function useListSelection(listRef: React.RefObject<HTMLElement | null>, session: string | undefined) {
  const [selection, setSelection] = useState<{ text: string; turn: number } | null>(null);
  // Another session shown: nothing in it is selected.
  useEffect(() => setSelection(null), [session]);
  useEffect(() => {
    const onChange = () => {
      const list = listRef.current;
      const selected = document.getSelection();
      const anchor = selected?.anchorNode ?? null;
      const element = (node: Node | null) => (node instanceof Element ? node : (node?.parentElement ?? null));
      // Gone with the session it was in.
      if (!anchor?.isConnected) return setSelection(null);
      if (!list || !selected || !list.contains(anchor)) return;
      // A translation is not translated again.
      if (element(anchor)?.closest("[data-translation]")) return;
      const text = selected.toString().trim();
      if (selected.isCollapsed || !text) return setSelection(null);
      // Across bubbles: the last of them (its translation goes under it).
      const turnOf = (node: Node | null) => Number(element(node)?.closest("[data-turn-index]")?.getAttribute("data-turn-index") ?? -1);
      setSelection({ text, turn: Math.max(turnOf(anchor), turnOf(selected.focusNode)) });
    };
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, [listRef]);
  return selection;
}

/** Under the bubble the words were selected in: their translation, quieter than a message. */
function TranslationBox({ translation, onCopy }: { translation: Translation; onCopy(text: string): Promise<void> }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  const text = translation.text ?? "";
  return (
    <div
      data-translation
      data-no-drag
      className="flex min-w-0 max-w-[80%] flex-col gap-0.5 rounded-2xl border border-border py-2 ps-3 pe-1.5 text-sm"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="select-none text-2xs text-muted-foreground">Translation · {languageName(translation.to)}</span>
        {text && (
          <Button
            variant="ghost-muted"
            size="icon-xs"
            aria-label="Copy translation"
            title="Copy"
            onClick={() => void onCopy(text).then(() => setCopied(true))}
          >
            {copied ? <CheckIcon className="text-success-foreground" /> : <CopyIcon />}
          </Button>
        )}
      </div>
      {text ? (
        <p dir={textDirection(text)} data-selectable className="whitespace-pre-wrap wrap-break-word pe-1.5 text-foreground leading-relaxed">
          {text}
        </p>
      ) : (
        <p className="pe-1.5 text-destructive-foreground text-xs">{translation.error}</p>
      )}
    </div>
  );
}

/** `value` as it was when `held` became true, until it is false again. */
function useHeld<T>(value: T, held: boolean): T {
  const kept = useRef(value);
  if (!held) kept.current = value;
  return kept.current;
}

/** A turn of the conversation being recorded, holding still while words are selected in it. */
function HeldTurn({ held, ...props }: ComponentProps<typeof ConversationTurn> & { held: boolean }) {
  const turn = useHeld(props.turn, held);
  const pending = useHeld(props.pending, held);
  return <ConversationTurn {...props} turn={turn} pending={pending} />;
}
