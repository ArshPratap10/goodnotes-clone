/**
 * @file pdfManager.js
 * @description Mozilla PDF.js Multi-Page Manager for GoodNotes.
 * Handles loading, offscreen bitmap caching, high-DPI canvas rendering,
 * and lazy thumbnail generation for instant lag-free PDF interaction.
 */

export class PdfManager {
  constructor() {
    this.pdfDoc = null;
    this.rawArrayBuffer = null;
    this.pageCount = 0;
    this.pageInfoCache = new Map(); // pageIndex -> { width, height, aspectRatio }
    this.thumbnailCache = new Map(); // pageIndex -> dataURL
    this.renderedPageCache = new Map(); // pageIndex -> HTMLCanvasElement (offscreen cached bitmap)
    this.renderingPromises = new Map(); // pageIndex -> Promise
    this.isPdfJsLoaded = false;
    this.initPdfJs();
  }

  /**
   * Initializes PDF.js worker configuration
   */
  initPdfJs() {
    if (typeof window !== 'undefined' && window.pdfjsLib) {
      this.isPdfJsLoaded = true;
      if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      }
    }
  }

  /**
   * Loads a PDF instantly from an ArrayBuffer or File object.
   * Only scans page 1 up front so documents open in milliseconds,
   * while scanning subsequent pages in the background during idle time.
   * 
   * @param {ArrayBuffer|File|Blob} fileOrBuffer 
   * @returns {Promise<{pageCount: number, pages: Array<Object>}>}
   */
  async loadPdf(fileOrBuffer) {
    this.initPdfJs();
    if (!window.pdfjsLib) {
      throw new Error('PDF.js library is not available in the current environment.');
    }

    let arrayBuffer;
    if (fileOrBuffer instanceof ArrayBuffer) {
      arrayBuffer = fileOrBuffer;
    } else if (fileOrBuffer.arrayBuffer) {
      arrayBuffer = await fileOrBuffer.arrayBuffer();
    } else {
      throw new Error('Unsupported file format for PDF loading.');
    }

    this.rawArrayBuffer = arrayBuffer.slice(0); // Store copy for export & persistence

    const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer });
    this.pdfDoc = await loadingTask.promise;
    this.pageCount = this.pdfDoc.numPages;
    this.pageInfoCache.clear();
    this.thumbnailCache.clear();
    this.renderedPageCache.clear();
    this.renderingPromises.clear();

    // Fast initial scan: Only load page 1 immediately so loadPdf returns in <50ms!
    const firstPage = await this.pdfDoc.getPage(1);
    const firstViewport = firstPage.getViewport({ scale: 1.0 });
    const defaultInfo = {
      pageNumber: 1,
      width: Math.round(firstViewport.width),
      height: Math.round(firstViewport.height),
      aspectRatio: firstViewport.width / firstViewport.height
    };
    this.pageInfoCache.set(1, defaultInfo);

    const pageDescriptors = [];
    for (let pageNum = 1; pageNum <= this.pageCount; pageNum++) {
      pageDescriptors.push({
        pageNumber: pageNum,
        width: defaultInfo.width,
        height: defaultInfo.height,
        aspectRatio: defaultInfo.aspectRatio
      });
    }

    // Immediately trigger offscreen render for Page 1 so it's ready when the canvas paints
    this.renderPageOffscreen(1, defaultInfo.width, defaultInfo.height).catch(() => {});

    // Asynchronously scan remaining page sizes in the background without blocking the UI
    this.scanRemainingPagesInBackground();

    return {
      pageCount: this.pageCount,
      pages: pageDescriptors
    };
  }

  /**
   * Scans page metadata in idle slices without blocking inking or UI responsiveness.
   */
  scanRemainingPagesInBackground() {
    if (!this.pdfDoc || this.pageCount <= 1) return;
    let pageNum = 2;

    const step = () => {
      if (pageNum > this.pageCount || !this.pdfDoc) return;
      this.pdfDoc.getPage(pageNum).then(page => {
        const vp = page.getViewport({ scale: 1.0 });
        this.pageInfoCache.set(pageNum, {
          pageNumber: pageNum,
          width: Math.round(vp.width),
          height: Math.round(vp.height),
          aspectRatio: vp.width / vp.height
        });
        pageNum++;
        if (typeof requestIdleCallback !== 'undefined') {
          requestIdleCallback(step, { timeout: 250 });
        } else {
          setTimeout(step, 25);
        }
      }).catch(() => {});
    };

    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(step, { timeout: 250 });
    } else {
      setTimeout(step, 25);
    }
  }

  /**
   * Returns metadata for a specific 1-indexed page.
   */
  getPageInfo(pageNum) {
    return this.pageInfoCache.get(pageNum) || { width: 794, height: 1123, aspectRatio: 794 / 1123 };
  }

  /**
   * Checks if an offscreen high-resolution bitmap is already cached for this page.
   */
  hasCachedPage(pageNum) {
    return this.renderedPageCache.has(pageNum);
  }

  /**
   * Blits a cached high-resolution PDF page directly onto a canvas 2D context.
   * Blazing fast hardware accelerated operation (<0.5ms).
   */
  drawCachedPageToCtx(pageNum, ctx, targetWidth, targetHeight) {
    const cachedCanvas = this.renderedPageCache.get(pageNum);
    if (!cachedCanvas) return false;
    ctx.drawImage(cachedCanvas, 0, 0, targetWidth, targetHeight);
    return true;
  }

  /**
   * Renders a PDF page offscreen at high resolution and stores it in the bitmap cache.
   * Subsequent draws from this cache are instant (60+ FPS).
   * 
   * @param {number} pageNum - 1-indexed page number
   * @param {number} targetWidth - Intended display width in px
   * @param {number} targetHeight - Intended display height in px
   * @param {number} [dpr=2] - Device pixel ratio multiplier for high DPI
   * @returns {Promise<HTMLCanvasElement|null>}
   */
  async renderPageOffscreen(pageNum, targetWidth, targetHeight, dpr = 2) {
    if (this.renderedPageCache.has(pageNum)) {
      return this.renderedPageCache.get(pageNum);
    }

    if (this.renderingPromises.has(pageNum)) {
      return this.renderingPromises.get(pageNum);
    }

    if (!this.pdfDoc || pageNum < 1 || pageNum > this.pageCount) {
      return null;
    }

    const promise = (async () => {
      try {
        const page = await this.pdfDoc.getPage(pageNum);
        const unscaledViewport = page.getViewport({ scale: 1.0 });

        // Calculate scale factor for crisp rendering (at least 2x DPR for razor sharp text)
        const scale = (targetWidth / unscaledViewport.width) * Math.max(dpr, 2.0);
        const viewport = page.getViewport({ scale });

        const offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = Math.round(viewport.width);
        offscreenCanvas.height = Math.round(viewport.height);

        const ctx = offscreenCanvas.getContext('2d', { alpha: false });
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);

        await page.render({
          canvasContext: ctx,
          viewport: viewport
        }).promise;

        this.renderedPageCache.set(pageNum, offscreenCanvas);

        // Also create mini thumbnail for sidebar
        try {
          const thumbCanvas = document.createElement('canvas');
          const thumbScale = 120 / unscaledViewport.width;
          const thumbVp = page.getViewport({ scale: thumbScale });
          thumbCanvas.width = Math.round(thumbVp.width);
          thumbCanvas.height = Math.round(thumbVp.height);
          const thumbCtx = thumbCanvas.getContext('2d');
          thumbCtx.drawImage(offscreenCanvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
          this.thumbnailCache.set(pageNum, thumbCanvas.toDataURL('image/jpeg', 0.82));
        } catch (thumbErr) {}

        return offscreenCanvas;
      } catch (err) {
        console.warn(`Error rendering PDF page ${pageNum} offscreen:`, err);
        return null;
      } finally {
        this.renderingPromises.delete(pageNum);
      }
    })();

    this.renderingPromises.set(pageNum, promise);
    return promise;
  }

  /**
   * Renders a specific 1-indexed PDF page onto a target canvas (used for PDF export).
   * 
   * @param {number} pageNum - 1-indexed page number
   * @param {HTMLCanvasElement} canvas - Target background canvas
   * @param {number} targetWidth - Intended display width in px
   * @param {number} targetHeight - Intended display height in px
   */
  async renderPageToCanvas(pageNum, canvas, targetWidth, targetHeight) {
    if (!this.pdfDoc || pageNum < 1 || pageNum > this.pageCount) {
      return false;
    }

    if (this.renderedPageCache.has(pageNum)) {
      const cached = this.renderedPageCache.get(pageNum);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(cached, 0, 0, canvas.width, canvas.height);
      return true;
    }

    const offscreen = await this.renderPageOffscreen(pageNum, targetWidth, targetHeight);
    if (offscreen) {
      const ctx = canvas.getContext('2d');
      ctx.drawImage(offscreen, 0, 0, canvas.width, canvas.height);
      return true;
    }
    return false;
  }

  /**
   * Generates a mini thumbnail dataURL for the sidebar.
   * 
   * @param {number} pageNum - 1-indexed page number
   * @param {number} [thumbWidth=120]
   * @returns {Promise<string>} Data URL
   */
  async getPageThumbnail(pageNum, thumbWidth = 120) {
    if (this.thumbnailCache.has(pageNum)) {
      return this.thumbnailCache.get(pageNum);
    }

    if (!this.pdfDoc || pageNum < 1 || pageNum > this.pageCount) {
      return null;
    }

    try {
      const page = await this.pdfDoc.getPage(pageNum);
      const unscaledViewport = page.getViewport({ scale: 1.0 });
      const scale = thumbWidth / unscaledViewport.width;
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d');

      await page.render({ canvasContext: ctx, viewport }).promise;
      const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
      this.thumbnailCache.set(pageNum, dataUrl);
      return dataUrl;
    } catch (e) {
      console.error(`Failed to generate thumbnail for PDF page ${pageNum}`, e);
      return null;
    }
  }

  /**
   * Extracts PDF Table of Contents / Outline hierarchy and resolves page destinations
   * @returns {Promise<Array<{title: string, pageNumber: number, items: Array}>>}
   */
  async getOutline() {
    if (!this.pdfDoc) return [];
    try {
      const outline = await this.pdfDoc.getOutline();
      if (!outline || outline.length === 0) return [];

      const resolveItem = async (item) => {
        let pageNumber = 1;
        try {
          let dest = item.dest;
          if (typeof dest === 'string') {
            dest = await this.pdfDoc.getDestination(dest);
          }
          if (Array.isArray(dest) && dest[0]) {
            const pageIdx = await this.pdfDoc.getPageIndex(dest[0]);
            pageNumber = pageIdx + 1;
          }
        } catch (e) {}

        const children = item.items && item.items.length > 0
          ? await Promise.all(item.items.map(resolveItem))
          : [];

        return {
          title: item.title || 'Untitled Section',
          pageNumber,
          items: children
        };
      };

      return await Promise.all(outline.map(resolveItem));
    } catch (err) {
      console.warn('Could not extract PDF outline:', err);
      return [];
    }
  }

  /**
   * Returns the cached raw ArrayBuffer of the imported PDF.
   */
  getRawBuffer() {
    return this.rawArrayBuffer;
  }
}
