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
 * row from the same speaker are one paragraph.
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
  speaker: Voice;
  text: string;
}

export interface DialogueTurn extends Turn {
  id: string;
}

/** A turn as shown: its settled text and, after it, the words still being recognized. */
export interface DialogueBlock extends DialogueTurn {
  pending: string;
}

/** Words a stream settled, as Soniox sent them: runs of one speaker, and where someone stopped. */
export type SpeechPiece = { speaker?: string; text: string } | "end";
/** Words a stream is still deciding on, by speaker. */
export interface PendingRun {
  speaker?: string;
  text: string;
}

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

/** "Speaker 1: …" / "Speaker 2: …", one turn per line: what Copy puts on the clipboard. */
export function formatConversation(turns: Turn[]): string {
  const numbers = speakerNumbers(turns);
  return turns
    .filter((turn) => turn.text.trim())
    .map((turn) => `${speakerName(numbers.get(turn.speaker)!)}: ${turn.text.trim()}`)
    .join("\n");
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
}

/** The voice of a Soniox speaker id in a stream (a stream without diarization is speaker 1). */
export const voiceOf = (source: Source, speaker?: string): Voice => `${source}:${speaker || "1"}`;

/** The dialogue while recording: one lane per Soniox stream feeds the turns of its voices. */
export class Dialogue {
  turns: DialogueTurn[];
  private lanes = new Map<number, Lane>();
  /** What the computer played lately, to recognize it when it comes back through the microphone. */
  private heard: { at: number; text: string }[] = [];
  private now: () => number;

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
    this.lanes.set(laneId, { source, voice, open, pending: "", pendingVoice: null });
  }

  /** New settled words from a stream, in order, and the words it is still deciding on. */
  update(laneId: number, settled: SpeechPiece[], pending: PendingRun[]) {
    const lane = this.lanes.get(laneId);
    if (!lane) return;
    for (const piece of settled) {
      if (piece === "end") {
        this.closeTurn(lane);
        continue;
      }
      const voice = voiceOf(lane.source, piece.speaker);
      if (voice !== lane.voice && piece.text.trim()) {
        this.closeTurn(lane); // another voice of this stream: the last one stopped
        lane.voice = voice;
      }
      this.append(lane, piece.text);
    }
    lane.pending = pending.map((run) => run.text).join("");
    const first = pending.find((run) => run.text.trim());
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
    if (lane.source === "computer") {
      const now = this.now();
      this.heard.push({ at: now, text });
      this.heard = this.heard.filter((entry) => entry.at >= now - 60_000);
    }
  }

  /** A new turn goes last: into the speaker's last paragraph if nobody spoke since, or a new one. */
  private openTurn(lane: Lane) {
    const last = this.turns.at(-1);
    const takenByOther = (id: string) => [...this.lanes.values()].some((other) => other !== lane && other.open?.id === id);
    const startedAt = this.now();
    if (last && last.speaker === lane.voice && !takenByOther(last.id)) {
      lane.open = { id: last.id, start: last.text.length, fresh: true, startedAt };
      return;
    }
    const turn = { id: newTurnId(), speaker: lane.voice, text: "" };
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
    if (!before || !after || before.speaker !== after.speaker) return;
    const gap = before.text && after.text && !/\s$/u.test(before.text) && !/^\s/u.test(after.text) ? " " : "";
    for (const lane of this.lanes.values()) {
      if (lane.open?.id !== after.id) continue;
      lane.open.id = before.id;
      lane.open.start += before.text.length + gap.length;
    }
    before.text = before.text + gap + after.text;
    this.turns.splice(index, 1);
  }
}
