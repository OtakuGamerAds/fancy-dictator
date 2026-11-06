/**
 * Updates from GitHub Releases, the way T3 Code does it (apps/desktop/src/updates,
 * MIT License — see THIRD_PARTY_LICENSE_T3CODE.txt):
 *
 * - check at startup and every 4 minutes;
 * - never download on its own: the update button downloads when clicked;
 * - once downloaded, the button restarts into the new version, silently
 *   (quitAndInstall with isSilent and isForceRunAfter, as T3 does).
 *
 * The state shape and transitions follow T3's updateMachine.ts, trimmed to what this app shows.
 */
const { app } = require("electron");
const { autoUpdater } = require("electron-updater");

const POLL_INTERVAL_MS = 4 * 60 * 1000;
/**
 * Where to look for a new version: the latest release's own files, which change the moment it
 * is published. (The "github" provider, T3's, reads the releases feed, which GitHub refreshes
 * minutes later.) Releases are still published to GitHub as before.
 */
const FEED_URL = "https://github.com/OtakuGamerAds/fancy-dictator/releases/latest/download";
const STARTUP_DELAY_MS = 10 * 1000;

let state = {
  enabled: false,
  status: "disabled", // disabled | idle | checking | up-to-date | available | downloading | downloaded | error
  currentVersion: app.getVersion(),
  availableVersion: null,
  downloadedVersion: null,
  downloadPercent: null,
  message: null,
  errorContext: null, // "check" | "download" | "install"
};

let notify = () => {};
let downloading = false;

function setState(patch) {
  state = { ...state, ...patch };
  notify(state);
}

/**
 * A short message for the button's tooltip. electron-updater's errors carry the whole HTTP
 * exchange (method, URL, headers, HTML body), which is noise to anyone using the app.
 */
function errorMessage(error) {
  const text = error instanceof Error ? error.message : String(error);
  const status = Number(error?.statusCode ?? text.match(/^\s*(\d{3})\b/)?.[1]);
  const network = /ENOTFOUND|EAI_AGAIN|ENETUNREACH|ECONNRESET|ECONNREFUSED|ETIMEDOUT|net::ERR_/.test(text);
  if (network || status >= 500) return "Couldn't reach GitHub right now";
  if (status === 404) return "No update information was found";
  return text.split(/\r?\n/)[0].slice(0, 120);
}

function wireEvents() {
  autoUpdater.on("checking-for-update", () => {
    // A downloaded update stays ready while checking again.
    if (state.downloadedVersion) return;
    setState({ status: "checking", message: null, errorContext: null });
  });
  autoUpdater.on("update-available", (info) => {
    const isDownloaded = state.downloadedVersion === info.version;
    setState({
      status: isDownloaded ? "downloaded" : "available",
      availableVersion: info.version,
      downloadPercent: isDownloaded ? 100 : null,
      message: null,
      errorContext: null,
    });
  });
  autoUpdater.on("update-not-available", () => {
    if (state.downloadedVersion) return setState({ status: "downloaded", downloadPercent: 100 });
    setState({ status: "up-to-date", availableVersion: null, downloadPercent: null, message: null, errorContext: null });
  });
  autoUpdater.on("download-progress", (progress) => {
    setState({ status: "downloading", downloadPercent: progress.percent });
  });
  autoUpdater.on("update-downloaded", (info) => {
    downloading = false;
    setState({ status: "downloaded", downloadedVersion: info.version, downloadPercent: 100, message: null, errorContext: null });
  });
  autoUpdater.on("error", (error) => {
    if (downloading) return; // reported by download()
    if (state.downloadedVersion) return setState({ status: "downloaded", downloadPercent: 100 });
    setState({ status: "error", message: errorMessage(error), errorContext: "check" });
  });
}

async function check() {
  if (!state.enabled || downloading || state.status === "checking") return;
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    if (!state.downloadedVersion) setState({ status: "error", message: errorMessage(error), errorContext: "check" });
  }
}

async function download() {
  if (!state.enabled || downloading || !state.availableVersion) return state;
  downloading = true;
  setState({ status: "downloading", downloadPercent: 0, message: null, errorContext: null });
  try {
    await autoUpdater.downloadUpdate();
  } catch (error) {
    downloading = false;
    // Back to "available" so the button offers a retry.
    setState({ status: "available", downloadPercent: null, message: errorMessage(error), errorContext: "download" });
  }
  return state;
}

function install(beforeQuit) {
  if (!state.enabled || !state.downloadedVersion) return state;
  try {
    beforeQuit();
    autoUpdater.quitAndInstall(true, true);
  } catch (error) {
    setState({ status: "error", message: errorMessage(error), errorContext: "install" });
  }
  return state;
}

/** Start updating. Only the installed app updates; `pnpm start`/`pnpm dev` stay disabled. */
function init(onState) {
  notify = onState;
  if (!app.isPackaged) return;
  autoUpdater.setFeedURL({ provider: "generic", url: FEED_URL });
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  wireEvents();
  setState({ enabled: true, status: "idle" });
  setTimeout(check, STARTUP_DELAY_MS);
  setInterval(check, POLL_INTERVAL_MS);
}

module.exports = { init, check, download, install, getState: () => state };
