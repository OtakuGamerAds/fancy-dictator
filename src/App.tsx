import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { Composer, type Phase } from "~/components/Composer";
import { HistoryPanel, type LiveSession } from "~/components/HistoryPanel";
import { type ReplayRequest, ReplayView } from "~/components/ReplayView";
import { SettingsView } from "~/components/SettingsView";
import { type RecordedAudio, RecordingAudio, recordedAudio } from "~/lib/clipRecorder";
import { createStreamGate } from "~/lib/hissGate";
import { cutClip } from "~/lib/replayAudio";
import { ReplayBuffer } from "~/lib/replayBuffer";
import {
  Dialogue,
  type DialogueBlock,
  type DialogueTurn,
  formatConversation,
  newTurnId,
  turnsFromWords,
  type PendingRun,
  speakerName,
  type Turn,
  voiceOf,
} from "~/lib/dialogue";
import { sonioxContext } from "~/lib/sonioxContext";
import {
  type AudioSource,
  describeStartError,
  type ListenMode,
  type SonioxSession,
  type Speech,
  startSoniox,
} from "~/lib/soniox";
import type { HistoryEntry, ReplayKept, ReplaySegment, Settings } from "~/lib/types";
import { releaseUndoShortcut, showUndoNotice, undoClaimsShortcut, undoLatestAction } from "~/lib/undoNotice";
import { joinSpoken } from "~/lib/utils";

type View = "main" | "settings" | "replay";

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
  /** Soniox says where its speakers stop: in a conversation only (see StartOptions.endpoints). */
  endpoints: boolean;
}

const savedTurns = (turns: DialogueTurn[]): Turn[] =>
  turns
    .filter((turn) => turn.text.trim())
    .map(({ id, speaker, text, recording, translation }) => ({
      id,
      speaker,
      text: text.trim(),
      ...(recording ? { recording } : {}),
      ...(translation?.trim() ? { translation: translation.trim() } : {}),
    }));

/** How many recordings a session has (its clips are numbered by recording). */
const recordingsOf = (entry: HistoryEntry | undefined) =>
  entry ? new Set(entry.audioParts?.map((part) => part.recording)).size || (entry.audioClips ?? 0) : 0;

const LEVEL_BARS = 18;
/**
 * What does not drag the window: whatever you can click, type in or select (buttons, the text,
 * the bubbles, the recordings). Every other spot of the card drags it, the gaps of a list that
 * scrolls included: the drag is done here, not by a drag region, which would swallow the wheel.
 */
const NO_DRAG =
  'button, input, textarea, select, a, [role="button"], [role="switch"], [data-selectable], [data-no-drag], [data-slot="context-chip"]';
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
  // The session shown under the box (null: the latest), or a new one with nothing in it yet
  // (＋). Recording goes into the one shown.
  const [shownId, setShownId] = useState<string | null>(null);
  const [blankSession, setBlankSession] = useState(false);
  const showSession = (id: string | null) => {
    setShownId(id);
    setBlankSession(false);
  };
  const [settingsNotice, setSettingsNotice] = useState<string | null>(null);

  // The text box. Each dictation is appended to it; it is one history entry until cleared.
  const [text, setText] = useState("");
  const [durationMs, setDurationMs] = useState(0);
  const entryId = useRef<string | null>(null);
  // When the session in the box began (one continued keeps its own).
  const entryCreatedAt = useRef<number | null>(null);

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
  const latest = useLatest({ settings, view, startedAt, text, durationMs, historyOpen, history, shownId, blankSession });

  const setPhase = (next: Phase) => {
    phaseRef.current = next;
    setPhaseState(next);
  };
  // A recording into a new session ended with nothing said (so nothing saved): the new session
  // stays shown, empty, for the next one, rather than the latest saved one coming back.
  useEffect(() => {
    if (phase === "idle" && shownId && !history.some((entry) => entry.id === shownId)) {
      setShownId(null);
      setBlankSession(true);
    }
  }, [phase, shownId, history]);

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
  const latestShown = useLatest(shownId);

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
    const shown = latestShown.current;
    if (shown && ids.includes(shown)) {
      const at = current.findIndex((entry) => entry.id === shown);
      const next = current.slice(at + 1).find((entry) => !ids.includes(entry.id)) ?? remaining.at(-1);
      showSession(next?.id ?? null);
    }
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
  // Whether the streams opened now tell voices apart: in a conversation, not in a dictation.
  const diarizeRef = useRef(false);

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
  const boxClips = useRef<RecordedAudio[]>([]);

  /** The recording ended: its clip is finished (and kept, until the message is saved). */
  const endClip = () => void boxClips.current.at(-1)?.stop();
  /** The recording ended with nothing to keep: drop its clip. */
  const dropClip = () => boxClips.current.pop()?.cancel();

  /**
   * Save a session, with each recording made into it since it was last saved as a clip. One
   * continued keeps its place in the list; a new one goes first.
   */
  const saveEntry = async (entry: HistoryEntry) => {
    const clips = boxClips.current;
    boxClips.current = [];
    for (const recording of clips) {
      const parts = await recording.stop();
      if (parts.length) await window.api.addAudioClips(entry.id, parts);
    }
    const saved = await window.api.getHistory();
    setHistory(
      saved.some((old) => old.id === entry.id)
        ? await window.api.replaceHistory(saved.map((old) => (old.id === entry.id ? entry : old)))
        : await window.api.addHistory(entry),
    );
  };

  /** The message the box makes now. */
  const boxEntry = (text: string, durationMs: number): HistoryEntry => {
    const turns = turnsRef.current && savedTurns(turnsRef.current);
    return {
      id: entryId.current ?? crypto.randomUUID(),
      text,
      createdAt: entryCreatedAt.current ?? Date.now(),
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
    entryCreatedAt.current = null;
  };

  /** Continue a saved session: the box takes its words (and turns), and saves back into it. */
  const continueEntry = (entry: HistoryEntry) => {
    clearText();
    entryId.current = entry.id;
    entryCreatedAt.current = entry.createdAt;
    setDurationMs(entry.durationMs);
    if (entry.turns?.length) writeTurns(entry.turns.map((turn) => ({ ...turn, id: turn.id ?? newTurnId() })));
    else writeText(entry.text);
  };

  /**
   * Turn what is in the box into a message in the history and start clean, like sending in
   * T3. Used when a session ends and whenever the window is hidden. A recording is finished first.
   */
  const sendBox = async ({ showInHistory = false } = {}) => {
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
        // The session stays shown under the box, as it was while recording.
        showSession(entry.id);
        setHistoryOpen(true);
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
    cancelLanes();
    setPhase("idle");
    // What was heard before it failed moves below like any session; the error stays in the box.
    void sendBox({ showInHistory: true }).then(() => setError(message));
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
        // Turns need to know where each side stops; a dictation is better off without: Soniox
        // then settles words later, with more heard after them (measured on real recordings).
        endpoints: diarizeRef.current,
      }),
    );
    for (const lane of lanes) dialogueRef.current?.addLane(lane.id, lane.source, false, lane.endpoints);
    const results = await Promise.allSettled(
      lanes.map(async (lane) => {
        lane.session = await startSoniox({
          apiKey: current.sonioxApiKey,
          model,
          languageHints: current.languages,
          context: sonioxContext(current.languages, current.terms ?? []),
          translateTo: current.liveTranslateTo || undefined,
          source: lane.source,
          deviceId: current.micDeviceId || undefined,
          // In a conversation, the voices of each stream are told apart.
          diarize: diarizeRef.current,
          endpoints: lane.endpoints,
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
      if (dialogueRef.current) dialogueRef.current.closeLane(lane.id);
      else {
        appendSpoken(lane.pending); // plain text: anything still unsettled is kept
        setPendingText("");
      }
      lane.pending = "";
      lanesRef.current = lanesRef.current.filter((l) => l !== lane);
      showDialogue();
    })();
  };

  /**
   * Start listening, into the session shown under the box; `fresh` (the shortcut, Replay), a
   * new session (＋), or none shown starts a new one.
   */
  const startRecording = useCallback(
    async (fresh = false, from: Exclude<ListenMode, "none"> = "mic", asConversation = false) => {
      if (phaseRef.current !== "idle") return;
      const current = latest.current.settings;
      if (!current) return;
      if (!current.sonioxApiKey) {
        setSettingsNotice(NEEDS_KEY);
        setView("settings");
        return;
      }
      const { history: saved, historyOpen: open, shownId: shown, blankSession: blank } = latest.current;
      const continued = !fresh && open && !blank ? (saved.find((entry) => entry.id === shown) ?? saved[0]) : undefined;
      if (continued) continueEntry(continued);
      else clearText();
      entryId.current ??= crypto.randomUUID();
      setPhase("starting");
      setMode(from);
      setView("main");
      // It is shown where it is saved, filling in as you speak.
      showSession(entryId.current);
      setHistoryOpen(true);
      setError(null);
      spokenEnd.current = null;
      const clip = new RecordingAudio();
      boxClips.current.push(clip);
      // A conversation (both sides, or a session holding more than one voice): the voices of
      // each stream are told apart.
      const voice = from === "both" ? null : voiceOf(from);
      diarizeRef.current = from === "both" || asConversation || (turnsRef.current ?? []).some((turn) => turn.speaker !== voice);
      plainSource.current = from === "both" ? "mic" : from;
      // The words go into turns (bubbles), this recording's after the ones so far, each new one
      // marked as where it began; a pause starts a bubble too.
      ensureDialogue().seal(recordingsOf(continued) + 1);
      showDialogue();
      textAtStart.current = textRef.current;
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
      // Each source muted or not on its own; both muted is a pause (no stream, nothing billed).
      const want: AudioSource[] = next === "both" ? ["mic", "computer"] : next === "none" ? [] : [next];
      if (next === "both") diarizeRef.current = true;
      if (!dialogueRef.current && want.includes("computer")) {
        // Becoming a conversation: the text so far is the first turn, and the stream already
        // running carries on in it as its speaker.
        const dialogue = ensureDialogue();
        for (const lane of lanes) {
          dialogue.addLane(lane.id, lane.source, spokenContinues(), lane.endpoints);
          dialogue.update(lane.id, [], lane.pendingRuns);
        }
        setPendingText("");
        showDialogue();
      }
      const missing = want.filter((source) => !lanes.some((lane) => lane.source === source && !lane.leaving));
      const live = boxClips.current.at(-1); // this recording's (Replay's earlier part comes first)
      const added = await openLanes(missing, live instanceof RecordingAudio ? live : undefined);
      if (phaseRef.current !== "recording") {
        for (const lane of added) lane.session?.cancel();
        return;
      }
      lanesRef.current = [...lanesRef.current, ...added];
      for (const lane of lanesRef.current) if (!want.includes(lane.source) && !lane.leaving) leaveLane(lane);
      if (want.length === 0) setLevels(Array(LEVEL_BARS).fill(0)); // the wave goes flat
    } catch {
      setMode(previous); // could not open it: keep listening to what it was
    } finally {
      switching.current = false;
    }
  };

  // ── Replay: the last minutes always recorded, to go back to ──

  const replayRef = useRef<ReplayBuffer | null>(null);
  const replayMinutes = settings?.replay ? settings.replayMinutes : 0;
  const micDeviceId = settings?.micDeviceId ?? "";
  useEffect(() => {
    if (!replayMinutes || new URLSearchParams(location.search).has("snapshot")) return;
    let buffer: ReplayBuffer | null = null;
    let stopped = false;
    void ReplayBuffer.start(micDeviceId || undefined)
      .then((started) => {
        if (stopped) started.stop();
        else replayRef.current = buffer = started;
      })
      .catch(() => {}); // neither source could be opened: Replay shows nothing recorded
    return () => {
      stopped = true;
      buffer?.stop();
      replayRef.current = null;
    };
  }, [replayMinutes, micDeviceId]);
  // Turned off: what was kept is deleted.
  useEffect(() => {
    if (settings && !replayMinutes) void window.api.clearReplay();
  }, [settings, replayMinutes]);

  const [replayBusy, setReplayBusy] = useState(false);
  const [replayError, setReplayError] = useState<string | null>(null);
  // Replay's earlier part being transcribed ahead of a live recording ("Keep going live").
  const pastRef = useRef<Promise<void> | null>(null);
  const [pastPending, setPastPending] = useState(false);

  /** Everything Replay recorded until now. */
  const loadReplay = async () => {
    await replayRef.current?.flush();
    return window.api.listReplay();
  };

  /** Replay's part from `start` until `end`: a clip per source and the conversation in it. */
  const replayContext = () => {
    const current = latest.current.settings;
    return current ? sonioxContext(current.languages, current.terms ?? []) : undefined;
  };
  const transcribePast = async (start: number, end: number, sources: AudioSource[]) => {
    const { segments } = await loadReplay();
    const clips = (
      await Promise.all(
        sources.map(async (source) => ({
          source,
          webm: await cutClip(
            segments.filter((s) => s.source === source),
            start,
            end,
          ),
        })),
      )
    ).filter((clip): clip is { source: AudioSource; webm: ArrayBuffer } => clip.webm !== null);
    // Soniox hears each clip muted while nobody speaks (the hiss gate), as live.
    const streams = await Promise.all(
      clips.map(async (clip) => {
        const heard = await cutClip(
          segments.filter((s) => s.source === clip.source),
          start,
          end,
          true,
        );
        return { source: clip.source, words: await window.api.transcribeReplay(heard ?? clip.webm, replayContext()) };
      }),
    );
    return { clips, turns: turnsFromWords(streams) };
  };

  const transcribeReplay = async ({ start, end: until, mode: chosen, keepLive, cleanUp }: ReplayRequest) => {
    const sources: AudioSource[] = chosen === "both" ? ["mic", "computer"] : chosen === "none" ? [] : [chosen];
    if (sources.length === 0) return;
    // Carrying on live, the part ends now, where the live recording begins.
    const end = keepLive ? Date.now() : until;
    // Done, and only then: Replay forgets everything up to the part's end (as if opened then).
    const cleanUpAfter = () => (cleanUp ? window.api.trimReplay(end) : Promise.resolve());
    setReplayError(null);
    if (keepLive) {
      // The live part starts now, as a conversation; the earlier part is put before it once
      // Soniox has it (Stop waits for it).
      setView("main");
      setPastPending(true);
      pastRef.current = transcribePast(start, end, sources)
        .then(({ clips, turns }) => {
          // Its own recording, before the live one.
          if (clips.length) {
            dialogueRef.current?.prepend(turns);
            boxClips.current.unshift(recordedAudio(clips));
          }
          showDialogue();
          return cleanUpAfter();
        })
        .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)))
        .finally(() => {
          setPastPending(false);
          pastRef.current = null;
        });
      await startRecording(true, chosen as Exclude<ListenMode, "none">, true);
      return;
    }
    setReplayBusy(true);
    try {
      const { clips, turns } = await transcribePast(start, end, sources);
      const kept = savedTurns(turns.map((turn) => ({ ...turn, recording: 1 })));
      if (kept.length === 0) throw new Error("No speech found in that part.");
      const entry: HistoryEntry = {
        id: crypto.randomUUID(),
        text: formatConversation(kept),
        turns: kept,
        createdAt: start,
        durationMs: end - start,
      };
      if (clips.length) await window.api.addAudioClips(entry.id, clips);
      setHistory(await window.api.addHistory(entry));
      await cleanUpAfter();
      // Shown below the box like any session that just ended.
      showSession(entry.id);
      setHistoryOpen(true);
      setView("main");
    } catch (failure) {
      setReplayError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setReplayBusy(false);
    }
  };

  /** Stop: the session is saved and moves below the box, which is empty for the next one. */
  const finishSession = () => sendBox({ showInHistory: true });

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
    const lanes = lanesRef.current; // none while both sources are muted
    setPhase("stopping");
    // Replay's earlier part goes first: it is waited for.
    await pastRef.current;
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
    const combined = textRef.current.trim();
    if (combined === textAtStart.current.trim()) {
      dropClip(); // nothing was said: keep no clip of it
      setPhase("idle");
      if (!combined) setError("No speech detected.");
      return { text: combined, durationMs: latest.current.durationMs };
    }
    const duration = latest.current.durationMs + elapsed;
    entryId.current ??= crypto.randomUUID();
    if (!turnsRef.current) writeText(combined);
    setDurationMs(duration);
    await saveEntry(boxEntry(combined, duration));
    setPhase("idle");
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

  /** A message's words changed in its bubble: saved in place (it keeps its place in the list). */
  const editEntry = async (entry: HistoryEntry) => {
    const saved = await window.api.getHistory();
    setHistory(await window.api.replaceHistory(saved.map((old) => (old.id === entry.id ? entry : old))));
  };

  // ── Events from the main process and the keyboard ─────────────────────

  useEffect(() => {
    // Hidden by the shortcut, the tray or ✕: a recording in progress finishes and is saved.
    // However the window is hidden, the box is saved as a message and the next open is clean.
    const offHidden = window.api.onHidden(() => {
      void sendBox();
      setHistoryOpen(false);
    });
    // First press opens and starts recording; the next one stops it, or hides when idle.
    const offHotkey = window.api.onHotkey(({ opened }) => {
      const p = phaseRef.current;
      if (opened) {
        if (p === "idle") void startRecording(true);
      } else if (p === "recording") void finishSession();
      else if (p === "starting") cancelRecording();
      // Open: talking again, as the box's own click does (into the session shown, a new bubble).
      else if (p === "idle") void startRecording();
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
        const field = target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement;
        if (field && (target as HTMLTextAreaElement).value && !undoClaimsShortcut()) return;
        if (target?.isContentEditable && !undoClaimsShortcut()) return; // a bubble being edited
        if (undoLatestAction()) event.preventDefault();
        return;
      }
      if (!["Control", "Meta", "Shift", "Alt"].includes(event.key)) releaseUndoShortcut();
      // Ctrl+Enter ends the session, like Stop.
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && latest.current.view === "main") {
        event.preventDefault();
        void finishSession();
        return;
      }
      if (event.key !== "Escape") return;
      const { view: current, historyOpen: open } = latest.current;
      if (phaseRef.current === "recording") void finishSession();
      else if (phaseRef.current !== "idle") cancelRecording();
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

  const continuedEntry = history.find((entry) => entry.id === entryId.current);
  const live: LiveSession | null =
    phase === "idle"
      ? null
      : {
          entry: {
            id: entryId.current ?? "live",
            text,
            createdAt: entryCreatedAt.current ?? startedAt,
            durationMs,
            audioClips: continuedEntry?.audioClips,
            audioParts: continuedEntry?.audioParts,
          },
          blocks,
          pending: joinSpoken(text, pendingText, spokenEnd.current !== null && text === spokenEnd.current).slice(text.length),
          status: phase === "starting" ? "Connecting" : "Listening",
          pastPending,
          onTextInput: (value) => {
            releaseUndoShortcut();
            writeText(value);
          },
          onTurnInput: (id, value) => {
            dialogueRef.current?.editTurn(id, value);
            showDialogue();
          },
          onTranslationInput: (id, value) => {
            dialogueRef.current?.editTranslation(id, value);
            showDialogue();
          },
        };

  return (
    // The window is T3 Code's black app background; only the text box gets the composer color.
    // The card hugs the window's right edge, so the ✕ in its corner stays under the mouse
    // while the card shrinks or grows.
    <div
      className="overflow-hidden rounded-2xl border border-border bg-background transition-[height] duration-200 ease-drawer"
      style={{ width: CARD_WIDTH, height: cardHeight }}
      onPointerDown={(event) => {
        const target = event.target as HTMLElement;
        if (event.button !== 0 || target.closest(NO_DRAG)) return;
        // Open lists and menus sit outside the card (portals) but still pass their presses
        // through React to it: they are theirs, not a drag.
        if (!event.currentTarget.contains(target)) return;
        // A list's scrollbar scrolls it (on the left for Arabic): only inside it drags.
        const x = event.nativeEvent.offsetX;
        if (x < target.clientLeft || x >= target.clientLeft + target.clientWidth) return;
        event.preventDefault(); // no text selection or focus change from a drag
        event.currentTarget.setPointerCapture(event.pointerId);
        window.api.startDrag();
      }}
      onLostPointerCapture={() => window.api.endDrag()}
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
              error={error}
              elapsedMs={durationMs + (phase === "idle" ? 0 : now - startedAt)}
              levels={levels}
              historyOpen={historyOpen || live !== null}
              historyCount={history.length}
              // Nothing to start anew from while recording, or with no sessions, or one already new.
              canStartNewSession={phase === "idle" && history.length > 0 && !(blankSession && historyOpen)}
              onNewSession={() => {
                setShownId(null);
                setBlankSession(true);
                setHistoryOpen(true);
              }}
              onMic={() => void startRecording()}
              onConversation={() => void startRecording(false, "both")}
              onReplay={replayMinutes ? () => setView("replay") : undefined}
              mode={mode}
              onSwitchMode={(next) => void switchMode(next)}
              // Stop ends the recording: the session is saved where it is shown.
              onStop={() => void finishSession()}
              languages={settings?.languages ?? []}
              onLanguagesChange={(languages) => {
                if (!settings) return;
                setSettings({ ...settings, languages });
                void window.api.saveSettings({ languages });
              }}
              liveTranslateTo={settings?.liveTranslateTo ?? ""}
              onLiveTranslateChange={(liveTranslateTo) => {
                if (!settings) return;
                setSettings({ ...settings, liveTranslateTo });
                void window.api.saveSettings({ liveTranslateTo });
              }}
              onToggleHistory={() => {
                // Opened by hand, the list starts at the latest session.
                if (!historyOpen) showSession(null);
                setHistoryOpen(!historyOpen);
              }}
              // Closes the window; hiding saves the box and finishes a recording (see onHidden).
              onClose={hide}
              onOpenSettings={() => {
                setSettingsNotice(null);
                setView("settings");
              }}
            />
            {(historyOpen || live) && (
              <HistoryPanel
                history={history}
                selectedId={shownId}
                blank={blankSession}
                live={live}
                onSelect={showSession}
                showUndo={phase !== "idle"}
                translateTo={settings?.translateTo ?? "en"}
                onTranslateToChange={(translateTo) => {
                  if (!settings) return;
                  setSettings({ ...settings, translateTo });
                  void window.api.saveSettings({ translateTo });
                }}
                onCopy={copy}
                onEdit={(entry) => void editEntry(entry)}
                onDelete={(id) => void deleteEntries([id])}
                onClear={() => void deleteEntries(history.map((entry) => entry.id))}
              />
            )}
          </>
        )}
        {view === "replay" && (
          <ReplayView
            load={snapshotReplay ?? loadReplay}
            busy={replayBusy}
            error={replayError}
            onBack={() => setView("main")}
            onTranscribe={(request) => void transcribeReplay(request)}
          />
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

/** Replay's recording in snapshots: twelve minutes of made-up loudness, both sources. */
const snapshotReplay = new URLSearchParams(location.search).has("snapshot")
  ? async (): Promise<ReplayKept> => {
      const now = Date.now();
      const segments: ReplaySegment[] = [];
      for (const source of ["mic", "computer"] as const) {
        for (let start = now - 12 * 60_000; start < now; start += 30_000) {
          const levels = Array.from({ length: 120 }, (_, i) => {
            const t = (start - now) / 1000 + i / 4;
            const talking = Math.sin(t / (source === "mic" ? 23 : 17) + (source === "mic" ? 0 : 2)) > 0;
            return talking ? 0.03 + 0.1 * Math.abs(Math.sin(t * 1.7)) : 0.003;
          });
          segments.push({ source, start, end: start + 30_000, file: `${source}.${start}.webm`, levels });
        }
      }
      return { since: 0, segments };
    }
  : null;

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
  // A short one stays on one line (a contenteditable once wrapped it).
  { id: "c6", speaker: "mic:1", text: "والله منيح.", pending: "" },
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
  type Token = { text: string; is_final: boolean; speaker?: string; start_ms?: number; end_ms?: number };
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
  // The session shown under the box (where a recording goes).
  const box = () => {
    const turns = [...document.querySelectorAll<HTMLElement>("#root li [data-speaker]")];
    if (turns.length === 0) {
      const plain = document.querySelector<HTMLElement>("#root li [data-selectable]");
      return plain ? `plain: ${plain.textContent}` : "(empty)";
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
  const findStop = () => [...document.querySelectorAll<HTMLElement>("button")].find((b) => b.textContent?.trim() === "Stop");
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
  const mics = watchMicrophones();
  await click('[title^="Listen to you and the computer"]');
  steps.opened = Object.keys(sockets).sort().join("+");
  // The microphone unplugged while recording: another is opened, the stream goes on.
  const micStreams = mics.streams.length;
  for (const track of mics.streams.at(-1)?.getAudioTracks() ?? []) track.dispatchEvent(new Event("ended"));
  await wait(1000);
  steps.liveReopened = mics.streams.length > micStreams && !sockets.mic?.ended;
  mics.restore();
  await say("mic", "Hey, did", " you");
  await say("computer", "", "Sorry");
  steps.interrupt = box();
  // Edited while recording: the words still coming for that turn land after the edit.
  const editable = document.querySelector<HTMLElement>("#root li [data-speaker] [data-editable]");
  if (editable) {
    editable.contentEditable = "plaintext-only"; // as a click into it does
    editable.focus();
    editable.textContent = "Hi, did";
    editable.dispatchEvent(new InputEvent("input", { bubbles: true }));
  }
  await say("mic", " you get it?", "", true);
  steps.editedLive = box();
  editable?.blur();
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
  // Both muted: a pause, no stream open; then the microphone again.
  const micAlone = sockets.mic;
  await click('[aria-label="Your microphone"]');
  steps.bothMuted = { micEnded: micAlone?.ended, stopShown: !!findStop() };
  await click('[aria-label="Your microphone"]');
  steps.micBack = sockets.mic !== micAlone && !sockets.mic?.ended;
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
  findStop()?.click();
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

  // 6. ＋ a new session; plain dictation into it that becomes a conversation midway.
  x.setHistoryOpen(true);
  await wait(200);
  await click('[aria-label="New session"]');
  steps.newSession = box();
  await click('[aria-label="Click to talk"]');
  await say("mic", "Plain words", " still being said");
  steps.plain = box();
  // Faint words (still being recognized) selected: the bubble holds still while they are, so
  // the selection stays as they change; once nothing is selected, it catches up.
  const faint = document.querySelector("#root li [data-selectable] bdi");
  faint?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
  await wait(50);
  const faintText = faint?.firstChild;
  if (faintText) {
    const range = document.createRange();
    range.setStart(faintText, 0);
    range.setEnd(faintText, 5);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
  }
  document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  await say("mic", "", " still being said right now");
  await say("mic", " still being said", " right now");
  steps.faintSelected = {
    selected: getSelection()?.toString(),
    translateShown: !!document.querySelector('[aria-label="Translate"]'),
    shown: box(),
  };
  getSelection()?.removeAllRanges();
  await wait(100);
  steps.caughtUp = box();
  await click(`[aria-label="The computer's audio"]`);
  await say("mic", " and more.", "", true);
  await say("computer", "A reply.", "", true);
  steps.converted = box();
  findStop()?.click();
  await wait(1500);
  steps.afterStop = box();
  const sessions = (await window.api.getHistory()).length;
  // 7. Talking again carries on in the session shown: the same one, a second recording.
  await click('[aria-label="Click to talk"]');
  steps.continuedLive = box();
  // Words selected while it is being recorded stay selected as more come, to be translated.
  const first = document.querySelector("#root li [data-speaker] [data-editable]")?.firstChild;
  if (first) {
    const range = document.createRange();
    range.setStart(first, 0);
    range.setEnd(first, 11);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
  }
  await wait(100);
  await say("computer", "More words now.", "", true);
  await say("mic", "Continued.", "", true);
  steps.selectedWhileLive = {
    selected: getSelection()?.toString(),
    translateShown: !!document.querySelector('[aria-label="Translate"]'),
  };
  document.querySelector<HTMLElement>('[aria-label="Translate"]')?.click();
  await wait(300);
  steps.translatedLive = document.querySelector("[data-translation]")?.textContent;
  findStop()?.click();
  await wait(1500);
  const after = await window.api.getHistory();
  steps.continued = {
    sameCount: after.length === sessions,
    text: after[0]?.text,
    recordings: new Set(after[0]?.audioParts?.map((part) => part.recording)).size,
    shown: box(),
  };
  // 8. A dictation talked into again: the second recording is a bubble of its own, without
  // names (one voice), and Copy takes the two as paragraphs.
  await click('[aria-label="New session"]');
  await click('[aria-label="Click to talk"]');
  await say("mic", "First time.", "", true);
  findStop()?.click();
  await wait(1500);
  await click('[aria-label="Click to talk"]');
  await say("mic", "Second", " time");
  const bubbles = () => [...document.querySelectorAll("#root li [data-turn-text], #root li [data-selectable]")].map((b) => b.textContent);
  steps.againLive = { bubbles: bubbles(), names: document.querySelector("#root li")?.textContent?.includes("Speaker") };
  await say("mic", " time.", "", true);
  findStop()?.click();
  await wait(1500);
  const again = (await window.api.getHistory())[0];
  steps.again = { text: again?.text, turns: again?.turns, shown: bubbles() };
  // 9. Silence of over 10 seconds, then words again: a bubble of its own, in the same recording.
  await click('[aria-label="New session"]');
  await click('[aria-label="Click to talk"]');
  sockets.mic?.emit([{ text: "Before the pause.", is_final: true, start_ms: 0, end_ms: 1200 }]);
  await wait(60);
  sockets.mic?.emit([{ text: "After", is_final: false, start_ms: 12000, end_ms: 12400 }]);
  await wait(60);
  steps.pauseLive = bubbles();
  sockets.mic?.emit([{ text: "After it.", is_final: true, start_ms: 12000, end_ms: 12800 }]);
  await wait(60);
  sockets.mic?.emit([{ text: " Right after.", is_final: true, start_ms: 13200, end_ms: 14000 }]);
  await wait(60);
  findStop()?.click();
  await wait(1500);
  steps.pause = (await window.api.getHistory())[0]?.turns;
  // Words selected across bubbles: one selection, copied as one.
  const texts = document.querySelectorAll("#root li [data-turn-text]");
  if (texts.length >= 2) {
    const range = document.createRange();
    range.setStart(texts[0]!, 0);
    range.setEnd(texts[1]!, 1);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
  }
  steps.acrossBubbles = getSelection()?.toString();
  getSelection()?.removeAllRanges();
  // 10. A new session, a recording with nothing said: the new session stays shown (empty).
  await click('[aria-label="New session"]');
  await click('[aria-label="Click to talk"]');
  findStop()?.click();
  await wait(1500);
  steps.emptyStop = document.querySelector('[aria-label="Session"]')?.textContent;
  // 11. The hiss gate: a faint hiss alone is muted; speech over it passes (as loud as it came).
  const gate = createStreamGate(16000);
  const hiss = (n: number) => Float32Array.from({ length: n }, () => (Math.random() - 0.5) * 0.002); // about −60 dBFS
  const speech = (n: number) => Float32Array.from({ length: n }, (_, i) => 0.3 * Math.sin(i / 3) + (Math.random() - 0.5) * 0.002);
  const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / Math.max(1, a.length));
  gate.process(hiss(16000 * 4)); // the VAD learns the floor
  const hissOut = gate.process(hiss(16000));
  gate.process(speech(16000));
  const speechOut = gate.process(speech(16000));
  steps.hissGate = { hiss: rms(hissOut).toFixed(5), speech: rms(speechOut).toFixed(3) };
  window.__fdTestSocket = undefined;
  return steps;
}

/**
 * `pnpm probe`: is the app's own sound kept out of the computer's audio? A 1234 Hz tone is
 * played by the page, and only that frequency is measured in what the computer's audio
 * captures (other sound playing meanwhile does not count), with and without `restrictOwnAudio`.
 */
async function probeOwnAudio() {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const TONE_HZ = 1234;
  const measure = async (restrictOwnAudio: boolean) => {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, restrictOwnAudio } as MediaTrackConstraints,
    });
    const context = new AudioContext({ sampleRate: 48_000 });
    const analyser = context.createAnalyser();
    analyser.fftSize = 8192;
    context.createMediaStreamSource(stream).connect(analyser);
    const bins = new Float32Array(analyser.frequencyBinCount);
    const bin = Math.round((TONE_HZ / 48_000) * analyser.fftSize);
    const level = async () => {
      let peak = -Infinity;
      for (let i = 0; i < 10; i++) {
        await wait(100);
        analyser.getFloatFrequencyData(bins);
        peak = Math.max(peak, bins[bin]!);
      }
      return Math.round(peak);
    };
    const before = await level();
    const speakers = new AudioContext();
    const tone = speakers.createOscillator();
    tone.frequency.value = TONE_HZ;
    const gain = speakers.createGain();
    gain.gain.value = 0.05;
    tone.connect(gain).connect(speakers.destination);
    tone.start();
    await wait(300);
    const during = await level();
    tone.stop();
    void speakers.close();
    for (const track of stream.getTracks()) track.stop();
    void context.close();
    return { beforeDb: before, duringDb: during };
  };
  return { excluded: await measure(true), included: await measure(false) };
}

/** The microphone streams opened from now on (until `restore`), to unplug them in the probe. */
function watchMicrophones() {
  const streams: MediaStream[] = [];
  const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (constraints) => {
    const stream = await original(constraints);
    streams.push(stream);
    return stream;
  };
  return { streams, restore: () => (navigator.mediaDevices.getUserMedia = original) };
}

/**
 * `pnpm probe`: Replay records both sources for a few seconds (the probe's own settings), and a
 * part of it is cut into one clip per source, which must decode to the length asked for.
 */
async function probeReplay() {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  await window.api.saveSettings({ replay: true, replayMinutes: 5 });
  const mics = watchMicrophones();
  const buffer = await ReplayBuffer.start();
  const began = Date.now();
  await wait(1500);
  // The microphone unplugged: a new one is opened and the recording goes on.
  const opened = mics.streams.length;
  for (const track of mics.streams.at(-1)?.getAudioTracks() ?? []) track.dispatchEvent(new Event("ended"));
  await wait(1200);
  const reopenedAfterUnplug = mics.streams.length > opened;
  // One plugged in: the microphone is opened again (following the default).
  navigator.mediaDevices.dispatchEvent(new Event("devicechange"));
  await wait(1300);
  const reopenedAfterPlug = mics.streams.length > opened + 1;
  mics.restore();
  await buffer.flush();
  const { segments } = await window.api.listReplay();
  buffer.stop();
  const from = began + 1000;
  const to = Date.now() - 500;
  const decoder = new OfflineAudioContext(1, 1, 48_000);
  const clips: Record<string, unknown> = {};
  for (const source of ["mic", "computer"] as const) {
    const webm = await cutClip(
      segments.filter((s) => s.source === source),
      from,
      to,
    );
    clips[source] = webm ? { bytes: webm.byteLength, seconds: (await decoder.decodeAudioData(webm)).duration } : null;
  }
  // Cleaned up after: nothing before the part's end is kept any more.
  await window.api.trimReplay(to);
  const trimmed = await window.api.listReplay();
  const cleanedUp = trimmed.since === to && trimmed.segments.every((s) => s.end > to);
  await window.api.clearReplay();
  // Words as Soniox's async API gives them, laid out as a live conversation would be: they
  // cut in while you talk (after your turn), a second voice on the call, and your mic's echo
  // of them (dropped).
  const turns = turnsFromWords([
    {
      source: "mic",
      words: [
        { text: "Hello", start_ms: 0, end_ms: 400, speaker: "1" },
        { text: " there, how are you?", start_ms: 450, end_ms: 1800, speaker: "1" },
        { text: "me too", start_ms: 5100, end_ms: 5500, speaker: "2" },
      ],
    },
    {
      source: "computer",
      words: [
        { text: "Hi!", start_ms: 900, end_ms: 1200, speaker: "1" },
        { text: " Fine, thanks.", start_ms: 2200, end_ms: 3000, speaker: "1" },
        { text: "Me too.", start_ms: 5000, end_ms: 5400, speaker: "2" },
      ],
    },
  ]);
  return {
    cleanedUp,
    reopenedAfterUnplug,
    reopenedAfterPlug,
    turns: formatConversation(turns),
    pieces: segments.map((s) => ({ source: s.source, ms: s.end - s.start, levels: s.levels.length })),
    asked: (to - from) / 1000,
    clips,
  };
}

/**
 * `FD_PROBE=select pnpm probe`: a dictation fed by a scripted socket, for electron/probeInput.cjs
 * to select and edit its words with real mouse and keyboard input while words keep coming.
 */
function liveProbe(x: SnapshotSetters, settings: Settings) {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  type Token = { text: string; is_final: boolean; start_ms?: number; end_ms?: number; translation_status?: string };
  let socket: { emit(tokens: Token[]): void; raw(data: string): void } | null = null;
  let streaming = 0;
  let ms = 0;
  let tick = 0;
  /** Every word the stream settled, to tell whether any went missing. */
  const settled: string[] = [];
  const emit = (final: string, pending = "", end = false, gapMs = 300) => {
    const tokens: Token[] = [];
    ms += gapMs;
    if (final.startsWith(" w")) settled.push(final.trim());
    if (final) tokens.push({ text: final, is_final: true, start_ms: ms, end_ms: ms + 250 });
    if (end) tokens.push({ text: "<end>", is_final: true });
    if (pending) tokens.push({ text: pending, is_final: false, start_ms: ms + 300, end_ms: ms + 500 });
    ms += 250;
    socket?.emit(tokens);
  };
  const words = (node: Element | null) => node?.closest("[data-editable]") ?? null;
  return {
    async start() {
      window.__fdTestSocket = () => {
        const fake = {
          readyState: 0 as number,
          onopen: null as null | (() => void),
          onmessage: null as null | ((event: { data: string }) => void),
          onerror: null,
          onclose: null,
          send(data: unknown) {
            if (data === "") setTimeout(() => fake.onmessage?.({ data: JSON.stringify({ tokens: [], finished: true }) }), 30);
          },
          close() {
            fake.readyState = 3;
          },
          emit(tokens: Token[]) {
            fake.onmessage?.({ data: JSON.stringify({ tokens }) });
          },
          raw(data: string) {
            fake.onmessage?.({ data });
          },
        };
        setTimeout(() => {
          fake.readyState = 1;
          fake.onopen?.();
        }, 30);
        socket = fake;
        return fake as unknown as WebSocket;
      };
      x.setSettings(settings);
      x.setView("main");
      x.setHistory([]);
      x.setBlocks(null);
      x.setText("");
      await wait(300);
      document.querySelector<HTMLElement>('[aria-label="Click to talk"]')?.click();
      await wait(1500);
      return socket !== null;
    },
    /** A message Soniox sent in a real session, as it was. */
    raw: (data: string) => socket?.raw(data),
    /** Soniox's live translation of the words settled last. */
    translate: (text: string) => socket?.emit([{ text, is_final: true, translation_status: "translation" }]),
    /** The live translations shown, bubble by bubble. */
    translations: () =>
      [...document.querySelectorAll("#root li [data-speaker]")].flatMap((turn, i) => {
        const box = turn.querySelector("[data-live-translation] [data-selectable]");
        return box ? [`${i}: ${box.textContent}`] : [];
      }),
    /** Where a word is in the live translation under bubble `index`. */
    translationRectOf(index: number, word: string) {
      const box = document.querySelectorAll("#root li [data-live-translation] [data-selectable]")[index];
      const walker = box ? document.createTreeWalker(box, NodeFilter.SHOW_TEXT) : null;
      for (let node = walker?.nextNode(); node; node = walker!.nextNode()) {
        const at = node.textContent!.indexOf(word);
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + word.length);
        const r = range.getClientRects()[0]!;
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      }
      return null;
    },
    /** Settled words (then an endpoint) and faint ones, `gapMs` after the last. */
    say: (final: string, pending = "", end = false, gapMs = 300) => emit(final, pending, end, gapMs),
    /** Words keep coming, as when talking: faint ones change every 150 ms, settling every 4th. */
    stream(on: boolean) {
      clearInterval(streaming);
      if (!on) return;
      streaming = window.setInterval(() => {
        tick++;
        const word = ` w${tick}`;
        if (tick % 4 === 0) emit(word, " next", false, 0);
        else emit("", `${word} maybe`, false, 0);
      }, 150);
    },
    state() {
      const active = document.activeElement as HTMLElement | null;
      const selection = getSelection();
      return {
        editing: !!active?.isContentEditable,
        activeBubble: active?.isContentEditable ? active.textContent : null,
        selected: selection?.toString() ?? "",
        collapsed: selection?.isCollapsed ?? true,
        caretInEditing: !!(active?.isContentEditable && selection?.focusNode && active.contains(selection.focusNode)),
        bubbles: [...document.querySelectorAll("#root li [data-turn-text], #root li > div > p[data-selectable]")].map((b) => b.textContent),
      };
    },
    /** Where a word is on screen (its first box), in bubble `index` (counting from 0). */
    rectOf(index: number, word: string) {
      const bubble = document.querySelectorAll("#root li [data-turn-text], #root li > div > p[data-selectable]")[index];
      const walker = bubble ? document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT) : null;
      for (let node = walker?.nextNode(); node; node = walker!.nextNode()) {
        const at = node.textContent!.indexOf(word);
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + word.length);
        const r = range.getClientRects()[0]!;
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, editable: !!words(node.parentElement) };
      }
      return null;
    },
    /** Settled words of the stream no bubble shows. */
    missing() {
      const shown = new Set(
        [...document.querySelectorAll("#root li [data-turn-text], #root li > div > p[data-selectable]")].flatMap((b) => (b.textContent ?? "").split(/\s+/)),
      );
      return settled.filter((word) => !shown.has(word));
    },
    /** The list scrolled to its top. */
    scrollTop() {
      const list = document.querySelector("#root ul");
      if (list) list.scrollTop = 0;
    },
    /** The caret's box, to watch it blink. */
    caretRect() {
      const selection = getSelection();
      if (!selection?.rangeCount) return null;
      const r = selection.getRangeAt(0).getClientRects()[0] ?? selection.getRangeAt(0).getBoundingClientRect();
      return { left: r.left, top: r.top, bottom: r.bottom };
    },
    stop() {
      clearInterval(streaming);
      window.__fdTestSocket = undefined;
    },
  };
}
export type LiveProbe = ReturnType<typeof liveProbe>;

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
      sonioxModel: "latest",
      hotkey: "Control+Alt+Space",
      micDeviceId: "",
      replay: true,
      replayMinutes: 60,
      translateTo: "en",
      languages: ["ar", "en"],
      runOnStartup: false,
      terms: ["Claude Code", "T3 Code", "rename", "display name", "testing", "Genau"],
      liveTranslateTo: "",
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
      // More words come while scrolled up to read (electron/main.cjs scrolls up before this).
      "4b-recording-long-more": (x) => {
        x.setText(`${LONG_TEXT} ${LONG_TEXT} ${LONG_TEXT.slice(0, -40)}`);
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
      // Both muted: a pause.
      "5k-conversation-both-muted": (x) => {
        x.setMode("none");
        x.setLevels(Array(LEVEL_BARS).fill(0));
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
      // Short turns in a saved conversation stay on one line; a long one folds on its own.
      "5l-short-turns": (x) => {
        const turns = [
          { speaker: "computer:1", text: "He averaged the 2 numbers at the far end that are less than 10% of my spend, and said that's the price for the whole thing, so we went with it and moved on to the next point." },
          ...SAMPLE_TURNS.slice(4).map(({ speaker, text }) => ({ speaker, text })),
        ];
        x.setHistory([{ id: "short", text: formatConversation(turns), turns, createdAt: Date.now(), durationMs: 4000 }]);
        x.setHistoryOpen(true);
      },
      // A dictation talked into again after Stop (and paused in): a bubble per recording and
      // pause, without names; each recording marked where it began.
      "5m-talked-again": (x) => {
        const turns = [
          { speaker: "mic:1", text: "شو رأيك نحط الإعدادات تحت", recording: 1 },
          { speaker: "mic:1", text: LONG_TEXT, recording: 1 },
          {
            speaker: "mic:1",
            text: "لا، خليها فوق جنب السهم، أسهل.",
            recording: 2,
            translation: "No, keep it up there next to the arrow, it's easier.",
          },
        ];
        x.setSettings({ ...demoSettings, liveTranslateTo: "en" });
        x.setHistory([
          {
            id: "again",
            text: formatConversation(turns),
            turns,
            createdAt: Date.now(),
            durationMs: 12000,
            audioClips: 2,
            audioParts: [
              { recording: 1, source: "mic" },
              { recording: 2, source: "mic" },
            ],
          },
        ]);
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
      // Replay, twelve minutes kept (made-up loudness).
      "9b-replay": (x) => {
        x.setText("");
        x.setView("replay");
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
        return {
          events,
          levelMessages,
          heard,
          conversation: await probeConversation(setters.current, demoSettings),
          replay: await probeReplay(),
          ownAudio: await probeOwnAudio(),
        };
      },
      live: liveProbe(setters.current, demoSettings),
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
