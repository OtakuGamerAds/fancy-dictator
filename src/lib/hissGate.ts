/**
 * The hiss gate: what is sent to Soniox is muted while nobody speaks, so the faint hiss, air and
 * murmur between words are never written as words.
 *
 * From livecall-caption-web-v2 (src/services/hissGate.js `createHissGate` and HISS_GATE, its
 * numbers kept): a video editor's "Remove Silence" preset (attack 1 ms, hold 100 ms, release
 * 500 ms, a full mute) with a threshold told by an energy VAD on the same sound 40 ms ahead:
 *
 *   · its detector: the mean square of the sound over the 10 ms before each 1 ms block;
 *   · "speech near": an energy VAD (25 ms windows every 10 ms, the 3-frame smoothed level's 3 s
 *     running minimum + 15 dB and over −72 dBFS, a 30 ms hangover), a speech frame whose window
 *     ends within the 40 ms after the block's start;
 *   · the threshold: −72 dBFS while speech is near (a soft word stays), else −55 dBFS, which the
 *     hiss alone does not reach;
 *   · a block over it opens the gate, held 100 ms after the last such block; it opens over 1 ms
 *     and closes over 500 ms (linear in amplitude) down to nothing.
 *
 * Here the sound is delayed by those 40 ms to look ahead (the original read a raw mic ahead of
 * the denoised sound it gated): the gate's output is that much behind its input, and `flush()`
 * gives its last 40 ms at the end.
 */

const HISS_GATE = {
  quietDb: -55,
  speechDb: -72,
  attackMs: 1,
  holdMs: 100,
  releaseMs: 500,
  blockMs: 1,
  detectorMs: 10,
  aheadMs: 40,
  vad: { frameMs: 10, windowMs: 25, deltaDb: 15, floorS: 3, absMinDb: -72, hang: 3 },
};

/** The gate at `rate` Hz, a sample at a time: `mic(x)` takes the sound `aheadMs` ahead of the sample `play(c)` gates. */
function createHissGate(rate: number) {
  const { quietDb, speechDb, attackMs, holdMs, releaseMs, blockMs, detectorMs, aheadMs, vad } = HISS_GATE;
  const B = Math.max(1, Math.round((rate * blockMs) / 1000)); // one block
  const W = Math.max(1, Math.round((rate * detectorMs) / 1000)); // the detector's window
  const LA = Math.round((rate * aheadMs) / 1000); // speech near: within this lead
  const thQuiet = 10 ** (quietDb / 10);
  const thSpeech = 10 ** (speechDb / 10);
  const holdBlocks = Math.round(holdMs / blockMs);
  const up = 1 / Math.max(1, (attackMs * rate) / 1000);
  const down = 1 / Math.max(1, (releaseMs * rate) / 1000);
  // The detector: the last W squares of what played, their sum (summed afresh at each turn of the ring: no drift).
  const ring = new Float64Array(W);
  let rp = 0;
  let sum = 0;
  let nIn = 0;
  // The VAD: frames of `windowMs` every `frameMs`, frame f's window [FR·f, FR·f + WIN) of the sound ahead.
  const FR = Math.round((rate * vad.frameMs) / 1000);
  const WIN = Math.round((rate * vad.windowMs) / 1000);
  const FLOOR = Math.round((vad.floorS * 1000) / vad.frameMs);
  const rawRing = new Float64Array(WIN);
  let rawN = 0;
  const en = [0, 0, 0]; // the last three frame levels (smoothing)
  let enN = 0;
  const smHist = new Float64Array(FLOOR);
  let smN = 0;
  let frame = 0;
  let lastSp = -1e9;
  const ends: number[] = []; // each speech frame's window end (samples)
  let target = false;
  let held = -1e9;
  let gain = 0;
  let block = 0;
  let posInBlock = 0;
  let played = 0;
  let thr = thQuiet;
  const frameSpeech = (e: number) => {
    en[enN % 3] = e;
    enN += 1;
    let s = 0;
    for (let q = 0; q < Math.min(enN, 3); q += 1) s += en[q]!;
    const sm = s / 3;
    smHist[smN % FLOOR] = sm;
    smN += 1;
    let fl = Infinity;
    for (let i = 0, k = Math.min(smN, FLOOR); i < k; i += 1) if (smHist[i]! < fl) fl = smHist[i]!;
    const sp = e > fl + vad.deltaDb && e > vad.absMinDb;
    const f = frame;
    frame += 1;
    if (sp) lastSp = f;
    return sp || f - lastSp <= vad.hang;
  };
  return {
    lead: LA,
    mic(x: number) {
      const r = x || 0;
      rawRing[rawN % WIN] = r * r;
      rawN += 1;
      if (rawN >= WIN && (rawN - WIN) % FR === 0) {
        let s2 = 0;
        for (let j = 0; j < WIN; j += 1) s2 += rawRing[j]!;
        if (frameSpeech(10 * Math.log10(s2 / WIN + 1e-14))) ends.push(rawN);
      }
    },
    play(c: number) {
      if (posInBlock === 0) {
        // A new block: its verdict from what played before it, and the VAD's word on the next `aheadMs`.
        while (ends.length && ends[0]! <= played) ends.shift();
        const near = ends.length > 0 && ends[0]! <= played + LA;
        thr = near ? thSpeech : thQuiet;
        const ms = nIn > 0 ? sum / Math.min(nIn, W) : 0;
        if (block > 0 && ms > thr) held = block;
        target = block - held <= holdBlocks;
        block += 1;
      }
      posInBlock = (posInBlock + 1) % B;
      gain = target ? Math.min(1, gain + up) : Math.max(0, gain - down);
      const v = c === c ? c || 0 : 0;
      const sq = v * v;
      sum += sq - ring[rp]!;
      ring[rp] = sq;
      rp += 1;
      if (rp === W) {
        rp = 0;
        sum = 0;
        for (let j = 0; j < W; j += 1) sum += ring[j]!;
      }
      nIn += 1;
      played += 1;
      return gain;
    },
  };
}

/** A stream gated as it comes, piece by piece: each piece out is the gated sound 40 ms behind. */
export function createStreamGate(rate: number) {
  const gate = createHissGate(rate);
  const delay = new Float32Array(gate.lead);
  let heard = 0;
  const step = (x: number) => {
    gate.mic(x);
    const slot = heard % delay.length;
    const out = delay[slot]!;
    delay[slot] = x;
    heard += 1;
    // The first `lead` samples only fill the delay: nothing to send for them yet.
    return heard > delay.length ? out * gate.play(out) : null;
  };
  return {
    /** Samples (-1 to 1) in; the gated ones out (fewer at first, while the delay fills). */
    process(samples: Float32Array): Float32Array {
      const out = new Float32Array(samples.length);
      let n = 0;
      for (const x of samples) {
        const y = step(x);
        if (y !== null) out[n++] = y;
      }
      return out.subarray(0, n);
    },
    /** The end: the last `lead` samples, gated as if silence followed. */
    flush(): Float32Array {
      const left = Math.min(heard, delay.length);
      return this.process(new Float32Array(left));
    },
  };
}
