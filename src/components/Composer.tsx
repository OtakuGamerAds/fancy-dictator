import { ChevronDownIcon, CopyIcon, LoaderCircleIcon, MicIcon, MinusIcon, Settings2Icon, SquareIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { LanguagePicker } from "~/components/LanguagePicker";
import { Button } from "~/components/ui/button";
import { UndoNotice } from "~/components/UndoNotice";
import { UpdateButton } from "~/components/UpdateButton";
import { Waveform } from "~/components/Waveform";
import { cn, countWords, formatDuration, joinSpoken, textDirection } from "~/lib/utils";

export type Phase = "idle" | "starting" | "recording" | "stopping";

interface ComposerProps {
  phase: Phase;
  /** The text box's content (editable when not recording). */
  text: string;
  /** While recording: the words Soniox is still deciding on (settled ones are already in `text`). */
  pendingText: string;
  /** Whether `pendingText` carries on from Soniox's last settled piece (so no space is added). */
  pendingContinues: boolean;
  error: string | null;
  elapsedMs: number;
  durationMs: number;
  levels: number[];
  historyOpen: boolean;
  /** How many messages there are; with none, the history arrow is disabled. */
  historyCount: number;
  onTextChange(text: string): void;
  onMic(): void;
  onStop(): void;
  /** Copy the text, keep it in the messages and empty the box (stops a recording first). */
  onCopy(): void;
  languages: string[];
  onLanguagesChange(languages: string[]): void;
  onToggleHistory(): void;
  /** Close the window. */
  onClose(): void;
  onOpenSettings(): void;
}

/**
 * The one view: a toolbar on top (settings and updates at the left, the messages arrow and
 * hide at the right), then the box.
 *
 * Empty, the box itself is the talk button: click anywhere in it to start the mic. With
 * text it is T3's composer (the text across the full width, a row of controls under it),
 * whose main button is Copy: copy, keep it in the messages, start fresh.
 */
export function Composer(props: ComposerProps) {
  const listening = props.phase !== "idle";
  const talkSurface = !listening && !props.text;
  return (
    <div>
      <Toolbar {...props} />
      <div
        data-slot="composer-box"
        dir="ltr"
        className="relative mx-2 mt-2 mb-2 rounded-xl border border-(--composer-outline) bg-card inset-shadow-2xs inset-shadow-(color:--composer-highlight)"
      >
        {talkSurface ? (
          <TalkSurface {...props} />
        ) : (
          <>
            <div className="px-3.5 pt-2.5 pb-1">
              <ComposerText {...props} />
              {props.error && <p className="mt-1 text-error-foreground text-xs">{props.error}</p>}
            </div>
            <div className="flex items-center justify-between gap-2 px-1.5 pb-1.5">
              {listening ? <RecordingRow {...props} /> : <EditRow {...props} />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** T3 Code's labelled primary pill (ComposerPrimaryActions.tsx: messageActionPillClassName). */
const MESSAGE_ACTION_PILL =
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-message-action font-medium text-base text-message-action-foreground shadow-xs shadow-message-action/24 outline-none hover:bg-message-action-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64 disabled:shadow-none sm:text-sm";

/**
 * The empty box is one big talk button. The language picker and the undo notice inside it
 * keep their own clicks (they stop the click from reaching the box).
 */
function TalkSurface({ error, languages, onMic, onLanguagesChange }: ComposerProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      data-no-drag
      aria-label="Click to talk"
      onClick={onMic}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onMic();
        }
      }}
      className="group/talk flex cursor-pointer flex-col rounded-[inherit] outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <div className="flex items-center justify-center gap-2.5 px-3.5 pt-3 pb-1">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground shadow-xs shadow-primary/24 transition-transform group-hover/talk:scale-105">
          <MicIcon className="size-3.5" />
        </span>
        <span className={cn("text-sm", error ? "text-error-foreground" : "text-placeholder group-hover/talk:text-foreground")}>
          {error ? `${error} Click to try again.` : "Click to talk"}
        </span>
      </div>
      <div className="flex min-h-8 items-center justify-between gap-2 px-1.5 pb-1.5">
        <span onClick={(event) => event.stopPropagation()}>
          <LanguagePicker value={languages} onChange={onLanguagesChange} />
        </span>
        {/* "Copied, Ctrl+Z to undo" right after the box was emptied. */}
        <span className="min-w-0 flex-1" onClick={(event) => event.stopPropagation()}>
          <UndoNotice className="w-full justify-start" />
        </span>
      </div>
    </div>
  );
}

/** Under the text: languages, a mic to add more, and Copy, the main action. */
function EditRow({ text, languages, onMic, onCopy, onLanguagesChange }: ComposerProps) {
  return (
    <>
      <LanguagePicker value={languages} onChange={onLanguagesChange} />
      <div className="flex items-center gap-1">
        <Button
          variant="ghost-muted"
          size="icon-sm"
          className="rounded-full before:rounded-full"
          aria-label="Keep dictating"
          title="Keep dictating"
          onClick={onMic}
        >
          <MicIcon />
        </Button>
        <button
          type="button"
          className={cn(MESSAGE_ACTION_PILL, "h-8 px-3 sm:h-7")}
          disabled={!text.trim()}
          title="Copy, keep it in your messages, and start fresh (Ctrl+Enter)"
          onClick={onCopy}
        >
          <CopyIcon className="size-3.5" />
          Copy
        </button>
      </div>
    </>
  );
}

/** While recording: the timer and the wave, and Stop. */
function RecordingRow({ phase, elapsedMs, levels, onStop }: ComposerProps) {
  return (
    <>
      <span className="flex items-center gap-2 ps-2 text-muted-foreground text-xs tabular-nums">
        <span className="size-2 animate-pulse rounded-full bg-red-500" />
        {formatDuration(elapsedMs)}
        <Waveform levels={levels} className="ms-1" />
      </span>
      <Button variant="outline" size="sm" className="h-8 rounded-full px-3 before:rounded-full sm:h-7" disabled={phase === "stopping"} onClick={onStop}>
        {phase === "stopping" ? <LoaderCircleIcon className="animate-spin" /> : <SquareIcon className="size-2.5 fill-current" />}
        Stop
      </Button>
    </>
  );
}

/** Text metrics shared by the textarea and its mirror; they must lay out identically. */
const FIELD_TEXT = "whitespace-pre-wrap wrap-break-word text-sm leading-relaxed";

/**
 * The text, copying T3 Code's composer editor (ComposerPromptEditorTiptap.tsx): 14px, relaxed
 * line height; it grows line by line to 208px (max-h-52), then scrolls, with the scrollbar on
 * the left for Arabic. It stays editable while recording: settled words are appended to
 * `text` as Soniox sends them, and only the still-unsettled (gray) words are out of reach.
 * The textarea sits over a "mirror" div that holds the same text (invisible) followed by the
 * gray words, so those appear right after your text, and the mirror gives the box its size.
 */
function ComposerText({ phase, text, pendingText, pendingContinues, onTextChange }: ComposerProps) {
  const listening = phase !== "idle";
  const scrollRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  // Follow the newest words unless the caret was moved away from the end to edit.
  const followEnd = useRef(true);

  // The gray words go where they will land once settled, joined the same way.
  const pending = joinSpoken(text, pendingText, pendingContinues).slice(text.length);
  const empty = !text && !pending;

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  useLayoutEffect(() => {
    const el = areaRef.current;
    const scroller = scrollRef.current;
    if (!el || !scroller || !followEnd.current) return;
    if (document.activeElement === el) el.setSelectionRange(el.value.length, el.value.length);
    scroller.scrollTop = scroller.scrollHeight;
  }, [text, pending]);

  return (
    <div
      ref={scrollRef}
      data-no-drag
      dir={textDirection(text + pending)}
      className="-m-1 block max-h-52 w-[calc(100%+--spacing(2))] overflow-y-auto p-1"
    >
      <div className="relative">
        <div aria-hidden className={cn(FIELD_TEXT, "min-h-[1lh]", empty && "text-center")}>
          {empty ? (
            listening && (
              <span dir="ltr" className="text-placeholder">
                {phase === "starting" ? "Connecting" : "Listening"}
                <AnimatedDots />
              </span>
            )
          ) : (
            <>
              <span className="invisible">{text}</span>
              <span className="text-muted-foreground/70">{pending}</span>
              {/* Keeps a trailing line break one line tall. */}
              {"​"}
            </>
          )}
        </div>
        <textarea
          ref={areaRef}
          value={text}
          spellCheck={false}
          aria-label="Your text"
          onChange={(event) => onTextChange(event.target.value)}
          onSelect={(event) => {
            const el = event.currentTarget;
            followEnd.current = el.selectionEnd === el.value.length;
          }}
          // The caret only shows once there is text, so it never sits apart from the words.
          className={cn(
            FIELD_TEXT,
            "absolute inset-0 size-full resize-none overflow-hidden bg-transparent text-foreground focus:outline-none",
            !text && "caret-transparent",
          )}
        />
      </div>
    </div>
  );
}

/** ".", "..", "...", repeating. Always three dots wide, so the centered word never shifts. */
function AnimatedDots() {
  const [count, setCount] = useState(1);
  useEffect(() => {
    const timer = setInterval(() => setCount((n) => (n % 3) + 1), 400);
    return () => clearInterval(timer);
  }, []);
  return (
    <span aria-hidden>
      {".".repeat(count)}
      <span className="invisible">{".".repeat(3 - count)}</span>
    </span>
  );
}

/**
 * The toolbar, like a title bar: settings and updates at the left, the messages arrow and hide
 * at the right. It is a size container, so it never makes the card wider; the word count only
 * shows when there is room for it.
 */
function Toolbar(props: ComposerProps) {
  const { phase, text, durationMs, onClose, onOpenSettings } = props;
  const listening = phase !== "idle";
  return (
    <div data-slot="composer-toolbar" className="@container/footer px-2 pt-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-0.5">
          <Button
            variant="ghost-muted"
            size="icon"
            className="rounded-full before:rounded-full"
            aria-label="Settings"
            title={listening ? "Settings (after the recording)" : "Settings"}
            aria-disabled={listening || undefined}
            onClick={() => !listening && onOpenSettings()}
          >
            <Settings2Icon />
          </Button>
          <UpdateButton />
          {!listening && text.trim() && (
            <span className="ms-1.5 hidden text-muted-foreground text-xs tabular-nums @min-[300px]/footer:inline">
              {durationMs > 0 && `${formatDuration(durationMs)} · `}
              {countWords(text)} words
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <HistoryToggle {...props} />
          <HideButton label={listening ? "Hide (keeps what you said)" : "Hide (Esc)"} onClick={onClose} />
        </div>
      </div>
    </div>
  );
}

/** Folds or unfolds the messages under the box. Disabled (T3's not-allowed cursor) when there are none. */
function HistoryToggle({ historyOpen, historyCount, onToggleHistory }: ComposerProps) {
  const noMessages = historyCount === 0 && !historyOpen;
  return (
    // aria-disabled rather than disabled: a disabled button gets no pointer events, so T3's
    // "not allowed" cursor (aria-disabled:cursor-not-allowed) would never show.
    <Button
      variant="ghost-muted"
      size="icon"
      className="rounded-full before:rounded-full"
      aria-label={historyOpen ? "Hide messages" : noMessages ? "No messages yet" : "Show messages"}
      title={noMessages ? "No messages yet" : undefined}
      aria-expanded={historyOpen}
      aria-disabled={noMessages || undefined}
      onClick={() => !noMessages && onToggleHistory()}
    >
      <ChevronDownIcon className={cn("transition-transform duration-200", historyOpen && "rotate-180")} />
    </Button>
  );
}

/** Hides the window (it keeps running in the tray), like a minimize button in the corner. */
function HideButton({ onClick, label }: { onClick(): void; label: string }) {
  return (
    <Button variant="ghost-muted" size="icon" className="rounded-full before:rounded-full" aria-label={label} title={label} onClick={onClick}>
      <MinusIcon />
    </Button>
  );
}
