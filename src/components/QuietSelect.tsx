import { Select as SelectPrimitive } from "@base-ui/react/select";
import { CheckIcon } from "lucide-react";

import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "~/components/ui/select";
import { SCROLL_LIST } from "~/lib/selectStyles";
import { cn } from "~/lib/utils";

type Choice = { value: string; label: string };

type QuietSelectProps = {
  items: Choice[];
  /** What the trigger shows. */
  label: string;
  title?: string;
  ariaLabel: string;
  disabled?: boolean;
  /** Where the list opens: under the trigger, or above it (at the bottom of the window). */
  side?: "bottom" | "top";
  align?: "start" | "center" | "end";
  className?: string;
} & ({ multiple: true; value: string[]; onChange(value: string[]): void } | { multiple?: false; value: string; onChange(value: string): void });

/**
 * A quiet ghost Select that shows its choice in short form, the way T3 Code puts its model
 * picker beside the send button. The languages and the sessions are both picked with it.
 */
export function QuietSelect(props: QuietSelectProps) {
  const { items, label, title, ariaLabel, disabled, side = "bottom", align = "end", className } = props;
  return (
    <Select
      multiple={props.multiple}
      value={props.value as never}
      disabled={disabled}
      onValueChange={(value) => props.onChange(value as never)}
    >
      <SelectTrigger
        variant="ghost"
        size="xs"
        className={cn("w-auto min-w-0 shrink-0 font-medium", className)}
        aria-label={ariaLabel}
        title={title}
      >
        <SelectValue>{() => label}</SelectValue>
      </SelectTrigger>
      <SelectPopup side={side} align={align} alignItemWithTrigger={false} matchTriggerWidth={false} className={SCROLL_LIST}>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value} className="min-w-40">
            <span className="flex items-center justify-between gap-4">
              {item.label}
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
