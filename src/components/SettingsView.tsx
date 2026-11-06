import { EyeIcon, EyeOffIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { type ModelList, ModelPicker } from "~/components/ModelPicker";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Kbd, KbdGroup } from "~/components/ui/kbd";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { ViewHeader } from "~/components/ViewHeader";
import { SCROLL_LIST } from "~/lib/selectStyles";
import type { Settings } from "~/lib/types";
import { cn } from "~/lib/utils";

interface SettingsViewProps {
  settings: Settings;
  notice: string | null;
  onBack(): void;
  onSaved(settings: Settings): void;
}

/** How much Replay keeps. */
const REPLAY_CHOICES: Record<string, string> = {
  "0": "Off",
  "5": "Last 5 minutes",
  "15": "Last 15 minutes",
  "30": "Last 30 minutes",
  "60": "Last hour",
};

/** Base UI Select needs a non-empty value for "System default". */
const DEFAULT_MIC = "default";


export function SettingsView({ settings, notice, onBack, onSaved }: SettingsViewProps) {
  const [draft, setDraft] = useState<Settings>(settings);
  const [showKey, setShowKey] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [balanceKey, setBalanceKey] = useState(0);
  const modelList = useModelList(draft.sonioxApiKey);

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const loadDevices = useCallback(async () => {
    setLoadingDevices(true);
    try {
      // Device names are only visible after the microphone has been opened once.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of stream.getTracks()) track.stop();
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(all.filter((d) => d.kind === "audioinput" && d.deviceId !== "default" && d.deviceId !== "communications"));
    } catch {
      setDevices([]);
    } finally {
      setLoadingDevices(false);
    }
  }, []);

  useEffect(() => {
    void loadDevices();
    navigator.mediaDevices.addEventListener("devicechange", loadDevices);
    return () => navigator.mediaDevices.removeEventListener("devicechange", loadDevices);
  }, [loadDevices]);

  // Record a new shortcut. The global one is paused meanwhile so it can be re-pressed.
  useEffect(() => {
    if (!capturing) return;
    window.api.suspendHotkey();
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setCapturing(false);
        return;
      }
      const accelerator = toAccelerator(event);
      if (accelerator) {
        update("hotkey", accelerator);
        setCapturing(false);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.api.resumeHotkey();
    };
  }, [capturing]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await window.api.saveSettings(draft);
      if (result.hotkeyError) {
        setError(result.hotkeyError);
        setDraft((d) => ({ ...d, hotkey: result.settings.hotkey }));
      } else {
        setBalanceKey((n) => n + 1);
        onSaved(result.settings);
      }
    } finally {
      setSaving(false);
    }
  };

  const micItems: Record<string, string> = { [DEFAULT_MIC]: "System default" };
  for (const device of devices) micItems[device.deviceId] = device.label || `Microphone ${device.deviceId.slice(0, 6)}`;
  if (draft.micDeviceId && !micItems[draft.micDeviceId]) micItems[draft.micDeviceId] = "Saved microphone (not connected)";

  return (
    <div>
      <ViewHeader title="Settings" onBack={onBack} />

      {notice && (
        <div className="mx-4 mb-1 rounded-lg border border-warning/32 bg-warning-surface px-3 py-2 text-warning-foreground text-xs">
          {notice}
        </div>
      )}

      <div className="divide-y divide-border px-4">
        <Row label="Soniox API key" description="Stored encrypted on this device" aside={<Balance refreshKey={balanceKey} />}>
          <div className="relative w-full">
            <Input
              nativeInput
              type={showKey ? "text" : "password"}
              value={draft.sonioxApiKey}
              placeholder="Paste your API key"
              spellCheck={false}
              autoFocus={!draft.sonioxApiKey}
              className="[&_input]:ps-9 [&_input]:pe-9 [&_input]:text-center"
              onChange={(event) => update("sonioxApiKey", event.target.value)}
            />
            <Button
              variant="ghost-muted"
              size="icon-xs"
              className="absolute end-1 top-1/2 -translate-y-1/2"
              aria-label={showKey ? "Hide key" : "Show key"}
              onClick={() => setShowKey((v) => !v)}
            >
              {showKey ? <EyeOffIcon /> : <EyeIcon />}
            </Button>
          </div>
        </Row>

        <Row label="Model" description="Latest switches to Soniox's newest model by itself">
          <ModelPicker value={draft.sonioxModel} list={modelList} onChange={(value) => update("sonioxModel", value)} />
        </Row>

        <Row label="Organization API key" description="Optional, only to show your balance (snx_org_…)">
          <Input
            nativeInput
            type={showKey ? "text" : "password"}
            value={draft.sonioxOrgKey}
            placeholder="Paste an organization API key"
            spellCheck={false}
            className="[&_input]:ps-9 [&_input]:pe-9 [&_input]:text-center"
            onChange={(event) => update("sonioxOrgKey", event.target.value)}
          />
        </Row>

        <Row label="Shortcut" description="Shows and hides Fancy Dictator">
          <Button
            variant="outline"
            size="sm"
            className={cn("w-full justify-center", capturing && "border-ring ring-[3px] ring-ring/24")}
            onClick={() => setCapturing((v) => !v)}
          >
            {capturing ? (
              <span className="text-muted-foreground">Press a shortcut… (Esc to cancel)</span>
            ) : (
              <KbdGroup>
                {draft.hotkey.split("+").map((key) => (
                  <Kbd key={key} className="text-foreground">
                    {key === "Control" ? "Ctrl" : key}
                  </Kbd>
                ))}
              </KbdGroup>
            )}
          </Button>
        </Row>

        <Row label="Microphone">
          <div className="flex w-full items-center gap-1.5">
            <Select
              items={micItems}
              value={draft.micDeviceId || DEFAULT_MIC}
              onValueChange={(value) => update("micDeviceId", !value || value === DEFAULT_MIC ? "" : value)}
            >
              <SelectTrigger size="sm" className="min-w-0 flex-1 ps-7">
                <SelectValue className="text-center" />
              </SelectTrigger>
              <SelectPopup side="bottom" alignItemWithTrigger={false} className={SCROLL_LIST}>
                {Object.entries(micItems).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
            <Button
              variant="ghost-muted"
              size="icon-sm"
              aria-label="Refresh microphones"
              disabled={loadingDevices}
              onClick={() => void loadDevices()}
            >
              <RefreshCwIcon className={cn(loadingDevices && "animate-spin")} />
            </Button>
          </div>
        </Row>

        <Row label="Replay" description="Keeps your mic and the computer's audio on this device, to transcribe later">
          <Select
            items={REPLAY_CHOICES}
            value={String(draft.replayMinutes)}
            onValueChange={(value) => update("replayMinutes", Number(value) || 0)}
          >
            <SelectTrigger size="sm" className="min-w-0 flex-1 ps-7">
              <SelectValue className="text-center" />
            </SelectTrigger>
            <SelectPopup side="bottom" alignItemWithTrigger={false} className={SCROLL_LIST}>
              {Object.entries(REPLAY_CHOICES).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </Row>

        <Row label="Run on startup" description="Works in the installed app" inline>
          <Switch checked={draft.runOnStartup} onCheckedChange={(checked) => update("runOnStartup", checked)} />
        </Row>
      </div>

      <div className="flex items-center justify-end gap-3 border-t border-border px-4 py-2.5">
        {error && <p className="me-auto ps-1 text-error-foreground text-xs">{error}</p>}
        <Button size="sm" className="min-w-20" disabled={saving || capturing} onClick={() => void save()}>
          Save
        </Button>
      </div>
    </div>
  );
}

/**
 * One setting. In the narrow (420px) window the label sits above its control; a switch stays
 * beside its label (`inline`), where it reads naturally.
 */
function Row({
  label,
  description,
  inline = false,
  aside,
  children,
}: {
  label: string;
  description?: string;
  inline?: boolean;
  /** Shown at the right of the label, e.g. the balance. */
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  const text = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-foreground text-sm">{label}</p>
        {description && <p className="text-muted-foreground text-xs">{description}</p>}
      </div>
      {aside}
    </div>
  );
  if (inline) {
    return (
      <div className="flex items-center justify-between gap-4 py-3">
        {text}
        {children}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 py-3">
      {text}
      <div className="flex w-full">{children}</div>
    </div>
  );
}

const CODE_KEYS: Record<string, string> = {
  Space: "Space",
  Enter: "Return",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Delete",
  Insert: "Insert",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
};

/** Turn a key press into an Electron accelerator ("Control+Alt+Space"), or null if incomplete. */
function toAccelerator(event: KeyboardEvent): string | null {
  const { code } = event;
  let key: string | undefined;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) key = code;
  else key = CODE_KEYS[code];
  if (!key) return null; // A modifier on its own, or an unsupported key.

  const modifiers = [
    event.ctrlKey && "Control",
    event.altKey && "Alt",
    event.shiftKey && "Shift",
    event.metaKey && "Super",
  ].filter(Boolean) as string[];
  // Plain letters would fire while typing anywhere; require a modifier unless it is an F-key.
  if (modifiers.length === 0 && !/^F\d+$/.test(key)) return null;
  return [...modifiers, key].join("+");
}

/**
 * The Soniox prepaid balance, read with the organization API key. Nothing shows until that key
 * is set; a key without the balance permission says so.
 */
function Balance({ refreshKey }: { refreshKey: number }) {
  const [state, setState] = useState<{ error: string | null; availableUsd?: string; invoiced?: boolean } | null>(null);
  useEffect(() => {
    let current = true;
    void window.api.getBalance().then((result) => {
      if (current) setState(result);
    });
    return () => {
      current = false;
    };
  }, [refreshKey]);
  if (!state || (!state.error && state.availableUsd === undefined)) return null;
  if (state.error) return <span className="shrink-0 text-error-foreground text-xs">{state.error}</span>;
  const amount = Number(state.availableUsd);
  return (
    <span className="shrink-0 text-end">
      <span className="block text-muted-foreground text-xs">Balance</span>
      <span className="font-semibold text-foreground text-sm tabular-nums">
        {state.invoiced ? "Invoiced" : `$${Number.isFinite(amount) ? amount.toFixed(2) : state.availableUsd}`}
      </span>
    </span>
  );
}

/** Soniox's real-time models for the key being edited (fetched again shortly after it changes). */
function useModelList(apiKey: string): ModelList {
  const [list, setList] = useState<ModelList>(null);
  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      void window.api.listModels(apiKey).then((result) => {
        if (current) setList(result);
      });
    }, 400);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [apiKey]);
  return list;
}
