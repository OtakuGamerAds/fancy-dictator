import { QuietSelect } from "~/components/QuietSelect";
import { LANGUAGES } from "~/lib/types";

const nameOf = (code: string) => LANGUAGES.find((l) => l.code === code)?.name ?? code;
const CHOICES = LANGUAGES.map((language) => ({ value: language.code, label: language.name }));

/** The languages Soniox listens for, picked right beside the send button. */
export function LanguagePicker({
  value,
  disabled,
  onChange,
}: {
  value: string[];
  disabled?: boolean;
  onChange(languages: string[]): void;
}) {
  return (
    <QuietSelect
      multiple
      value={value}
      items={CHOICES}
      label={value.length ? value.map((code) => code.toUpperCase()).join(" · ") : "Auto"}
      title={value.length ? value.map(nameOf).join(", ") : "Detect the language automatically"}
      ariaLabel="Languages"
      disabled={disabled}
      onChange={onChange}
    />
  );
}

const OFF = "off";
const TRANSLATE_CHOICES = [{ value: OFF, label: "No live translation" }, ...CHOICES];

/**
 * Live translation, beside the languages: what is said is translated by Soniox as it is said,
 * into the language picked, under each bubble. Off, it reads "Translate".
 */
export function LiveTranslatePicker({ value, onChange }: { value: string; onChange(language: string): void }) {
  return (
    <QuietSelect
      value={value || OFF}
      items={TRANSLATE_CHOICES}
      label={value ? `Translate → ${value.toUpperCase()}` : "Translate"}
      title={value ? `Translated live into ${nameOf(value)} as you speak` : "Translate live as you speak"}
      ariaLabel="Live translation"
      className={value ? undefined : "text-muted-foreground"}
      onChange={(choice) => onChange(choice === OFF ? "" : choice)}
    />
  );
}
