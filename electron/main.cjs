/**
 * Fancy Dictator — main process.
 *
 * One frameless, transparent window of a fixed size. The card inside it (T3 Code's
 * composer width at most, 736px) animates its own size; the empty rest of the window
 * lets clicks through.
 */
const {
  app,
  BrowserWindow,
  desktopCapturer,
  Menu,
  Tray,
  clipboard,
  globalShortcut,
  ipcMain,
  nativeImage,
  protocol,
  screen,
  session,
} = require("electron");
const fs = require("fs");
const path = require("path");
const store = require("./store.cjs");
const updater = require("./updater.cjs");
const models = require("./models.cjs");
const audio = require("./audio.cjs");

/**
 * The window never changes size: resizing a transparent window makes Windows flash the old
 * frame for a moment. It is as wide as the card (a fixed 420px) and tall enough for every
 * view; the card animates its height inside it, and the transparent rest lets clicks through
 * (see "Click-through" below).
 */
const WIDTH = 420;
const HEIGHT = 760;
const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const SNAPSHOT = process.env.FD_SNAPSHOT === "1";
// `pnpm snapshot`/`pnpm probe` keep their settings, messages and audio in a folder of their
// own, so they never touch (or save test messages into) the real ones.
if (SNAPSHOT) app.setPath("userData", path.join(require("os").tmpdir(), "fancy-dictator-snapshot"));

let win = null;
let tray = null;
let settings = null;
let activeHotkey = null;
let quitting = false;

// ── Window ────────────────────────────────────────────────────────────────

/** The window is positioned by its top-center, which is also the card's. */
function defaultAnchor() {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    cx: Math.round(workArea.x + workArea.width / 2),
    y: Math.round(workArea.y + workArea.height * 0.18),
  };
}

/** Use the saved anchor only if it is still on a connected display. */
function savedAnchor() {
  // `cardAnchor` is the card's top-center. Older versions saved the 736px window's center,
  // with the card at its right edge: the card's center was 160px to the right of it.
  const old = settings.windowAnchor;
  const pos = settings.cardAnchor ?? (old ? { cx: old.cx + 160, y: old.y } : null);
  if (!pos || !Number.isFinite(pos.cx) || !Number.isFinite(pos.y)) return null;
  const onScreen = screen.getAllDisplays().some(({ workArea: a }) => {
    return pos.cx > a.x + 40 && pos.cx < a.x + a.width - 40 && pos.y >= a.y && pos.y < a.y + a.height - 40;
  });
  return onScreen ? pos : null;
}

function createWindow() {
  const anchor = savedAnchor() ?? defaultAnchor();
  const { workArea } = screen.getDisplayNearestPoint({ x: anchor.cx, y: anchor.y });
  win = new BrowserWindow({
    x: Math.round(anchor.cx - WIDTH / 2),
    y: anchor.y,
    width: WIDTH,
    height: Math.min(HEIGHT, workArea.height),
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    // In the taskbar while open; hidden, a window leaves the taskbar by itself (tray only).
    skipTaskbar: false,
    alwaysOnTop: true,
    show: false,
    title: "Fancy Dictator",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, "screen-saver");

  const query = SNAPSHOT ? { snapshot: "1" } : undefined;
  if (DEV_URL) win.loadURL(SNAPSHOT ? `${DEV_URL}?snapshot=1` : DEV_URL);
  else win.loadFile(path.join(__dirname, "..", "dist", "index.html"), { query });

  win.once("ready-to-show", () => {
    if (SNAPSHOT) runSnapshots();
    else showWindow();
  });

  // However the window gets hidden, a recording in progress is stopped and kept.
  win.on("hide", () => sendToWindow("app:hidden"));
  win.on("moved", rememberPlace);
  win.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    hideWindow();
  });
  // Quitting (or restarting into an update) destroys the window; nothing may touch it after.
  win.on("closed", () => {
    stopHitTesting();
    win = null;
  });
}

/** A window that is quitting is destroyed before every timer and event has stopped. */
const windowAlive = () => win !== null && !win.isDestroyed();

function sendToWindow(channel, payload) {
  if (windowAlive()) win.webContents.send(channel, payload);
}

function showWindow() {
  if (!windowAlive()) return;
  win.show();
  win.focus();
  startHitTesting();
}

function hideWindow() {
  if (!windowAlive()) return;
  win.hide();
  stopHitTesting();
}

// ── Click-through ─────────────────────────────────────────────────────────
// Only the card (and an open dropdown) should take the mouse; the transparent rest of the
// window must let clicks reach the app behind it. The renderer reports those rectangles, and
// here the cursor is checked against them every frame. This must not rely on mouse events
// forwarded to the page: on Windows that forwarding stops once another app takes focus,
// which left the window ignoring clicks on the card itself, so they landed on the app behind.

let hitRects = []; // [{ x, y, width, height }] in window coordinates
let hitTimer = null;
let ignoring = null;

function setIgnoring(ignore) {
  if (!windowAlive() || ignore === ignoring) return;
  ignoring = ignore;
  win.setIgnoreMouseEvents(ignore);
}

function updateClickThrough() {
  if (!windowAlive() || !win.isVisible()) return;
  const cursor = screen.getCursorScreenPoint();
  const bounds = win.getBounds();
  const x = cursor.x - bounds.x;
  const y = cursor.y - bounds.y;
  const overContent = hitRects.some((r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);
  setIgnoring(!overContent);
}

function startHitTesting() {
  if (hitTimer) return;
  hitTimer = setInterval(updateClickThrough, 16);
  updateClickThrough();
}

function stopHitTesting() {
  clearInterval(hitTimer);
  hitTimer = null;
}

/** If the card would run past the bottom of the screen, move the window up just enough. */
/** Where the card is, so it opens there next time. */
function rememberPlace() {
  if (!windowAlive()) return;
  const { x, y, width } = win.getBounds();
  settings = store.saveSettings({ cardAnchor: { cx: Math.round(x + width / 2), y } });
}

/**
 * Dragging the card: the window follows the mouse from the press until the release. Its size
 * is set with every move, since moving alone can change it by a pixel on scaled displays.
 */
let drag = null;
function startDrag() {
  if (!windowAlive() || drag) return;
  const cursor = screen.getCursorScreenPoint();
  const bounds = win.getBounds();
  const follow = () => {
    const now = screen.getCursorScreenPoint();
    const x = bounds.x + now.x - cursor.x;
    const y = bounds.y + now.y - cursor.y;
    const current = win.getBounds();
    if (current.x !== x || current.y !== y) win.setBounds({ x, y, width: current.width, height: current.height });
  };
  drag = setInterval(() => (windowAlive() ? follow() : endDrag()), 8);
}
function endDrag() {
  if (!drag) return;
  clearInterval(drag);
  drag = null;
  rememberPlace();
}

function keepOnScreen(contentHeight) {
  if (!windowAlive() || !Number.isFinite(contentHeight)) return;
  const bounds = win.getBounds();
  const { workArea: a } = screen.getDisplayMatching(bounds);
  const bottom = a.y + a.height;
  if (bounds.y + contentHeight <= bottom) return;
  win.setPosition(bounds.x, Math.max(a.y, Math.round(bottom - contentHeight)));
}

// ── Hotkey ────────────────────────────────────────────────────────────────

/**
 * The shortcut opens the window and starts recording. Pressed again it stops a recording,
 * or hides the window when nothing is recording (the renderer decides, it knows).
 */
function onHotkey() {
  if (!windowAlive()) return;
  if (win.isVisible()) {
    sendToWindow("hotkey", { opened: false });
  } else {
    showWindow();
    sendToWindow("hotkey", { opened: true });
  }
}

/** Register `accelerator`. Returns an error message, or null on success. */
function registerHotkey(accelerator) {
  if (activeHotkey) globalShortcut.unregister(activeHotkey);
  activeHotkey = null;
  try {
    if (!globalShortcut.register(accelerator, onHotkey)) {
      return `"${accelerator}" is already used by another app.`;
    }
  } catch {
    return `"${accelerator}" is not a valid shortcut.`;
  }
  activeHotkey = accelerator;
  return null;
}


// ── Tray ──────────────────────────────────────────────────────────────────

/** A 32×32 blue dot with a white mic, drawn pixel by pixel (no image files needed). */
function trayIcon() {
  const size = 32;
  const buf = Buffer.alloc(size * size * 4);
  const cover = (inside) => Math.max(0, Math.min(1, inside + 0.5));
  const capsule = (x, y) => {
    // Mic head: a capsule from y=8 to y=18, x centered, radius 4.
    const cx = 15.5;
    const cy = Math.max(11.5, Math.min(14.5, y));
    return 4 - Math.hypot(x - cx, y - cy);
  };
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = px + 0.5;
      const y = py + 0.5;
      const circle = cover(15.5 - Math.hypot(x - 16, y - 16));
      // Mic: capsule head, a U-shaped holder, a stem and a base.
      const ring = Math.abs(Math.hypot(x - 15.5, y - 14) - 6.5);
      const holder = y > 14 && y < 21.5 ? cover(1 - ring) : 0;
      const stem = Math.abs(x - 15.5) < 1 && y > 20 && y < 24.5 ? 1 : 0;
      const base = Math.abs(y - 24.5) < 1 && Math.abs(x - 15.5) < 4 ? 1 : 0;
      const white = Math.min(1, Math.max(cover(capsule(x, y)), holder, stem, base));
      const i = (py * size + px) * 4;
      // BGRA. Blue is T3's primary, #3B6EF5.
      buf[i] = Math.round(0xf5 * (1 - white) + 255 * white);
      buf[i + 1] = Math.round(0x6e * (1 - white) + 255 * white);
      buf[i + 2] = Math.round(0x3b * (1 - white) + 255 * white);
      buf[i + 3] = Math.round(255 * circle);
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size, scaleFactor: 2 });
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip("Fancy Dictator");
  const pretty = () => (settings.hotkey || "").replace(/Control/g, "Ctrl");
  const menu = () =>
    Menu.buildFromTemplate([
      { label: `Show  (${pretty()})`, click: showWindow },
      {
        label: "Settings",
        click: () => {
          showWindow();
          sendToWindow("app:open-settings");
        },
      },
      { type: "separator" },
      { label: "Quit", click: () => ((quitting = true), app.quit()) },
    ]);
  tray.on("click", () => (windowAlive() && win.isVisible() ? hideWindow() : showWindow()));
  tray.on("right-click", () => tray.popUpContextMenu(menu()));
}

function applyLoginItem() {
  if (!app.isPackaged) return; // In dev this would register electron.exe itself.
  app.setLoginItemSettings({
    openAtLogin: !!settings.runOnStartup,
    path: process.execPath,
  });
}

// ── Soniox balance ────────────────────────────────────────────────────────

/**
 * The prepaid balance, from Soniox's Organization API (GET /v1/organization/balance). It needs
 * an organization API key (snx_org_…); the project key used for dictation cannot read it.
 * Runs here rather than in the page, whose security policy only allows the dictation socket.
 */
async function fetchBalance() {
  if (SNAPSHOT) return { error: null, availableUsd: "1.58" }; // `pnpm snapshot` shows the layout
  const key = settings.sonioxOrgKey;
  if (!key) return { error: null };
  try {
    const response = await fetch("https://api.soniox.com/v1/organization/balance", {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (response.status === 401 || response.status === 403) {
      return { error: "This key can't read the balance" };
    }
    if (!response.ok) return { error: "Couldn't load the balance" };
    const body = await response.json();
    return { error: null, availableUsd: body.available_balance_usd, invoiced: Boolean(body.invoice_billing_enabled) };
  } catch {
    return { error: "Couldn't reach Soniox" };
  }
}

// ── IPC ───────────────────────────────────────────────────────────────────

function sanitize(patch) {
  const out = {};
  if (typeof patch.sonioxApiKey === "string") out.sonioxApiKey = patch.sonioxApiKey.trim();
  if (typeof patch.sonioxOrgKey === "string") out.sonioxOrgKey = patch.sonioxOrgKey.trim();
  if (typeof patch.sonioxModel === "string" && patch.sonioxModel) out.sonioxModel = patch.sonioxModel;
  if (typeof patch.hotkey === "string" && patch.hotkey) out.hotkey = patch.hotkey;
  if (typeof patch.micDeviceId === "string") out.micDeviceId = patch.micDeviceId;
  if (Array.isArray(patch.languages)) out.languages = patch.languages.filter((l) => typeof l === "string");
  if (typeof patch.runOnStartup === "boolean") out.runOnStartup = patch.runOnStartup;
  return out;
}

function registerIpc() {
  ipcMain.handle("settings:get", () => settings);
  ipcMain.handle("balance:get", () => fetchBalance());
  ipcMain.handle("models:list", (_e, apiKey) =>
    SNAPSHOT
      ? { models: [{ id: "stt-rt-v6", name: "stt-rt-v6" }, { id: "stt-rt-v5", name: "stt-rt-v5" }], latest: "stt-rt-v6", error: null }
      : models.listModels(String(apiKey || settings.sonioxApiKey), { force: true }),
  );
  ipcMain.handle("models:resolve", () =>
    SNAPSHOT ? "stt-rt-v6" : models.resolveModel(settings.sonioxApiKey, settings.sonioxModel),
  );
  ipcMain.handle("settings:save", (_e, patch) => {
    const previous = settings.hotkey;
    settings = store.saveSettings(sanitize(patch || {}));
    let hotkeyError = null;
    if (settings.hotkey !== previous || !activeHotkey) {
      hotkeyError = registerHotkey(settings.hotkey);
      if (hotkeyError) {
        registerHotkey(previous);
        settings = store.saveSettings({ hotkey: previous });
      }
    }
    applyLoginItem();
    return { settings, hotkeyError };
  });
  // Every list of messages says which audio clips each one has saved.
  const withAudio = (history) =>
    history.map((entry) => {
      const parts = audio.parts(entry.id);
      return { ...entry, audioClips: parts.length, audioParts: parts };
    });
  ipcMain.handle("history:get", () => withAudio(store.getHistory()));
  ipcMain.handle("history:add", (_e, entry) => {
    const before = store.getHistory();
    const history = store.addHistory(entry);
    // Past the 50 kept messages the oldest is dropped for good (there is no undo): its audio too.
    audio.remove(before.filter((old) => !history.some((kept) => kept.id === old.id)).map((old) => old.id));
    return withAudio(history);
  });
  ipcMain.handle("history:clear", () => withAudio(store.clearHistory()));
  ipcMain.handle("history:replace", (_e, entries) => withAudio(store.replaceHistory(entries)));
  ipcMain.handle("audio:add-clips", (_e, id, clips) => audio.addRecording(id, clips));
  // Deleted messages can no longer be brought back: erase their audio, unless one was restored.
  ipcMain.handle("audio:discard", (_e, ids) => {
    const history = store.getHistory();
    const gone = (Array.isArray(ids) ? ids : []).filter((id) => !history.some((entry) => entry.id === id));
    audio.remove(gone);
  });

  ipcMain.handle("clipboard:write", (_e, text) => clipboard.writeText(String(text ?? "")));
  ipcMain.on("window:content-height", (_e, height) => keepOnScreen(Number(height)));
  ipcMain.on("window:drag-start", startDrag);
  ipcMain.on("window:drag-end", endDrag);
  ipcMain.on("window:hit-rects", (_e, rects) => {
    hitRects = Array.isArray(rects) ? rects : [];
    updateClickThrough();
  });
  ipcMain.on("window:hide", hideWindow);
  ipcMain.on("hotkey:suspend", () => {
    if (activeHotkey) globalShortcut.unregister(activeHotkey);
    activeHotkey = null;
  });
  ipcMain.on("hotkey:resume", () => registerHotkey(settings.hotkey));
  ipcMain.handle("update:get-state", () => updater.getState());
  ipcMain.handle("update:check", () => updater.check());
  ipcMain.handle("update:download", () => updater.download());
  ipcMain.handle("update:install", () =>
    updater.install(() => {
      quitting = true; // let the window close for real while the installer takes over
    }),
  );
}

// ── Snapshot mode (FD_SNAPSHOT=1): render every view to ./snapshots/*.png ──

const CARD_RECT = `(() => {
  const r = document.querySelector("#root > div").getBoundingClientRect();
  return { x: Math.floor(r.left), y: Math.floor(r.top), width: Math.ceil(r.width), height: Math.ceil(r.height) };
})()`;

async function runSnapshots() {
  const outDir = path.join(__dirname, "..", "snapshots");
  fs.mkdirSync(outDir, { recursive: true });
  win.showInactive();
  // `pnpm probe` only runs the probe; `pnpm snapshot 5e 5j` renders only the views whose names
  // start with those (all of them without names).
  if (process.env.FD_PROBE) {
    console.log("[probe]", JSON.stringify(await win.webContents.executeJavaScript("window.__fdSnapshot.probe()")));
    quitting = true;
    app.quit();
    return;
  }
  const only = process.argv.slice(2).filter((arg) => /^\d/.test(arg));
  const wanted = (name) => only.length === 0 || only.some((prefix) => name.startsWith(prefix));
  const views = await win.webContents.executeJavaScript("window.__fdSnapshot.views()");
  for (const name of views) {
    // Each view builds on the ones before it: those not wanted are only set up, not shown.
    if (!wanted(name)) {
      await win.webContents.executeJavaScript(`window.__fdSnapshot.apply(${JSON.stringify(name)})`);
      continue;
    }
    await win.webContents.executeJavaScript(`window.__fdSnapshot.show(${JSON.stringify(name)})`);
    await new Promise((r) => setTimeout(r, 500)); // let the card's size animation finish
    const rect = await win.webContents.executeJavaScript(CARD_RECT);
    const height = rect.height;
    const image = await win.webContents.capturePage(rect);
    fs.writeFileSync(path.join(outDir, `${name}.png`), image.toPNG());
    console.log(`[snapshot] ${name}.png (${rect.width}×${height})`);
  }
  // The settings dropdowns, open .
  if (wanted("7-settings-select")) {
    await win.webContents.executeJavaScript(`window.__fdSnapshot.show("6-settings")`);
    await new Promise((r) => setTimeout(r, 500));
    const triggers = await win.webContents.executeJavaScript(
      "document.querySelectorAll('[data-slot=select-trigger]').length",
    );
    for (let i = 0; i < triggers; i++) {
      // A real mouse click at the trigger's center, as a user would do it.
      const { x, y } = await win.webContents.executeJavaScript(`(() => {
        const r = document.querySelectorAll('[data-slot=select-trigger]')[${i}].getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      })()`);
      win.webContents.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
      win.webContents.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
      await new Promise((r) => setTimeout(r, 800));
      // The card plus the open dropdown, which may hang below it.
      const rect = await win.webContents.executeJavaScript(`(() => {
        const card = document.querySelector("#root > div").getBoundingClientRect();
        const popup = document.querySelector("[data-slot=select-popup]")?.getBoundingClientRect();
        const bottom = Math.ceil(Math.max(card.bottom, popup ? popup.bottom + 8 : 0));
        return { x: Math.floor(card.left), y: Math.floor(card.top), width: Math.ceil(card.width), height: bottom - Math.floor(card.top) };
      })()`);
      const image = await win.webContents.capturePage(rect);
      fs.writeFileSync(path.join(outDir, `7-settings-select-${i + 1}.png`), image.toPNG());
      console.log(`[snapshot] 7-settings-select-${i + 1}.png`);
      win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  // The model picker in Settings, open.
  if (wanted("7-model-picker")) {
    await win.webContents.executeJavaScript(`window.__fdSnapshot.show("6-settings")`);
    await new Promise((r) => setTimeout(r, 500));
    const picker = await win.webContents.executeJavaScript(`(() => {
      const el = document.querySelector('[data-slot=popover-trigger]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    if (picker) {
      win.webContents.sendInputEvent({ type: "mouseDown", ...picker, button: "left", clickCount: 1 });
      win.webContents.sendInputEvent({ type: "mouseUp", ...picker, button: "left", clickCount: 1 });
      await new Promise((r) => setTimeout(r, 800));
      const rect = await win.webContents.executeJavaScript(`(() => {
        const card = document.querySelector("#root > div").getBoundingClientRect();
        const popup = document.querySelector("[data-slot=popover-popup]")?.getBoundingClientRect();
        const bottom = Math.ceil(Math.max(card.bottom, popup ? popup.bottom + 8 : 0));
        return { x: Math.floor(card.left), y: Math.floor(card.top), width: Math.ceil(card.width), height: bottom - Math.floor(card.top) };
      })()`);
      fs.writeFileSync(path.join(outDir, "7-model-picker.png"), (await win.webContents.capturePage(rect)).toPNG());
      console.log("[snapshot] 7-model-picker.png");
    }
  }
  // A saved conversation's Copy menu, open.
  if (wanted("5h-conversation-copy-menu")) {
    await win.webContents.executeJavaScript(`window.__fdSnapshot.show("5g-conversation-history")`);
    await new Promise((r) => setTimeout(r, 500));
    const copyOptions = await win.webContents.executeJavaScript(`(() => {
      const el = document.querySelector('[data-speaker]')?.closest("li")?.querySelector('[aria-label="Copy"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    if (copyOptions) {
      win.webContents.sendInputEvent({ type: "mouseDown", ...copyOptions, button: "left", clickCount: 1 });
      win.webContents.sendInputEvent({ type: "mouseUp", ...copyOptions, button: "left", clickCount: 1 });
      await new Promise((r) => setTimeout(r, 800));
      const rect = await win.webContents.executeJavaScript(`(() => {
        const card = document.querySelector("#root > div").getBoundingClientRect();
        const popup = document.querySelector("[data-slot=menu-popup]")?.getBoundingClientRect();
        const bottom = Math.ceil(Math.max(card.bottom, popup ? popup.bottom + 8 : 0));
        return { x: Math.floor(card.left), y: Math.floor(card.top), width: Math.ceil(card.width), height: bottom - Math.floor(card.top) };
      })()`);
      fs.writeFileSync(path.join(outDir, "5h-conversation-copy-menu.png"), (await win.webContents.capturePage(rect)).toPNG());
      console.log("[snapshot] 5h-conversation-copy-menu.png");
      // Esc closes the menu only, not the window.
      win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
      win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
      await new Promise((r) => setTimeout(r, 500));
      const menuOpen = await win.webContents.executeJavaScript(`!!document.querySelector("[data-slot=menu-popup]")`);
      console.log(`[snapshot] Esc on the Copy menu: menu ${menuOpen ? "still open" : "closed"}, window ${win.isVisible() ? "still shown" : "hidden"}`);
    }
  }
  // The session picker under the list, open.
  if (wanted("5m-session-picker")) {
    await win.webContents.executeJavaScript(`window.__fdSnapshot.show("1-empty")`);
    await win.webContents.executeJavaScript(`window.__fdSnapshot.show("2-history")`);
    await new Promise((r) => setTimeout(r, 500));
    const trigger = await win.webContents.executeJavaScript(`(() => {
      const r = document.querySelector('[aria-label="Session"]')?.getBoundingClientRect();
      return r && { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    if (trigger) {
      win.webContents.sendInputEvent({ type: "mouseDown", ...trigger, button: "left", clickCount: 1 });
      win.webContents.sendInputEvent({ type: "mouseUp", ...trigger, button: "left", clickCount: 1 });
      await new Promise((r) => setTimeout(r, 800));
      const rect = await win.webContents.executeJavaScript(CARD_RECT);
      fs.writeFileSync(path.join(outDir, "5m-session-picker.png"), (await win.webContents.capturePage(rect)).toPNG());
      console.log("[snapshot] 5m-session-picker.png");
      // Picking the third session shows it.
      const item = await win.webContents.executeJavaScript(`(() => {
        const r = document.querySelectorAll("[data-slot=select-item]")[2]?.getBoundingClientRect();
        return r && { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      })()`);
      if (item) {
        win.webContents.sendInputEvent({ type: "mouseDown", ...item, button: "left", clickCount: 1 });
        win.webContents.sendInputEvent({ type: "mouseUp", ...item, button: "left", clickCount: 1 });
        await new Promise((r) => setTimeout(r, 500));
      }
      const shown = await win.webContents.executeJavaScript(
        `[document.querySelector('[aria-label="Session"]')?.textContent, document.querySelector("#root li [data-selectable]")?.textContent?.slice(0, 30)]`,
      );
      console.log(`[snapshot] picked the third session: ${JSON.stringify(shown)}`);
    }
  }
  // A real click 60% along a message's recording (from its play button) jumps there.
  if (wanted("5j-audio-jump")) {
    await win.webContents.executeJavaScript(`window.__fdSnapshot.show("1-empty")`);
    await win.webContents.executeJavaScript(`window.__fdSnapshot.show("2-history")`);
    await new Promise((r) => setTimeout(r, 1500)); // the recordings load
    const chip = await win.webContents.executeJavaScript(`(() => {
      const r = document.querySelector("[data-slot=context-chip]")?.getBoundingClientRect();
      return r && { x: Math.round(r.right - r.width * 0.6), y: Math.round(r.top + r.height / 2) }; // an Arabic message
    })()`);
    if (chip) {
      win.webContents.sendInputEvent({ type: "mouseDown", ...chip, button: "left", clickCount: 1 });
      win.webContents.sendInputEvent({ type: "mouseUp", ...chip, button: "left", clickCount: 1 });
      await new Promise((r) => setTimeout(r, 400));
      const rect = await win.webContents.executeJavaScript(CARD_RECT);
      fs.writeFileSync(path.join(outDir, "5j-audio-jump.png"), (await win.webContents.capturePage(rect)).toPNG());
      const label = await win.webContents.executeJavaScript(`document.querySelector("[data-slot=context-chip]").textContent`);
      console.log(`[snapshot] 5j-audio-jump.png (after the click: ${label})`);
    }
  }
  quitting = true;
  app.quit();
}

// ── App ───────────────────────────────────────────────────────────────────

// Messages' audio plays from fd-audio://audio/<id>/<clip>: Chromium will not play blob: URLs on a
// page loaded from a file, and a privileged scheme can be streamed by <audio>.
protocol.registerSchemesAsPrivileged([
  { scheme: "fd-audio", privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
]);

function serveAudio() {
  protocol.handle("fd-audio", (request) => {
    const [id = "", position = ""] = new URL(request.url).pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const index = Number(position);
    if (!Number.isInteger(index) || index < 0) return new Response(null, { status: 404 });
    // Snapshots play a made-up tone for their sample messages; the probe's recordings are real.
    const clip = audio.get(id, index) ?? (SNAPSHOT ? audio.sample(index === 0 ? 7 : 4) : null);
    if (!clip) return new Response(null, { status: 404 });
    const size = clip.bytes.byteLength;
    const headers = { "content-type": clip.type, "accept-ranges": "bytes", "cache-control": "no-store" };
    // A part of the clip, when the player jumps to a point in it.
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start >= size || start > end) {
        return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
      }
      return new Response(clip.bytes.subarray(start, end + 1), {
        status: 206,
        headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) },
      });
    }
    return new Response(clip.bytes, { headers: { ...headers, "content-length": String(size) } });
  });
}

// Snapshot runs skip the lock so they work while the real app is open.
if (!SNAPSHOT && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showWindow);
  app.whenReady().then(() => {
    settings = store.getSettings();
    if (!SNAPSHOT) audio.prune(store.getHistory().map((entry) => entry.id));
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(permission === "media" || permission === "clipboard-sanitized-write");
    });
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === "media");
    // "Dictate others": the page asks for the screen and its audio; it gets what the computer
    // is playing (Windows loopback). The screen's video is required by Chromium and dropped.
    session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
      try {
        const [screenSource] = await desktopCapturer.getSources({ types: ["screen"] });
        callback(screenSource ? { video: screenSource, audio: "loopback" } : {});
      } catch {
        callback({});
      }
    });
    registerIpc();
    serveAudio();
    createWindow();
    if (SNAPSHOT) return;
    const error = registerHotkey(settings.hotkey);
    if (error) console.warn("[Hotkey]", error);
    createTray();
    updater.init((state) => sendToWindow("update:state", state));
    applyLoginItem();
  });
  app.on("window-all-closed", () => {
    /* Keep running in the tray. */
  });
  app.on("before-quit", () => {
    quitting = true;
    stopHitTesting();
  });
  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
  });
}
