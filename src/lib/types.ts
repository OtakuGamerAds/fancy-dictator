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
  /** Replay: how many minutes of your mic and the computer's audio are kept to go back to (0: off). */
  replayMinutes: number;
}

/** A piece of Replay's recording (about half a minute of one source). */
export interface ReplaySegment {
  source: "mic" | "computer";
  /** When it starts and ends (ms since 1970). */
  start: number;
  end: number;
  /** Its name in Replay's folder (read with readReplay). */
  file: string;
  /** Its loudness every quarter second, 0–1. */
  levels: number[];
}

/** What Replay keeps: its pieces, none of them used before `since`. */
export interface ReplayKept {
  since: number;
  segments: ReplaySegment[];
}

/** A word of an async transcription. */
export interface TimedToken {
  text: string;
  start_ms: number;
  end_ms: number;
  speaker?: string;
}

export interface HistoryEntry {
  id: string;
  text: string;
  createdAt: number;
  durationMs: number;
  /** A conversation (you and the computer's audio): its turns; `text` is it written out. */
  turns?: Turn[];
  /** How many audio clips of the message are saved (set by the main process, electron/audio.cjs). */
  audioClips?: number;
  /**
   * Each clip's recording (1, 2, … as "Keep dictating" adds them) and source; null for clips
   * saved before 0.1.14, which hold every source in one.
   */
  audioParts?: { recording: number; source: "mic" | "computer" | null }[];
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
  /** Save one recording's audio, a WebM clip per source, as the message's next recording. */
  addAudioClips(id: string, clips: { source: "mic" | "computer"; webm: ArrayBuffer }[]): Promise<boolean>;
  /** Replay: keep a piece of the recording; what is kept; forget it all; transcribe a part. */
  addReplaySegment(segment: Omit<ReplaySegment, "file"> & { webm: ArrayBuffer }): Promise<void>;
  /** What is kept, and the moment before which nothing is (a cleaned-up part). */
  listReplay(): Promise<ReplayKept>;
  readReplay(file: string): Promise<Uint8Array | null>;
  /** Forget everything before `ms` (after a part was transcribed). */
  trimReplay(ms: number): Promise<void>;
  clearReplay(): Promise<void>;
  transcribeReplay(webm: ArrayBuffer): Promise<TimedToken[]>;
  /** Erase the audio of deleted messages (any that are back in the history are kept). */
  discardAudio(ids: string[]): Promise<void>;
  copy(text: string): Promise<void>;
  reportContentHeight(height: number): void;
  /** The parts of the window that take the mouse (the card, open dropdowns); the rest clicks through. */
  setHitRects(rects: { x: number; y: number; width: number; height: number }[]): void;
  hide(): void;
  /** Move the window with the mouse until endDrag (a press on an empty spot of the card). */
  startDrag(): void;
  endDrag(): void;
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
      /** Set a view up without waiting to show it (the views before the ones a run renders). */
      apply(name: string): void;
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
