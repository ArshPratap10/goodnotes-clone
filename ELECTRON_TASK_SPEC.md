# GoodNotes Electron Desktop App — Task Spec for Gemini Flash

## PROJECT LOCATION
`c:\Users\91969\Desktop\GoodNotes Clone\GoodNotes_App\`

## WHAT IS ALREADY DONE (DO NOT REDO)
- `electron/main.js` — 234-line Electron main process with all IPC handlers (save/load/list/delete/rename/duplicate notebooks, save-settings, open-pdf-dialog, save-export, open-data-folder, open-notebooks-folder, get-data-dir)
- `electron/preload.js` — contextBridge exposes `window.electronAPI` with all methods
- `package.json` — electron@31 + electron-builder@24 installed, `npm start` launches app
- `node_modules/` — already installed
- `modules/storageManager.js` — FULLY REWRITTEN to dual-mode: uses `window.electronAPI` in Electron, falls back to IndexedDB in browser
- `index.html` line ~79: Added `<button id="btnOpenFilesFolder">Files Folder</button>` (hidden by default)

## DATA STORAGE PATH (when running as Electron app)
Notebooks saved as `.gnotes` JSON files in:
`C:\Users\<user>\Documents\GoodNotes_App_Data\notebooks\<id>.gnotes`
Exports go to: `C:\Users\<user>\Documents\GoodNotes_App_Data\exports\`
Settings: `C:\Users\<user>\Documents\GoodNotes_App_Data\settings.json`

---

## YOUR TASKS (do all of these)

### TASK 1 — Wire Electron mode detection in `app.js`
In `app.js`, find the `DOMContentLoaded` handler (line ~4378). After `app.init()`, add:
```js
// Show "Files Folder" button in Electron mode
if (window.electronAPI && window.electronAPI.isElectron) {
  const btn = document.getElementById('btnOpenFilesFolder');
  if (btn) {
    btn.style.display = '';
    btn.addEventListener('click', () => app.storage.openDataFolder());
  }
}
```

### TASK 2 — Wire Electron native PDF dialog in `app.js`
Find where `btnLibraryImportPdf` click handler is (line ~551-553). It currently does `this.dom.pdfFileInput.click()`. Replace the ENTIRE click handler for both `btnLibraryImportPdf` AND `btnImportPdf` (line ~887) so they use Electron native dialog when available:

```js
// Pattern to replace the click handler:
async _handleImportPdfClick() {
  if (this.storage.isElectron) {
    const result = await this.storage.openPdfDialog();
    if (!result) return;
    // result = { filePath, base64, name }
    const arrayBuffer = Uint8Array.from(atob(result.base64), c => c.charCodeAt(0)).buffer;
    await this._loadPdfFromArrayBuffer(arrayBuffer, result.name);
  } else {
    this.dom.pdfFileInput.click();
  }
}
```
Find the existing method that processes a selected PDF file (currently in `pdfFileInput` change event, line ~891). That method loads the File object and converts it to ArrayBuffer. Extract that logic into `_loadPdfFromArrayBuffer(arrayBuffer, filename)` if not already done, then call it from both native dialog and file input paths.

### TASK 3 — Wire "Open Files Folder" toolbar button in `app.js`
Find the DOM refs section (around line 344-400). Add:
```js
this.dom.btnOpenFilesFolder = document.getElementById('btnOpenFilesFolder');
```
Then in the event listeners section, add:
```js
if (this.dom.btnOpenFilesFolder) {
  this.dom.btnOpenFilesFolder.addEventListener('click', () => this.storage.openDataFolder());
}
```

### TASK 4 — Show data folder path in library screen footer (Electron only)
In `index.html`, find the library screen `<div id="libraryScreen">`. Just before its closing `</div>`, add:
```html
<div id="electronDataPathInfo" class="electron-path-info" style="display:none;"></div>
```
In `app.js`, after `app.init()` (in DOMContentLoaded), add:
```js
if (window.electronAPI) {
  window.electronAPI.getDataDir().then(r => {
    const el = document.getElementById('electronDataPathInfo');
    if (el && r.success) {
      el.textContent = `📁 Data stored in: ${r.path}`;
      el.style.display = 'block';
    }
  });
}
```
In `styles.css` add:
```css
.electron-path-info {
  padding: 10px 20px;
  font-size: 11px;
  color: #64748b;
  border-top: 1px solid rgba(255,255,255,0.06);
  text-align: center;
  font-family: monospace;
}
```

### TASK 5 — Create `launch_electron.bat`
Create file `c:\Users\91969\Desktop\GoodNotes Clone\GoodNotes_App\launch_electron.bat`:
```bat
@echo off
cd /d "%~dp0"
echo Starting GoodNotes Desktop App...
npx electron . 
pause
```
Also create a shortcut-hint file `HOW_TO_RUN.txt`:
```
To run as Desktop App:
  Double-click: launch_electron.bat

Your notebook files are saved to:
  Documents\GoodNotes_App_Data\notebooks\

Each notebook is a .gnotes JSON file you can see in File Manager.
Exports (PDF/PNG) go to:
  Documents\GoodNotes_App_Data\exports\
```

### TASK 6 — Fix `index.html`: Remove CDN dependencies that break in Electron offline
In `index.html`, the scripts for PDF.js, pdf-lib, jsPDF are loaded from CDNs (lines 17-22). These fail in Electron if offline. Download them locally OR make them fail gracefully. 

Simplest fix: wrap each CDN `<script>` in a try block by converting to dynamic load with onerror fallback. Actually the easiest approach: just keep CDN scripts BUT add `<script>` error handling at the bottom of `<head>`:
```html
<script>
  window.addEventListener('error', function(e) {
    if (e.target && e.target.tagName === 'SCRIPT') {
      console.warn('Failed to load script:', e.target.src);
    }
  }, true);
</script>
```
This prevents crashes. CDN scripts will work when online; offline PDF.js features just won't be available (which is fine since the user needs internet anyway for dev).

### TASK 7 — Test and fix startup
After all edits, run: `cd "c:\Users\91969\Desktop\GoodNotes Clone\GoodNotes_App" && npx electron .`

The app should:
1. Open a maximized window showing the GoodNotes library screen
2. Create `Documents\GoodNotes_App_Data\` folder automatically on first run
3. Show "Files Folder" button in library toolbar
4. Show data path footer in library
5. Create new notebook → it should save as `Documents\GoodNotes_App_Data\notebooks\<id>.gnotes`
6. Reopen app → notebook should still be there (persistent!)
7. "Import PDF" should open native Windows file picker (not HTML input)

If Electron fails to start, common fixes:
- Missing `"type": "module"` issue: `app.js` uses ES modules. In Electron, `main.js` uses CommonJS (require). The renderer loads `index.html` which loads `app.js` as a module via `<script type="module">`. This should work fine with `webSecurity: false`.
- If `<script type="module">` fails in Electron, change `electron/main.js` `loadFile` path and check console for errors.

### TASK 8 — Push to GitHub after everything works
```
cd "c:\Users\91969\Desktop\GoodNotes Clone\GoodNotes_App"
git add -A
git commit -m "feat: Electron desktop app with local file system storage"
git push origin main
```

---

## KEY FILES REFERENCE
| File | Purpose |
|------|---------|
| `electron/main.js` | Main process, IPC handlers, file I/O |
| `electron/preload.js` | Exposes `window.electronAPI` to renderer |
| `modules/storageManager.js` | Dual-mode storage (Electron FS / IndexedDB) |
| `app.js` | Main app — NEEDS TASKS 1,2,3 wired |
| `index.html` | UI — NEEDS TASKS 4,6 |
| `styles.css` | NEEDS `.electron-path-info` style (Task 4) |
| `package.json` | npm scripts: `npm start` = `electron .` |

## HOW TO RUN
```
cd "c:\Users\91969\Desktop\GoodNotes Clone\GoodNotes_App"
npm start
```
or: `npx electron .`

## IMPORTANT NOTES FOR GEMINI FLASH
- The `app.js` is ~4389 lines. Use grep/search to find exact line numbers before editing.
- `storageManager.js` is already complete — do NOT rewrite it, only add Task wiring in `app.js`.
- `window.electronAPI.isElectron` is `true` only in Electron; `undefined` in browser.
- Notebooks auto-save every 150ms via `scheduleAutoSave` — this already calls `storageManager.saveNotebook()` which now routes to Electron file system.
- The `.gnotes` file format is just plain JSON — users can open them in Notepad, back them up, copy them, etc.
