import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { Composer, type Phase } from "~/components/Composer";
import { HistoryPanel } from "~/components/HistoryPanel";
import { SettingsView } from "~/components/SettingsView";
import { describeStartError, type SonioxSession, startSoniox } from "~/lib/soniox";
import type { HistoryEntry, Settings } from "~/lib/types";
import { releaseUndoShortcut, showUndoNotice, undoClaimsShortcut, undoLatestAction } from "~/lib/undoNotice";

type View = "main" | "settings";

const LEVEL_BARS = 18;
const FULL_WIDTH = 736; // T3 Code's composer width
const COMPACT_WIDTH = 380;
const NEEDS_KEY = "Paste your Soniox API key to start dictating.";

/** Keeps the latest value readable from long-lived listeners. */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [view, setView] = useState<View>("main");
  const [historyOpen, setHistoryOpen] = useState(false);
  // Messages cleared from the box since the window opened. Right after clearing, the list opens
  // showing just these; opening it with the arrow shows the latest few as usual.
  const [sessionIds, setSessionIds] = useState<string[]>([]);
  const [historyMode, setHistoryMode] = useState<"session" | "recent">("recent");
  const [settingsNotice, setSettingsNotice] = useState<string | null>(null);

  // The text box. Each dictation is appended to it; it is one history entry until cleared.
  const [text, setText] = useState("");
  const [durationMs, setDurationMs] = useState(0);
  const entryId = useRef<string | null>(null);

  const [phase, setPhaseState] = useState<Phase>("idle");
  const [pendingText, setPendingText] = useState("");
  const [levels, setLevels] = useState<number[]>(() => Array(LEVEL_BARS).fill(0));
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const phaseRef = useRef<Phase>("idle");
  const sessionRef = useRef<SonioxSession | null>(null);
  const latest = useLatest({ settings, view, startedAt, text, durationMs, historyOpen });

  const setPhase = (next: Phase) => {
    phaseRef.current = next;
    setPhaseState(next);
  };

  useEffect(() => {
    void window.api.getSettings().then((loaded) => {
      setSettings(loaded);
      if (!loaded.sonioxApiKey) {
        setSettingsNotice(NEEDS_KEY);
        setView("settings");
      }
    });
    void window.api.getHistory().then(setHistory);
  }, []);

  // Deleting or clearing shows T3's undo notice; Ctrl+Z (or its button) brings things back.
  const latestHistory = useLatest(history);

  const restoreEntries = async (entries: HistoryEntry[]) => {
    const merged = [...latestHistory.current.filter((e) => !entries.some((r) => r.id === e.id)), ...entries];
    merged.sort((a, b) => b.createdAt - a.createdAt);
    setHistory(await window.api.replaceHistory(merged));
  };

  const deleteEntries = async (ids: string[]) => {
    const current = latestHistory.current;
    const removed = current.filter((entry) => ids.includes(entry.id));
    if (removed.length === 0) return;
    const remaining = current.filter((entry) => !ids.includes(entry.id));
    setHistory(await window.api.replaceHistory(remaining));
    // Nothing left to show: fold the drawer up (Ctrl+Z still brings the messages back).
    if (remaining.length === 0) setHistoryOpen(false);
    showUndoNotice({ action: ids.length > 1 ? "Cleared" : "Deleted", undo: () => restoreEntries(removed) });
  };

  // The box's text, readable right away (state only updates on the next render). Settled
  // words from Soniox are appended to it while recording, and it stays editable meanwhile.
  const textRef = useRef("");
  const writeText = (value: string) => {
    textRef.current = value;
    setText(value);
  };

  /** Add newly settled words at the end of the box, with a space if needed. */
  const appendSpoken = (chunk: string) => {
    if (!chunk) return;
    const current = textRef.current;
    let piece = chunk;
    if (!current.trim()) piece = piece.trimStart();
    else if (!/\s$/.test(current) && !/^\s/.test(piece)) piece = ` ${piece}`;
    writeText(current + piece);
  };
  const appendedLength = useRef(0); // how much of this session's final text is already in the box
  const pendingRef = useRef("");
  const textAtStart = useRef("");

  const clearText = () => {
    writeText("");
    setDurationMs(0);
    entryId.current = null;
  };

  /**
   * Turn what is in the box into a message in the history and start clean, like sending in
   * T3. Used by Ctrl+Enter and whenever the window is hidden. A recording is finished first.
   */
  const sendBox = async ({ showInHistory = false, undoable = false } = {}) => {
    let value = textRef.current;
    let duration = latest.current.durationMs;
    if (phaseRef.current === "recording" || phaseRef.current === "stopping") {
      const result = await stopRecording();
      if (result) ({ text: value, durationMs: duration } = result);
    } else if (phaseRef.current === "starting") {
      cancelRecording();
    }
    const trimmed = value.trim();
    if (trimmed) {
      const entry = { id: entryId.current ?? crypto.randomUUID(), text: trimmed, createdAt: Date.now(), durationMs: duration };
      setHistory(await window.api.addHistory(entry));
      if (showInHistory) {
        // Open the list on just what was cleared this session, so it is seen landing there.
        setSessionIds((ids) => (ids.includes(entry.id) ? ids : [...ids, entry.id]));
        setHistoryMode("session");
        setHistoryOpen(true);
      }
      if (undoable) {
        showUndoNotice({
          action: "Cleared",
          undo: () => {
            writeText(entry.text);
            setDurationMs(entry.durationMs);
            entryId.current = entry.id;
          },
        });
      }
    }
    clearText();
    setError(null);
    setCopied(false);
  };

  // ── Recording ──────────────────────────────────────────────────────────

  /** Start listening. New words are appended to the text box unless `fresh` empties it first. */
  const startRecording = useCallback(
    async (fresh = false) => {
      if (phaseRef.current !== "idle") return;
      const current = latest.current.settings;
      if (!current) return;
      if (!current.sonioxApiKey) {
        setSettingsNotice(NEEDS_KEY);
        setView("settings");
        return;
      }
      if (fresh) clearText();
      setPhase("starting");
      setView("main");
      setError(null);
      appendedLength.current = 0;
      pendingRef.current = "";
      textAtStart.current = textRef.current;
      setPendingText("");
      setLevels(Array(LEVEL_BARS).fill(0));
      setCopied(false);
      setStartedAt(Date.now());
      setNow(Date.now());
      try {
        const session = await startSoniox({
          apiKey: current.sonioxApiKey,
          languageHints: current.languages,
          deviceId: current.micDeviceId || undefined,
          onText: (final, pending) => {
            appendSpoken(final.slice(appendedLength.current));
            appendedLength.current = final.length;
            pendingRef.current = pending;
            setPendingText(pending);
          },
          onLevel: (level) => setLevels((prev) => [...prev.slice(1), level]),
          onError: (message) => {
            setError(message);
            sessionRef.current?.cancel();
            sessionRef.current = null;
            setPhase("idle");
          },
        });
        // Read through a cast: TypeScript narrowed phaseRef.current above, but it may have changed while awaiting.
        if ((phaseRef.current as Phase) !== "starting") {
          session.cancel(); // Cancelled, or failed, while we were connecting.
          return;
        }
        sessionRef.current = session;
        setPhase("recording");
      } catch (startError) {
        setError(describeStartError(startError));
        setPhase("idle");
      }
    },
    [latest],
  );

  const stopping = useRef<Promise<{ text: string; durationMs: number } | null> | null>(null);

  /** Stop listening and save. Resolves to the box's text and duration afterwards. */
  const stopRecording = useCallback((): Promise<{ text: string; durationMs: number } | null> => {
    if (stopping.current) return stopping.current;
    const run = stopRecordingNow().finally(() => (stopping.current = null));
    stopping.current = run;
    return run;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopRecordingNow = async (): Promise<{ text: string; durationMs: number } | null> => {
    if (phaseRef.current === "starting") {
      setPhase("idle");
      return null;
    }
    if (phaseRef.current !== "recording") return null;
    const session = sessionRef.current;
    sessionRef.current = null;
    if (!session) return null;
    setPhase("stopping");
    const elapsed = Date.now() - latest.current.startedAt;
    await session.stop(); // Soniox settles the last words; onText appends them to the box.
    appendSpoken(pendingRef.current); // anything still unsettled if it timed out
    pendingRef.current = "";
    setPendingText("");
    setPhase("idle");
    const combined = textRef.current.trim();
    if (combined === textAtStart.current.trim()) {
      if (!combined) setError("No speech detected.");
      return { text: combined, durationMs: latest.current.durationMs };
    }
    const duration = latest.current.durationMs + elapsed;
    entryId.current ??= crypto.randomUUID();
    writeText(combined);
    setDurationMs(duration);
    const entry: HistoryEntry = { id: entryId.current, text: combined, createdAt: Date.now(), durationMs: duration };
    setHistory(await window.api.addHistory(entry));
    return { text: combined, durationMs: duration };
  };

  /** Esc while recording: stop listening; settled words stay, unsettled ones are dropped. */
  const cancelRecording = useCallback(() => {
    sessionRef.current?.cancel();
    sessionRef.current = null;
    pendingRef.current = "";
    setPendingText("");
    setPhase("idle");
    setError(null);
  }, []);

  // Elapsed timer while recording.
  useEffect(() => {
    if (phase !== "starting" && phase !== "recording") return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [phase]);

  // "Copied" turns back into "Copy" after a moment.
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  const hide = useCallback(() => {
    setError(null);
    window.api.hide();
  }, []);

  const copy = useCallback(async (value: string) => {
    await window.api.copy(value);
  }, []);

  // ── Events from the main process and the keyboard ─────────────────────

  useEffect(() => {
    // Hidden by the shortcut, the tray or ✕: a recording in progress finishes and is saved.
    // However the window is hidden, the box is saved as a message and the next open is clean.
    const offHidden = window.api.onHidden(() => {
      void sendBox();
      // The next open is a fresh session.
      setSessionIds([]);
      setHistoryOpen(false);
    });
    // First press opens and starts recording; the next one stops it, or hides when idle.
    const offHotkey = window.api.onHotkey(({ opened }) => {
      const p = phaseRef.current;
      if (opened) {
        if (p === "idle") void startRecording(true);
      } else if (p === "recording") void stopRecording();
      else if (p === "starting") cancelRecording();
      else if (p === "idle") hide();
    });
    const offOpenSettings = window.api.onOpenSettings(() => {
      if (phaseRef.current === "idle") setView("settings");
    });
    return () => {
      offHidden();
      offHotkey();
      offOpenSettings();
    };
    // sendBox only reads refs, so the listeners never go stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest, cancelRecording, startRecording, stopRecording, hide]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.code === "KeyZ") {
        // As in T3: right after an action Ctrl+Z undoes it, even inside a text field. Once
        // another key is pressed or the text is edited, Ctrl+Z is the field's own undo again.
        const target = event.target as HTMLElement | null;
        const editing = target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement;
        if (editing && (target as HTMLTextAreaElement).value && !undoClaimsShortcut()) return;
        if (undoLatestAction()) event.preventDefault();
        return;
      }
      if (!["Control", "Meta", "Shift", "Alt"].includes(event.key)) releaseUndoShortcut();
      // Ctrl+Enter sends the box to the history and clears it.
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && latest.current.view === "main") {
        event.preventDefault();
        void sendBox({ showInHistory: true, undoable: true });
        return;
      }
      if (event.key !== "Escape") return;
      const { view: current, historyOpen: open } = latest.current;
      if (phaseRef.current !== "idle") cancelRecording();
      else if (current === "settings") setView("main");
      else if (open) setHistoryOpen(false);
      else hide();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [latest, cancelRecording, hide]);

  // ── Size: the card animates its height; the window follows ────────────

  // The content takes its natural size: as wide as its longest line (between the compact
  // width and T3's composer width, after which text wraps), as tall as it needs. The card
  // animates to that size, so it widens bit by bit as words arrive, then grows downward.
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentSize, setContentSize] = useState({ width: COMPACT_WIDTH - 2, height: 95 });

  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setContentSize({ width: el.offsetWidth, height: el.offsetHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, [view]);

  // History and Settings always use the full width.
  const fullWidth = view === "settings" || historyOpen;
  const cardWidth = contentSize.width + 2; // + left and right border
  const cardHeight = contentSize.height + 2; // + top and bottom border

  // The window has a fixed size and the card animates inside it (resizing a transparent
  // window flickers). The main process only moves the window up if the card would leave the screen.
  useEffect(() => {
    window.api.reportContentHeight(cardHeight);
  }, [cardHeight]);

  // Tell the main process which parts of the window take the mouse: the card and any open
  // dropdown. Everywhere else clicks go through to the app behind. Checked every frame, so it
  // follows the card while it animates; only changes are sent.
  useEffect(() => {
    let frame = 0;
    let last = "";
    const tick = () => {
      const elements = [
        ...document.querySelectorAll<HTMLElement>("#root > div, [data-slot=select-popup]"),
      ];
      const rects = elements.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: Math.floor(r.left), y: Math.floor(r.top), width: Math.ceil(r.width), height: Math.ceil(r.height) };
      });
      const key = JSON.stringify(rects);
      if (key !== last) {
        last = key;
        window.api.setHitRects(rects);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  useSnapshotHooks({
    setView,
    setHistoryOpen,
    setHistory,
    setText: writeText,
    setDurationMs,
    setPendingText,
    setPhase,
    setStartedAt,
    setLevels,
    setError,
    setSettings,
    contentRef,
  });

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    // The window is T3 Code's black app background; only the text box gets the composer color.
    // The card hugs the window's right edge, so the ✕ in its corner stays under the mouse
    // while the card shrinks or grows.
    <div
      className="drag-region ms-auto overflow-hidden rounded-2xl border border-border bg-background transition-[width,height] duration-200 ease-drawer"
      style={{ width: cardWidth, height: cardHeight }}
    >
      <div
        ref={contentRef}
        style={{
          width: "max-content",
          minWidth: (fullWidth ? FULL_WIDTH : COMPACT_WIDTH) - 2,
          maxWidth: FULL_WIDTH - 2,
        }}
      >
        {view === "main" && (
          <>
            <Composer
              phase={phase}
              text={text}
              pendingText={pendingText}
              error={error}
              elapsedMs={durationMs + (phase === "idle" ? 0 : now - startedAt)}
              durationMs={durationMs}
              levels={levels}
              copied={copied}
              historyOpen={historyOpen}
              historyCount={history.length}
              onTextChange={(value) => {
                releaseUndoShortcut();
                writeText(value);
              }}
              onMic={() => void startRecording()}
              onStop={() => void stopRecording()}
              onCopy={() => void copy(text.trim()).then(() => setCopied(true))}
              onClear={() => void sendBox({ showInHistory: true, undoable: true })}
              languages={settings?.languages ?? []}
              onLanguagesChange={(languages) => {
                if (!settings) return;
                setSettings({ ...settings, languages });
                void window.api.saveSettings({ languages });
              }}
              onToggleHistory={() => {
                // Opened by hand, the list shows the latest messages.
                if (!historyOpen) setHistoryMode("recent");
                setHistoryOpen(!historyOpen);
              }}
              // Closes the window; hiding saves the box and finishes a recording (see onHidden).
              onClose={hide}
              onOpenSettings={() => {
                setSettingsNotice(null);
                setView("settings");
              }}
            />
            {historyOpen && phase === "idle" && (
              <HistoryPanel
                key={historyMode}
                history={history}
                mode={historyMode}
                showUndo={text.length > 0}
                sessionIds={sessionIds}
                onCopy={copy}
                onDelete={(id) => void deleteEntries([id])}
                onClear={() => void deleteEntries(history.map((entry) => entry.id))}
              />
            )}
          </>
        )}
        {view === "settings" && settings && (
          <SettingsView
            settings={settings}
            notice={settingsNotice}
            onBack={() => setView("main")}
            onSaved={(saved) => {
              setSettings(saved);
              setSettingsNotice(null);
              setView("main");
            }}
          />
        )}
      </div>
    </div>
  );
}

// ── Snapshot mode: `pnpm snapshot` renders every view to a PNG ───────────

const SAMPLE_HISTORY: HistoryEntry[] = [
  { id: "1", text: "مرحبا، بدي اكتب رسالة سريعة لفريق العمل", createdAt: Date.now() - 2 * 60000, durationMs: 18000 },
  { id: "1b", text: "بدي أشيل الزر كلياته تبع الإنسيرت بشكل عام، لأنه حاسس إنه ما إله أي لزوم، وأنا دايمًا بستخدم الزر تبع كوبي لما بدي أستخدم شي. بإمكانك إنك تشيله بالكامل مشان ينضف التطبيق بشكل عام. وكمان الكنترول إنتر هي مو الطريقة الوحيدة لإنه تنضاف المسج تحت، وإنما كيف بتي 3 كود نحن في عنا الزر تبع سند نفس هذا الزر بقلب التكست فيلد كمان يكون موجود.", createdAt: Date.now() - 3 * 60000, durationMs: 90000 },
  { id: "2", text: "شو رأيك نحط الإعدادات تحت", createdAt: Date.now() - 15 * 60000, durationMs: 7000 },
  { id: "3", text: "Fix the hotkey bug before the release", createdAt: Date.now() - 60 * 60000, durationMs: 5000 },
  { id: "4", text: "بكرا الساعة عشرة منراجع الكود", createdAt: Date.now() - 26 * 3600000, durationMs: 9000 },
];

const LONG_TEXT =
  "مرحبا، بدي اكتب رسالة سريعة لفريق العمل بخصوص التحديث الجاي. أولاً لازم نراجع الكود بكرا الساعة عشرة الصبح، ونتأكد إنو كل الملاحظات المفتوحة انحلّت. بعدين لازم نصلّح مشكلة الاختصار لأنها لسا عم تعمل تعارض على بعض الأجهزة. كمان بقترح نرتّب صفحة الإعدادات ونخليها أوضح للمستخدمين الجداد. إذا خلصنا المراجعة بكرا، منكون جاهزين للإطلاق بالموعد المحدد بدون أي تأخير. وإذا عند حدا ملاحظات زيادة، يا ريت يكتبها بالقناة قبل الاجتماع. وكمان لا تنسوا نحدّث ملف التغييرات ونكتب فيه كل شي تغيّر بهالنسخة، مشان يكون واضح للكل شو الجديد وشو انصلح. شكراً للجميع على الشغل الحلو بهالأسبوع، وبشوفكم بكرا إن شاء الله.";

interface SnapshotSetters {
  setView(v: View): void;
  setHistoryOpen(v: boolean): void;
  setHistory(v: HistoryEntry[]): void;
  setText(v: string): void;
  setDurationMs(v: number): void;
  setPendingText(v: string): void;
  setPhase(v: Phase): void;
  setStartedAt(v: number): void;
  setLevels(v: number[]): void;
  setError(v: string | null): void;
  setSettings(v: Settings): void;
  contentRef: React.RefObject<HTMLDivElement | null>;
}

function useSnapshotHooks(s: SnapshotSetters) {
  const setters = useLatest(s);
  useEffect(() => {
    if (!new URLSearchParams(location.search).has("snapshot")) return;
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const levels = Array.from({ length: LEVEL_BARS }, (_, i) => 0.02 + 0.12 * Math.abs(Math.sin(i * 0.9)));
    const demoSettings: Settings = {
      sonioxApiKey: "sk-demo-1234567890",
      hotkey: "Control+Alt+Space",
      micDeviceId: "",
      languages: ["ar", "en"],
      runOnStartup: false,
    };
    const scenes: Record<string, (x: SnapshotSetters) => void> = {
      "1-empty": (x) => {
        x.setSettings(demoSettings);
        x.setError(null);
        x.setPhase("idle");
        x.setText("");
        x.setDurationMs(0);
        x.setHistoryOpen(false);
        x.setView("main");
      },
      "2-history": (x) => {
        x.setHistory(SAMPLE_HISTORY);
        x.setHistoryOpen(true);
      },
      "3a-listening": (x) => {
        x.setHistoryOpen(false);
        x.setPhase("recording");
        x.setStartedAt(Date.now() - 5000);
        x.setText("");
        x.setPendingText("");
      },
      "3-recording": (x) => {
        x.setHistoryOpen(false);
        x.setPhase("recording");
        x.setStartedAt(Date.now() - 4000);
        x.setLevels(levels);
        x.setText("مرحبا، بدي اكتب");
        x.setPendingText(" رسالة");
      },
      "3b-recording-medium": (x) => {
        x.setText("مرحبا، بدي اكتب رسالة سريعة لفريق العمل بخصوص التحديث الجاي، وأولاً");
        x.setPendingText(" لازم نراجع");
      },
      "4-recording-long": (x) => {
        x.setStartedAt(Date.now() - 41000);
        x.setText(`${LONG_TEXT} ${LONG_TEXT.slice(0, -40)}`);
        x.setPendingText(LONG_TEXT.slice(-40));
      },
      "5a-typed-short": (x) => {
        x.setPhase("idle");
        x.setPendingText("");
        x.setText("مرحبا كيفك");
        x.setDurationMs(0);
      },
      "5-done": (x) => {
        x.setPhase("idle");
        x.setText(LONG_TEXT);
        x.setDurationMs(44000);
      },
      "5b-undo-notice": (x) => {
        x.setHistoryOpen(true);
        showUndoNotice({ action: "Deleted", undo: () => {} });
      },
      "5c-no-speech": (x) => {
        x.setHistoryOpen(false);
        x.setText("");
        x.setDurationMs(0);
        x.setError("No speech detected.");
      },
      "5d-cleared": (x) => {
        x.setError(null);
        x.setHistoryOpen(false);
        x.setText("");
        showUndoNotice({ action: "Cleared", undo: () => {} });
      },
      "6-settings": (x) => {
        x.setError(null);
        x.setHistoryOpen(false);
        x.setView("settings");
      },
      ...Object.fromEntries(
        (["idle", "available", "downloading", "downloaded"] as const).map((status) => [
          `9-update-${status}`,
          (x: SnapshotSetters) => {
            x.setView("main");
            x.setText("");
            // After the main view (and its update button) has mounted.
            setTimeout(() => window.__fdSetUpdateState?.({
              enabled: true,
              status,
              currentVersion: "0.1.2",
              availableVersion: "0.1.3",
              downloadedVersion: status === "downloaded" ? "0.1.3" : null,
              downloadPercent: status === "downloading" ? 40 : null,
              message: null,
              errorContext: null,
            }), 50);
          },
        ]),
      ),
      "8-main-typed": (x) => {
        x.setView("main");
        x.setText("مرحبا كيفك");
      },
    };
    window.__fdSnapshot = {
      // `pnpm probe`: checks mic → worklet → Soniox socket with a fake key; expects a 401 error.
      probe: async () => {
        const events: string[] = [];
        let levelMessages = 0;
        try {
          const session = await startSoniox({
            apiKey: "invalid-key-probe",
            languageHints: ["ar", "en"],
            onText: (f, p) => events.push(`text:${f}|${p}`),
            onLevel: () => levelMessages++,
            onError: (m) => events.push(`error:${m}`),
          });
          await new Promise((r) => setTimeout(r, 2500));
          session.cancel();
        } catch (e) {
          events.push(`start-failed:${describeStartError(e)}`);
        }
        return { events, levelMessages };
      },
      views: () => Object.keys(scenes),
      show: async (name) => {
        scenes[name]?.(setters.current);
        await frame();
        await new Promise((r) => setTimeout(r, 300));
        return (setters.current.contentRef.current?.offsetHeight ?? 95) + 2;
      },
      click: async (selector) => {
        const el = document.querySelector<HTMLElement>(selector);
        if (!el) return false;
        for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
          const init = { bubbles: true, cancelable: true, button: 0, pointerType: "mouse" };
          el.dispatchEvent(type.startsWith("pointer") ? new PointerEvent(type, init) : new MouseEvent(type, init));
        }
        await new Promise((r) => setTimeout(r, 400));
        return true;
      },
    };
  }, [setters]);
}
