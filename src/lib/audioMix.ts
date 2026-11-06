/** The audio one stream sent to Soniox (16 kHz, mono, 16-bit PCM) and when it began. */
export interface AudioTrack {
  /** performance.now() at the track's first sample (null until audio arrives). */
  at: number | null;
  chunks: ArrayBuffer[];
}

const SAMPLE_RATE = 16000;

function concat(chunks: ArrayBuffer[]): Int16Array {
  const out = new Int16Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength / 2, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(new Int16Array(chunk), offset);
    offset += chunk.byteLength / 2;
  }
  return out;
}

/**
 * One recording's audio as a single clip. In conversation mode both sides were recorded
 * side by side; they are laid over each other at the time each began, so it plays back like
 * the call did.
 */
export function mixTracks(tracks: AudioTrack[]): ArrayBuffer | null {
  const recorded = tracks.filter((track) => track.at !== null && track.chunks.length > 0);
  if (recorded.length === 0) return null;
  const origin = Math.min(...recorded.map((track) => track.at!));
  const placed = recorded.map((track) => ({
    samples: concat(track.chunks),
    offset: Math.max(0, Math.round(((track.at! - origin) * SAMPLE_RATE) / 1000)),
  }));
  if (placed.length === 1) return placed[0]!.samples.buffer as ArrayBuffer;
  const sum = new Int32Array(Math.max(...placed.map(({ samples, offset }) => offset + samples.length)));
  for (const { samples, offset } of placed) {
    for (let i = 0; i < samples.length; i++) sum[offset + i]! += samples[i]!;
  }
  const mix = new Int16Array(sum.length);
  for (let i = 0; i < sum.length; i++) mix[i] = Math.max(-32768, Math.min(32767, sum[i]!));
  return mix.buffer;
}
