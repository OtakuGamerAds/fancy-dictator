import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { Composer, type Phase } from "~/components/Composer";
import { HistoryPanel } from "~/components/HistoryPanel";
import { SettingsView } from "~/components/SettingsView";
import { RecordingAudio } from "~/lib/clipRecorder";
import {
  type CopyWhich,
  Dialogue,
  type DialogueBlock,
  type DialogueTurn,
  formatConversation,
  newTurnId,
  type PendingRun,
  speakerName,
  speakerText,
  type Turn,
  voiceOf,
} from "~/lib/dialogue";
import {
  type AudioSource,
  describeStartError,
  type ListenMode,
  type SonioxSession,
  type Speech,
  startSoniox,
} from "~/lib/soniox";
import type { HistoryEntry, Settings } from "~/lib/types";
import { releaseUndoShortcut, showUndoNotice, undoClaimsShortcut, undoLatestAction } from "~/lib/undoNotice";
import { joinSpoken } from "~/lib/utils";

type View = "main" | "settings";

/** One Soniox stream of the recording, from one source. */
interface Lane {
  id: number;
  source: AudioSource;
  session: SonioxSession | null;
  /** How much of the stream's settled text has been placed in the box. */
  appended: number;
  pending: string;
  /** The same words by speaker, for when the box becomes a conversation mid-recording. */
  pendingRuns: PendingRun[];
  level: number;
  /** Set while the stream finishes because its source was switched off. */
  leaving: Promise<void> | null;
}

const savedTurns = (turns: DialogueTurn[]): Turn[] =>
  turns.filter((turn) => turn.text.trim()).map(({ speaker, text }) => ({ speaker, text: text.trim() }));

const LEVEL_BARS = 18;
/** One width for everything: text wraps and the card grows downward instead of wider. */
const CARD_WIDTH = 420;
const NEEDS_KEY = "Paste your Soniox API key to start dictating.";

/** Keeps the latest value readable from long-lived listeners. */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [view, setView] = useState<View>("main");
  const [historyOpen, setHistoryOpen] = useState(false);
  // Messages cleared from the box since the window opened. Right after clearing, the list opens
  // showing just these; opening it with the arrow shows the latest few as usual.
  const [sessionIds, setSessionIds] = useState<string[]>([]);
  const [historyMode, setHistoryMode] = useState<"session" | "recent">("recent");
  const [settingsNotice, setSettingsNotice] = useState<string | null>(null);

  // The text box. Each dictation is appended to it; it is one history entry until cleared.
  const [text, setText] = useState("");
  const [durationMs, setDurationMs] = useState(0);
  const entryId = useRef<string | null>(null);

  const [phase, setPhaseState] = useState<Phase>("idle");
  const [pendingText, setPendingText] = useState("");
  const [levels, setLevels] = useState<number[]>(() => Array(LEVEL_BARS).fill(0));
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const phaseRef = useRef<Phase>("idle");
  // The recording's streams: one, or two in a conversation (your microphone and the computer).
  const lanesRef = useRef<Lane[]>([]);
  const laneSeq = useRef(0);
  const latest = useLatest({ settings, view, startedAt, text, durationMs, historyOpen });

  const setPhase = (next: Phase) => {
    phaseRef.current = next;
    setPhaseState(next);
  };

  useEffect(() => {
    void window.api.getSettings().then((loaded) => {
      setSettings(loaded);
      if (!loaded.sonioxApiKey) {
        setSettingsNotice(NEEDS_KEY);
        setView("settings");
      }
    });
    void window.api.getHistory().then(setHistory);
  }, []);

  // Deleting or clearing shows T3's undo notice; Ctrl+Z (or its button) brings things back.
  const latestHistory = useLatest(history);

  const restoreEntries = async (entries: HistoryEntry[]) => {
    const merged = [...latestHistory.current.filter((e) => !entries.some((r) => r.id === e.id)), ...entries];
    merged.sort((a, b) => b.createdAt - a.createdAt);
    setHistory(await window.api.replaceHistory(merged));
  };

  const deleteEntries = async (ids: string[]) => {
    const current = latestHistory.current;
    const removed = current.filter((entry) => ids.includes(entry.id));
    if (removed.length === 0) return;
    const remaining = current.filter((entry) => !ids.includes(entry.id));
    setHistory(await window.api.replaceHistory(remaining));
    // Nothing left to show: fold the drawer up (Ctrl+Z still brings the messages back).
    if (remaining.length === 0) setHistoryOpen(false);
    showUndoNotice({
      action: ids.length > 1 ? "Cleared" : "Deleted",
      undo: () => restoreEntries(removed),
      // Once Ctrl+Z can no longer bring them back, their audio is erased too.
      expire: () => void window.api.discardAudio(removed.map((entry) => entry.id)),
    });
  };

  // The box's text, readable right away (state only updates on the next render). Settled
  // words from Soniox are appended to it while recording, and it stays editable meanwhile.
  const textRef = useRef("");
  const writeText = (value: string) => {
    textRef.current = value;
    setText(value);
  };

  // The box's text right after Soniox last wrote to it this recording (null before it has).
  // While the box still ends there, Soniox's next piece continues it, often mid-word.
  const spokenEnd = useRef<string | null>(null);
  const spokenContinues = () => spokenEnd.current !== null && textRef.current === spokenEnd.current;

  /** Add newly settled words at the end of the box. */
  const appendSpoken = (chunk: string) => {
    if (!chunk) return;
    writeText(joinSpoken(textRef.current, chunk, spokenContinues()));
    spokenEnd.current = textRef.current;
  };
  const textAtStart = useRef("");

  // ── Conversation: the box as a dialogue of turns ──
  // Where the plain text in the box was dictated from, should it become a conversation.
  const plainSource = useRef<AudioSource>("mic");
  // The box's turns when it holds a conversation (null: plain text). Its text is then the
  // conversation written out ("Speaker 1: …"), which is what Copy takes and what is saved.
  const turnsRef = useRef<DialogueTurn[] | null>(null);
  const [blocks, setBlocks] = useState<DialogueBlock[] | null>(null);
  // While recording into a conversation: places each stream's words in its speaker's turns.
  const dialogueRef = useRef<Dialogue | null>(null);

  const writeTurns = (turns: DialogueTurn[] | null) => {
    turnsRef.current = turns;
    setBlocks(turns && turns.map((turn) => ({ ...turn, pending: "" })));
    writeText(turns ? formatConversation(turns) : "");
  };

  /** Show the conversation as it is now, the words still being recognized included. */
  const showDialogue = () => {
    const dialogue = dialogueRef.current;
    if (!dialogue) return;
    turnsRef.current = dialogue.turns;
    setBlocks(dialogue.view());
    writeText(formatConversation(dialogue.turns));
  };

  /** Record into the box as a conversation; plain text already in it becomes the first turn. */
  const ensureDialogue = (): Dialogue => {
    if (dialogueRef.current) return dialogueRef.current;
    const plain = textRef.current;
    const turns = turnsRef.current ?? (plain.trim() ? [{ id: newTurnId(), speaker: voiceOf(plainSource.current), text: plain }] : []);
    dialogueRef.current = new Dialogue(turns);
    return dialogueRef.current;
  };

  /** The recording into the conversation ended: keep the turns that have words. */
  const finishDialogue = () => {
    const dialogue = dialogueRef.current;
    if (!dialogue) return;
    dialogueRef.current = null;
    const turns = dialogue.turns.filter((turn) => turn.text.trim());
    writeTurns(turns.length ? turns : null);
  };

  // The recordings made into the box and not yet saved with its message, each with a clip per
  // source it heard.
  const boxClips = useRef<RecordingAudio[]>([]);

  /** The recording ended: its clip is finished (and kept, until the message is saved). */
  const endClip = () => void boxClips.current.at(-1)?.stop();
  /** The recording ended with nothing to keep: drop its clip. */
  const dropClip = () => boxClips.current.pop()?.cancel();

  /** Save a message, with each recording made into it since it was last saved as a clip. */
  const saveEntry = async (entry: HistoryEntry) => {
    const clips = boxClips.current;
    boxClips.current = [];
    for (const recording of clips) {
      const parts = await recording.stop();
      if (parts.length) await window.api.addAudioClips(entry.id, parts);
    }
    setHistory(await window.api.addHistory(entry));
  };

  /** The message the box makes now. */
  const boxEntry = (text: string, durationMs: number): HistoryEntry => {
    const turns = turnsRef.current && savedTurns(turnsRef.current);
    return {
      id: entryId.current ?? crypto.randomUUID(),
      text,
      createdAt: Date.now(),
      durationMs,
      ...(turns?.length ? { turns } : {}),
    };
  };

  const clearText = () => {
    for (const clip of boxClips.current) clip.cancel();
    boxClips.current = [];
    turnsRef.current = null;
    setBlocks(null);
    writeText("");
    setDurationMs(0);
    entryId.current = null;
  };

  /**
   * Turn what is in the box into a message in the history and start clean, like sending in
   * T3. Used by Ctrl+Enter and whenever the window is hidden. A recording is finished first.
   */
  const sendBox = async ({
    showInHistory = false,
    undoable = false,
    copy = false,
    which = "all" as CopyWhich,
  } = {}) => {
    let value = textRef.current;
    let duration = latest.current.durationMs;
    if (phaseRef.current === "recording" || phaseRef.current === "stopping") {
      const result = await stopRecording();
      if (result) ({ text: value, durationMs: duration } = result);
    } else if (phaseRef.current === "starting") {
      cancelRecording();
    }
    const trimmed = value.trim();
    if (trimmed) {
      const entry = boxEntry(trimmed, duration);
      await saveEntry(entry);
      if (showInHistory) {
        // Open the list on just what was cleared this session, so it is seen landing there.
        setSessionIds((ids) => (ids.includes(entry.id) ? ids : [...ids, entry.id]));
        setHistoryMode("session");
        setHistoryOpen(true);
      }
      if (copy) await window.api.copy(which === "all" || !entry.turns ? entry.text : speakerText(entry.turns, which));
      if (undoable) {
        showUndoNotice({
          action: copy ? "Copied" : "Cleared",
          undo: () => {
            if (entry.turns) writeTurns(entry.turns.map((turn) => ({ ...turn, id: newTurnId() })));
            else writeText(entry.text);
            setDurationMs(entry.durationMs);
            entryId.current = entry.id;
          },
        });
      }
    }
    clearText();
    setError(null);
    setCopied(false);
  };

  // ── Recording ──────────────────────────────────────────────────────────

  // What the recording listens to: your microphone, the computer's audio ("dictate others"),
  // or both as a conversation.
  const [mode, setModeState] = useState<ListenMode>("mic");
  const modeRef = useRef<ListenMode>("mic");
  const setMode = (next: ListenMode) => {
    modeRef.current = next;
    setModeState(next);
  };

  /** A stream's new words: into the conversation, or appended to the plain text. */
  const laneText = (lane: Lane, final: string, pending: string, speech: Speech) => {
    const piece = final.slice(lane.appended);
    lane.appended = final.length;
    lane.pending = pending;
    lane.pendingRuns = speech.pending;
    const dialogue = dialogueRef.current;
    if (dialogue) {
      dialogue.update(lane.id, speech.settled, speech.pending);
      showDialogue();
    } else {
      appendSpoken(piece);
      setPendingText(pending);
    }
  };

  /** The wave shows the louder of the streams, moving once per chunk of the first one. */
  const laneLevel = (lane: Lane, level: number) => {
    lane.level = level;
    const active = lanesRef.current.filter((l) => !l.leaving);
    if (active[0] !== lane) return;
    const loudest = Math.max(...active.map((l) => l.level));
    setLevels((prev) => [...prev.slice(1), loudest]);
  };

  /** Stop every stream at once, dropping the words not settled yet (Esc, or an error). */
  const cancelLanes = () => {
    const lanes = lanesRef.current;
    lanesRef.current = [];
    for (const lane of lanes) {
      lane.session?.cancel();
      lane.pending = "";
      dialogueRef.current?.closeLane(lane.id, false);
    }
    endClip();
    finishDialogue();
    setPendingText("");
  };

  const failRecording = (message: string) => {
    setError(message);
    cancelLanes();
    setPhase("idle");
  };

  /**
   * Open a stream for each source, recording its audio into `clip`. All or none: if one cannot
   * start, the others are closed and the error says which source failed.
   */
  const openLanes = async (sources: AudioSource[], clip: RecordingAudio | undefined): Promise<Lane[]> => {
    const current = latest.current.settings!;
    // "Latest" is resolved from Soniox's model list, so new models are used without an app update.
    const model = await window.api.resolveModel();
    const lanes = sources.map(
      (source): Lane => ({
        id: ++laneSeq.current,
        source,
        session: null,
        appended: 0,
        pending: "",
        pendingRuns: [],
        level: 0,
        leaving: null,
      }),
    );
    for (const lane of lanes) dialogueRef.current?.addLane(lane.id, lane.source);
    const results = await Promise.allSettled(
      lanes.map(async (lane) => {
        lane.session = await startSoniox({
          apiKey: current.sonioxApiKey,
          model,
          languageHints: current.languages,
          source: lane.source,
          deviceId: current.micDeviceId || undefined,
          // In a conversation, the voices of each stream are told apart.
          diarize: dialogueRef.current !== null,
          onText: (final, pending, speech) => laneText(lane, final, pending, speech),
          onLevel: (level) => laneLevel(lane, level),
          onStream: (stream) => clip?.add(lane.source, stream),
          onError: failRecording,
        });
      }),
    );
    const failed = results.findIndex((result) => result.status === "rejected");
    if (failed >= 0) {
      for (const lane of lanes) {
        lane.session?.cancel();
        dialogueRef.current?.closeLane(lane.id, false);
      }
      throw { error: (results[failed] as PromiseRejectedResult).reason, source: lanes[failed]!.source };
    }
    return lanes;
  };

  /** A source switched off mid-recording: its stream settles its last words, then closes. */
  const leaveLane = (lane: Lane) => {
    lane.leaving = (async () => {
      await lane.session?.stop();
      dialogueRef.current?.closeLane(lane.id);
      lanesRef.current = lanesRef.current.filter((l) => l !== lane);
      showDialogue();
    })();
  };

  /** Start listening. New words are appended to the text box unless `fresh` empties it first. */
  const startRecording = useCallback(
    async (fresh = false, from: ListenMode = "mic") => {
      if (phaseRef.current !== "idle") return;
      const current = latest.current.settings;
      if (!current) return;
      if (!current.sonioxApiKey) {
        setSettingsNotice(NEEDS_KEY);
        setView("settings");
        return;
      }
      if (fresh) clearText();
      setPhase("starting");
      setMode(from);
      setView("main");
      setError(null);
      spokenEnd.current = null;
      textAtStart.current = textRef.current;
      const clip = new RecordingAudio();
      boxClips.current.push(clip);
      // Both sides, or a box that already holds a conversation: the words go into turns.
      if (from === "both" || turnsRef.current) ensureDialogue();
      else plainSource.current = from;
      setPendingText("");
      setLevels(Array(LEVEL_BARS).fill(0));
      setCopied(false);
      setStartedAt(Date.now());
      setNow(Date.now());
      try {
        const lanes = await openLanes(from === "both" ? ["mic", "computer"] : [from], clip);
        // Read through a cast: TypeScript narrowed phaseRef.current above, but it may have changed while awaiting.
        if ((phaseRef.current as Phase) !== "starting") {
          // Cancelled, or failed, while we were connecting.
          for (const lane of lanes) {
            lane.session?.cancel();
            dialogueRef.current?.closeLane(lane.id, false);
          }
          if (boxClips.current.at(-1) === clip) dropClip();
          finishDialogue();
          return;
        }
        lanesRef.current = lanes;
        setPhase("recording");
      } catch (failure) {
        const { error: startError, source } = failure as { error: unknown; source: AudioSource };
        if (boxClips.current.at(-1) === clip) dropClip();
        finishDialogue();
        setError(describeStartError(startError, source));
        setPhase("idle");
      }
    },
    // The helpers it calls only read refs and state setters, so they never go stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [latest],
  );

  /** Switch what the recording listens to, without stopping it. */
  const switching = useRef(false);
  const switchMode = async (next: ListenMode) => {
    const previous = modeRef.current;
    if (switching.current || phaseRef.current !== "recording" || next === previous) return;
    switching.current = true;
    setMode(next);
    try {
      const lanes = lanesRef.current;
      if (!dialogueRef.current) {
        // Becoming a conversation: the text so far is the first turn, and the stream already
        // running carries on in it as its speaker.
        const dialogue = ensureDialogue();
        for (const lane of lanes) {
          dialogue.addLane(lane.id, lane.source, spokenContinues());
          dialogue.update(lane.id, [], lane.pendingRuns);
        }
        setPendingText("");
        showDialogue();
      }
      const want: AudioSource[] = next === "both" ? ["mic", "computer"] : [next];
      const missing = want.filter((source) => !lanes.some((lane) => lane.source === source && !lane.leaving));
      const added = await openLanes(missing, boxClips.current.at(-1));
      if (phaseRef.current !== "recording") {
        for (const lane of added) lane.session?.cancel();
        return;
      }
      lanesRef.current = [...lanesRef.current, ...added];
      for (const lane of lanesRef.current) if (!want.includes(lane.source) && !lane.leaving) leaveLane(lane);
    } catch {
      setMode(previous); // could not open it: keep listening to what it was
    } finally {
      switching.current = false;
    }
  };

  const stopping = useRef<Promise<{ text: string; durationMs: number } | null> | null>(null);

  /** Stop listening and save. Resolves to the box's text and duration afterwards. */
  const stopRecording = useCallback((): Promise<{ text: string; durationMs: number } | null> => {
    if (stopping.current) return stopping.current;
    const run = stopRecordingNow().finally(() => (stopping.current = null));
    stopping.current = run;
    return run;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopRecordingNow = async (): Promise<{ text: string; durationMs: number } | null> => {
    if (phaseRef.current === "starting") {
      setPhase("idle");
      return null;
    }
    if (phaseRef.current !== "recording") return null;
    const lanes = lanesRef.current;
    if (lanes.length === 0) return null;
    setPhase("stopping");
    const elapsed = Date.now() - latest.current.startedAt;
    // Soniox settles the last words; they arrive through each stream's onText.
    await Promise.all(lanes.map((lane) => lane.leaving ?? lane.session?.stop()));
    lanesRef.current = [];
    endClip();
    // Anything still unsettled if it timed out is kept.
    const dialogue = dialogueRef.current;
    if (dialogue) {
      for (const lane of lanes) dialogue.closeLane(lane.id);
      finishDialogue();
    } else {
      appendSpoken(lanes[0]?.pending ?? "");
    }
    for (const lane of lanes) lane.pending = "";
    setPendingText("");
    setPhase("idle");
    const combined = textRef.current.trim();
    if (combined === textAtStart.current.trim()) {
      dropClip(); // nothing was said: keep no clip of it
      if (!combined) setError("No speech detected.");
      return { text: combined, durationMs: latest.current.durationMs };
    }
    const duration = latest.current.durationMs + elapsed;
    entryId.current ??= crypto.randomUUID();
    if (!turnsRef.current) writeText(combined);
    setDurationMs(duration);
    await saveEntry(boxEntry(combined, duration));
    return { text: combined, durationMs: duration };
  };

  /** Esc while recording: stop listening; settled words stay, unsettled ones are dropped. */
  const cancelRecording = useCallback(() => {
    cancelLanes();
    setPhase("idle");
    setError(null);
    // cancelLanes only touches refs and state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Elapsed timer while recording.
  useEffect(() => {
    if (phase !== "starting" && phase !== "recording") return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [phase]);

  // "Copied" turns back into "Copy" after a moment.
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  const hide = useCallback(() => {
    setError(null);
    window.api.hide();
  }, []);

  const copy = useCallback(async (value: string) => {
    await window.api.copy(value);
  }, []);

  // ── Events from the main process and the keyboard ─────────────────────

  useEffect(() => {
    // Hidden by the shortcut, the tray or ✕: a recording in progress finishes and is saved.
    // However the window is hidden, the box is saved as a message and the next open is clean.
    const offHidden = window.api.onHidden(() => {
      void sendBox();
      // The next open is a fresh session.
      setSessionIds([]);
      setHistoryOpen(false);
    });
    // First press opens and starts recording; the next one stops it, or hides when idle.
    const offHotkey = window.api.onHotkey(({ opened }) => {
      const p = phaseRef.current;
      if (opened) {
        if (p === "idle") void startRecording(true);
      } else if (p === "recording") void stopRecording();
      else if (p === "starting") cancelRecording();
      else if (p === "idle") hide();
    });
    const offOpenSettings = window.api.onOpenSettings(() => {
      if (phaseRef.current === "idle") setView("settings");
    });
    return () => {
      offHidden();
      offHotkey();
      offOpenSettings();
    };
    // sendBox only reads refs, so the listeners never go stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest, cancelRecording, startRecording, stopRecording, hide]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.code === "KeyZ") {
        // As in T3: right after an action Ctrl+Z undoes it, even inside a text field. Once
        // another key is pressed or the text is edited, Ctrl+Z is the field's own undo again.
        const target = event.target as HTMLElement | null;
        const editing = target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement;
        if (editing && (target as HTMLTextAreaElement).value && !undoClaimsShortcut()) return;
        if (undoLatestAction()) event.preventDefault();
        return;
      }
      if (!["Control", "Meta", "Shift", "Alt"].includes(event.key)) releaseUndoShortcut();
      // Ctrl+Enter sends the box to the history and clears it.
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && latest.current.view === "main") {
        event.preventDefault();
        void sendBox({ showInHistory: true, undoable: true, copy: true });
        return;
      }
      if (event.key !== "Escape") return;
      const { view: current, historyOpen: open } = latest.current;
      if (phaseRef.current !== "idle") cancelRecording();
      else if (current === "settings") setView("main");
      else if (open) setHistoryOpen(false);
      else hide();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [latest, cancelRecording, hide]);

  // ── Size: the card animates its height; the window follows ────────────

  // The width never changes; the content is as tall as it needs and the card animates to it.
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState(90);

  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    // Rounded up, so a fractional height never trims the gap under the content.
    const observer = new ResizeObserver(() => setContentHeight(Math.ceil(el.getBoundingClientRect().height)));
    observer.observe(el);
    return () => observer.disconnect();
  }, [view]);

  const cardHeight = contentHeight + 2; // + top and bottom border

  // The window has a fixed size and the card animates inside it (resizing a transparent
  // window flickers). The main process only moves the window up if the card would leave the screen.
  useEffect(() => {
    window.api.reportContentHeight(cardHeight);
  }, [cardHeight]);

  // Tell the main process which parts of the window take the mouse: the card and any open
  // dropdown. Everywhere else clicks go through to the app behind. Checked every frame, so it
  // follows the card while it animates; only changes are sent.
  useEffect(() => {
    let frame = 0;
    let last = "";
    const tick = () => {
      const elements = [
        ...document.querySelectorAll<HTMLElement>("#root > div, [data-slot=select-popup], [data-slot=popover-popup], [data-slot=menu-popup]"),
      ];
      const rects = elements.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: Math.floor(r.left), y: Math.floor(r.top), width: Math.ceil(r.width), height: Math.ceil(r.height) };
      });
      const key = JSON.stringify(rects);
      if (key !== last) {
        last = key;
        window.api.setHitRects(rects);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  useSnapshotHooks({
    setView,
    setHistoryOpen,
    setHistory,
    setText: writeText,
    setDurationMs,
    setPendingText,
    setPhase,
    setStartedAt,
    setLevels,
    setError,
    setSettings,
    setBlocks: (value) => {
      turnsRef.current = value;
      setBlocks(value);
      writeText(value ? formatConversation(value) : "");
    },
    setMode,
    contentRef,
  });

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    // The window is T3 Code's black app background; only the text box gets the composer color.
    // The card hugs the window's right edge, so the ✕ in its corner stays under the mouse
    // while the card shrinks or grows.
    <div
      className="drag-region overflow-hidden rounded-2xl border border-border bg-background transition-[height] duration-200 ease-drawer"
      style={{ width: CARD_WIDTH, height: cardHeight }}
    >
      <div
        ref={contentRef}
        // flow-root keeps the last child's bottom margin inside, so it is measured (and the
        // card does not cut the gap under the text box).
        className="flow-root"
        style={{ width: CARD_WIDTH - 2 }}
      >
        {view === "main" && (
          <>
            <Composer
              phase={phase}
              text={text}
              dialogue={blocks}
              pendingText={pendingText}
              pendingContinues={spokenEnd.current !== null && text === spokenEnd.current}
              error={error}
              elapsedMs={durationMs + (phase === "idle" ? 0 : now - startedAt)}
              durationMs={durationMs}
              levels={levels}
              historyOpen={historyOpen}
              historyCount={history.length}
              onTextChange={(value) => {
                releaseUndoShortcut();
                writeText(value);
              }}
              onMic={() => void startRecording()}
              onConversation={() => void startRecording(false, "both")}
              mode={mode}
              onSwitchMode={(next) => void switchMode(next)}
              onStop={() => void stopRecording()}
              // Copy, keep it in the messages, and start fresh: talk → Copy → paste anywhere.
              onCopy={(which) => void sendBox({ showInHistory: true, undoable: true, copy: true, which })}
              languages={settings?.languages ?? []}
              onLanguagesChange={(languages) => {
                if (!settings) return;
                setSettings({ ...settings, languages });
                void window.api.saveSettings({ languages });
              }}
              onToggleHistory={() => {
                // Opened by hand, the list shows the latest messages.
                if (!historyOpen) setHistoryMode("recent");
                setHistoryOpen(!historyOpen);
              }}
              // Closes the window; hiding saves the box and finishes a recording (see onHidden).
              onClose={hide}
              onOpenSettings={() => {
                setSettingsNotice(null);
                setView("settings");
              }}
            />
            {historyOpen && (
              <HistoryPanel
                key={historyMode}
                history={history}
                mode={historyMode}
                showUndo={text.length > 0}
                sessionIds={sessionIds}
                onCopy={copy}
                onDelete={(id) => void deleteEntries([id])}
                onClear={() => void deleteEntries(history.map((entry) => entry.id))}
              />
            )}
          </>
        )}
        {view === "settings" && settings && (
          <SettingsView
            settings={settings}
            notice={settingsNotice}
            onBack={() => setView("main")}
            onSaved={(saved) => {
              setSettings(saved);
              setSettingsNotice(null);
              setView("main");
            }}
          />
        )}
      </div>
    </div>
  );
}

// ── Snapshot mode: `pnpm snapshot` renders every view to a PNG ───────────

const SAMPLE_HISTORY: HistoryEntry[] = [
  { id: "1", text: "مرحبا، بدي اكتب رسالة سريعة لفريق العمل", createdAt: Date.now() - 2 * 60000, durationMs: 18000, audioClips: 2 },
  { id: "1b", text: "بدي أشيل الزر كلياته تبع الإنسيرت بشكل عام، لأنه حاسس إنه ما إله أي لزوم، وأنا دايمًا بستخدم الزر تبع كوبي لما بدي أستخدم شي. بإمكانك إنك تشيله بالكامل مشان ينضف التطبيق بشكل عام. وكمان الكنترول إنتر هي مو الطريقة الوحيدة لإنه تنضاف المسج تحت، وإنما كيف بتي 3 كود نحن في عنا الزر تبع سند نفس هذا الزر بقلب التكست فيلد كمان يكون موجود.", createdAt: Date.now() - 3 * 60000, durationMs: 90000, audioClips: 1 },
  { id: "2", text: "شو رأيك نحط الإعدادات تحت", createdAt: Date.now() - 15 * 60000, durationMs: 7000, audioClips: 1 },
  { id: "3", text: "Fix the hotkey bug before the release", createdAt: Date.now() - 60 * 60000, durationMs: 5000 },
  { id: "4", text: "بكرا الساعة عشرة منراجع الكود", createdAt: Date.now() - 26 * 3600000, durationMs: 9000 },
];

// A conversation: you at the microphone and two people on the call (two voices of the
// computer's audio). One cut in while you were still talking, so their turn comes after yours.
const SAMPLE_TURNS: DialogueBlock[] = [
  { id: "c1", speaker: "mic:1", text: "مرحبا، شفت النسخة الجديدة من البرنامج؟", pending: "" },
  { id: "c2", speaker: "computer:1", text: "اي، جربتها اليوم الصبح، والتحديث اشتغل تمام.", pending: "" },
  { id: "c3", speaker: "computer:2", text: "وأنا كمان، بس ما لقيت وين الإعدادات.", pending: "" },
  { id: "c4", speaker: "mic:1", text: "حلو، وقسم الصوت، سجّل صوتنا كلنا؟", pending: "" },
  { id: "c5", speaker: "computer:1", text: "عفوًا، لحظة، أي قسم بالضبط؟", pending: "" },
];
const SAMPLE_LIVE: DialogueBlock[] = [
  SAMPLE_TURNS[0]!,
  SAMPLE_TURNS[1]!,
  SAMPLE_TURNS[2]!,
  { id: "c4", speaker: "mic:1", text: "حلو، وقسم الصوت، سجّل", pending: " صوتنا كلنا" },
  { id: "c5", speaker: "computer:1", text: "", pending: "عفوًا، لحظة، أي" },
];
const SAMPLE_CONVERSATION: HistoryEntry = {
  id: "c",
  text: formatConversation(SAMPLE_TURNS),
  turns: SAMPLE_TURNS.map(({ speaker, text }) => ({ speaker, text })),
  createdAt: Date.now() - 30000,
  durationMs: 41000,
  audioClips: 2,
  audioParts: [
    { recording: 1, source: "mic" },
    { recording: 1, source: "computer" },
  ],
};

const LONG_TEXT =
  "مرحبا، بدي اكتب رسالة سريعة لفريق العمل بخصوص التحديث الجاي. أولاً لازم نراجع الكود بكرا الساعة عشرة الصبح، ونتأكد إنو كل الملاحظات المفتوحة انحلّت. بعدين لازم نصلّح مشكلة الاختصار لأنها لسا عم تعمل تعارض على بعض الأجهزة. كمان بقترح نرتّب صفحة الإعدادات ونخليها أوضح للمستخدمين الجداد. إذا خلصنا المراجعة بكرا، منكون جاهزين للإطلاق بالموعد المحدد بدون أي تأخير. وإذا عند حدا ملاحظات زيادة، يا ريت يكتبها بالقناة قبل الاجتماع. وكمان لا تنسوا نحدّث ملف التغييرات ونكتب فيه كل شي تغيّر بهالنسخة، مشان يكون واضح للكل شو الجديد وشو انصلح. شكراً للجميع على الشغل الحلو بهالأسبوع، وبشوفكم بكرا إن شاء الله.";

/**
 * `pnpm probe`: drives conversation mode through the real UI with a scripted Soniox (one fake
 * socket per source; the real microphone and computer audio are opened). Returns what the box
 * showed at each step and the message that was saved.
 */
async function probeConversation(x: SnapshotSetters, settings: Settings) {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  type Token = { text: string; is_final: boolean; speaker?: string };
  const sockets: Partial<Record<AudioSource, { emit(tokens: Token[]): void; ended: boolean }>> = {};
  window.__fdTestSocket = (source) => {
    const socket = {
      readyState: 0 as number,
      ended: false,
      onopen: null as null | (() => void),
      onmessage: null as null | ((event: { data: string }) => void),
      onerror: null,
      onclose: null,
      send(data: unknown) {
        if (data === "") {
          socket.ended = true;
          setTimeout(() => socket.onmessage?.({ data: JSON.stringify({ tokens: [], finished: true }) }), 30);
        }
      },
      close() {
        socket.readyState = 3;
      },
      emit(tokens: Token[]) {
        socket.onmessage?.({ data: JSON.stringify({ tokens }) });
      },
    };
    setTimeout(() => {
      socket.readyState = 1;
      socket.onopen?.();
    }, 30);
    sockets[source] = socket;
    return socket as unknown as WebSocket;
  };
  const say = async (source: AudioSource, final: string, pending = "", end = false, speaker?: string) => {
    const tokens: Token[] = [];
    if (final) tokens.push({ text: final, is_final: true, speaker });
    if (end) tokens.push({ text: "<end>", is_final: true });
    if (pending) tokens.push({ text: pending, is_final: false, speaker });
    sockets[source]?.emit(tokens);
    await wait(60);
  };
  const box = () => {
    const turns = [...document.querySelectorAll<HTMLElement>("[data-slot=composer-box] [data-speaker]")];
    if (turns.length === 0) {
      const plain = document.querySelector<HTMLTextAreaElement>("[data-slot=composer-box] textarea");
      return plain ? `plain: ${plain.value}` : "(empty)";
    }
    return turns
      .map((turn) => {
        const full = turn.querySelector("[data-turn-text]")?.textContent ?? "";
        const pending = turn.querySelector("bdi")?.textContent ?? "";
        const said = full.slice(0, full.length - pending.length).trimEnd();
        return `${speakerName(Number(turn.dataset.speaker))}: ${said}${pending ? `[${pending}]` : ""}`;
      })
      .join(" | ");
  };
  const click = async (selector: string) => {
    document.querySelector<HTMLElement>(selector)?.click();
    await wait(1500); // the sources open and the fake sockets connect
  };
  const steps: Record<string, unknown> = {};
  x.setSettings(settings);
  x.setView("main");
  x.setHistory([]);
  x.setBlocks(null);
  x.setText("");
  await wait(300);

  // 1. Conversation from the empty box; they cut in while you are still talking.
  await click('[title^="Listen to you and the computer"]');
  steps.opened = Object.keys(sockets).sort().join("+");
  await say("mic", "Hey, did", " you");
  await say("computer", "", "Sorry");
  steps.interrupt = box();
  await say("mic", " you get it?", "", true);
  await say("computer", "Sorry, which one?", "", true);
  steps.turns = box();
  // 2. The echo of their words in your microphone is dropped.
  await say("computer", " I tried it this morning.", "");
  await say("mic", "tried it this morning", "", true);
  await say("computer", "", "", true);
  steps.echo = box();
  // 2b. A second voice on the call (Soniox speaker 2 of the computer's stream) is Speaker 3,
  // and ends speaker 1's turn without an endpoint.
  await say("computer", "Hi, I'm here too.", "", false, "2");
  await say("computer", "", "Welcome", false, "1");
  steps.secondVoice = box();
  await say("computer", "Welcome!", "", true, "1");
  steps.secondVoiceSettled = box();
  // 3. The computer's audio off: their stream settles and closes.
  const computerBefore = sockets.computer;
  await click(`[aria-label="The computer's audio"]`);
  steps.computerEnded = computerBefore?.ended;
  // The only source left cannot be turned off.
  await click('[aria-label="Your microphone"]');
  steps.micAlone = { pressed: document.querySelector('[aria-label="Your microphone"]')?.hasAttribute("data-pressed"), recording: !!sockets.mic && !sockets.mic.ended };
  await say("mic", "Just me now.", "", true);
  // 4. And back on: a new stream for them.
  await click(`[aria-label="The computer's audio"]`);
  steps.newComputerSocket = sockets.computer !== computerBefore;
  await say("computer", "Back again.", "", true);
  // 4b. Your microphone muted: its stream closes; the computer's goes on.
  const micBefore = sockets.mic;
  await click('[aria-label="Your microphone"]');
  steps.micMuted = { ended: micBefore?.ended, icon: document.querySelector('[aria-label="Your microphone"] svg')?.getAttribute("class") };
  await say("computer", "Still here.", "", true);
  await click('[aria-label="Your microphone"]');
  steps.micUnmuted = sockets.mic !== micBefore;
  steps.beforeStop = box();
  // 5. Stop: saved as one message with its turns and one (mixed) clip.
  [...document.querySelectorAll<HTMLElement>("button")].find((b) => b.textContent?.trim() === "Stop")?.click();
  await wait(1500);
  const history = await window.api.getHistory();
  steps.saved = history[0] && { text: history[0].text, turns: history[0].turns, audioClips: history[0].audioClips, audioParts: history[0].audioParts };
  // The clips, one per source: Opus in WebM, with a duration so they can be seeked.
  if (history[0]?.audioClips) {
    const durations: (number | string)[] = [];
    for (let clip = 0; clip < history[0].audioClips; clip++) {
      const player = new Audio(`fd-audio://audio/${history[0].id}/${clip}`);
      durations.push(
        await new Promise<number | string>((resolve) => {
          player.onloadedmetadata = () => {
            const target = player.duration / 2;
            player.onseeked = () => resolve(`${player.duration.toFixed(2)}s, jumped to ${player.currentTime.toFixed(2)}s`);
            player.currentTime = target;
          };
          player.onerror = () => resolve(`error ${player.error?.code}: ${player.error?.message}`);
          setTimeout(() => resolve("timeout"), 5000);
        }),
      );
    }
    steps.clips = durations;
    // Clicking three quarters along a clip's chip jumps there.
    x.setHistoryOpen(true);
    await wait(1500);
    const chip = document.querySelector<HTMLElement>("[data-slot=context-chip]");
    if (chip) {
      const rect = chip.getBoundingClientRect();
      chip.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: rect.left + rect.width * 0.75, clientY: rect.top + 2 }));
      await wait(300);
      steps.chipClick = chip.textContent;
    }
    x.setHistoryOpen(false);
  }

  // 6. Plain dictation that becomes a conversation midway.
  x.setBlocks(null);
  x.setText("");
  await wait(200);
  await click('[aria-label="Click to talk"]');
  await say("mic", "Plain words", "");
  steps.plain = box();
  await click(`[aria-label="The computer's audio"]`);
  await say("mic", " and more.", "", true);
  await say("computer", "A reply.", "", true);
  steps.converted = box();
  [...document.querySelectorAll<HTMLElement>("button")].find((b) => b.textContent?.trim() === "Stop")?.click();
  await wait(1500);
  steps.afterStop = box();
  window.__fdTestSocket = undefined;
  return steps;
}

interface SnapshotSetters {
  setView(v: View): void;
  setHistoryOpen(v: boolean): void;
  setHistory(v: HistoryEntry[]): void;
  setText(v: string): void;
  setDurationMs(v: number): void;
  setPendingText(v: string): void;
  setPhase(v: Phase): void;
  setStartedAt(v: number): void;
  setLevels(v: number[]): void;
  setError(v: string | null): void;
  setSettings(v: Settings): void;
  setBlocks(v: DialogueBlock[] | null): void;
  setMode(v: ListenMode): void;
  contentRef: React.RefObject<HTMLDivElement | null>;
}

function useSnapshotHooks(s: SnapshotSetters) {
  const setters = useLatest(s);
  useEffect(() => {
    if (!new URLSearchParams(location.search).has("snapshot")) return;
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const levels = Array.from({ length: LEVEL_BARS }, (_, i) => 0.02 + 0.12 * Math.abs(Math.sin(i * 0.9)));
    const demoSettings: Settings = {
      sonioxApiKey: "sk-demo-1234567890",
      sonioxOrgKey: "",
      sonioxModel: "latest",
      hotkey: "Control+Alt+Space",
      micDeviceId: "",
      languages: ["ar", "en"],
      runOnStartup: false,
    };
    const scenes: Record<string, (x: SnapshotSetters) => void> = {
      "1-empty": (x) => {
        x.setSettings(demoSettings);
        x.setError(null);
        x.setPhase("idle");
        x.setText("");
        x.setDurationMs(0);
        x.setHistoryOpen(false);
        x.setView("main");
      },
      "2-history": (x) => {
        x.setHistory(SAMPLE_HISTORY);
        x.setHistoryOpen(true);
      },
      "3a-listening": (x) => {
        x.setHistoryOpen(false);
        x.setPhase("recording");
        x.setStartedAt(Date.now() - 5000);
        x.setText("");
        x.setPendingText("");
      },
      "3-recording": (x) => {
        x.setHistoryOpen(false);
        x.setPhase("recording");
        x.setStartedAt(Date.now() - 4000);
        x.setLevels(levels);
        x.setText("مرحبا، بدي اكتب");
        x.setPendingText(" رسالة");
      },
      "3b-recording-medium": (x) => {
        x.setText("مرحبا، بدي اكتب رسالة سريعة لفريق العمل بخصوص التحديث الجاي، وأولاً");
        x.setPendingText(" لازم نراجع");
      },
      // English then Arabic, with the unsettled words on the last line: the two layers must line up.
      "3e-recording-mixed": (x) => {
        x.setText("Oh, oh, الله يسلمك، خلود. صح، بس في الأهل. نعم، ولا فهمت عليك.");
        x.setPendingText(" هيدي المشكلة، ليكوا ليكوا، يا الله، عن جد الأهل.");
      },
      "3f-recording-mixed-back": (x) => {
        x.setText("مرحبا، بدي اكتب رسالة سريعة لفريق العمل.");
        x.setPendingText(" I can also speak English");
      },
      "3c-recording-list-open": (x) => {
        x.setHistory(SAMPLE_HISTORY);
        x.setHistoryOpen(true);
      },
      "3d-recording-list-folded": (x) => {
        x.setHistoryOpen(false);
      },
      "4-recording-long": (x) => {
        x.setStartedAt(Date.now() - 41000);
        x.setText(`${LONG_TEXT} ${LONG_TEXT.slice(0, -40)}`);
        x.setPendingText(LONG_TEXT.slice(-40));
      },
      "5a-typed-short": (x) => {
        x.setPhase("idle");
        x.setPendingText("");
        x.setText("مرحبا كيفك");
        x.setDurationMs(0);
      },
      "5-done": (x) => {
        x.setPhase("idle");
        x.setText(LONG_TEXT);
        x.setDurationMs(44000);
      },
      "5b-undo-notice": (x) => {
        x.setHistoryOpen(true);
        showUndoNotice({ action: "Deleted", undo: () => {} });
      },
      "5c-no-speech": (x) => {
        x.setHistoryOpen(false);
        x.setText("");
        x.setDurationMs(0);
        x.setError("No speech detected.");
      },
      "5d-cleared": (x) => {
        x.setError(null);
        x.setHistoryOpen(false);
        x.setText("");
        showUndoNotice({ action: "Copied", undo: () => {} });
      },
      "5e-conversation": (x) => {
        x.setView("main");
        x.setError(null);
        x.setHistoryOpen(false);
        x.setPhase("recording");
        x.setMode("both");
        x.setStartedAt(Date.now() - 41000);
        x.setLevels(levels);
        x.setBlocks(SAMPLE_LIVE);
      },
      // Watching a video: the microphone muted, only the computer's voices are heard.
      "5i-conversation-mic-muted": (x) => {
        x.setView("main");
        x.setError(null);
        x.setHistoryOpen(false);
        x.setPhase("recording");
        x.setMode("computer");
        x.setStartedAt(Date.now() - 41000);
        x.setLevels(levels);
        x.setBlocks(SAMPLE_LIVE);
      },
      "5f-conversation-done": (x) => {
        x.setView("main");
        x.setHistoryOpen(false);
        x.setPhase("idle");
        x.setBlocks(SAMPLE_TURNS);
        x.setDurationMs(41000);
      },
      "5g-conversation-history": (x) => {
        x.setBlocks(null);
        x.setDurationMs(0);
        x.setMode("mic");
        x.setHistory([SAMPLE_CONVERSATION, ...SAMPLE_HISTORY]);
        x.setHistoryOpen(true);
      },
      "6-settings": (x) => {
        x.setError(null);
        x.setHistoryOpen(false);
        x.setView("settings");
      },
      ...Object.fromEntries(
        (["idle", "available", "downloading", "downloaded"] as const).map((status) => [
          `9-update-${status}`,
          (x: SnapshotSetters) => {
            x.setView("main");
            x.setText("");
            // After the main view (and its update button) has mounted.
            setTimeout(() => window.__fdSetUpdateState?.({
              enabled: true,
              status,
              currentVersion: "0.1.2",
              availableVersion: "0.1.3",
              downloadedVersion: status === "downloaded" ? "0.1.3" : null,
              downloadPercent: status === "downloading" ? 40 : null,
              message: null,
              errorContext: null,
            }), 50);
          },
        ]),
      ),
      "8-main-typed": (x) => {
        x.setView("main");
        x.setText("مرحبا كيفك");
      },
    };
    window.__fdSnapshot = {
      // `pnpm probe`: checks mic → worklet → Soniox socket with a fake key; expects a 401 error.
      probe: async () => {
        const events: string[] = [];
        let levelMessages = 0;
        // Audio chunks and the loudest level heard on each source, switched mid-recording.
        let stage: "mic" | "computer" | "mic-again" = "mic";
        const heard = { mic: { chunks: 0, peak: 0 }, computer: { chunks: 0, peak: 0 }, "mic-again": { chunks: 0, peak: 0 } };
        const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
        try {
          const session = await startSoniox({
            apiKey: "invalid-key-probe",
            languageHints: ["ar", "en"],
            onText: (f, p) => events.push(`text:${f}|${p}`),
            onLevel: (level) => {
              levelMessages++;
              heard[stage].chunks++;
              heard[stage].peak = Math.max(heard[stage].peak, level);
            },
            onError: (m) => events.push(`error:${m}`),
          });
          await wait(1000);
          await session.setSource("computer");
          stage = "computer";
          // A short, quiet tone through the speakers, which the computer's audio should carry.
          const speakers = new AudioContext();
          const tone = speakers.createOscillator();
          const gain = speakers.createGain();
          gain.gain.value = 0.03;
          tone.connect(gain).connect(speakers.destination);
          tone.start();
          await wait(1000);
          tone.stop();
          void speakers.close();
          await session.setSource("mic");
          stage = "mic-again";
          await wait(800);
          session.cancel();
        } catch (e) {
          events.push(`start-failed:${describeStartError(e)}`);
        }
        return { events, levelMessages, heard, conversation: await probeConversation(setters.current, demoSettings) };
      },
      views: () => Object.keys(scenes),
      apply: (name) => scenes[name]?.(setters.current),
      show: async (name) => {
        scenes[name]?.(setters.current);
        await frame();
        await new Promise((r) => setTimeout(r, 600)); // past the 200ms height animation
        const card = document.querySelector("#root > div")?.getBoundingClientRect();
        const box = document.querySelector("[data-slot=composer-box]")?.getBoundingClientRect();
        const bar = document.querySelector("[data-slot=composer-toolbar]")?.getBoundingClientRect();
        if (card && box && bar) {
          const r = (n: number) => Math.round(n * 10) / 10;
          console.log(
            `[layout] ${name}: toolbar top ${r(bar.top - card.top)} · gap ${r(box.top - bar.bottom)} · ` +
              `box left ${r(box.left - card.left)} right ${r(card.right - box.right)} bottom ${r(card.bottom - box.bottom)}`,
          );
        }
        return (setters.current.contentRef.current?.offsetHeight ?? 95) + 2;
      },
      click: async (selector) => {
        const el = document.querySelector<HTMLElement>(selector);
        if (!el) return false;
        for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
          const init = { bubbles: true, cancelable: true, button: 0, pointerType: "mouse" };
          el.dispatchEvent(type.startsWith("pointer") ? new PointerEvent(type, init) : new MouseEvent(type, init));
        }
        await new Promise((r) => setTimeout(r, 400));
        return true;
      },
    };
  }, [setters]);
}
