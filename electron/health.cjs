/**
 * Keeping the app alive, and knowing why when it was not. The app runs all day (Replay records
 * all the time), so:
 * - its page coming back by itself when it crashes or stops responding (the window stays open
 *   and empty otherwise), and
 * - a page using far too much memory is reloaded before it slows the computer down,
 * and each of these, with the memory of every process every ten minutes, goes into
 * userData/health.log (kept under a megabyte).
 */
const { app } = require("electron");
const fs = require("fs");
const path = require("path");

const CHECK_MS = 60_000;
const LOG_EVERY = 10; // checks: the memory is written every ten minutes
/** A page this big has something wrong with it: it is reloaded. */
const MAX_PAGE_MB = 2048;
/** Not responding for this long: the page is restarted. */
const HUNG_MS = 20_000;
const MAX_LOG_BYTES = 1024 * 1024;

const logFile = () => path.join(app.getPath("userData"), "health.log");

function log(message) {
  try {
    const file = logFile();
    // Too long: only its second half is kept.
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_LOG_BYTES) {
      const text = fs.readFileSync(file, "utf8");
      fs.writeFileSync(file, text.slice(text.indexOf("\n", text.length / 2) + 1));
    }
    fs.appendFileSync(file, `${new Date().toISOString()} ${message}\n`);
  } catch {}
}

/** Every process of the app with its private memory in MB, e.g. "Tab=41 GPU=110 Browser=75". */
function memory() {
  return app.getAppMetrics().map((p) => ({
    type: p.name ? `${p.type}:${p.name}` : p.type,
    pid: p.pid,
    mb: Math.round((p.memory.privateBytes ?? p.memory.workingSetSize) / 1024),
  }));
}
const describe = (processes) => processes.map((p) => `${p.type}=${p.mb}`).join(" ");

/** Watch the window's page; `isQuitting()` is true once the app is closing. */
function watch(win, isQuitting) {
  const contents = win.webContents;
  let checks = 0;
  let hung = null;
  log(`started ${app.getVersion()} ${describe(memory())}`);

  contents.on("render-process-gone", (_event, details) => {
    log(`page gone: ${details.reason} (exit ${details.exitCode}) ${describe(memory())}`);
    if (!isQuitting() && !win.isDestroyed()) setTimeout(() => !win.isDestroyed() && contents.reload(), 1000);
  });
  contents.on("unresponsive", () => {
    log(`page not responding ${describe(memory())}`);
    clearTimeout(hung);
    hung = setTimeout(() => {
      log("page restarted: not responding");
      if (!win.isDestroyed()) contents.forcefullyCrashRenderer(); // then reloaded, as above
    }, HUNG_MS);
  });
  contents.on("responsive", () => clearTimeout(hung));

  const timer = setInterval(() => {
    if (win.isDestroyed()) return clearInterval(timer);
    const processes = memory();
    if (++checks % LOG_EVERY === 0) log(describe(processes));
    const page = processes.find((p) => p.pid === contents.getOSProcessId());
    if (page && page.mb > MAX_PAGE_MB) {
      log(`page reloaded: ${page.mb} MB ${describe(processes)}`);
      contents.reload();
    }
  }, CHECK_MS);
}

module.exports = { watch, log };
