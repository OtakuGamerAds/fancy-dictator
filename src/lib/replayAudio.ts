/**
 * Playing and cutting Replay's recording. It is kept as half-minute pieces per source
 * (src/lib/replayBuffer.ts); a part of it is played by scheduling the pieces it spans on the
 * Web Audio clock, and cut out as one WebM clip per source by encoding the pieces one after
 * another (with silence where nothing was recorded), never the whole hour in memory at once.
 */
import { AudioBufferSource, BufferTarget, Output, QUALITY_HIGH, WebMOutputFormat } from "mediabunny";

import type { ReplaySegment } from "./types";

const SAMPLE_RATE = 48_000;

async function decode(context: BaseAudioContext, segment: ReplaySegment): Promise<AudioBuffer> {
  const bytes = await window.api.readReplay(segment.file);
  if (!bytes) throw new Error("A part of Replay's recording is gone.");
  return context.decodeAudioData(bytes.slice().buffer);
}

const overlapping = (segments: ReplaySegment[], from: number, to: number) =>
  segments.filter((s) => s.end > from && s.start < to).sort((a, b) => a.start - b.start);

/** One channel: the channels averaged. */
function mono(buffer: AudioBuffer, from: number, to: number): Float32Array {
  const out = new Float32Array(Math.max(0, to - from));
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i]! += data[from + i]! / buffer.numberOfChannels;
  }
  return out;
}

/** A clip's sound, as one channel at 16 kHz (enough to tell how loud its words were). */
export async function clipSamples(webm: ArrayBuffer): Promise<{ samples: Float32Array; sampleRate: number }> {
  const sampleRate = 16_000;
  const buffer = await new OfflineAudioContext(1, 1, sampleRate).decodeAudioData(webm.slice(0));
  return { samples: mono(buffer, 0, buffer.length), sampleRate };
}

/**
 * One source's recording from `from` to `to` (ms since 1970), as a WebM (Opus) clip: what is
 * kept with the session, and what Soniox transcribes. Null when nothing was recorded then.
 */
export async function cutClip(segments: ReplaySegment[], from: number, to: number): Promise<ArrayBuffer | null> {
  const pieces = overlapping(segments, from, to);
  if (pieces.length === 0) return null;
  const decoder = new OfflineAudioContext(1, 1, SAMPLE_RATE);
  const output = new Output({ format: new WebMOutputFormat(), target: new BufferTarget() });
  const source = new AudioBufferSource({ codec: "opus", quality: QUALITY_HIGH });
  output.addAudioTrack(source);
  await output.start();
  const add = (samples: Float32Array) => {
    const buffer = new AudioBuffer({ numberOfChannels: 1, length: Math.max(1, samples.length), sampleRate: SAMPLE_RATE });
    buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
    return source.add(buffer);
  };
  const toSamples = (ms: number) => Math.round((ms * SAMPLE_RATE) / 1000);
  let written = 0; // samples since `from`
  const total = toSamples(to - from);
  for (const piece of pieces) {
    const at = toSamples(piece.start - from); // where the piece starts, in samples since `from`
    // Nothing was recorded before this piece: silence, in seconds-long steps.
    while (written < Math.min(at, total)) {
      const step = Math.min(at, total) - written;
      const length = Math.min(step, SAMPLE_RATE);
      await add(new Float32Array(length));
      written += length;
    }
    if (written >= total) break;
    const buffer = await decode(decoder, piece);
    const start = written - at; // pieces overlap a little: skip what was already written
    const end = Math.min(buffer.length, total - at);
    if (end <= start) continue;
    await add(mono(buffer, start, end));
    written += end - start;
  }
  await output.finalize();
  return output.target.buffer;
}

/**
 * Plays the recording from a moment on, the chosen sources together, decoding the pieces just
 * ahead of what is heard.
 */
export class ReplayPlayer {
  private context = new AudioContext();
  private nodes: AudioBufferSourceNode[] = [];
  private scheduled = new Set<string>();
  private timer = 0;
  private frame = 0;
  private origin = { at: 0, ms: 0 }; // the clock time `at` plays the moment `ms`

  playing = false;

  constructor(private onTime: (ms: number) => void) {}

  /** The moment being heard now. */
  get position(): number {
    return this.origin.ms + (this.context.currentTime - this.origin.at) * 1000;
  }

  play(segments: ReplaySegment[], from: number, until: number) {
    this.stop();
    this.playing = true;
    void this.context.resume();
    this.origin = { at: this.context.currentTime + 0.15, ms: from };
    const fill = () => {
      const now = this.position;
      for (const piece of overlapping(segments, now, now + 15_000)) {
        if (this.scheduled.has(piece.file)) continue;
        this.scheduled.add(piece.file);
        void decode(this.context, piece).then((buffer) => {
          if (!this.playing) return;
          let when = this.origin.at + (piece.start - this.origin.ms) / 1000;
          let offset = 0;
          // Started before it (or decoded late): from the moment being heard.
          if (when < this.context.currentTime) {
            offset = this.context.currentTime - when;
            when = this.context.currentTime;
          }
          if (offset >= buffer.duration) return;
          const node = this.context.createBufferSource();
          node.buffer = buffer;
          node.connect(this.context.destination);
          node.start(when, offset, Math.max(0, (until - piece.start) / 1000 - offset));
          this.nodes.push(node);
        });
      }
    };
    fill();
    this.timer = window.setInterval(fill, 1000);
    const tick = () => {
      const now = this.position;
      this.onTime(Math.min(now, until));
      if (now >= until) return this.stop();
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  stop() {
    this.playing = false;
    clearInterval(this.timer);
    cancelAnimationFrame(this.frame);
    for (const node of this.nodes) {
      try {
        node.stop();
      } catch {}
    }
    this.nodes = [];
    this.scheduled.clear();
  }

  close() {
    this.stop();
    void this.context.close();
  }
}
