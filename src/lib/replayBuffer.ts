/**
 * Replay's recording: while it is on, your microphone and the computer's audio are recorded all
 * the time, each in pieces of half a minute (Opus in WebM, as the messages' clips), handed to
 * the main process, which keeps the last few minutes to an hour of them (electron/replay.cjs).
 * Each piece carries its loudness every quarter second, which the timeline draws.
 */
import { type AudioSource, openSource } from "./soniox";

const SEGMENT_MS = 30_000;
const LEVEL_MS = 250;
const MIME_TYPE = "audio/webm;codecs=opus";
const BITS_PER_SECOND = 128_000;

interface Piece {
  recorder: MediaRecorder;
  chunks: Blob[];
  start: number;
  levels: number[];
}

/** One source, recorded piece after piece. */
class Tape {
  private context = new AudioContext();
  private analyser = this.context.createAnalyser();
  private samples = new Float32Array(2048);
  private piece: Piece | null = null;
  private timers: number[] = [];
  private saving = new Set<Promise<void>>();

  constructor(
    private source: AudioSource,
    private stream: MediaStream,
  ) {
    this.analyser.fftSize = this.samples.length;
    this.context.createMediaStreamSource(stream).connect(this.analyser);
    this.piece = this.begin();
    this.timers.push(window.setInterval(() => this.measure(), LEVEL_MS));
    this.timers.push(window.setInterval(() => void this.rotate(), SEGMENT_MS));
  }

  private begin(): Piece {
    const recorder = new MediaRecorder(this.stream, { mimeType: MIME_TYPE, audioBitsPerSecond: BITS_PER_SECOND });
    const piece: Piece = { recorder, chunks: [], start: Date.now(), levels: [] };
    recorder.ondataavailable = (event) => {
      if (event.data.size) piece.chunks.push(event.data);
    };
    recorder.start();
    return piece;
  }

  private measure() {
    if (!this.piece) return;
    this.analyser.getFloatTimeDomainData(this.samples);
    let energy = 0;
    for (const sample of this.samples) energy += sample * sample;
    this.piece.levels.push(Math.round(Math.sqrt(energy / this.samples.length) * 1000) / 1000);
  }

  /** The next piece starts before this one stops, so nothing is missed in between. */
  rotate(): Promise<void> {
    const done = this.piece;
    if (!done) return Promise.resolve();
    this.piece = this.begin();
    return this.save(done);
  }

  private save(piece: Piece): Promise<void> {
    const saved = new Promise<void>((resolve) => {
      piece.recorder.onstop = async () => {
        try {
          const webm = await new Blob(piece.chunks, { type: MIME_TYPE }).arrayBuffer();
          await window.api.addReplaySegment({ source: this.source, start: piece.start, end: Date.now(), webm, levels: piece.levels });
        } finally {
          resolve();
        }
      };
      piece.recorder.stop();
    });
    this.saving.add(saved);
    void saved.then(() => this.saving.delete(saved));
    return saved;
  }

  /** Everything up to now kept (the piece being recorded is ended and a new one begun). */
  async flush() {
    await this.rotate();
    await Promise.all(this.saving);
  }

  stop() {
    for (const timer of this.timers) clearInterval(timer);
    const last = this.piece;
    this.piece = null;
    if (last) void this.save(last);
    for (const track of this.stream.getTracks()) track.stop();
    void this.context.close();
  }
}

export class ReplayBuffer {
  private constructor(private tapes: Tape[]) {}

  /** Start recording both sources (either alone, if the other cannot be opened). */
  static async start(deviceId?: string): Promise<ReplayBuffer> {
    const sources: AudioSource[] = ["mic", "computer"];
    const streams = await Promise.allSettled(sources.map((source) => openSource(source, deviceId)));
    const tapes = streams.flatMap((result, i) => (result.status === "fulfilled" ? [new Tape(sources[i]!, result.value)] : []));
    if (tapes.length === 0) throw new Error("Replay could not open the microphone or the computer's audio.");
    return new ReplayBuffer(tapes);
  }

  /** Make everything recorded until now available to play and transcribe. */
  flush(): Promise<void> {
    return Promise.all(this.tapes.map((tape) => tape.flush())).then(() => {});
  }

  stop() {
    for (const tape of this.tapes) tape.stop();
  }
}
