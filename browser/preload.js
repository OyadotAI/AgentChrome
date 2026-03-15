const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('oyaBrowser', {
  navigate: (url) => ipcRenderer.invoke('navigate', url),
  goBack: () => ipcRenderer.invoke('go-back'),
  goForward: () => ipcRenderer.invoke('go-forward'),
  reload: () => ipcRenderer.invoke('reload'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  getStatus: () => ipcRenderer.invoke('get-status'),
  enterBrowsing: () => ipcRenderer.invoke('enter-browsing'),
  showOverlay: () => ipcRenderer.invoke('show-overlay'),
  hideOverlay: () => ipcRenderer.invoke('hide-overlay'),
  toggleDevPanel: () => ipcRenderer.invoke('toggle-dev-panel'),
  // Tabs
  newTab: (url) => ipcRenderer.invoke('new-tab', url),
  closeTab: (id) => ipcRenderer.invoke('close-tab', id),
  activateTab: (id) => ipcRenderer.invoke('activate-tab', id),
  // Events
  onUrlChanged: (cb) => ipcRenderer.on('url-changed', (e, url) => cb(url)),
  onTitleChanged: (cb) => ipcRenderer.on('title-changed', (e, title) => cb(title)),
  onWsStatus: (cb) => ipcRenderer.on('ws-status', (e, status) => cb(status)),
  onModeChanged: (cb) => ipcRenderer.on('mode-changed', (e, mode) => cb(mode)),
  onDevLog: (cb) => ipcRenderer.on('dev-log', (e, entry) => cb(entry)),
  onDevPanelState: (cb) => ipcRenderer.on('dev-panel-state', (e, open) => cb(open)),
  onTabsUpdated: (cb) => ipcRenderer.on('tabs-updated', (e, tabs) => cb(tabs)),
});
