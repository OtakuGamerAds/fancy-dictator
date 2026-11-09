/**
 * Words said much more quietly than the speech around them (voices in the background, a TV in
 * the next room) are left out of the transcript: only clear speech, yours or the people you
 * talk with, is written.
 *
 * Each stream keeps how loud its audio was over time. A word's loudness is that of the audio
 * under it (Soniox gives each word's time); the stream's speech level is the loudness most of
 * its words reach (the 90th percentile of the latest ones). A word well below it is dropped.
 * A token continuing a word (no space before it) goes with the word's start.
 */

/** Below this share of the speech level (about 12 dB quieter), a word is background. */
const QUIET_SHARE = 0.25;
/** How many of the latest words set the speech level. */
const LEVEL_WORDS = 300;
/** A short word is measured over at least this much audio. */
const MIN_SPAN_MS = 150;

/** A word or a piece of one, with its time in the stream. */
export interface TimedToken {
  text: string;
  start_ms?: number;
  end_ms?: number;
}

/** Whether a token continues the word before it (rather than starting one). */
const continuesWord = (token: TimedToken) => !/^\s/.test(token.text);

const percentile90 = (levels: number[]) => {
  const sorted = [...levels].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * 0.9)] ?? 0;
};

export class Loudness {
  /** The audio's loudness (RMS, 0–1) in pieces, in order. */
  private chunks: { start: number; end: number; level: number }[] = [];
  private heardMs = 0;
  private words: number[] = [];
  /** Whether the last settled word was kept (words still being decided on follow it). */
  private lastKept = true;
  private any = false;

  /** `keepMs`: how much audio is kept to measure words by (Soniox settles words within seconds). */
  constructor(private keepMs = 120_000) {}

  /** The next `ms` of the stream had this loudness. */
  add(ms: number, level: number) {
    this.chunks.push({ start: this.heardMs, end: this.heardMs + ms, level });
    this.heardMs += ms;
    while (this.chunks.length && this.chunks[0]!.end < this.heardMs - this.keepMs) this.chunks.shift();
  }

  /** Samples (-1 to 1) heard at `sampleRate`, measured in 100 ms pieces. */
  addSamples(samples: Float32Array, sampleRate: number) {
    const size = Math.round(sampleRate / 10);
    for (let at = 0; at < samples.length; at += size) {
      const end = Math.min(samples.length, at + size);
      let energy = 0;
      for (let i = at; i < end; i++) energy += samples[i]! * samples[i]!;
      this.add(((end - at) / sampleRate) * 1000, Math.sqrt(energy / Math.max(1, end - at)));
    }
  }

  /** The loudness under a token; null without a time or audio there. */
  measure(token: TimedToken): number | null {
    if (token.start_ms === undefined || token.end_ms === undefined) return null;
    const middle = (token.start_ms + token.end_ms) / 2;
    const from = Math.min(token.start_ms, middle - MIN_SPAN_MS / 2);
    const to = Math.max(token.end_ms, middle + MIN_SPAN_MS / 2);
    let energy = 0;
    let span = 0;
    for (const chunk of this.chunks) {
      const overlap = Math.min(to, chunk.end) - Math.max(from, chunk.start);
      if (overlap <= 0) continue;
      energy += chunk.level * chunk.level * overlap;
      span += overlap;
    }
    return span > 0 ? Math.sqrt(energy / span) : null;
  }

  /**
   * One message's tokens, in order (settled ones first), the quiet ones dropped. Settled words
   * count toward the speech level; the ones still being decided on are judged without.
   */
  filter<T extends TimedToken & { is_final?: boolean }>(tokens: T[]): T[] {
    let previous = this.lastKept;
    return tokens.filter((token) => {
      let kept = previous;
      if (!(continuesWord(token) && this.any)) {
        const level = this.measure(token);
        if (level !== null && token.is_final) {
          this.words.push(level);
          if (this.words.length > LEVEL_WORDS) this.words.shift();
        }
        kept = level === null || level >= percentile90(this.words) * QUIET_SHARE;
      }
      previous = kept;
      if (token.is_final) {
        this.lastKept = kept;
        this.any = true;
      }
      return kept;
    });
  }
}

/** A whole recording's words (Replay's part), its quiet ones dropped against its own speech level. */
export function dropQuietWords<T extends TimedToken>(words: T[], samples: Float32Array, sampleRate: number): T[] {
  const loudness = new Loudness(Infinity);
  loudness.addSamples(samples, sampleRate);
  const levels = words.map((word, i) => (i === 0 || !continuesWord(word) ? loudness.measure(word) : undefined));
  const speech = percentile90(levels.filter((level): level is number => typeof level === "number"));
  let previous = true;
  return words.filter((_, i) => {
    const level = levels[i];
    if (level !== undefined) previous = level === null || level >= speech * QUIET_SHARE;
    return previous;
  });
}
