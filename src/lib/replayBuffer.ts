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
const RETRY_MS = 3000;
const SOURCES: AudioSource[] = ["mic", "computer"];

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
    onLost: () => void,
  ) {
    // Unplugged: the tape is over, and another takes its place.
    for (const track of stream.getAudioTracks()) track.addEventListener("ended", onLost, { once: true });
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
  private tapes = new Map<AudioSource, Tape>();
  private opening = new Set<AudioSource>();
  private retries = new Map<AudioSource, number>();
  private changeTimer = 0;
  private stopped = false;

  private constructor(private deviceId?: string) {
    navigator.mediaDevices.addEventListener("devicechange", this.onDeviceChange);
  }

  /**
   * Start recording both sources. One that cannot be opened (no microphone plugged in) is
   * tried again until it can.
   */
  static async start(deviceId?: string): Promise<ReplayBuffer> {
    const buffer = new ReplayBuffer(deviceId);
    await Promise.all(SOURCES.map((source) => buffer.open(source)));
    return buffer;
  }

  /**
   * (Re)open a source. A new tape starts before the old one stops, so a microphone plugged back
   * in (or a new default one) takes over without a gap.
   */
  private async open(source: AudioSource) {
    if (this.stopped || this.opening.has(source)) return;
    this.opening.add(source);
    clearTimeout(this.retries.get(source));
    try {
      const stream = await openSource(source, this.deviceId);
      if (this.stopped) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      const tape: Tape = new Tape(source, stream, () => {
        if (this.tapes.get(source) !== tape) return;
        this.tapes.delete(source);
        tape.stop();
        void this.open(source);
      });
      this.tapes.get(source)?.stop();
      this.tapes.set(source, tape);
    } catch {
      // Not there (yet): try again in a moment, or as soon as a device is plugged in.
      this.retries.set(source, window.setTimeout(() => void this.open(source), RETRY_MS));
    } finally {
      this.opening.delete(source);
    }
  }

  /** A device plugged in or out: the microphone follows (the computer's audio only if it was lost). */
  private onDeviceChange = () => {
    clearTimeout(this.changeTimer);
    this.changeTimer = window.setTimeout(() => {
      for (const source of SOURCES) if (source === "mic" || !this.tapes.has(source)) void this.open(source);
    }, 600);
  };

  /** Make everything recorded until now available to play and transcribe. */
  flush(): Promise<void> {
    return Promise.all([...this.tapes.values()].map((tape) => tape.flush())).then(() => {});
  }

  stop() {
    this.stopped = true;
    navigator.mediaDevices.removeEventListener("devicechange", this.onDeviceChange);
    clearTimeout(this.changeTimer);
    for (const timer of this.retries.values()) clearTimeout(timer);
    for (const tape of this.tapes.values()) tape.stop();
    this.tapes.clear();
  }
}
