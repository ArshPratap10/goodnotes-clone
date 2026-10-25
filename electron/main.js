const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ─── Data directory: Documents/GoodNotes_App_Data ───────────────────────────
const DATA_DIR = path.join(os.homedir(), 'Documents', 'GoodNotes_App_Data');
const NOTEBOOKS_DIR = path.join(DATA_DIR, 'notebooks');
const EXPORTS_DIR = path.join(DATA_DIR, 'exports');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

function ensureDirectories() {
  [DATA_DIR, NOTEBOOKS_DIR, EXPORTS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}

// ─── IPC Handlers ────────────────────────────────────────────────────────────

// Save a notebook JSON to disk
ipcMain.handle('save-notebook', async (event, notebookData) => {
  try {
    ensureDirectories();
    const id = notebookData.id || 'default_notebook';
    const filePath = path.join(NOTEBOOKS_DIR, `${id}.gnotes`);
    fs.writeFileSync(filePath, JSON.stringify(notebookData, null, 2), 'utf8');
    return { success: true, path: filePath };
  } catch (err) {
    console.error('save-notebook error:', err);
    return { success: false, error: err.message };
  }
});

// Load a specific notebook
ipcMain.handle('load-notebook', async (event, notebookId) => {
  try {
    ensureDirectories();
    if (notebookId) {
      const filePath = path.join(NOTEBOOKS_DIR, `${notebookId}.gnotes`);
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return { success: true, data };
      }
      return { success: false, error: 'Not found' };
    }
    // Return most recent if no ID
    const files = fs.readdirSync(NOTEBOOKS_DIR).filter(f => f.endsWith('.gnotes'));
    if (files.length === 0) return { success: true, data: null };
    files.sort((a, b) => {
      const statA = fs.statSync(path.join(NOTEBOOKS_DIR, a));
      const statB = fs.statSync(path.join(NOTEBOOKS_DIR, b));
      return statB.mtimeMs - statA.mtimeMs;
    });
    const data = JSON.parse(fs.readFileSync(path.join(NOTEBOOKS_DIR, files[0]), 'utf8'));
    return { success: true, data };
  } catch (err) {
    console.error('load-notebook error:', err);
    return { success: false, error: err.message };
  }
});

// List all notebooks (metadata only - fast)
ipcMain.handle('list-notebooks', async () => {
  try {
    ensureDirectories();
    const files = fs.readdirSync(NOTEBOOKS_DIR).filter(f => f.endsWith('.gnotes'));
    const list = files.map(f => {
      const filePath = path.join(NOTEBOOKS_DIR, f);
      const stat = fs.statSync(filePath);
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return {
          id: data.id,
          title: data.title || 'Untitled Notebook',
          coverTheme: data.coverTheme || 'modern-blue',
          pageCount: data.pages ? data.pages.length : 1,
          hasPdf: Boolean(data.pdfSource),
          isFavorite: Boolean(data.isFavorite),
          isTrash: Boolean(data.isTrash),
          createdAt: data.createdAt || stat.birthtimeMs,
          updatedAt: data.updatedAt || stat.mtimeMs,
          template: (data.pages && data.pages[0]) ? data.pages[0].template : 'ruled',
          paperColor: (data.pages && data.pages[0]) ? data.pages[0].paperColor : 'cream',
          filePath
        };
      } catch (e) {
        return { id: f.replace('.gnotes', ''), title: 'Corrupted File', filePath, error: true };
      }
    });
    // Sort by updatedAt descending
    list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return { success: true, data: list };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Delete a notebook
ipcMain.handle('delete-notebook', async (event, notebookId) => {
  try {
    const filePath = path.join(NOTEBOOKS_DIR, `${notebookId}.gnotes`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Rename a notebook
ipcMain.handle('rename-notebook', async (event, notebookId, newTitle) => {
  try {
    const filePath = path.join(NOTEBOOKS_DIR, `${notebookId}.gnotes`);
    if (!fs.existsSync(filePath)) return { success: false, error: 'Not found' };
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    data.title = newTitle;
    data.updatedAt = Date.now();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Save settings
ipcMain.handle('save-settings', async (event, settings) => {
  try {
    ensureDirectories();
    const existing = fs.existsSync(SETTINGS_FILE)
      ? JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))
      : {};
    const merged = { ...existing, ...settings };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2), 'utf8');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Load settings
ipcMain.handle('load-settings', async () => {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return { success: true, data: JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) };
    }
    return { success: true, data: {} };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Open file picker for PDF import
ipcMain.handle('open-pdf-dialog', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Import PDF',
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
    properties: ['openFile']
  });
  if (canceled || filePaths.length === 0) return { success: false, canceled: true };
  try {
    const buffer = fs.readFileSync(filePaths[0]);
    const base64 = buffer.toString('base64');
    return { success: true, filePath: filePaths[0], base64, name: path.basename(filePaths[0]) };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Save export (PDF or PNG) to exports folder
ipcMain.handle('save-export', async (event, { filename, base64, mimeType }) => {
  try {
    ensureDirectories();
    const filePath = path.join(EXPORTS_DIR, filename);
    const buffer = Buffer.from(base64, 'base64');
    fs.writeFileSync(filePath, buffer);
    return { success: true, path: filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Open data folder in file explorer
ipcMain.handle('open-data-folder', async () => {
  ensureDirectories();
  shell.openPath(DATA_DIR);
  return { success: true };
});

// Open notebooks folder
ipcMain.handle('open-notebooks-folder', async () => {
  ensureDirectories();
  shell.openPath(NOTEBOOKS_DIR);
  return { success: true };
});

// Get data directory path
ipcMain.handle('get-data-dir', async () => {
  return { success: true, path: DATA_DIR, notebooksDir: NOTEBOOKS_DIR, exportsDir: EXPORTS_DIR };
});

// Duplicate notebook
ipcMain.handle('duplicate-notebook', async (event, notebookId) => {
  try {
    const filePath = path.join(NOTEBOOKS_DIR, `${notebookId}.gnotes`);
    if (!fs.existsSync(filePath)) return { success: false, error: 'Not found' };
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const newId = 'notebook_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 4);
    const clone = { ...data, id: newId, title: `${data.title || 'Untitled'} (Copy)`, createdAt: Date.now(), updatedAt: Date.now() };
    fs.writeFileSync(path.join(NOTEBOOKS_DIR, `${newId}.gnotes`), JSON.stringify(clone, null, 2), 'utf8');
    return { success: true, data: clone };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── Window Creation ──────────────────────────────────────────────────────────
let mainWindow;

function createWindow() {
  ensureDirectories();

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'GoodNotes App',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false  // Allow loading local files (PDF, images)
    },
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.maximize();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
