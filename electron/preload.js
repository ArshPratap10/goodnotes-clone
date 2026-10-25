const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Notebook CRUD
  saveNotebook: (data) => ipcRenderer.invoke('save-notebook', data),
  loadNotebook: (id) => ipcRenderer.invoke('load-notebook', id),
  listNotebooks: () => ipcRenderer.invoke('list-notebooks'),
  deleteNotebook: (id) => ipcRenderer.invoke('delete-notebook', id),
  renameNotebook: (id, title) => ipcRenderer.invoke('rename-notebook', id, title),
  duplicateNotebook: (id) => ipcRenderer.invoke('duplicate-notebook', id),

  // Settings
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  loadSettings: () => ipcRenderer.invoke('load-settings'),

  // File operations
  openPdfDialog: () => ipcRenderer.invoke('open-pdf-dialog'),
  saveExport: (opts) => ipcRenderer.invoke('save-export', opts),

  // Navigation
  openDataFolder: () => ipcRenderer.invoke('open-data-folder'),
  openNotebooksFolder: () => ipcRenderer.invoke('open-notebooks-folder'),
  getDataDir: () => ipcRenderer.invoke('get-data-dir'),

  // Environment
  isElectron: true
});
