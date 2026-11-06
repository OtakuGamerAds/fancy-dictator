import {
  MicOffIcon,
  ChevronDownIcon,
  CopyIcon,
  LoaderCircleIcon,
  MicIcon,
  MinusIcon,
  MonitorSpeakerIcon,
  Settings2Icon,
  SquareIcon,
  UsersIcon,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { ConversationTurn, speakerColors } from "~/components/ConversationTurn";
import { LanguagePicker } from "~/components/LanguagePicker";
import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { UndoNotice } from "~/components/UndoNotice";
import { UpdateButton } from "~/components/UpdateButton";
import { Waveform } from "~/components/Waveform";
import { type CopyWhich, type DialogueBlock, speakerName, speakerNumbers } from "~/lib/dialogue";
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
  onTextChange(text: string): void;
  onMic(): void;
  /** Start listening to the computer's audio instead: someone you are talking to. */
  /** Start listening to both, you and the computer's audio, as a conversation. */
  onConversation(): void;
  /** What the recording listens to, switchable while it runs. */
  mode: ListenMode;
  onSwitchMode(mode: ListenMode): void;
  onStop(): void;
  /** Copy the text (or one side of a conversation), keep it in the messages and empty the box. */
  onCopy(which: CopyWhich): void;
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

/** T3 Code's labelled primary pill (ComposerPrimaryActions.tsx: messageActionPillClassName). */
const MESSAGE_ACTION_PILL =
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-message-action font-medium text-base text-message-action-foreground shadow-xs shadow-message-action/24 outline-none hover:bg-message-action-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64 disabled:shadow-none sm:text-sm";

/**
 * The empty box is one big talk button. The language picker and the undo notice inside it
 * keep their own clicks (they stop the click from reaching the box).
 */
function TalkSurface({ error, languages, onMic, onConversation, onLanguagesChange }: ComposerProps) {
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
function EditRow({ text, dialogue, languages, onMic, onCopy, onLanguagesChange }: ComposerProps) {
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
        {dialogue ? (
          <CopyConversation dialogue={dialogue} onCopy={onCopy} />
        ) : (
          <button
            type="button"
            className={cn(MESSAGE_ACTION_PILL, "h-8 px-3 sm:h-7")}
            disabled={!text.trim()}
            title="Copy, keep it in your messages, and start fresh (Ctrl+Enter)"
            onClick={() => onCopy("all")}
          >
            <CopyIcon className="size-3.5" />
            Copy
          </button>
        )}
      </div>
    </>
  );
}

/**
 * Copy for a conversation: the pill copies all of it; its chevron (T3's split primary button,
 * ComposerPrimaryActions' "Implement" menu) offers one speaker only.
 */
function CopyConversation({ dialogue, onCopy }: { dialogue: DialogueBlock[]; onCopy(which: CopyWhich): void }) {
  // The speakers with settled words, numbered as Copy writes them.
  const speakers = [...speakerNumbers(dialogue.map((turn) => ({ ...turn, pending: "" }))).values()];
  return (
    <div className="flex items-center">
      <button
        type="button"
        className={cn(MESSAGE_ACTION_PILL, "h-8 rounded-r-none px-3 sm:h-7")}
        disabled={speakers.length === 0}
        title="Copy the conversation, keep it in your messages, and start fresh (Ctrl+Enter)"
        onClick={() => onCopy("all")}
      >
        <CopyIcon className="size-3.5" />
        Copy
      </button>
      <Menu>
        <MenuTrigger
          render={
            <button
              type="button"
              className={cn(MESSAGE_ACTION_PILL, "h-8 rounded-l-none border-l border-message-action-foreground/20 px-2 sm:h-7")}
              aria-label="Copy options"
            />
          }
        >
          <ChevronDownIcon className="size-3.5" />
        </MenuTrigger>
        <MenuPopup align="end">
          {/* Plain items, like T3's "Implement in a new thread". */}
          <MenuItem onClick={() => onCopy("all")}>
            <span aria-hidden className="w-3 shrink-0" />
            Copy conversation
          </MenuItem>
          {speakers.map((number) => (
            <MenuItem key={number} onClick={() => onCopy(number)}>
              {/* The speaker's bubble color, as a legend swatch (T3's telemetry legend). */}
              <span aria-hidden className={cn("h-1.5 w-3 shrink-0 rounded-full", speakerColors(number).hue)} />
              Copy {speakerName(number)} only
            </MenuItem>
          ))}
        </MenuPopup>
      </Menu>
    </div>
  );
}

/** While recording: the timer and the wave, and Stop. */
function RecordingRow({ phase, elapsedMs, levels, mode, onSwitchMode, onStop }: ComposerProps) {
  const micOn = mode !== "computer";
  const computerOn = mode !== "mic";
  return (
    <>
      <span className="flex items-center gap-2 ps-2 text-muted-foreground text-xs tabular-nums">
        <span className="size-2 animate-pulse rounded-full bg-red-500" />
        {formatDuration(elapsedMs)}
        <Waveform levels={levels} className="ms-1" />
      </span>
      <div className="flex items-center gap-2">
        {/* What is heard, switched without stopping (T3's segmented toggle, both can be on):
            the computer's audio makes it a conversation; the mic can be muted in one. One of
            them stays on (Stop ends the recording). */}
        <ToggleGroup
          aria-label="Listen to"
          variant="segmented"
          multiple
          value={[...(micOn ? ["mic"] : []), ...(computerOn ? ["computer"] : [])]}
          disabled={phase !== "recording"}
          onValueChange={(value) => {
            const mic = value.includes("mic");
            const computer = value.includes("computer");
            // Turning off the only one left does nothing (it would not look disabled: Stop ends).
            if (mic || computer) onSwitchMode(mic && computer ? "both" : mic ? "mic" : "computer");
          }}
        >
          <Toggle
            aria-label="Your microphone"
            title={micOn ? "Mute your microphone" : "Unmute your microphone"}
            value="mic"
          >
            {micOn ? <MicIcon className="size-3.5" /> : <MicOffIcon className="size-3.5 text-error-foreground" />}
          </Toggle>
          <Toggle
            aria-label="The computer's audio"
            title={computerOn ? "Stop listening to the computer's audio" : "Listen to the computer's audio too: a conversation"}
            value="computer"
          >
            <MonitorSpeakerIcon className="size-3.5" />
          </Toggle>
        </ToggleGroup>
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
function DialogueText({ phase, dialogue }: ComposerProps & { dialogue: DialogueBlock[] }) {
  const numbers = speakerNumbers(dialogue);
  const listening = phase !== "idle";
  const scrollRef = useRef<HTMLDivElement>(null);
  // While recording, follow the newest words.
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (scroller && listening) scroller.scrollTop = scroller.scrollHeight;
  }, [dialogue, listening]);
  return (
    <div
      ref={scrollRef}
      data-no-drag
      className="-m-1 block max-h-52 w-[calc(100%+--spacing(2))] overflow-y-auto p-1"
    >
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
            <ConversationTurn key={turn.id} turn={turn} number={numbers.get(turn.speaker) ?? 1} pending={turn.pending} />
          ))}
        </div>
      )}
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
