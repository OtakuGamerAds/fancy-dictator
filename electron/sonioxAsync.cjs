/**
 * Transcribing a recording that already exists (Replay), with Soniox's async API: upload the
 * file, ask for a transcription (voices told apart), wait for it, read its words with their
 * times and speakers, then delete both from Soniox. Cheaper than real-time, and better at
 * telling voices apart, since the whole recording is heard at once.
 */
const API = "https://api.soniox.com/v1";
/** Used until the models have been listed once (or if they cannot be). */
const FALLBACK_MODEL = "stt-async-v4";
const POLL_MS = 1000;
const TIMEOUT_MS = 15 * 60 * 1000;

const versionOf = (id) => Number(id.match(/-v(\d+)/)?.[1] ?? 0);

async function call(apiKey, method, route, body) {
  const response = await fetch(`${API}${route}`, {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, ...(body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}) },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    let message = "";
    try {
      message = (await response.json())?.message ?? "";
    } catch {}
    throw new Error(response.status === 401 ? "Your Soniox API key was not accepted" : `Soniox: ${message || `error ${response.status}`}`);
  }
  return response.status === 204 ? null : response.json();
}

/** The newest async model Soniox lists (no previews or aliases). */
let model = null;
async function asyncModel(apiKey) {
  if (model) return model;
  try {
    const body = await call(apiKey, "GET", "/models");
    const ids = (body?.models ?? [])
      .filter((m) => m?.transcription_mode === "async" && !m.aliased_model_id && !/preview/i.test(m.id))
      .map((m) => String(m.id))
      .sort((a, b) => versionOf(b) - versionOf(a));
    model = ids[0] ?? FALLBACK_MODEL;
  } catch {
    return FALLBACK_MODEL;
  }
  return model;
}

/**
 * The words of a WebM recording: [{ text, start_ms, end_ms, speaker }]. `languageHints` as
 * in the composer.
 */
async function transcribe(apiKey, webm, languageHints) {
  if (!apiKey) throw new Error("Add your Soniox API key first");
  const form = new FormData();
  form.append("file", new Blob([Buffer.from(webm)], { type: "audio/webm" }), "replay.webm");
  const file = await call(apiKey, "POST", "/files", form);
  let transcription = null;
  try {
    transcription = await call(apiKey, "POST", "/transcriptions", {
      model: await asyncModel(apiKey),
      file_id: file.id,
      ...(languageHints?.length ? { language_hints: languageHints } : {}),
      enable_language_identification: true,
      enable_speaker_diarization: true,
    });
    const started = Date.now();
    while (transcription.status !== "completed") {
      if (transcription.status === "error") throw new Error(`Soniox: ${transcription.error_message || "the transcription failed"}`);
      if (Date.now() - started > TIMEOUT_MS) throw new Error("Soniox took too long");
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      transcription = await call(apiKey, "GET", `/transcriptions/${transcription.id}`);
    }
    const transcript = await call(apiKey, "GET", `/transcriptions/${transcription.id}/transcript`);
    return (transcript?.tokens ?? []).map((token) => ({
      text: String(token.text ?? ""),
      start_ms: Number(token.start_ms ?? 0),
      end_ms: Number(token.end_ms ?? 0),
      ...(token.speaker != null ? { speaker: String(token.speaker) } : {}),
    }));
  } finally {
    // Nothing is left on Soniox's side.
    if (transcription?.id) await call(apiKey, "DELETE", `/transcriptions/${transcription.id}`).catch(() => {});
    await call(apiKey, "DELETE", `/files/${file.id}`).catch(() => {});
  }
}

module.exports = { transcribe };
