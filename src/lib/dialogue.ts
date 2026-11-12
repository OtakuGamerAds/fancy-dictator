/**
 * Conversation mode: your microphone and the computer's audio go to Soniox as two separate
 * streams, and the box shows them as a dialogue of turns. Soniox also tells the voices of each
 * stream apart (speaker diarization), so two people at one microphone, or two on the call, are
 * two speakers. Speakers are numbered in the order they first spoke.
 *
 * A turn starts when someone starts speaking and ends when Soniox says they stopped (its
 * endpoint, `<end>`), or when another voice of the same stream speaks. Turns are placed in the
 * order they start and are never split: when someone cuts in from the other stream, the
 * sentence being said stays whole and theirs follows it, as if they had waited. Two turns in a
 * row from the same speaker are one paragraph, within a recording and without a long pause:
 * talking again after Stop, or after a few seconds of silence, starts a paragraph of its own.
 *
 * Without headphones the microphone also hears the computer through the speakers. A turn from
 * the microphone that is mostly words the computer just played is that echo, and is dropped.
 */
import { joinSpoken } from "./utils";

type Source = "mic" | "computer";

/**
 * Who said a turn: one voice of one stream, "<source>:<Soniox's speaker id>" ("mic:1"). Messages
 * saved by 0.1.11 have "me" and "them". Only the order voices first speak in is ever shown.
 */
export type Voice = string;
/** What Copy takes from a conversation: all of it, or one speaker's words (by number). */
export type CopyWhich = "all" | number;

/** One paragraph of the dialogue, as saved with a message. */
export interface Turn {
  /** Kept with a saved message, so a bubble being edited stays one when the recording ends. */
  id?: string;
  speaker: Voice;
  text: string;
  /** The recording it was said in (1, 2, …, as the session's clips are numbered). */
  recording?: number;
  /** Its live translation (Soniox's), edited on its own. */
  translation?: string;
}

export interface DialogueTurn extends Turn {
  id: string;
}

/** A turn as shown: its settled text and, after it, the words still being recognized. */
export interface DialogueBlock extends DialogueTurn {
  pending: string;
}

/**
 * Words a stream settled, as Soniox sent them: runs of one speaker, and where someone stopped.
 * The times (ms into the stream) say where the run's words begin and end.
 */
export type SpeechPiece = { speaker?: string; text: string; startMs?: number; endMs?: number } | { translated: string } | "end";
/** Words a stream is still deciding on, by speaker. */
export interface PendingRun {
  speaker?: string;
  text: string;
  startMs?: number;
  endMs?: number;
}

/** Silence this long, then words again: a new paragraph, as if the recording had been stopped. */
export const PAUSE_MS = 10_000;

/** Each voice's number: 1 for whoever spoke first (turns without words aside). */
export function speakerNumbers(turns: readonly { speaker: Voice; text: string; pending?: string }[]): Map<Voice, number> {
  const numbers = new Map<Voice, number>();
  for (const turn of turns) {
    if (numbers.has(turn.speaker) || !(turn.text.trim() || turn.pending?.trim())) continue;
    numbers.set(turn.speaker, numbers.size + 1);
  }
  return numbers;
}

export const speakerName = (number: number) => `Speaker ${number}`;

/**
 * "Speaker 1: …" / "Speaker 2: …", one turn per line: what Copy puts on the clipboard. With one
 * voice only (a dictation talked into again), its paragraphs without names.
 */
export function formatConversation(turns: Turn[]): string {
  const numbers = speakerNumbers(turns);
  const said = turns.filter((turn) => turn.text.trim());
  if (numbers.size <= 1) return said.map((turn) => turn.text.trim()).join("\n\n");
  return said.map((turn) => `${speakerName(numbers.get(turn.speaker)!)}: ${turn.text.trim()}`).join("\n");
}

/** Only what one speaker said, one turn per line. */
export function speakerText(turns: Turn[], number: number): string {
  const numbers = speakerNumbers(turns);
  return turns
    .filter((turn) => numbers.get(turn.speaker) === number && turn.text.trim())
    .map((turn) => turn.text.trim())
    .join("\n");
}

export function newTurnId(): string {
  return crypto.randomUUID();
}

/** How far back the computer's words count when deciding whether the microphone's were their echo. */
const ECHO_WINDOW_MS = 4000;
/** A turn from the microphone is echo when at least this share of its words were just played. */
const ECHO_SHARE = 0.6;

/** Words for comparing two transcripts of the same speech (case, diacritics and alef forms aside). */
function words(text: string): string[] {
  return (
    text
      .toLowerCase()
      .normalize("NFKC")
      .replace(/[ً-ٰٟـ]/gu, "")
      .replace(/[أإآ]/gu, "ا")
      .replace(/ة/gu, "ه")
      .replace(/ى/gu, "ي")
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

export function isEcho(mine: string, theirs: string): boolean {
  const mineWords = words(mine);
  if (mineWords.length === 0) return false;
  const theirWords = new Set(words(theirs));
  if (theirWords.size === 0) return false;
  const shared = mineWords.filter((word) => theirWords.has(word)).length;
  return shared / mineWords.length >= ECHO_SHARE;
}

interface OpenTurn {
  id: string;
  /** Where this turn's words begin in the paragraph (a paragraph can hold several turns). */
  start: number;
  /** Nothing of this turn is in the paragraph yet: its first words are not a continuation. */
  fresh: boolean;
  startedAt: number;
}

interface Lane {
  source: Source;
  /** Whose words the stream is settling now: the open turn's speaker. */
  voice: Voice;
  open: OpenTurn | null;
  pending: string;
  /** Who the words still being decided on are by, when that is another voice of the stream. */
  pendingVoice: Voice | null;
  /** Where (ms into the stream) the last words heard end, to tell a pause. */
  lastEndMs: number | null;
  /** A pause was heard: the next words start a paragraph of their own. */
  afterPause: boolean;
  /** The turn this stream last added words to: their translation, coming after them, goes there. */
  lastTurn: string | null;
}

/** The voice of a Soniox speaker id in a stream (a stream without diarization is speaker 1). */
export const voiceOf = (source: Source, speaker?: string): Voice => `${source}:${speaker || "1"}`;

/** A word with its time, from a transcription of a recording that already exists (Replay). */
export interface TimedWord {
  text: string;
  start_ms: number;
  end_ms: number;
  speaker?: string;
}

/** A pause this long within one voice starts a new turn. */
const TURN_GAP_MS = 1500;

/**
 * The turns of a conversation transcribed after the fact, laid out as a live one would be:
 * each stream's words in turns (a new one when another of its voices speaks, or after a pause),
 * the turns in the order they started, the microphone's echo of the computer dropped, and two
 * turns in a row of the same voice made one paragraph. 
 */
export function turnsFromWords(streams: { source: Source; words: TimedWord[] }[]): DialogueTurn[] {
  type Spoken = { speaker: Voice; source: Source; start: number; end: number; text: string };
  const spoken: Spoken[] = [];
  for (const { source, words } of streams) {
    let current: Spoken | null = null;
    for (const word of words) {
      const speaker = voiceOf(source, word.speaker);
      if (!current || current.speaker !== speaker || word.start_ms - current.end > TURN_GAP_MS) {
        if (current?.text.trim()) spoken.push(current);
        current = { speaker, source, start: word.start_ms, end: word.end_ms, text: "" };
      }
      current.text += word.text;
      current.end = word.end_ms;
    }
    if (current?.text.trim()) spoken.push(current);
  }
  const theirs = spoken.filter((s) => s.source === "computer");
  const kept = spoken.filter(
    (s) =>
      s.source !== "mic" ||
      !isEcho(
        s.text,
        theirs
          .filter((t) => t.end >= s.start - ECHO_WINDOW_MS && t.start <= s.end + 1000)
          .map((t) => t.text)
          .join(" "),
      ),
  );
  kept.sort((a, b) => a.start - b.start);
  const turns: DialogueTurn[] = [];
  let lastEnd = 0;
  for (const s of kept) {
    const text = s.text.trim();
    const last = turns.at(-1);
    if (last && last.speaker === s.speaker && s.start - lastEnd < PAUSE_MS) last.text = joinSpoken(last.text, text, false);
    else turns.push({ id: newTurnId(), speaker: s.speaker, text });
    lastEnd = s.end;
  }
  return turns;
}

/** The dialogue while recording: one lane per Soniox stream feeds the turns of its voices. */
export class Dialogue {
  turns: DialogueTurn[];
  private lanes = new Map<number, Lane>();
  /** What the computer played lately, to recognize it when it comes back through the microphone. */
  private heard: { at: number; text: string }[] = [];
  private now: () => number;
  /** The turns of earlier recordings: words said now are never added to them. */
  private sealed = new Set<string>();
  /** The recording being made: its number goes with each turn said in it. */
  private recording: number | undefined;

  constructor(turns: DialogueTurn[], now: () => number = Date.now) {
    this.turns = turns.map((turn) => ({ ...turn }));
    this.now = now;
  }

  /**
   * A stream joins. With `continueLast`, its first words carry on the last paragraph when it
   * is this stream's (the box was already being dictated into, maybe mid-word).
   */
  addLane(laneId: number, source: Source, continueLast = false) {
    const voice = voiceOf(source);
    const last = this.turns.at(-1);
    const open =
      continueLast && last?.speaker === voice
        ? { id: last.id, start: last.text.length, fresh: false, startedAt: this.now() }
        : null;
    this.lanes.set(laneId, { source, voice, open, pending: "", pendingVoice: null, lastEndMs: null, afterPause: false, lastTurn: null });
  }

  /**
   * Recording `recording` starts: what is said in it goes into turns of its own, after the ones
   * so far, each marked with its number.
   */
  seal(recording: number) {
    this.sealed = new Set(this.turns.map((turn) => turn.id));
    this.recording = recording;
  }

  /**
   * New settled words from a stream, in order, and the words it is still deciding on. A live
   * translation among them is of the words before it: it goes with the turn they went to.
   */
  update(laneId: number, settled: SpeechPiece[], pending: PendingRun[]) {
    const lane = this.lanes.get(laneId);
    if (!lane) return;
    for (const piece of settled) {
      if (piece === "end") {
        this.closeTurn(lane);
        continue;
      }
      if ("translated" in piece) {
        const turn = this.turns.find((t) => t.id === lane.lastTurn);
        if (turn) turn.translation = turn.translation ? turn.translation + piece.translated : piece.translated.trimStart();
        continue;
      }
      if (piece.text.trim()) this.notePause(lane, piece.startMs);
      const voice = voiceOf(lane.source, piece.speaker);
      if (voice !== lane.voice && piece.text.trim()) {
        this.closeTurn(lane); // another voice of this stream: the last one stopped
        lane.voice = voice;
      }
      this.append(lane, piece.text);
      if (piece.text.trim() && piece.endMs !== undefined) lane.lastEndMs = piece.endMs;
    }
    lane.pending = pending.map((run) => run.text).join("");
    const first = pending.find((run) => run.text.trim());
    if (first) this.notePause(lane, first.startMs);
    const pendingVoice = first ? voiceOf(lane.source, first.speaker) : null;
    if (pendingVoice && !lane.open) lane.voice = pendingVoice;
    lane.pendingVoice = pendingVoice && pendingVoice !== lane.voice ? pendingVoice : null;
    if (lane.pending.trim() && !lane.open) this.openTurn(lane);
  }

  /** A stream ends. Its unsettled words are kept unless `keepPending` is false (Esc). */
  closeLane(laneId: number, keepPending = true) {
    const lane = this.lanes.get(laneId);
    if (!lane) return;
    if (keepPending && lane.pendingVoice) {
      this.closeTurn(lane);
      lane.voice = lane.pendingVoice;
    }
    if (keepPending) this.append(lane, lane.pending);
    lane.pending = "";
    lane.pendingVoice = null;
    this.closeTurn(lane);
    this.lanes.delete(laneId);
  }

  /**
   * A turn's words edited by hand while recording. A stream still adding to it carries on at
   * its end; emptied (and closed), the turn goes.
   */
  editTurn(id: string, text: string) {
    const turn = this.turns.find((t) => t.id === id);
    if (!turn) return;
    turn.text = text;
    let open = false;
    for (const lane of this.lanes.values()) {
      if (lane.open?.id !== id) continue;
      open = true;
      lane.open.start = Math.min(lane.open.start, text.length);
    }
    if (!open && !text.trim()) this.remove(id);
  }

  /** A turn's translation edited by hand: what comes later is added after it. */
  editTranslation(id: string, text: string) {
    const turn = this.turns.find((t) => t.id === id);
    if (turn) turn.translation = text;
  }

  /**
   * Turns said before this recording began (Replay's transcription), placed first: they are a
   * recording of their own, the one made now the next.
   */
  prepend(turns: DialogueTurn[]) {
    const recording = this.recording ?? 1;
    for (const turn of this.turns) if (!this.sealed.has(turn.id)) turn.recording = (turn.recording ?? recording) + 1;
    this.recording = recording + 1;
    this.turns.unshift(...turns.map((turn) => ({ ...turn, recording })));
  }

  /** Words starting a while after the last ones ended: the paragraph being said ends there. */
  private notePause(lane: Lane, startMs: number | undefined) {
    if (startMs === undefined || lane.lastEndMs === null || startMs - lane.lastEndMs < PAUSE_MS) return;
    this.closeTurn(lane);
    lane.afterPause = true;
    lane.lastEndMs = startMs; // heard once: the same words settling later are not a pause again
  }

  /** The turns as shown now, the still-unsettled words included. */
  view(): DialogueBlock[] {
    const blocks: DialogueBlock[] = [];
    for (const turn of this.turns) {
      let text = turn.text;
      let pending = "";
      for (const lane of this.lanes.values()) {
        if (lane.open?.id !== turn.id) continue;
        const own = lane.pendingVoice ? "" : lane.pending;
        // The computer's words coming back through your microphone are hidden while heard.
        const sofar = turn.text.slice(lane.open.start) + own;
        if (lane.source === "mic" && this.isEchoSince(sofar, lane.open.startedAt)) {
          text = turn.text.slice(0, lane.open.start).trimEnd();
        } else {
          pending = joinSpoken(turn.text, own, !lane.open.fresh).slice(turn.text.length);
        }
      }
      if (text.trim() || pending.trim()) blocks.push({ ...turn, text, pending });
    }
    // Another voice of a stream starting to speak: last, until its words settle.
    for (const [laneId, lane] of this.lanes) {
      if (!lane.pendingVoice || !lane.pending.trim()) continue;
      if (lane.source === "mic" && this.isEchoSince(lane.pending, this.now())) continue;
      blocks.push({ id: `pending:${laneId}`, speaker: lane.pendingVoice, text: "", pending: lane.pending.trimStart() });
    }
    return blocks;
  }

  private append(lane: Lane, text: string) {
    if (!text) return;
    if (!lane.open) {
      if (!text.trim()) return; // a space before anyone said anything
      this.openTurn(lane);
    }
    const open = lane.open!;
    const turn = this.turns.find((t) => t.id === open.id);
    if (!turn) return;
    turn.text = joinSpoken(turn.text, text, !open.fresh);
    open.fresh = false;
    if (text.trim()) lane.lastTurn = turn.id;
    if (lane.source === "computer") {
      const now = this.now();
      this.heard.push({ at: now, text });
      this.heard = this.heard.filter((entry) => entry.at >= now - 60_000);
    }
  }

  /**
   * A new turn goes last: into the speaker's last paragraph if nobody spoke since (in this
   * recording), or a new one.
   */
  private openTurn(lane: Lane) {
    const last = this.turns.at(-1);
    const takenByOther = (id: string) => [...this.lanes.values()].some((other) => other !== lane && other.open?.id === id);
    const startedAt = this.now();
    const afterPause = lane.afterPause;
    lane.afterPause = false;
    if (last && last.speaker === lane.voice && !afterPause && !this.sealed.has(last.id) && !takenByOther(last.id)) {
      lane.open = { id: last.id, start: last.text.length, fresh: true, startedAt };
      return;
    }
    const turn: DialogueTurn = { id: newTurnId(), speaker: lane.voice, text: "", ...(this.recording ? { recording: this.recording } : {}) };
    this.turns.push(turn);
    lane.open = { id: turn.id, start: 0, fresh: true, startedAt };
  }

  private closeTurn(lane: Lane) {
    const open = lane.open;
    if (!open) return;
    lane.open = null;
    const turn = this.turns.find((t) => t.id === open.id);
    if (!turn) return;
    if (lane.source === "mic" && this.isEchoSince(turn.text.slice(open.start), open.startedAt)) {
      turn.text = turn.text.slice(0, open.start).trimEnd();
    }
    if (!turn.text.trim()) this.remove(turn.id);
  }

  private isEchoSince(mine: string, since: number): boolean {
    if (!mine.trim()) return false;
    const recent = this.heard.filter((entry) => entry.at >= since - ECHO_WINDOW_MS).map((entry) => entry.text);
    for (const lane of this.lanes.values()) if (lane.source === "computer") recent.push(lane.pending);
    return isEcho(mine, recent.join(" "));
  }

  /** Drop an empty paragraph; the two around it become one if they are the same speaker's. */
  private remove(id: string) {
    const index = this.turns.findIndex((turn) => turn.id === id);
    if (index < 0) return;
    this.turns.splice(index, 1);
    const before = this.turns[index - 1];
    const after = this.turns[index];
    if (!before || !after || before.speaker !== after.speaker || this.sealed.has(before.id) || this.sealed.has(after.id)) return;
    const gap = before.text && after.text && !/\s$/u.test(before.text) && !/^\s/u.test(after.text) ? " " : "";
    for (const lane of this.lanes.values()) {
      if (lane.lastTurn === after.id) lane.lastTurn = before.id;
      if (lane.open?.id !== after.id) continue;
      lane.open.id = before.id;
      lane.open.start += before.text.length + gap.length;
    }
    before.text = before.text + gap + after.text;
    if (after.translation) before.translation = before.translation ? `${before.translation} ${after.translation.trimStart()}` : after.translation;
    this.turns.splice(index, 1);
  }
}
