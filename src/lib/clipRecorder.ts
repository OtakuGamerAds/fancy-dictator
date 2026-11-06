/**
 * The voice kept with a message: one clip per recording, at the sound card's own rate (48 kHz)
 * in Opus (WebM), about 1 MB a minute. It is recorded beside the 16 kHz audio sent to Soniox,
 * not from it, so it sounds as recorded. Every source the recording listens to (your
 * microphone, the computer's audio) plays into the one clip, each at the moment it was heard.
 */
import fixWebmDuration from "fix-webm-duration";

const MIME_TYPE = "audio/webm;codecs=opus";
const BITS_PER_SECOND = 128_000;

export class ClipRecorder {
  private context = new AudioContext();
  private destination = this.context.createMediaStreamDestination();
  private recorder = new MediaRecorder(this.destination.stream, {
    mimeType: MIME_TYPE,
    audioBitsPerSecond: BITS_PER_SECOND,
  });
  private chunks: Blob[] = [];
  private startedAt = performance.now();
  private heard = false;
  private result: Promise<ArrayBuffer | null> | null = null;

  constructor() {
    this.recorder.ondataavailable = (event) => {
      if (event.data.size) this.chunks.push(event.data);
    };
    this.recorder.start(1000);
  }

  /** A source the recording listens to from now on (until its tracks stop). */
  add(stream: MediaStream) {
    if (this.result) return;
    this.heard = true;
    this.context.createMediaStreamSource(stream).connect(this.destination);
  }

  /** Finish the clip: its WebM bytes (with their duration, so it can be seeked), or null. */
  stop(): Promise<ArrayBuffer | null> {
    this.result ??= (async () => {
      const durationMs = performance.now() - this.startedAt;
      if (this.recorder.state !== "inactive") {
        await new Promise<void>((resolve) => {
          this.recorder.onstop = () => resolve();
          this.recorder.stop();
        });
      }
      void this.context.close();
      if (!this.heard || this.chunks.length === 0) return null;
      const blob = await fixWebmDuration(new Blob(this.chunks, { type: MIME_TYPE }), durationMs, { logger: false });
      return blob.arrayBuffer();
    })();
    return this.result;
  }

  /** Drop the clip. */
  cancel() {
    this.chunks = [];
    this.heard = false;
    void this.stop();
  }
}
