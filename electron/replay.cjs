/**
 * Replay: while it is on, the page records your microphone and the computer's audio all the
 * time, in pieces of about half a minute (src/lib/replayBuffer.ts), and they are kept here, in
 * userData/replay/<source>.<start ms>.<end ms>.webm, for as long as Settings says (5 minutes to
 * an hour); older pieces are deleted as new ones come. Nothing leaves the device until a part
 * of it is transcribed. The pieces do not outlive the app: they are cleared when it starts.
 */
const { app } = require("electron");
const fs = require("fs");
const path = require("path");

const SOURCES = ["mic", "computer"];
const NAME = /^(mic|computer)\.(\d+)\.(\d+)\.webm$/;

/** The pieces kept, oldest first, each with its loudness every quarter second (for the timeline). */
let segments = []; // { source, start, end, file, levels }

function dir() {
  return path.join(app.getPath("userData"), "replay");
}

function removeFile(file) {
  try {
    fs.unlinkSync(path.join(dir(), file));
  } catch {}
}

/** Keep one piece; drop the ones older than `keepMs` from now. */
function addSegment({ source, start, end, webm, levels }, keepMs) {
  if (!SOURCES.includes(source) || !Number.isFinite(start) || !Number.isFinite(end) || !webm?.byteLength) return;
  const file = `${source}.${Math.round(start)}.${Math.round(end)}.webm`;
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(path.join(dir(), file), Buffer.from(webm));
  segments.push({ source, start, end, file, levels: Array.isArray(levels) ? levels.map(Number) : [] });
  prune(keepMs);
}

function prune(keepMs) {
  const cutoff = Date.now() - keepMs;
  const [old, kept] = [segments.filter((s) => s.end < cutoff), segments.filter((s) => s.end >= cutoff)];
  for (const segment of old) removeFile(segment.file);
  segments = kept;
}

/** What is kept now, for the timeline and for playing or transcribing a part of it. */
function list() {
  return segments.map(({ source, start, end, file, levels }) => ({ source, start, end, file, levels }));
}

/** A piece's bytes, to play or cut. */
function read(file) {
  if (typeof file !== "string" || !NAME.test(file) || !segments.some((s) => s.file === file)) return null;
  try {
    return new Uint8Array(fs.readFileSync(path.join(dir(), file)));
  } catch {
    return null;
  }
}

/** Forget everything (Replay turned off, or the app starting). */
function clear() {
  segments = [];
  try {
    for (const name of fs.readdirSync(dir())) if (NAME.test(name)) removeFile(name);
  } catch {}
}

module.exports = { addSegment, prune, list, read, clear };
