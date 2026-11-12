/**
 * What Soniox is told before it hears anything (its `context`, sent with the start request):
 * who speaks and how it should be written, and your own words. Soniox's documented lever for
 * mixed-language speech: a word listed in `terms` is written the way it is listed, so English
 * and German words said inside Arabic come out in Latin letters instead of transliterated
 * ("rename", not "رينيم"). See https://soniox.com/docs/stt/concepts/context.
 */

export interface SonioxContext {
  general?: { key: string; value: string }[];
  text?: string;
  terms?: string[];
}

const NAMES: Record<string, string> = { ar: "Arabic", en: "English", de: "German", fr: "French", es: "Spanish", tr: "Turkish" };
/** Languages written in Latin letters (of those offered). */
const LATIN = new Set(["en", "de", "fr", "es", "tr", "it", "nl", "pt", "pl", "sv"]);

/** How Arabic mixed with English (and German) is written: Soniox learns the style from it. */
const ARABIC_EXAMPLE = "طيب، بدي أعمل rename للـ display name، وبعدين نعمل testing على الـ feature الجديدة.";
const GERMAN_EXAMPLE = "Genau, das machen wir morgen.";

/** Words Soniox keeps as written (it caps them; very long lists only cost a little more). */
const MAX_TERMS = 500;

/** Your words, one per line or comma-separated, as typed in Settings. */
export function parseTerms(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\n,،]/u)) {
    const term = raw.trim();
    if (!term || seen.has(term.toLowerCase())) continue;
    seen.add(term.toLowerCase());
    out.push(term);
  }
  return out.slice(0, MAX_TERMS);
}

export function sonioxContext(languages: string[], terms: string[]): SonioxContext | undefined {
  const general: { key: string; value: string }[] = [{ key: "use", value: "Dictation: messages, notes and requests, often to AI assistants about software" }];
  const named = languages.map((code) => NAMES[code] ?? code);
  const arabic = languages.includes("ar");
  const latin = languages.filter((code) => LATIN.has(code));
  let text: string | undefined;
  if (arabic && latin.length) {
    const others = latin.map((code) => NAMES[code] ?? code).join(" and ");
    general.push(
      { key: "speaker", value: `Arabic speaker (Levantine) who mixes ${others} words and phrases into Arabic sentences` },
      { key: "writing", value: `Arabic words in Arabic script; every ${others} word in Latin script, spelled as in ${others}` },
    );
    text = [ARABIC_EXAMPLE, latin.includes("de") ? GERMAN_EXAMPLE : ""].filter(Boolean).join(" ");
  } else if (named.length > 1) {
    general.push({ key: "languages", value: `${named.join(", ")}, mixed within sentences` });
  }
  const listed = terms.slice(0, MAX_TERMS);
  return { general, ...(text ? { text } : {}), ...(listed.length ? { terms: listed } : {}) };
}
