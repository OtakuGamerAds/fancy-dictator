/**
 * Translating a part of a message (selected in it, translated from the bar under it), with
 * Google Translate's free endpoint: no key, the source language detected by itself. Only the
 * selected words are sent.
 *
 * Asked with Node's plain https: Google answers fetch (Node's and Chromium's alike) with
 * "429 Too Many Requests" from the first request on.
 */
const https = require("https");

const ENDPOINT = "https://translate.googleapis.com/translate_a/single";
const TIMEOUT_MS = 15_000;

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: TIMEOUT_MS }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("timeout", () => req.destroy(Object.assign(new Error("timeout"), { name: "TimeoutError" })));
    req.on("error", reject);
  });
}

async function translate(text, to) {
  const words = String(text ?? "").trim();
  const target = String(to ?? "");
  if (!words || !/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(target)) return { error: "Nothing to translate." };
  const url = `${ENDPOINT}?${new URLSearchParams({ client: "gtx", sl: "auto", tl: target, dt: "t", q: words })}`;
  try {
    const { status, body } = await get(url);
    if (status !== 200) return { error: `Google Translate answered ${status}.` };
    // [[[translated, original, …], …], …, detected source language, …]
    const data = JSON.parse(body);
    const translated = (Array.isArray(data?.[0]) ? data[0] : []).map((part) => part?.[0] ?? "").join("");
    return translated ? { text: translated, from: typeof data?.[2] === "string" ? data[2] : null } : { error: "No translation came back." };
  } catch (error) {
    return { error: error?.name === "TimeoutError" ? "Google Translate did not answer." : "Could not reach Google Translate." };
  }
}

module.exports = { translate };
