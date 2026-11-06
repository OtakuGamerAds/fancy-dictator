import {
  HistoryIcon,
  MicOffIcon,
  ChevronDownIcon,
  LoaderCircleIcon,
  MicIcon,
  MinusIcon,
  MonitorSpeakerIcon,
  Settings2Icon,
  SquareIcon,
  UsersIcon,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { ConversationTurn } from "~/components/ConversationTurn";
import { LanguagePicker } from "~/components/LanguagePicker";
import { Button } from "~/components/ui/button";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { UndoNotice } from "~/components/UndoNotice";
import { UpdateButton } from "~/components/UpdateButton";
import { Waveform } from "~/components/Waveform";
import { type DialogueBlock, speakerNumbers } from "~/lib/dialogue";
import type { ListenMode } from "~/lib/soniox";
import { cn, countWords, formatDuration, joinSpoken, textDirection } from "~/lib/utils";

export type Phase = "idle" | "starting" | "recording" | "stopping";

interface ComposerProps {
  phase: Phase;
  /** The text box's content (editable when not recording). */
  text: string;
  /** A conversation's turns, shown instead of plain text (null: plain text). */
  dialogue: DialogueBlock[] | null;
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
  /** Replay is on: the empty box offers to go back in time. */
  onReplay?: () => void;
  /** Replay's earlier part is being transcribed, ahead of this live recording. */
  pastPending?: boolean;
  onTextChange(text: string): void;
  onMic(): void;
  /** Start listening to the computer's audio instead: someone you are talking to. */
  /** Start listening to both, you and the computer's audio, as a conversation. */
  onConversation(): void;
  /** What the recording listens to, switchable while it runs. */
  mode: ListenMode;
  onSwitchMode(mode: ListenMode): void;
  /** A conversation's turn edited by hand while it is being recorded. */
  onTurnEdit(id: string, text: string): void;
  onStop(): void;
  /** Copy the text (or one side of a conversation), keep it in the messages and empty the box. */
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
              {props.dialogue ? <DialogueText {...props} dialogue={props.dialogue} /> : <ComposerText {...props} />}
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

/**
 * The empty box is one big talk button. The language picker and the undo notice inside it
 * keep their own clicks (they stop the click from reaching the box).
 */
function TalkSurface({ error, languages, onMic, onConversation, onReplay, onLanguagesChange }: ComposerProps) {
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
      {/* One sentence, centered: "Click to talk, or [conversation]". The box is the mic; the
          button listens to the computer's audio too. */}
      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1.5 px-3.5 pt-3 pb-1">
        {/* The mic stays with the sentence; the button moves down when it does not fit. */}
        <span className="flex items-center gap-2.5">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground shadow-xs shadow-primary/24 transition-transform group-hover/talk:scale-105">
            <MicIcon className="size-3.5" />
          </span>
          <span className={cn("text-sm", error ? "text-error-foreground" : "text-placeholder group-hover/talk:text-foreground")}>
            {error ? `${error} Click to try again, or` : "Click to talk, or"}
          </span>
        </span>
        <span className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="xs"
            className="rounded-full before:rounded-full"
            title="Listen to you and the computer's audio, each on its own, as a conversation"
            onClick={(event) => {
              event.stopPropagation();
              onConversation();
            }}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <UsersIcon />
            conversation
          </Button>
          {onReplay && (
            <Button
              variant="outline"
              size="xs"
              className="rounded-full before:rounded-full"
              title="Go back in time: transcribe what was said in the last minutes"
              onClick={(event) => {
                event.stopPropagation();
                onReplay();
              }}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <HistoryIcon />
              replay
            </Button>
          )}
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

/** Under the text: languages, and a mic to add more. */
function EditRow({ languages, onMic, onLanguagesChange }: ComposerProps) {
  return (
    <>
      <LanguagePicker value={languages} onChange={onLanguagesChange} />
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
    </>
  );
}

/** While recording: the timer and the wave, and Stop. */
/**
 * Your microphone and the computer's audio, each on or muted on its own (T3's segmented toggle,
 * both can be on): red while muted. Used while recording, and to pick what Replay transcribes.
 */
export function SourceToggles({
  mode,
  disabled,
  onChange,
}: {
  mode: ListenMode;
  disabled?: boolean;
  onChange(mode: ListenMode): void;
}) {
  const micOn = mode === "mic" || mode === "both";
  const computerOn = mode === "computer" || mode === "both";
  return (
    <ToggleGroup
      aria-label="Listen to"
      variant="segmented"
      multiple
      value={[...(micOn ? ["mic"] : []), ...(computerOn ? ["computer"] : [])]}
      disabled={disabled}
      onValueChange={(value) => {
        const mic = value.includes("mic");
        const computer = value.includes("computer");
        onChange(mic && computer ? "both" : mic ? "mic" : computer ? "computer" : "none");
      }}
    >
      <Toggle aria-label="Your microphone" title={micOn ? "Mute your microphone" : "Unmute your microphone"} value="mic">
        {micOn ? <MicIcon className="size-3.5" /> : <MicOffIcon className="size-3.5 text-error-foreground" />}
      </Toggle>
      <Toggle
        aria-label="The computer's audio"
        title={computerOn ? "Mute the computer's audio" : "Unmute the computer's audio (a conversation)"}
        value="computer"
      >
        <MonitorSpeakerIcon className={cn("size-3.5", !computerOn && "text-error-foreground")} />
      </Toggle>
    </ToggleGroup>
  );
}

function RecordingRow({ phase, elapsedMs, levels, mode, onSwitchMode, onStop }: ComposerProps) {
  return (
    <>
      <span className="flex items-center gap-2 ps-2 text-muted-foreground text-xs tabular-nums">
        <span className="size-2 animate-pulse rounded-full bg-red-500" />
        {formatDuration(elapsedMs)}
        <Waveform levels={levels} className="ms-1" />
      </span>
      <div className="flex items-center gap-2">
        {/* What is heard, each muted on its own without stopping: the computer's audio makes it
            a conversation; both muted pauses the recording. */}
        <SourceToggles mode={mode} disabled={phase !== "recording"} onChange={onSwitchMode} />
        <Button variant="outline" size="sm" className="h-8 rounded-full px-3 before:rounded-full sm:h-7" disabled={phase === "stopping"} onClick={onStop}>
          {phase === "stopping" ? <LoaderCircleIcon className="animate-spin" /> : <SquareIcon className="size-2.5 fill-current" />}
          Stop
        </Button>
      </div>
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
  const pendingLead = /^\s*/.exec(pending)?.[0] ?? "";
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
              {/* Isolated (<bdi>): mixed Arabic and English words around it would otherwise be
                  reordered differently here than in the textarea above, and the two would overlap. */}
              {/* The space before them stays outside, between the words, not at the isolated edge. */}
              {pendingLead}
              <bdi className="text-muted-foreground/70">{pending.slice(pendingLead.length)}</bdi>
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

/**
 * A conversation, as T3 Code shows a thread with a guest: each speaker in a bubble of their own
 * color (ConversationTurn). Read-only, like messages.
 */
function DialogueText({ phase, dialogue, pastPending, onTurnEdit }: ComposerProps & { dialogue: DialogueBlock[] }) {
  const numbers = speakerNumbers(dialogue);
  const listening = phase !== "idle";
  const scrollRef = useRef<HTMLDivElement>(null);
  // While recording, follow the newest words.
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (scroller && listening) scroller.scrollTop = scroller.scrollHeight;
  }, [dialogue, listening]);
  return (
    <div ref={scrollRef} className="-m-1 block max-h-52 w-[calc(100%+--spacing(2))] overflow-y-auto p-1">
      {pastPending && (
        <p className="pb-2 text-center text-placeholder text-sm">
          Transcribing the earlier part
          <AnimatedDots />
        </p>
      )}
      {dialogue.length === 0 ? (
        <div className={cn(FIELD_TEXT, "min-h-[1lh] text-center")}>
          {listening && (
            <span className="text-placeholder">
              {phase === "starting" ? "Connecting" : "Listening"}
              <AnimatedDots />
            </span>
          )}
        </div>
      ) : (
        // The gap between messages in the list below the box.
        <div className="flex flex-col gap-3">
          {dialogue.map((turn) => (
            <ConversationTurn
              key={turn.id}
              turn={turn}
              number={numbers.get(turn.speaker) ?? 1}
              pending={turn.pending}
              // Its settled words can be edited while recording, as plain dictation can.
              onLiveEdit={turn.id.startsWith("pending:") ? undefined : (text) => onTurnEdit(turn.id, text)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** ".", "..", "...", repeating. Always three dots wide, so the centered word never shifts. */
export function AnimatedDots() {
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
  const { phase, durationMs, onClose, onOpenSettings } = props;
  const text = props.dialogue ? props.dialogue.map((turn) => turn.text).join(" ") : props.text;
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
