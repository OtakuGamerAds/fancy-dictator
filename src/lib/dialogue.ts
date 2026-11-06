/**
 * Conversation mode: your microphone and the computer's audio (the other person) go to Soniox
 * as two separate streams, and the box shows them as a dialogue of turns.
 *
 * A turn starts when someone starts speaking and ends when Soniox says they stopped (its
 * endpoint, `<end>`). Turns are placed in the order they start and are never split: when the
 * other person cuts in, your sentence stays whole and theirs follows it, as if they had waited.
 * Two turns in a row from the same person are one paragraph.
 *
 * Without headphones the microphone also hears the other person through the speakers. A turn
 * of yours that is mostly words they just said is that echo, and is dropped.
 */
import { joinSpoken } from "./utils";

export type Speaker = "me" | "them";
/** What Copy takes from a conversation: all of it, or one side. */
export type CopyWhich = "all" | Speaker;

/** One paragraph of the dialogue, as saved with a message. */
export interface Turn {
  speaker: Speaker;
  text: string;
}

export interface DialogueTurn extends Turn {
  id: string;
}

/** A turn as shown: its settled text and, after it, the words still being recognized. */
export interface DialogueBlock extends DialogueTurn {
  pending: string;
}

export const SPEAKER_LABEL: Record<Speaker, string> = { me: "You", them: "Them" };

/** "You: …" / "Them: …", one turn per line: what Copy puts on the clipboard. */
export function formatConversation(turns: Turn[]): string {
  return turns
    .filter((turn) => turn.text.trim())
    .map((turn) => `${SPEAKER_LABEL[turn.speaker]}: ${turn.text.trim()}`)
    .join("\n");
}

/** Only what one side said, one turn per line. */
export function speakerText(turns: Turn[], speaker: Speaker): string {
  return turns
    .filter((turn) => turn.speaker === speaker && turn.text.trim())
    .map((turn) => turn.text.trim())
    .join("\n");
}

export function newTurnId(): string {
  return crypto.randomUUID();
}

/** How far back the other side's words count when deciding whether yours were their echo. */
const ECHO_WINDOW_MS = 4000;
/** A turn of yours is echo when at least this share of its words were just said by them. */
const ECHO_SHARE = 0.6;

/** Words for comparing two transcripts of the same speech (case, diacritics and alef forms aside). */
function words(text: string): string[] {
  return (
    text
      .toLowerCase()
      .normalize("NFKC")
      .replace(/[ً-ٰٟـ]/gu, "")
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
  speaker: Speaker;
  open: OpenTurn | null;
  pending: string;
}

/** The dialogue while recording: one lane per Soniox stream feeds its speaker's turns. */
export class Dialogue {
  turns: DialogueTurn[];
  private lanes = new Map<number, Lane>();
  /** What the other side said lately, to recognize it when it comes back through the microphone. */
  private heard: { at: number; text: string }[] = [];
  private now: () => number;

  constructor(turns: DialogueTurn[], now: () => number = Date.now) {
    this.turns = turns.map((turn) => ({ ...turn }));
    this.now = now;
  }

  /**
   * A stream joins. With `continueLast`, its first words carry on the last paragraph when it
   * is this speaker's (the box was already being dictated into, maybe mid-word).
   */
  addLane(laneId: number, speaker: Speaker, continueLast = false) {
    const last = this.turns.at(-1);
    const open =
      continueLast && last?.speaker === speaker
        ? { id: last.id, start: last.text.length, fresh: false, startedAt: this.now() }
        : null;
    this.lanes.set(laneId, { speaker, open, pending: "" });
  }

  /**
   * New settled words from a stream (`piece`), the words it is still deciding on, and where
   * in `piece` the speaker stopped (Soniox endpoints).
   */
  update(laneId: number, piece: string, pending: string, endpoints: number[] = []) {
    const lane = this.lanes.get(laneId);
    if (!lane) return;
    let position = 0;
    for (const end of endpoints) {
      const at = Math.min(Math.max(end, position), piece.length);
      this.append(lane, piece.slice(position, at));
      this.closeTurn(lane);
      position = at;
    }
    this.append(lane, piece.slice(position));
    lane.pending = pending;
    if (pending.trim() && !lane.open) this.openTurn(lane);
  }

  /** A stream ends. Its unsettled words are kept unless `keepPending` is false (Esc). */
  closeLane(laneId: number, keepPending = true) {
    const lane = this.lanes.get(laneId);
    if (!lane) return;
    if (keepPending) this.append(lane, lane.pending);
    lane.pending = "";
    this.closeTurn(lane);
    this.lanes.delete(laneId);
  }

  /** The turns as shown now, the still-unsettled words included. */
  view(): DialogueBlock[] {
    const blocks: DialogueBlock[] = [];
    for (const turn of this.turns) {
      let text = turn.text;
      let pending = "";
      for (const lane of this.lanes.values()) {
        if (lane.open?.id !== turn.id) continue;
        // Their words coming back through your microphone are hidden while they are heard.
        const sofar = turn.text.slice(lane.open.start) + lane.pending;
        if (lane.speaker === "me" && this.isEchoSince(sofar, lane.open.startedAt)) {
          text = turn.text.slice(0, lane.open.start).trimEnd();
        } else {
          pending = joinSpoken(turn.text, lane.pending, !lane.open.fresh).slice(turn.text.length);
        }
      }
      if (text.trim() || pending.trim()) blocks.push({ ...turn, text, pending });
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
    if (lane.speaker === "them") {
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
    if (last && last.speaker === lane.speaker && !takenByOther(last.id)) {
      lane.open = { id: last.id, start: last.text.length, fresh: true, startedAt };
      return;
    }
    const turn = { id: newTurnId(), speaker: lane.speaker, text: "" };
    this.turns.push(turn);
    lane.open = { id: turn.id, start: 0, fresh: true, startedAt };
  }

  private closeTurn(lane: Lane) {
    const open = lane.open;
    if (!open) return;
    lane.open = null;
    const turn = this.turns.find((t) => t.id === open.id);
    if (!turn) return;
    if (lane.speaker === "me" && this.isEchoSince(turn.text.slice(open.start), open.startedAt)) {
      turn.text = turn.text.slice(0, open.start).trimEnd();
    }
    if (!turn.text.trim()) this.remove(turn.id);
  }

  private isEchoSince(mine: string, since: number): boolean {
    if (!mine.trim()) return false;
    const recent = this.heard.filter((entry) => entry.at >= since - ECHO_WINDOW_MS).map((entry) => entry.text);
    for (const lane of this.lanes.values()) if (lane.speaker === "them") recent.push(lane.pending);
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
