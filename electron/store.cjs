/**
 * Settings and history, stored as JSON files in Electron's userData folder.
 * The Soniox API key is encrypted with the OS keychain (safeStorage) when available.
 */
const { app, safeStorage } = require("electron");
const fs = require("fs");
const path = require("path");

const DEFAULT_SETTINGS = {
  sonioxApiKey: "",
  // "latest" (the newest real-time model Soniox lists) or a specific model id.
  sonioxModel: "latest",
  hotkey: "Control+Alt+Space",
  micDeviceId: "",
  languages: ["ar", "en"],
  runOnStartup: false,
  // Replay: your mic and the computer's audio kept for this many minutes, to go back to.
  replay: false,
  replayMinutes: 60,
  // The language selected words are translated into.
  translateTo: "en",
  cardAnchor: null,
};

const MAX_HISTORY = 50;

function filePath(name) {
  return path.join(app.getPath("userData"), name);
}

function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath(name), "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(name, value) {
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  const target = filePath(name);
  const temp = `${target}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(temp, target);
}

function encrypt(secret) {
  if (!secret) return "";
  if (safeStorage.isEncryptionAvailable()) {
    return `enc:${safeStorage.encryptString(secret).toString("base64")}`;
  }
  return secret;
}

function decrypt(stored) {
  if (!stored) return "";
  if (!stored.startsWith("enc:")) return stored;
  try {
    return safeStorage.decryptString(Buffer.from(stored.slice(4), "base64"));
  } catch {
    return "";
  }
}

function getSettings() {
  const raw = { ...DEFAULT_SETTINGS, ...readJson("settings.json", {}) };
  // An organization key (for the balance) was kept before 0.1.16; it is no longer used.
  const { sonioxOrgKey: _unused, ...kept } = raw;
  // Replay was one number of minutes (0: off) before 0.1.16.
  const replay = typeof kept.replay === "boolean" ? kept.replay : Number(kept.replayMinutes) > 0;
  return { ...kept, replay, replayMinutes: Number(kept.replayMinutes) || 60, sonioxApiKey: decrypt(kept.sonioxApiKey) };
}

function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  writeJson("settings.json", {
    ...next,
    sonioxApiKey: encrypt(next.sonioxApiKey),
  });
  return next;
}

function getHistory() {
  const history = readJson("history.json", []);
  return Array.isArray(history) ? history : [];
}

/** The page sends entries back with their audio listed on them; that is worked out when read, not stored. */
function stored({ audioClips: _audioClips, audioParts: _audioParts, ...entry }) {
  return entry;
}

/** Add an entry at the top; an entry with the same id (a continued dictation) replaces it. */
function addHistory(entry) {
  const others = getHistory().filter((item) => item.id !== entry.id);
  const history = [stored(entry), ...others].slice(0, MAX_HISTORY);
  writeJson("history.json", history);
  return history;
}

/** Replace the whole list (deleting one entry, or undoing a delete). */
function replaceHistory(entries) {
  const history = (Array.isArray(entries) ? entries : []).slice(0, MAX_HISTORY).map(stored);
  writeJson("history.json", history);
  return history;
}

function clearHistory() {
  writeJson("history.json", []);
  return [];
}

module.exports = { getSettings, saveSettings, getHistory, addHistory, replaceHistory, clearHistory };
