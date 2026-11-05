/**
 * Soniox's real-time models, from GET /v1/models (with the same project key used for
 * dictation), so the list in Settings is always current. "Latest" means the newest of them,
 * worked out here every time the list is fetched: no app update is needed when Soniox ships one.
 */

const MODELS_URL = "https://api.soniox.com/v1/models";
/** Used until the list has been fetched once (or if it cannot be). */
const FALLBACK_MODEL = "stt-rt-v6";
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

let cache = null; // { key, fetchedAt, models: [{ id, name }], latest }

/** The version number in an id like "stt-rt-v6" (0 when there is none). */
const versionOf = (id) => Number(id.match(/-v(\d+)/)?.[1] ?? 0);

/**
 * The real-time models that are actual models, newest first. Aliases (old ids that now point
 * to another model) and previews are left out.
 */
function realTimeModels(body) {
  const models = Array.isArray(body?.models) ? body.models : [];
  return models
    .filter((m) => m?.transcription_mode === "real_time" && !m.aliased_model_id && !/preview/i.test(m.id))
    .map((m) => ({ id: String(m.id), name: String(m.name || m.id) }))
    .sort((a, b) => versionOf(b.id) - versionOf(a.id));
}

/** The models, fetched again when the key changed or the list is older than six hours. */
async function listModels(apiKey, { force = false } = {}) {
  if (!apiKey) return { models: [], latest: FALLBACK_MODEL, error: "Add your Soniox API key first" };
  const fresh = cache && cache.key === apiKey && Date.now() - cache.fetchedAt < MAX_AGE_MS;
  if (fresh && !force) return { models: cache.models, latest: cache.latest, error: null };
  try {
    const response = await fetch(MODELS_URL, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!response.ok) throw new Error(response.status === 401 ? "This API key was not accepted" : "Couldn't load the models");
    const models = realTimeModels(await response.json());
    if (models.length === 0) throw new Error("No real-time models were listed");
    cache = { key: apiKey, fetchedAt: Date.now(), models, latest: models[0].id };
    return { models, latest: cache.latest, error: null };
  } catch (error) {
    const message = error instanceof Error && !/fetch failed/i.test(error.message) ? error.message : "Couldn't reach Soniox";
    // Keep whatever list we had; "latest" falls back to the last one known.
    return { models: cache?.models ?? [], latest: cache?.latest ?? FALLBACK_MODEL, error: message };
  }
}

/** The model id a recording should use for the `choice` in Settings ("latest" or an id). */
async function resolveModel(apiKey, choice) {
  if (choice && choice !== "latest") return choice;
  return (await listModels(apiKey)).latest;
}

module.exports = { listModels, resolveModel, FALLBACK_MODEL };
