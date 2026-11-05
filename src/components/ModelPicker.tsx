/**
 * The model picker, assembled the way T3 Code builds its own (MIT License — see
 * THIRD_PARTY_LICENSE_T3CODE.txt): chat/ProviderModelPicker.tsx (a ComposerControl trigger
 * opening a Popover), chat/ModelPickerContent.tsx (an inline Combobox with "Search models...")
 * and chat/ModelListRow.tsx (the row: name, a check when selected, a muted detail, "New").
 * T3's providers, favorites and shortcuts are left out; there is one provider here, Soniox.
 */
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { useRef, useState } from "react";

import { Combobox, ComboboxEmpty, ComboboxItem, ComboboxList, ComboboxSearchInput } from "~/components/ui/combobox";
import { ComposerControl } from "~/components/ui/composer-control";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { cn } from "~/lib/utils";

/** T3's settings/settingsLayout.tsx: pickers in Settings match the bordered selects beside them. */
const SETTINGS_PICKER_TRIGGER_CLASSNAME =
  "min-w-0 max-w-none shrink-0 border-input bg-background font-normal text-foreground shadow-xs/5 hover:bg-accent/50 dark:bg-input/32 [&_svg[data-composer-control-chevron]]:stroke-[1.75] [&_svg[data-composer-control-chevron]]:opacity-70";

export type ModelList = { models: { id: string; name: string }[]; latest: string; error: string | null } | null;

type Row = { value: string; name: string; detail?: string; isNew?: boolean };

export function ModelPicker({ value, list, onChange }: { value: string; list: ModelList; onChange(value: string): void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const rows: Row[] = [
    { value: "latest", name: "Latest", detail: list ? list.latest : "newest model", isNew: false },
    ...(list?.models ?? []).map((m) => ({
      value: m.id,
      name: m.id,
      ...(m.name !== m.id ? { detail: m.name } : {}),
      isNew: m.id === list?.latest,
    })),
  ];
  // A saved model Soniox no longer lists still shows, so the choice is never silently changed.
  if (!rows.some((row) => row.value === value)) rows.push({ value, name: value, detail: "not listed" });

  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? rows.filter((row) => `${row.name} ${row.detail ?? ""}`.toLowerCase().includes(needle))
    : rows;
  const selected = rows.find((row) => row.value === value);
  const triggerText = value === "latest" ? `Latest${list ? ` (${list.latest})` : ""}` : (selected?.name ?? value);

  return (
    <div className="flex w-full flex-col gap-1">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery("");
        }}
      >
        <PopoverTrigger
          render={
            <ComposerControl
              aria-label={`Model: ${triggerText}`}
              className={cn("w-full min-w-0 shrink justify-between whitespace-nowrap border", SETTINGS_PICKER_TRIGGER_CLASSNAME)}
            />
          }
        >
          <span className="flex min-w-0 flex-1 items-center justify-center gap-1.5">
            <span data-chat-provider-model-picker-label className="min-w-0 overflow-hidden truncate">
              {triggerText}
            </span>
          </span>
          <ChevronDownIcon data-composer-control-chevron aria-hidden className="size-4" />
        </PopoverTrigger>
        {/* As wide as the field it opens from; the popover sizes its own content to the popup. */}
        <PopoverPopup initialFocus={searchInputRef} align="start" className="w-(--anchor-width) before:hidden" padding="none">
          <Combobox<string>
            inline
            items={rows.map((row) => row.value)}
            filteredItems={filtered.map((row) => row.value)}
            filter={null}
            autoHighlight
            open
            value={value}
            onValueChange={(next) => {
              if (typeof next !== "string") return;
              onChange(next);
              setOpen(false);
              setQuery("");
            }}
          >
            <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-muted/40">
              <ComboboxSearchInput
                ref={searchInputRef}
                placeholder="Search models..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <ComboboxList className="max-h-64">
                {filtered.map((row, index) => (
                  <ComboboxItem
                    key={row.value}
                    hideIndicator
                    selectedFill={false}
                    index={index}
                    value={row.value}
                    className="group relative w-full !min-w-0 max-w-full cursor-pointer"
                  >
                    {/* ModelListRow: name, a check when selected, a muted detail, "New". */}
                    <div className="flex min-w-0 flex-1 items-center gap-2 text-left">
                      <div className="min-w-0 truncate font-normal text-sm leading-snug">{row.name}</div>
                      {row.value === value ? <CheckIcon className="size-3.5 shrink-0" aria-hidden="true" /> : null}
                      {row.detail ? (
                        <span className="min-w-0 shrink truncate text-muted-foreground/70 text-xs">{row.detail}</span>
                      ) : null}
                      {row.isNew ? (
                        <span
                          className="shrink-0 rounded border border-update/35 bg-update/15 px-0.5 py-px font-bold text-3xs text-update-foreground uppercase leading-none tracking-wide"
                          aria-label="Newest model"
                        >
                          New
                        </span>
                      ) : null}
                    </div>
                  </ComboboxItem>
                ))}
              </ComboboxList>
              <ComboboxEmpty className="empty:h-0">No models found</ComboboxEmpty>
            </div>
          </Combobox>
        </PopoverPopup>
      </Popover>
      {list?.error && <p className="text-error-foreground text-xs">{list.error}</p>}
    </div>
  );
}
