/**
 * The voice behind each message. Every recording into a message is its own clip ("Keep
 * dictating" adds the next one), kept in userData/audio/<message id>.<clip number>.webm: Opus
 * at 48 kHz, recorded beside what is sent to Soniox (src/lib/clipRecorder.ts). Clips saved by
 * 0.1.12 and before are .pcm, the 16 kHz audio sent to Soniox, and are served as WAV. Clips
 * play from fd-audio://audio/<message id>/<clip number> (see main.cjs).
 */
const { app } = require("electron");
const fs = require("fs");
const path = require("path");

const SAMPLE_RATE = 16000;
const ID = /^[\w-]{1,64}$/; // message ids hold no dots, so "<id>.<clip>.webm" splits cleanly
const CLIP = /^(\d+)\.(pcm|webm)$/;
/** WebM files start with the EBML magic number. */
const isWebm = (bytes) => bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;

function dir() {
  return path.join(app.getPath("userData"), "audio");
}

function names() {
  try {
    return fs.readdirSync(dir());
  } catch {
    return [];
  }
}

/** A message's clips, in recording order: their number and file name. */
function clipsOf(id) {
  if (typeof id !== "string" || !ID.test(id)) return [];
  const prefix = `${id}.`;
  return names()
    .filter((name) => name.startsWith(prefix) && CLIP.test(name.slice(prefix.length)))
    .map((name) => ({ number: Number(CLIP.exec(name.slice(prefix.length))[1]), name }))
    .sort((a, b) => a.number - b.number);
}

/** How many clips a message has. */
function count(id) {
  return clipsOf(id).length;
}

/** Save one recording (WebM bytes) as the message's next clip. */
function addClip(id, data) {
  if (typeof id !== "string" || !ID.test(id) || !data || !data.byteLength) return false;
  const bytes = Buffer.from(data);
  if (!isWebm(bytes)) return false;
  const existing = clipsOf(id);
  const next = existing.length ? existing[existing.length - 1].number + 1 : 0;
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(path.join(dir(), `${id}.${next}.webm`), bytes);
  return true;
}

/** 16-bit PCM samples wrapped in a WAV header, so the page's <audio> can play and seek it. */
function wav(pcm) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28); // bytes per second
  header.writeUInt16LE(2, 32); // bytes per sample
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** A message's clip (its position among the message's clips): its bytes and type, or null. */
function get(id, index) {
  const clip = clipsOf(id)[index];
  if (clip === undefined) return null;
  const bytes = fs.readFileSync(path.join(dir(), clip.name));
  return clip.name.endsWith(".webm")
    ? { bytes: new Uint8Array(bytes), type: "audio/webm" }
    : { bytes: new Uint8Array(wav(bytes)), type: "audio/wav" };
}

/** Delete every clip of these messages. */
function remove(ids) {
  const gone = new Set(ids);
  for (const name of names()) {
    if (!CLIP.test(name.slice(name.indexOf(".") + 1)) || !gone.has(name.split(".")[0])) continue;
    try {
      fs.unlinkSync(path.join(dir(), name));
    } catch {}
  }
}

/**
 * Delete the audio of every message not in `keepIds`. Run at startup, to catch what was
 * left behind (say, the app quit while a deleted message could still be undone).
 */
function prune(keepIds) {
  const keep = new Set(keepIds);
  for (const name of names()) {
    if (!CLIP.test(name.slice(name.indexOf(".") + 1)) || keep.has(name.split(".")[0])) continue;
    try {
      fs.unlinkSync(path.join(dir(), name));
    } catch {}
  }
}

/** A few seconds of a soft, speech-like tone, for `pnpm snapshot`. */
function sample(seconds = 7) {
  const total = SAMPLE_RATE * seconds;
  const pcm = Buffer.alloc(total * 2);
  for (let i = 0; i < total; i++) {
    const t = i / SAMPLE_RATE;
    const envelope = 0.5 + 0.5 * Math.sin(2 * Math.PI * 3 * t);
    pcm.writeInt16LE(Math.round(4000 * envelope * Math.sin(2 * Math.PI * 220 * t)), i * 2);
  }
  return { bytes: new Uint8Array(wav(pcm)), type: "audio/wav" };
}

module.exports = { addClip, count, get, remove, prune, sample };
