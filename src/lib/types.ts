export interface Settings {
  sonioxApiKey: string;
  /** Organization API key (snx_org_…), only for reading the balance. Optional. */
  sonioxOrgKey: string;
  hotkey: string;
  micDeviceId: string;
  languages: string[];
  runOnStartup: boolean;
}

export interface HistoryEntry {
  id: string;
  text: string;
  createdAt: number;
  durationMs: number;
}

/** Mirrors electron/updater.cjs (after T3 Code's DesktopUpdateState). */
export interface UpdateState {
  enabled: boolean;
  status: "disabled" | "idle" | "checking" | "up-to-date" | "available" | "downloading" | "downloaded" | "error";
  currentVersion: string;
  availableVersion: string | null;
  downloadedVersion: string | null;
  downloadPercent: number | null;
  message: string | null;
  errorContext: "check" | "download" | "install" | null;
}

export interface DesktopApi {
  getSettings(): Promise<Settings>;
  /** The Soniox prepaid balance; error null with no balance means no organization key is set. */
  getBalance(): Promise<{ error: string | null; availableUsd?: string; invoiced?: boolean }>;
  saveSettings(patch: Partial<Settings>): Promise<{ settings: Settings; hotkeyError: string | null }>;
  getHistory(): Promise<HistoryEntry[]>;
  addHistory(entry: HistoryEntry): Promise<HistoryEntry[]>;
  clearHistory(): Promise<HistoryEntry[]>;
  replaceHistory(entries: HistoryEntry[]): Promise<HistoryEntry[]>;
  copy(text: string): Promise<void>;
  reportContentHeight(height: number): void;
  /** The parts of the window that take the mouse (the card, open dropdowns); the rest clicks through. */
  setHitRects(rects: { x: number; y: number; width: number; height: number }[]): void;
  hide(): void;
  suspendHotkey(): void;
  resumeHotkey(): void;
  onHidden(callback: () => void): () => void;
  onHotkey(callback: (payload: { opened: boolean }) => void): () => void;
  onOpenSettings(callback: () => void): () => void;
  getUpdateState(): Promise<UpdateState>;
  checkForUpdate(): Promise<void>;
  downloadUpdate(): Promise<UpdateState>;
  installUpdate(): Promise<UpdateState>;
  onUpdateState(callback: (state: UpdateState) => void): () => void;
}

declare global {
  interface Window {
    api: DesktopApi;
    __fdSetUpdateState?: (state: UpdateState) => void;
    __fdSnapshot?: {
      views(): string[];
      show(name: string): Promise<number>;
      probe(): Promise<unknown>;
      click(selector: string): Promise<boolean>;
    };
  }
}

/** Languages offered as Soniox recognition hints. */
export const LANGUAGES: { code: string; name: string }[] = [
  { code: "ar", name: "Arabic" },
  { code: "en", name: "English" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "es", name: "Spanish" },
  { code: "tr", name: "Turkish" },
  { code: "ru", name: "Russian" },
  { code: "it", name: "Italian" },
  { code: "pt", name: "Portuguese" },
  { code: "nl", name: "Dutch" },
  { code: "fa", name: "Persian" },
  { code: "ur", name: "Urdu" },
  { code: "hi", name: "Hindi" },
  { code: "id", name: "Indonesian" },
  { code: "ms", name: "Malay" },
  { code: "zh", name: "Chinese" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
];
