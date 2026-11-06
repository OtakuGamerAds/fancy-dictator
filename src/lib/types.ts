import type { Turn } from "./dialogue";

export interface Settings {
  sonioxApiKey: string;
  /** Organization API key (snx_org_…), only for reading the balance. Optional. */
  sonioxOrgKey: string;
  /** "latest" (always the newest real-time model) or a specific Soniox model id. */
  sonioxModel: string;
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
  /** A conversation (you and the computer's audio): its turns; `text` is it written out. */
  turns?: Turn[];
  /** How many recordings of the message are saved (set by the main process, electron/audio.cjs). */
  audioClips?: number;
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
  /** Soniox's real-time models, newest first, and which one "latest" means right now. */
  listModels(apiKey?: string): Promise<{ models: { id: string; name: string }[]; latest: string; error: string | null }>;
  /** The model id the next recording uses. */
  resolveModel(): Promise<string>;
  saveSettings(patch: Partial<Settings>): Promise<{ settings: Settings; hotkeyError: string | null }>;
  getHistory(): Promise<HistoryEntry[]>;
  addHistory(entry: HistoryEntry): Promise<HistoryEntry[]>;
  clearHistory(): Promise<HistoryEntry[]>;
  replaceHistory(entries: HistoryEntry[]): Promise<HistoryEntry[]>;
  /** Save one recording's 16 kHz 16-bit PCM as the message's next audio clip. */
  addAudioClip(id: string, pcm: ArrayBuffer): Promise<boolean>;
  /** Erase the audio of deleted messages (any that are back in the history are kept). */
  discardAudio(ids: string[]): Promise<void>;
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
    /** `pnpm probe` only: a scripted stand-in for Soniox's socket. */
    __fdTestSocket?: (source: "mic" | "computer") => WebSocket;
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
