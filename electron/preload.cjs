const { contextBridge, ipcRenderer } = require("electron");

const listen = (channel) => (callback) => {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld("api", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  getBalance: () => ipcRenderer.invoke("balance:get"),
  saveSettings: (patch) => ipcRenderer.invoke("settings:save", patch),
  getHistory: () => ipcRenderer.invoke("history:get"),
  addHistory: (entry) => ipcRenderer.invoke("history:add", entry),
  clearHistory: () => ipcRenderer.invoke("history:clear"),
  replaceHistory: (entries) => ipcRenderer.invoke("history:replace", entries),
  copy: (text) => ipcRenderer.invoke("clipboard:write", text),
  reportContentHeight: (height) => ipcRenderer.send("window:content-height", height),
  setHitRects: (rects) => ipcRenderer.send("window:hit-rects", rects),
  hide: () => ipcRenderer.send("window:hide"),
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
