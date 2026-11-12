/**
 * Hesitations are left out of what is written: آه، أمم، ممم, um, uh, hmm, äh, ähm. Soniox writes
 * them as words (with a comma after, "آه،") and has no option to leave them out.
 *
 * Soniox's tokens are pieces of words; a token starting with a space starts a word, and
 * punctuation sticks to the word before it. A word is known to be whole once the next one
 * starts (or Soniox marks an endpoint, or the stream ends), so the last settled word is held
 * back until then: shown with the words still being decided on, not lost.
 */

/** The hesitation sounds, as Soniox spells them in Arabic, English and German. */
const FILLER = /^(?:[آاأإ]+ه+|[اأإ]?مم+|u+m+|u+h+m*|h+m+|e+r+m+|ä+h+m*|ö+h+m*)$/iu;
const PUNCTUATION = /[\s،؛؟,.?!…:;"'«»()-]+/gu;

export function isFiller(word: string): boolean {
  const bare = word.replace(PUNCTUATION, "");
  return bare.length > 0 && FILLER.test(bare);
}

/** Soniox's markers: an endpoint, or the end of a finalize. */
const isMarker = (text: string) => text === "<end>" || text === "<fin>";

type Piece = { text: string; speaker?: string; start_ms?: number; end_ms?: number };

/** The pieces of one word follow each other at once; a gap between them is a new word. */
const GAP_MS = 500;

/** Does `next` start a word of its own after `last`? */
function startsWord(last: Piece, next: Piece): boolean {
  if (/^\s/u.test(next.text) || isMarker(next.text) || isMarker(last.text)) return true;
  if (next.speaker !== last.speaker) return true;
  return last.end_ms !== undefined && next.start_ms !== undefined && next.start_ms - last.end_ms >= GAP_MS;
}

/** Tokens in words, each word with the punctuation after it. */
function words<T extends Piece>(tokens: T[]): T[][] {
  const out: T[][] = [];
  for (const token of tokens) {
    const last = out.at(-1);
    if (last && !startsWord(last.at(-1)!, token)) last.push(token);
    else out.push([token]);
  }
  return out;
}

const spoken = <T extends Piece>(word: T[]) => isMarker(word[0]!.text) || !isFiller(word.map((t) => t.text).join(""));

/** Words still being decided on, without the hesitations among them. */
export function withoutFillers<T extends Piece>(tokens: T[]): T[] {
  return words(tokens).filter(spoken).flat();
}

/** Settled tokens, given as they come, given back without hesitations (see above). */
export class FillerFilter<T extends Piece> {
  private held: T[] = [];

  /**
   * The settled tokens now known not to be a hesitation, in order. `next`, the words still
   * being decided on, may show the last settled word is whole (they start a word of their own).
   */
  push(tokens: T[], next: T[] = []): T[] {
    const all = words([...this.held, ...tokens]);
    const last = all.at(-1);
    // The last word may go on in the next tokens (a marker never does).
    this.held = last && !isMarker(last[0]!.text) ? all.pop()! : [];
    if (this.held.length && next[0] && startsWord(this.held.at(-1)!, next[0])) all.push(this.held.splice(0));
    return all.filter(spoken).flat();
  }

  /** The settled word held back, shown meanwhile with the words still being decided on. */
  holding(): T[] {
    return this.held.length && spoken(this.held) ? this.held : [];
  }

  /** The stream ended: the word held back is whole. */
  flush(): T[] {
    const last = this.held;
    this.held = [];
    return last.length && spoken(last) ? last : [];
  }
}
