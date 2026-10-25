/**
 * @file storageManager.js
 * @description Storage & Export Engine for GoodNotes.
 * In Electron desktop mode: reads/writes .gnotes JSON files to
 *   Documents/GoodNotes_App_Data/notebooks/ (visible in File Manager).
 * In browser mode: falls back to IndexedDB persistence.
 * Also handles PNG/PDF export and .gnotes project file backup.
 */

export class StorageManager {
  constructor() {
    // Electron detection
    this.isElectron = !!(window.electronAPI && window.electronAPI.isElectron);

    // IndexedDB fields (browser fallback)
    this.dbName = 'GoodNotesWindowsDB';
    this.dbVersion = 1;
    this.db = null;

    // Auto-save state
    this.autoSaveTimer = null;
    this.isSaving = false;
    this.pendingDocToSave = null;
    this.activeSavePromise = null;
  }

  // ─── Electron File-System API ──────────────────────────────────────────────

  async saveNotebookElectron(notebookDoc) {
    const record = this._serializeNotebook(notebookDoc);
    const result = await window.electronAPI.saveNotebook(record);
    if (!result.success) throw new Error(result.error);
    return true;
  }

  async loadNotebookElectron(notebookId = null) {
    const result = await window.electronAPI.loadNotebook(notebookId || null);
    if (!result.success) return null;
    return result.data;
  }

  async getAllNotebooksElectron() {
    const result = await window.electronAPI.listNotebooks();
    if (!result.success) return [];
    return result.data;
  }

  async deleteNotebookElectron(notebookId) {
    const result = await window.electronAPI.deleteNotebook(notebookId);
    if (!result.success) throw new Error(result.error);
    return true;
  }

  async duplicateNotebookElectron(notebookId) {
    const result = await window.electronAPI.duplicateNotebook(notebookId);
    if (!result.success) throw new Error(result.error);
    return result.data;
  }

  async renameNotebookElectron(notebookId, newTitle) {
    const result = await window.electronAPI.renameNotebook(notebookId, newTitle);
    if (!result.success) throw new Error(result.error);
    return true;
  }

  // ─── IndexedDB (browser fallback) ─────────────────────────────────────────

  async initDB() {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('notebooks')) {
          const store = db.createObjectStore('notebooks', { keyPath: 'id' });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };

      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this.db);
      };

      request.onerror = (e) => {
        console.error('IndexedDB initialization error:', e);
        reject(e);
      };
    });
  }

  async saveNotebookIDB(notebookDoc) {
    await this.initDB();
    const record = this._serializeNotebook(notebookDoc);

    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction(['notebooks'], 'readwrite');
        const store = tx.objectStore('notebooks');
        const putReq = store.put(record);
        putReq.onsuccess = () => resolve(true);
        putReq.onerror = (e) => reject(e);
      } catch (err) {
        reject(err);
      }
    });
  }

  async loadNotebookIDB(notebookId = null) {
    await this.initDB();

    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction(['notebooks'], 'readonly');
        const store = tx.objectStore('notebooks');

        if (notebookId) {
          const req = store.get(notebookId);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = (e) => reject(e);
        } else {
          const index = store.index('updatedAt');
          const openCursor = index.openCursor(null, 'prev');
          openCursor.onsuccess = (e) => {
            const cursor = e.target.result;
            resolve(cursor ? cursor.value : null);
          };
          openCursor.onerror = (e) => reject(e);
        }
      } catch (err) {
        reject(err);
      }
    });
  }

  async getAllNotebooksIDB() {
    await this.initDB();

    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction(['notebooks'], 'readonly');
        const store = tx.objectStore('notebooks');
        const index = store.index('updatedAt');
        const req = index.openCursor(null, 'prev');
        const list = [];

        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            const v = cursor.value;
            list.push({
              id: v.id,
              title: v.title || 'Untitled Notebook',
              coverTheme: v.coverTheme || 'modern-blue',
              pageCount: v.pages ? v.pages.length : 1,
              hasPdf: Boolean(v.pdfSource),
              isFavorite: Boolean(v.isFavorite),
              isTrash: Boolean(v.isTrash),
              createdAt: v.createdAt || Date.now(),
              updatedAt: v.updatedAt || Date.now(),
              template: (v.pages && v.pages[0]) ? v.pages[0].template : 'ruled',
              paperColor: (v.pages && v.pages[0]) ? v.pages[0].paperColor : 'cream'
            });
            cursor.continue();
          } else {
            resolve(list);
          }
        };

        req.onerror = (e) => reject(e);
      } catch (err) {
        reject(err);
      }
    });
  }

  async deleteNotebookIDB(notebookId) {
    await this.initDB();

    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction(['notebooks'], 'readwrite');
        const store = tx.objectStore('notebooks');
        const req = store.delete(notebookId);
        req.onsuccess = () => resolve(true);
        req.onerror = (e) => reject(e);
      } catch (err) {
        reject(err);
      }
    });
  }

  // ─── Public Unified API (auto-dispatches to Electron or IDB) ──────────────

  /**
   * Saves a notebook document to disk (Electron) or IndexedDB (browser).
   */
  async saveNotebook(notebookDoc) {
    if (this.isElectron) return this.saveNotebookElectron(notebookDoc);
    return this.saveNotebookIDB(notebookDoc);
  }

  /**
   * Loads the most recent notebook or a specific ID.
   */
  async loadNotebook(notebookId = null) {
    if (this.isElectron) return this.loadNotebookElectron(notebookId);
    return this.loadNotebookIDB(notebookId);
  }

  /**
   * Retrieves summary metadata of all notebooks.
   */
  async getAllNotebooks() {
    if (this.isElectron) return this.getAllNotebooksElectron();
    return this.getAllNotebooksIDB();
  }

  /**
   * Deletes a notebook by ID.
   */
  async deleteNotebook(notebookId) {
    if (this.isElectron) return this.deleteNotebookElectron(notebookId);
    return this.deleteNotebookIDB(notebookId);
  }

  /**
   * Duplicates an existing notebook with a new unique ID and "(Copy)" suffix.
   */
  async duplicateNotebook(notebookId) {
    if (this.isElectron) return this.duplicateNotebookElectron(notebookId);

    // Browser fallback
    const original = await this.loadNotebook(notebookId);
    if (!original) throw new Error('Notebook not found for duplication.');

    const newId = 'notebook_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 4);
    const clone = {
      ...original,
      id: newId,
      title: `${original.title || 'Untitled'} (Copy)`,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    await this.saveNotebook(clone);
    return clone;
  }

  /**
   * Renames a notebook.
   */
  async renameNotebook(notebookId, newTitle) {
    if (this.isElectron) return this.renameNotebookElectron(notebookId, newTitle);

    const doc = await this.loadNotebook(notebookId);
    if (!doc) throw new Error('Notebook not found for rename.');
    doc.title = newTitle;
    doc.updatedAt = Date.now();
    await this.saveNotebook(doc);
    return doc;
  }

  /**
   * Toggles the favorite status of a notebook.
   */
  async toggleFavoriteNotebook(notebookId) {
    const doc = await this.loadNotebook(notebookId);
    if (!doc) throw new Error('Notebook not found.');
    doc.isFavorite = !doc.isFavorite;
    doc.updatedAt = Date.now();
    await this.saveNotebook(doc);
    return doc;
  }

  /**
   * Immediately saves the notebook document without delay.
   * Serializes consecutive rapid saves so no updates are ever dropped.
   */
  async saveNotebookInstant(notebookDoc) {
    if (!notebookDoc) return false;
    if (this.isSaving) {
      this.pendingDocToSave = notebookDoc;
      return this.activeSavePromise;
    }

    this.isSaving = true;
    this.activeSavePromise = (async () => {
      try {
        await this.saveNotebook(notebookDoc);
        while (this.pendingDocToSave) {
          const nextDoc = this.pendingDocToSave;
          this.pendingDocToSave = null;
          await this.saveNotebook(nextDoc);
        }
        return true;
      } catch (err) {
        console.warn('Instant save error:', err);
        return false;
      } finally {
        this.isSaving = false;
        this.activeSavePromise = null;
      }
    })();

    return this.activeSavePromise;
  }

  /**
   * Schedules a debounced auto-save (default 150ms).
   */
  scheduleAutoSave(getDocCallback, delayMs = 150) {
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
    }

    this.autoSaveTimer = setTimeout(async () => {
      const doc = getDocCallback ? getDocCallback() : null;
      if (doc) {
        await this.saveNotebookInstant(doc);
      }
    }, delayMs);
  }

  // ─── Settings (Electron saves to file, browser uses localStorage) ──────────

  async saveSettings(settings) {
    if (this.isElectron) {
      await window.electronAPI.saveSettings(settings);
    } else {
      try {
        const existing = JSON.parse(localStorage.getItem('goodnotes_settings') || '{}');
        localStorage.setItem('goodnotes_settings', JSON.stringify({ ...existing, ...settings }));
      } catch (e) { /* noop */ }
    }
  }

  async loadSettings() {
    if (this.isElectron) {
      const result = await window.electronAPI.loadSettings();
      return result.success ? (result.data || {}) : {};
    } else {
      try {
        return JSON.parse(localStorage.getItem('goodnotes_settings') || '{}');
      } catch (e) { return {}; }
    }
  }

  // ─── Helper: Open file manager ─────────────────────────────────────────────

  async openDataFolder() {
    if (this.isElectron) {
      await window.electronAPI.openDataFolder();
    }
  }

  async openNotebooksFolder() {
    if (this.isElectron) {
      await window.electronAPI.openNotebooksFolder();
    }
  }

  async getDataDir() {
    if (this.isElectron) {
      const result = await window.electronAPI.getDataDir();
      return result.success ? result : null;
    }
    return null;
  }

  // ─── PDF Import via Electron dialog ───────────────────────────────────────

  /**
   * Opens native file picker for PDF (Electron) or triggers HTML input (browser).
   * Returns { filePath, base64, name } or null.
   */
  async openPdfDialog() {
    if (this.isElectron) {
      const result = await window.electronAPI.openPdfDialog();
      if (!result.success) return null;
      return result;
    }
    // Browser fallback: return null (caller should use <input type=file>)
    return null;
  }

  // ─── Serialization Helper ──────────────────────────────────────────────────

  _serializeNotebook(notebookDoc) {
    return {
      id: notebookDoc.id || 'default_notebook',
      title: notebookDoc.title || 'Untitled Notebook',
      coverTheme: notebookDoc.coverTheme || 'modern-blue',
      isFavorite: Boolean(notebookDoc.isFavorite),
      isTrash: Boolean(notebookDoc.isTrash),
      createdAt: notebookDoc.createdAt || Date.now(),
      updatedAt: Date.now(),
      currentPageIndex: notebookDoc.currentPageIndex || 0,
      pdfSource: notebookDoc.pdfSource || null,
      viewMode: notebookDoc.viewMode || 'vertical',
      outline: notebookDoc.outline || [],
      // Persist undo/redo history so it survives notebook close/reopen
      _undoStack: Array.isArray(notebookDoc._undoStack) ? notebookDoc._undoStack : [],
      _redoStack: Array.isArray(notebookDoc._redoStack) ? notebookDoc._redoStack : [],
      pages: (notebookDoc.pages || []).map(p => ({
        pageNumber: p.pageNumber,
        width: p.width,
        height: p.height,
        template: p.template || 'ruled',
        paperColor: p.paperColor || 'cream',
        pdfPageNumber: p.pdfPageNumber || null,
        isBookmarked: Boolean(p.isBookmarked),
        strokes: (p.strokes || []).map(s => ({
          id: s.id,
          tool: s.tool,
          color: s.color,
          width: s.width,
          opacity: s.opacity,
          blendMode: s.blendMode,
          points: s.points
        })),
        shapes: p.shapes || [],
        textBoxes: p.textBoxes || [],
        stickyNotes: p.stickyNotes || [],
        images: (p.images || []).map(img => ({
          id: img.id,
          x: img.x,
          y: img.y,
          width: img.width,
          height: img.height,
          naturalWidth: img.naturalWidth || img.width,
          naturalHeight: img.naturalHeight || img.height,
          src: img.src || img.dataUrl,
          dataUrl: img.dataUrl || img.src,
          aspectRatio: img.aspectRatio || (img.width / img.height)
        }))
      }))
    };
  }

  // ─── Export Methods ────────────────────────────────────────────────────────

  /**
   * Exports the current page as a high-resolution PNG image download.
   */
  exportPageToPNG(bgCanvas, vectorCanvas, textBoxes = [], stickyNotes = [], filename = 'GoodNotes_Page.png') {
    const width = bgCanvas.width;
    const height = bgCanvas.height;

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = width;
    exportCanvas.height = height;
    const ctx = exportCanvas.getContext('2d');

    ctx.drawImage(bgCanvas, 0, 0);
    ctx.drawImage(vectorCanvas, 0, 0);

    const dpr = width / (bgCanvas.style.width ? parseFloat(bgCanvas.style.width) : width);
    const scale = dpr || 1;

    for (const note of stickyNotes) this.drawStickyNoteToCtx(ctx, note, scale);
    for (const tb of textBoxes) this.drawTextBoxToCtx(ctx, tb, scale);

    if (this.isElectron) {
      const dataUrl = exportCanvas.toDataURL('image/png', 1.0);
      const base64 = dataUrl.split(',')[1];
      window.electronAPI.saveExport({ filename, base64, mimeType: 'image/png' }).then(result => {
        if (result.success) {
          this._showToast(`Saved to: ${result.path}`);
        }
      });
    } else {
      const link = document.createElement('a');
      link.download = filename;
      link.href = exportCanvas.toDataURL('image/png', 1.0);
      link.click();
    }
  }

  /**
   * Exports the full multi-page notebook as an annotated PDF file.
   */
  async exportToPDF(notebookDoc, renderPageComposite, filename = null) {
    const name = filename || `${notebookDoc.title || 'GoodNotes'}_Annotated.pdf`;

    // Try pdf-lib
    if (window.PDFLib) {
      const pdfDoc = await window.PDFLib.PDFDocument.create();

      for (let i = 0; i < notebookDoc.pages.length; i++) {
        const pageData = notebookDoc.pages[i];
        const compositeCanvas = await renderPageComposite(i);
        const pngDataUrl = compositeCanvas.toDataURL('image/png');
        const pngBytes = this.dataURLToUint8(pngDataUrl);

        const pngImage = await pdfDoc.embedPng(pngBytes);
        const page = pdfDoc.addPage([pageData.width, pageData.height]);
        page.drawImage(pngImage, { x: 0, y: 0, width: pageData.width, height: pageData.height });
      }

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });

      if (this.isElectron) {
        const base64 = await this._blobToBase64(blob);
        const result = await window.electronAPI.saveExport({ filename: name, base64, mimeType: 'application/pdf' });
        if (result.success) this._showToast(`PDF saved to: ${result.path}`);
      } else {
        this.downloadBlob(blob, name);
      }
      return true;
    }

    // Fallback: jsPDF
    if (window.jspdf && window.jspdf.jsPDF) {
      const { jsPDF } = window.jspdf;
      let pdf = null;

      for (let i = 0; i < notebookDoc.pages.length; i++) {
        const pageData = notebookDoc.pages[i];
        const orientation = pageData.width > pageData.height ? 'landscape' : 'portrait';

        if (i === 0) {
          pdf = new jsPDF({ orientation, unit: 'pt', format: [pageData.width, pageData.height] });
        } else {
          pdf.addPage([pageData.width, pageData.height], orientation);
        }

        const compositeCanvas = await renderPageComposite(i);
        const imgData = compositeCanvas.toDataURL('image/jpeg', 0.92);
        pdf.addImage(imgData, 'JPEG', 0, 0, pageData.width, pageData.height);
      }

      if (this.isElectron) {
        const base64 = pdf.output('datauristring').split(',')[1];
        const result = await window.electronAPI.saveExport({ filename: name, base64, mimeType: 'application/pdf' });
        if (result.success) this._showToast(`PDF saved to: ${result.path}`);
      } else {
        pdf.save(name);
      }
      return true;
    }

    throw new Error('PDF export engine (pdf-lib or jspdf) is not currently loaded.');
  }

  /**
   * Exports document structure into a .gnotes project JSON file.
   */
  exportProjectJSON(notebookDoc, filename = null) {
    const name = filename || `${notebookDoc.title || 'GoodNotes'}_Project.gnotes`;
    const jsonStr = JSON.stringify(notebookDoc, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });

    if (this.isElectron) {
      const base64 = btoa(jsonStr);
      window.electronAPI.saveExport({ filename: name, base64, mimeType: 'application/json' }).then(result => {
        if (result.success) this._showToast(`Project saved to: ${result.path}`);
      });
    } else {
      this.downloadBlob(blob, name);
    }
  }

  // ─── Utility Helpers ───────────────────────────────────────────────────────

  dataURLToUint8(dataURL) {
    const parts = dataURL.split(';base64,');
    const raw = atob(parts[1]);
    const rawLength = raw.length;
    const uInt8Array = new Uint8Array(rawLength);
    for (let i = 0; i < rawLength; ++i) {
      uInt8Array[i] = raw.charCodeAt(i);
    }
    return uInt8Array;
  }

  downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  _blobToBase64(blob) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.readAsDataURL(blob);
    });
  }

  _showToast(msg) {
    const toast = document.createElement('div');
    toast.className = 'storage-toast';
    toast.textContent = msg;
    toast.style.cssText = `
      position:fixed;bottom:24px;right:24px;background:#1e40af;color:#fff;
      padding:12px 20px;border-radius:10px;font-size:13px;z-index:99999;
      box-shadow:0 4px 24px rgba(0,0,0,0.3);max-width:380px;word-break:break-all;
      animation:fadeInUp 0.3s ease;
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  }

  drawStickyNoteToCtx(ctx, note, scale = 1) {
    ctx.save();
    const x = note.x * scale;
    const y = note.y * scale;
    const w = (note.width || 180) * scale;
    const h = (note.height || 180) * scale;

    ctx.shadowColor = 'rgba(0, 0, 0, 0.15)';
    ctx.shadowBlur = 8 * scale;
    ctx.shadowOffsetY = 4 * scale;
    ctx.fillStyle = note.color || '#FEF08A';
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, w, h, 6 * scale) : ctx.rect(x, y, w, h);
    ctx.fill();

    ctx.shadowColor = 'transparent';

    if (note.text) {
      ctx.fillStyle = '#1e293b';
      ctx.font = `${14 * scale}px system-ui, -apple-system, sans-serif`;
      const lines = note.text.split('\n');
      let lineY = y + (24 * scale);
      for (const line of lines) {
        ctx.fillText(line, x + (14 * scale), lineY, w - (28 * scale));
        lineY += (18 * scale);
      }
    }

    ctx.restore();
  }

  drawTextBoxToCtx(ctx, tb, scale = 1) {
    if (!tb.text) return;

    ctx.save();
    const x = tb.x * scale;
    const y = tb.y * scale;
    const fontSize = (tb.fontSize || 16) * scale;
    const fontWeight = tb.bold ? 'bold' : 'normal';
    const fontStyle = tb.italic ? 'italic' : 'normal';

    ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px system-ui, -apple-system, sans-serif`;
    ctx.fillStyle = tb.color || '#1e293b';

    const lines = tb.text.split('\n');
    let lineY = y + fontSize;
    for (const line of lines) {
      ctx.fillText(line, x, lineY);
      lineY += fontSize * 1.25;
    }

    ctx.restore();
  }
}
