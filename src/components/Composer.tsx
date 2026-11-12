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
  SquarePenIcon,
  UsersIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import { LanguagePicker, LiveTranslatePicker } from "~/components/LanguagePicker";
import { Button } from "~/components/ui/button";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { UndoNotice } from "~/components/UndoNotice";
import { UpdateButton } from "~/components/UpdateButton";
import { Waveform } from "~/components/Waveform";
import type { ListenMode } from "~/lib/soniox";
import { cn, formatDuration } from "~/lib/utils";

export type Phase = "idle" | "starting" | "recording" | "stopping";

interface ComposerProps {
  phase: Phase;
  error: string | null;
  elapsedMs: number;
  levels: number[];
  historyOpen: boolean;
  /** How many messages there are; with none, the history arrow is disabled. */
  historyCount: number;
  /** Replay is on: the empty box offers to go back in time. */
  onReplay?: () => void;
  onMic(): void;
  /** Start listening to both, you and the computer's audio, as a conversation. */
  onConversation(): void;
  /** What the recording listens to, switchable while it runs. */
  mode: ListenMode;
  onSwitchMode(mode: ListenMode): void;
  onStop(): void;
  languages: string[];
  onLanguagesChange(languages: string[]): void;
  /** What is said is translated live into this language ("" for none). */
  liveTranslateTo: string;
  onLiveTranslateChange(language: string): void;
  onToggleHistory(): void;
  /** The next recording starts a new session (shown blank under the box until then). */
  onNewSession(): void;
  canStartNewSession: boolean;
  /** Close the window. */
  onClose(): void;
  onOpenSettings(): void;
}

/**
 * The one view: a toolbar on top (settings and updates at the left; a new session, the sessions
 * arrow and hide at the right), then the box.
 *
 * The box itself is the talk button: click anywhere in it to start the mic. While recording it
 * is the recording's controls; what is said goes straight into the session below it.
 */
export function Composer(props: ComposerProps) {
  const listening = props.phase !== "idle";
  return (
    <div>
      <Toolbar {...props} />
      <div
        data-slot="composer-box"
        dir="ltr"
        className="relative mx-2 mt-2 mb-2 rounded-xl border border-(--composer-outline) bg-card inset-shadow-2xs inset-shadow-(color:--composer-highlight)"
      >
        {listening ? (
          <div className="flex items-center justify-between gap-2 p-1.5">
            <RecordingRow {...props} />
          </div>
        ) : (
          <TalkSurface {...props} />
        )}
      </div>
    </div>
  );
}

/**
 * The empty box is one big talk button. The language picker and the undo notice inside it
 * keep their own clicks (they stop the click from reaching the box).
 */
function TalkSurface({
  error,
  languages,
  liveTranslateTo,
  onMic,
  onConversation,
  onReplay,
  onLanguagesChange,
  onLiveTranslateChange,
}: ComposerProps) {
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
        <span className="flex items-center" onClick={(event) => event.stopPropagation()}>
          <LanguagePicker value={languages} onChange={onLanguagesChange} />
          <LiveTranslatePicker value={liveTranslateTo} onChange={onLiveTranslateChange} />
        </span>
        {/* "Copied, Ctrl+Z to undo" right after the box was emptied. */}
        <span className="min-w-0 flex-1" onClick={(event) => event.stopPropagation()}>
          <UndoNotice className="w-full justify-start" />
        </span>
      </div>
    </div>
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
 * The toolbar, like a title bar: settings and updates at the left; a new session, the sessions
 * arrow and hide at the right.
 */
function Toolbar(props: ComposerProps) {
  const { phase, onClose, onOpenSettings } = props;
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
        </div>
        <div className="flex items-center gap-0.5">
          <NewSessionButton {...props} />
          <HistoryToggle {...props} />
          <HideButton label={listening ? "Hide (keeps what you said)" : "Hide (Esc)"} onClick={onClose} />
        </div>
      </div>
    </div>
  );
}

/** A new session, as T3's "New thread" (its square pen): the next recording starts it. */
function NewSessionButton({ phase, canStartNewSession, onNewSession }: ComposerProps) {
  const title = phase !== "idle" ? "New session (after the recording)" : "New session";
  return (
    <Button
      variant="ghost-muted"
      size="icon"
      className="rounded-full before:rounded-full"
      aria-label="New session"
      title={title}
      aria-disabled={!canStartNewSession || undefined}
      onClick={() => canStartNewSession && onNewSession()}
    >
      <SquarePenIcon />
    </Button>
  );
}

/** Folds or unfolds the messages under the box. Disabled (T3's not-allowed cursor) when there are none. */
function HistoryToggle({ phase, historyOpen, historyCount, onToggleHistory }: ComposerProps) {
  const noMessages = historyCount === 0 && !historyOpen;
  const recording = phase !== "idle" && historyOpen;
  return (
    // aria-disabled rather than disabled: a disabled button gets no pointer events, so T3's
    // "not allowed" cursor (aria-disabled:cursor-not-allowed) would never show.
    <Button
      variant="ghost-muted"
      size="icon"
      className="rounded-full before:rounded-full"
      aria-label={historyOpen ? "Hide sessions" : noMessages ? "No sessions yet" : "Show sessions"}
      title={noMessages ? "No sessions yet" : recording ? "The session being recorded is shown" : undefined}
      aria-expanded={historyOpen}
      aria-disabled={noMessages || recording || undefined}
      onClick={() => !noMessages && !recording && onToggleHistory()}
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
