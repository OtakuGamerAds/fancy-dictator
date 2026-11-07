const { contextBridge, ipcRenderer } = require("electron");

const listen = (channel) => (callback) => {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld("api", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  listModels: (apiKey) => ipcRenderer.invoke("models:list", apiKey),
  resolveModel: () => ipcRenderer.invoke("models:resolve"),
  saveSettings: (patch) => ipcRenderer.invoke("settings:save", patch),
  getHistory: () => ipcRenderer.invoke("history:get"),
  addHistory: (entry) => ipcRenderer.invoke("history:add", entry),
  clearHistory: () => ipcRenderer.invoke("history:clear"),
  replaceHistory: (entries) => ipcRenderer.invoke("history:replace", entries),
  addAudioClips: (id, clips) => ipcRenderer.invoke("audio:add-clips", id, clips),
  addReplaySegment: (segment) => ipcRenderer.invoke("replay:add-segment", segment),
  listReplay: () => ipcRenderer.invoke("replay:list"),
  readReplay: (file) => ipcRenderer.invoke("replay:read", file),
  trimReplay: (ms) => ipcRenderer.invoke("replay:trim", ms),
  clearReplay: () => ipcRenderer.invoke("replay:clear"),
  transcribeReplay: (webm) => ipcRenderer.invoke("replay:transcribe", webm),
  translate: (text, to) => ipcRenderer.invoke("translate:text", text, to),
  discardAudio: (ids) => ipcRenderer.invoke("audio:discard", ids),
  copy: (text) => ipcRenderer.invoke("clipboard:write", text),
  reportContentHeight: (height) => ipcRenderer.send("window:content-height", height),
  setHitRects: (rects) => ipcRenderer.send("window:hit-rects", rects),
  hide: () => ipcRenderer.send("window:hide"),
  startDrag: () => ipcRenderer.send("window:drag-start"),
  endDrag: () => ipcRenderer.send("window:drag-end"),
  suspendHotkey: () => ipcRenderer.send("hotkey:suspend"),
  resumeHotkey: () => ipcRenderer.send("hotkey:resume"),
  onHidden: listen("app:hidden"),
  onHotkey: listen("hotkey"),
  onOpenSettings: listen("app:open-settings"),
  getUpdateState: () => ipcRenderer.invoke("update:get-state"),
  checkForUpdate: () => ipcRenderer.invoke("update:check"),
  downloadUpdate: () => ipcRenderer.invoke("update:download"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  onUpdateState: listen("update:state"),
});
