import { Select as SelectPrimitive } from "@base-ui/react/select";
import { CheckIcon } from "lucide-react";

import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "~/components/ui/select";
import { SCROLL_LIST } from "~/lib/selectStyles";
import { LANGUAGES } from "~/lib/types";

const nameOf = (code: string) => LANGUAGES.find((l) => l.code === code)?.name ?? code;

/**
 * The languages Soniox listens for, picked right beside the send button, the way T3 Code
 * puts its model picker there: a quiet ghost Select that shows the choice in short form.
 */
export function LanguagePicker({
  value,
  disabled,
  onChange,
}: {
  value: string[];
  disabled?: boolean;
  onChange(languages: string[]): void;
}) {
  const label = value.length ? value.map((code) => code.toUpperCase()).join(" · ") : "Auto";
  const title = value.length ? value.map(nameOf).join(", ") : "Detect the language automatically";
  return (
    <Select multiple value={value} disabled={disabled} onValueChange={onChange}>
      <SelectTrigger
        variant="ghost"
        size="xs"
        className="w-auto min-w-0 shrink-0 font-medium"
        aria-label="Languages"
        title={title}
      >
        <SelectValue>{() => label}</SelectValue>
      </SelectTrigger>
      <SelectPopup side="bottom" align="end" alignItemWithTrigger={false} matchTriggerWidth={false} className={SCROLL_LIST}>
        {LANGUAGES.map((language) => (
          <SelectItem key={language.code} value={language.code} className="min-w-40">
            <span className="flex items-center justify-between gap-4">
              {language.name}
              <SelectPrimitive.ItemIndicator>
                <CheckIcon className="size-4 text-foreground" />
              </SelectPrimitive.ItemIndicator>
            </span>
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}
