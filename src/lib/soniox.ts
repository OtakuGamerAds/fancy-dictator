/**
 * Live dictation with Soniox's real-time WebSocket API.
 *
 * Microphone → AudioWorklet (16 kHz mono, 16-bit PCM, 100 ms chunks) → Soniox.
 * Soniox answers with tokens: final tokens never change and are appended; non-final
 * tokens are the words it is still deciding on and are replaced by every message.
 * Endpoint and model settings follow the live-caption-sermons project.
 */

const WS_URL = "wss://stt-rt.soniox.com/transcribe-websocket";
// stt-rt-v6: stronger language switching within a sentence than v5, which Soniox retires on
// 2026-12-15 (fully compatible; only the model name changes).
export const SONIOX_MODEL = "stt-rt-v6";
const SAMPLE_RATE = 16000;

const WORKLET_SOURCE = `
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 1600; // 100 ms at 16 kHz
    this.reset();
    this.port.onmessage = (event) => {
      if (event.data === "flush") this.emit();
    };
  }
  reset() {
    this.buffer = new Int16Array(this.size);
    this.count = 0;
    this.energy = 0;
  }
  emit() {
    if (this.count > 0) {
      const pcm = this.buffer.slice(0, this.count).buffer;
      this.port.postMessage({ pcm, level: Math.sqrt(this.energy / this.count) }, [pcm]);
    }
    this.reset();
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        const s = Math.max(-1, Math.min(1, channel[i]));
        this.buffer[this.count++] = s < 0 ? s * 0x8000 : s * 0x7fff;
        this.energy += s * s;
        if (this.count === this.size) this.emit();
      }
    }
    return true;
  }
}
registerProcessor("pcm-capture", PcmCapture);
`;

export interface SonioxSession {
  /** Stop listening, wait for Soniox to finalize the last words, and return the full text. */
  stop(): Promise<string>;
  /** Drop everything immediately. */
  cancel(): void;
}

export interface StartOptions {
  apiKey: string;
  /** The Soniox model id (defaults to SONIOX_MODEL). */
  model?: string;
  languageHints: string[];
  deviceId?: string;
  onText(finalText: string, pendingText: string): void;
  onLevel?(level: number): void;
  /** Every chunk of audio sent to Soniox (16 kHz, mono, 16-bit PCM), to keep with the message. */
  onAudio?(pcm: ArrayBuffer): void;
  onError(message: string): void;
}

async function openMicrophone(deviceId?: string): Promise<MediaStream> {
  const base = { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  if (deviceId) {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: { ...base, deviceId: { exact: deviceId } } });
    } catch (error) {
      // The saved microphone was unplugged: fall back to the system default.
      if (!(error instanceof DOMException) || error.name !== "OverconstrainedError") throw error;
    }
  }
  return navigator.mediaDevices.getUserMedia({ audio: base });
}

export function describeStartError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") return "Microphone access is blocked. Allow it in Windows Settings → Privacy → Microphone.";
    if (error.name === "NotFoundError") return "No microphone found.";
    if (error.name === "NotReadableError") return "The microphone is being used by another app.";
  }
  return error instanceof Error ? error.message : "Could not start recording.";
}

export async function startSoniox(options: StartOptions): Promise<SonioxSession> {
  const stream = await openMicrophone(options.deviceId);
  const context = new AudioContext({ sampleRate: SAMPLE_RATE });
  const moduleUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "application/javascript" }));
  try {
    await context.audioWorklet.addModule(moduleUrl);
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }
  const source = context.createMediaStreamSource(stream);
  const capture = new AudioWorkletNode(context, "pcm-capture");
  // Keep the node pulled by the graph without playing anything.
  const mute = context.createGain();
  mute.gain.value = 0;
  source.connect(capture);
  capture.connect(mute);
  mute.connect(context.destination);

  let finalText = "";
  let pendingText = "";
  let ended = false;
  let failed = false;
  let audioClosed = false;
  let resolveFinished: () => void = () => {};
  const finished = new Promise<void>((resolve) => (resolveFinished = resolve));

  // Audio recorded before the socket opens is queued, not lost. "" means end of audio.
  const queue: (ArrayBuffer | string)[] = [];
  const ws = new WebSocket(WS_URL);

  const sendOrQueue = (data: ArrayBuffer | string) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
    else if (ws.readyState === WebSocket.CONNECTING) queue.push(data);
  };

  const fail = (message: string) => {
    if (failed || ended) return;
    failed = true;
    options.onError(message);
    resolveFinished();
  };

  ws.onopen = () => {
    ws.send(
      JSON.stringify({
        api_key: options.apiKey,
        model: options.model || SONIOX_MODEL,
        audio_format: "pcm_s16le",
        sample_rate: SAMPLE_RATE,
        num_channels: 1,
        ...(options.languageHints.length ? { language_hints: options.languageHints } : {}),
        enable_endpoint_detection: true,
        // Follow switches between languages (e.g. Arabic, then German) sentence by sentence.
        // The languages picked in the composer are the main lever: hints bias recognition
        // toward them, so a language that is spoken should be among them (or none: auto).
        enable_language_identification: true,
      }),
    );
    for (const data of queue.splice(0)) ws.send(data);
  };

  ws.onmessage = (event) => {
    let message: {
      tokens?: { text?: string; is_final?: boolean }[];
      finished?: boolean;
      error_code?: number;
      error_message?: string;
    };
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (message.error_code) {
      fail(`Soniox error ${message.error_code}: ${message.error_message ?? "unknown error"}`);
      return;
    }
    if (Array.isArray(message.tokens)) {
      let nextPending = "";
      for (const token of message.tokens) {
        if (typeof token?.text !== "string") continue;
        if (token.text === "<end>" || token.text === "<fin>") continue;
        if (token.is_final) finalText += token.text;
        else nextPending += token.text;
      }
      pendingText = nextPending;
      options.onText(finalText, pendingText);
    }
    if (message.finished) resolveFinished();
  };

  ws.onerror = () => fail("Could not connect to Soniox. Check your internet connection.");
  ws.onclose = (event) => {
    if (!ended && event.code !== 1000) fail(`Soniox closed the connection (${event.code}).`);
    resolveFinished();
  };

  capture.port.onmessage = (event: MessageEvent<{ pcm: ArrayBuffer; level: number }>) => {
    options.onLevel?.(event.data.level);
    if (ended) return;
    options.onAudio?.(event.data.pcm);
    sendOrQueue(event.data.pcm);
  };

  const closeAudio = () => {
    if (audioClosed) return;
    audioClosed = true;
    capture.port.onmessage = null;
    source.disconnect();
    capture.disconnect();
    mute.disconnect();
    for (const track of stream.getTracks()) track.stop();
    void context.close();
  };

  return {
    async stop() {
      if (ended) return (finalText + pendingText).trim();
      // Send whatever is still sitting in the worklet's buffer, then end the audio.
      await new Promise<void>((resolve) => {
        const onFlush = (event: MessageEvent<{ pcm: ArrayBuffer }>) => {
          options.onAudio?.(event.data.pcm);
          sendOrQueue(event.data.pcm);
          resolve();
        };
        capture.port.onmessage = onFlush;
        capture.port.postMessage("flush");
        setTimeout(resolve, 150);
      });
      ended = true;
      closeAudio();
      sendOrQueue("");
      await Promise.race([finished, new Promise((r) => setTimeout(r, 5000))]);
      try {
        ws.close(1000);
      } catch {}
      return (finalText + pendingText).trim();
    },
    cancel() {
      ended = true;
      closeAudio();
      try {
        ws.close(1000);
      } catch {}
      resolveFinished();
    },
  };
}
