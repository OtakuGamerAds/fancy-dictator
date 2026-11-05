import {
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  LoaderCircleIcon,
  MinusIcon,
  MicIcon,
  Settings2Icon,
  SquareIcon,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { LanguagePicker } from "~/components/LanguagePicker";
import { Button } from "~/components/ui/button";
import { UndoNotice } from "~/components/UndoNotice";
import { UpdateButton } from "~/components/UpdateButton";
import { useUndoNotice } from "~/lib/undoNotice";
import { Waveform } from "~/components/Waveform";
import { cn, countWords, formatDuration, textDirection } from "~/lib/utils";

/**
 * The text area copies T3 Code's composer editor (ComposerPromptEditorTiptap.tsx):
 * 14px text, relaxed line height; grows line by line to 208px (max-h-52), then scrolls.
 * (T3 starts at 2 lines; here it starts at 1 so the box only grows when the words need it.)
 * dir="auto" puts the scrollbar on the left for Arabic, as T3 does.
 */
const TEXT_AREA =
  "-m-1 block max-h-52 min-h-[calc(1lh+--spacing(2))] w-[calc(100%+--spacing(2))] overflow-y-auto p-1 whitespace-pre-wrap wrap-break-word bg-transparent text-foreground text-sm leading-relaxed placeholder:text-placeholder focus:outline-none";

export type Phase = "idle" | "starting" | "recording" | "stopping";

interface ComposerProps {
  phase: Phase;
  /** The text box's content (editable when not recording). */
  text: string;
  /** While recording: the words Soniox is still deciding on (settled ones are already in `text`). */
  pendingText: string;
  error: string | null;
  elapsedMs: number;
  durationMs: number;
  levels: number[];
  copied: boolean;
  historyOpen: boolean;
  /** How many messages there are; with none, the history arrow is disabled. */
  historyCount: number;
  onTextChange(text: string): void;
  onMic(): void;
  onStop(): void;
  onCopy(): void;
  /** Save the box to the history and empty it (stopping a recording first); Ctrl+Enter too. */
  onClear(): void;
  languages: string[];
  onLanguagesChange(languages: string[]): void;
  onToggleHistory(): void;
  /** Close the window. */
  onClose(): void;
  onOpenSettings(): void;
}

/**
 * The one view: a toolbar on top (mic in the center, window controls at the right, like a
 * title bar), then the T3-style text box. The history opens below the box.
 */
export function Composer(props: ComposerProps) {
  const listening = props.phase !== "idle";
  // An error with nothing else in the box takes the placeholder's place, on the same line.
  const errorOnly = !listening && !props.text && props.error;
  return (
    <div>
      {listening ? <RecordingToolbar {...props} /> : <IdleToolbar {...props} />}
      {/* The text box: T3's composer surface color on the black window. As in T3, the
          language picker (T3: the model picker) and the primary button sit inside it, at the end. */}
      <div
        dir="ltr"
        className="relative mx-2 mt-2 mb-2 flex items-end gap-2 rounded-xl border border-(--composer-outline) bg-card py-1.5 ps-3.5 pe-1.5 inset-shadow-2xs inset-shadow-(color:--composer-highlight)"
      >
        <div className="min-w-0 flex-1 py-0.5">
          {errorOnly ? (
            <p className={cn(TEXT_AREA, "text-center text-error-foreground")}>{props.error}</p>
          ) : (
            <ComposerText {...props} />
          )}
          {props.error && !errorOnly && <p className="mt-1 text-error-foreground text-xs">{props.error}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <CopyButton {...props} />
          <LanguagePicker value={props.languages} disabled={listening} onChange={props.onLanguagesChange} />
          <ClearButton {...props} />
        </div>
      </div>
    </div>
  );
}

/** Copies the box's text; a tick confirms it. Dimmed while there is nothing to copy. */
function CopyButton({ text, copied, onCopy }: ComposerProps) {
  const label = copied ? "Copied" : "Copy";
  return (
    <Button
      variant="ghost-muted"
      size="icon-xs"
      disabled={!text.trim()}
      aria-label={label}
      title={label}
      onClick={onCopy}
    >
      {copied ? <CheckIcon className="text-success-foreground" /> : <CopyIcon />}
    </Button>
  );
}

/** T3 Code's labelled primary pill (ComposerPrimaryActions.tsx: messageActionPillClassName). */
const MESSAGE_ACTION_PILL =
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-message-action font-medium text-base text-message-action-foreground shadow-xs shadow-message-action/24 outline-none hover:bg-message-action-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64 disabled:shadow-none sm:text-sm";

/**
 * "Clear", in the place and style of T3's submit button: dimmed while the box is empty.
 * It keeps the text (it moves to the history) and empties the box; Ctrl+Z brings it back.
 */
function ClearButton({ phase, text, onClear }: ComposerProps) {
  const canClear = phase === "recording" || text.trim().length > 0;
  return (
    <button
      type="button"
      className={cn(MESSAGE_ACTION_PILL, "h-8 px-3 sm:h-7")}
      disabled={!canClear}
      title="Keeps it in your messages and empties the box (Ctrl+Enter)"
      onClick={onClear}
    >
      Clear
    </button>
  );
}

const PLACEHOLDER = "Press the mic and start talking";
/** Text metrics shared by the textarea and its mirror; they must lay out identically. */
const FIELD_TEXT = "whitespace-pre-wrap wrap-break-word text-sm leading-relaxed";

/**
 * The text box. It is editable at all times, also while recording: settled words are
 * appended to `text` as Soniox sends them, and only the still-unsettled (gray) words are
 * outside your reach. The textarea sits over a "mirror" div that holds the same text
 * (invisible) followed by the gray words, so those appear right after your text, and the
 * mirror gives the box its natural size.
 */
function ComposerText({ phase, text, pendingText, onTextChange }: ComposerProps) {
  const listening = phase !== "idle";
  // Right after the box is emptied, "Cleared, Ctrl+Z to undo" stands where the text was.
  const undoShowing = useUndoNotice() !== null;
  const undoInBox = !listening && !text && undoShowing;
  const scrollRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  // Follow the newest words unless the caret was moved away from the end to edit.
  const followEnd = useRef(true);

  const needsSpace = text && pendingText && !/\s$/.test(text) && !/^\s/.test(pendingText);
  const pending = text.trim() ? (needsSpace ? ` ${pendingText}` : pendingText) : pendingText.trimStart();
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
            listening ? (
              <span dir="ltr" className="text-placeholder">
                {phase === "starting" ? "Connecting" : "Listening"}
                <AnimatedDots />
              </span>
            ) : (
              <span dir="ltr" className={cn("text-placeholder", undoInBox && "invisible")}>
                {PLACEHOLDER}
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
        {undoInBox && (
          // Above the textarea so its undo button can be clicked; the rest lets clicks reach the box.
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center [&_button]:pointer-events-auto">
            <UndoNotice className="h-auto w-full justify-center text-sm leading-relaxed" />
          </div>
        )}
        <textarea
          ref={areaRef}
          value={text}
          spellCheck={false}
          aria-label={PLACEHOLDER}
          onChange={(event) => onTextChange(event.target.value)}
          onSelect={(event) => {
            const el = event.currentTarget;
            followEnd.current = el.selectionEnd === el.value.length;
          }}
          // The placeholder is drawn by the mirror, centered. The textarea itself is never
          // centered, and its caret only shows once there is text: an empty, centered textarea
          // put the caret in the middle of the line, away from where words actually start.
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
 * The toolbar: the main control exactly centered, the side columns hold everything else.
 *
 * It is a size container, so it never makes the card wider: only the text decides the width.
 * Its contents adapt to the width they get instead (`@min-[…]/footer:` variants), e.g. the
 * word count only shows when there is room for it.
 */
function Toolbar({ left, center, right }: { left: React.ReactNode; center: React.ReactNode; right: React.ReactNode }) {
  return (
    <div className="@container/footer px-2 pt-2">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="flex min-w-0 items-center justify-start gap-0.5">{left}</div>
        <div className="flex items-center justify-center">{center}</div>
        <div className="flex min-w-0 items-center justify-end gap-0.5 @min-[620px]/footer:gap-1.5">{right}</div>
      </div>
    </div>
  );
}

/** Toolbar controls are all 32px, the size of T3 Code's round controls (its update button too). */
const ROUND = "size-8 rounded-full before:rounded-full sm:size-8";

/** Hides the window (it keeps running in the tray), like a minimize button in the corner. */
function HideButton({ onClick, label = "Hide (Esc)" }: { onClick(): void; label?: string }) {
  return (
    <Button variant="ghost-muted" size="icon" className="rounded-full before:rounded-full" aria-label={label} title={label} onClick={onClick}>
      <MinusIcon />
    </Button>
  );
}

function RecordingToolbar({ phase, elapsedMs, levels, onStop, onClose }: ComposerProps) {
  return (
    <Toolbar
      left={
        <span className="flex items-center gap-1.5 ps-2 text-muted-foreground text-xs tabular-nums">
          <span className="size-2 animate-pulse rounded-full bg-red-500" />
          {formatDuration(elapsedMs)}
        </span>
      }
      // Stop and the wave are one group, centered together.
      center={
        <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="icon"
          className={ROUND}
          aria-label="Stop"
          disabled={phase === "stopping"}
          onClick={onStop}
        >
          {phase === "stopping" ? (
            <LoaderCircleIcon className="animate-spin" />
          ) : (
            <SquareIcon className="size-2.5 fill-current sm:size-2.5" />
          )}
        </Button>
        <Waveform levels={levels} />
        </div>
      }
      right={<HideButton label="Hide (keeps what you said)" onClick={onClose} />}
    />
  );
}

function IdleToolbar({
  text,
  durationMs,
  historyOpen,
  historyCount,
  onMic,
  onToggleHistory,
  onClose,
  onOpenSettings,
}: ComposerProps) {
  const hasText = text.trim().length > 0;
  const noMessages = historyCount === 0 && !historyOpen;
  return (
    <Toolbar
      left={
        <>
          <Button variant="ghost-muted" size="icon" className="rounded-full before:rounded-full" aria-label="Settings" title="Settings" onClick={onOpenSettings}>
            <Settings2Icon />
          </Button>
          <UpdateButton />
          {hasText && (
            <span className="ms-1.5 hidden text-muted-foreground text-xs tabular-nums @min-[560px]/footer:inline">
              {durationMs > 0 && `${formatDuration(durationMs)} · `}
              {countWords(text)} words
            </span>
          )}
        </>
      }
      center={
        <Button size="icon" className={ROUND} aria-label="Dictate" title="Dictate" onClick={onMic}>
          <MicIcon />
        </Button>
      }
      right={
        <>
          {/* aria-disabled rather than disabled: a disabled button gets no pointer events, so T3's
              "not allowed" cursor (aria-disabled:cursor-not-allowed) would never show. */}
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
          <HideButton onClick={onClose} />
        </>
      }
    />
  );
}
