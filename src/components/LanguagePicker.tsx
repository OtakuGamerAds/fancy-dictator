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
