/**
 * The voice behind each message: the exact audio sent to Soniox (16 kHz, mono, 16-bit PCM).
 * Every recording into a message is its own clip ("Keep dictating" adds the next one), kept
 * in userData/audio/<message id>.<clip number>.pcm. Clips are served to the page as WAV
 * files, from fd-audio://audio/<message id>/<clip number> (see main.cjs).
 */
const { app } = require("electron");
const fs = require("fs");
const path = require("path");

const SAMPLE_RATE = 16000;
const ID = /^[\w-]{1,64}$/; // message ids hold no dots, so "<id>.<clip>.pcm" splits cleanly

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

/** The clip numbers a message has, in recording order. */
function clipsOf(id) {
  if (typeof id !== "string" || !ID.test(id)) return [];
  const prefix = `${id}.`;
  return names()
    .filter((name) => name.startsWith(prefix) && /^\d+\.pcm$/.test(name.slice(prefix.length)))
    .map((name) => Number(name.slice(prefix.length, -4)))
    .sort((a, b) => a - b);
}

/** How many clips a message has. */
function count(id) {
  return clipsOf(id).length;
}

/** Save one recording as the message's next clip. */
function addClip(id, pcm) {
  if (typeof id !== "string" || !ID.test(id) || !pcm || !pcm.byteLength) return false;
  const existing = clipsOf(id);
  const next = existing.length ? existing[existing.length - 1] + 1 : 0;
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(path.join(dir(), `${id}.${next}.pcm`), Buffer.from(pcm));
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

/** A message's clip (its position among the message's clips) as WAV bytes, or null. */
function get(id, index) {
  const clip = clipsOf(id)[index];
  if (clip === undefined) return null;
  return new Uint8Array(wav(fs.readFileSync(path.join(dir(), `${id}.${clip}.pcm`))));
}

/** Delete every clip of these messages. */
function remove(ids) {
  const gone = new Set(ids);
  for (const name of names()) {
    if (!name.endsWith(".pcm") || !gone.has(name.split(".")[0])) continue;
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
    if (!name.endsWith(".pcm") || keep.has(name.split(".")[0])) continue;
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
  return new Uint8Array(wav(pcm));
}

module.exports = { addClip, count, get, remove, prune, sample };
