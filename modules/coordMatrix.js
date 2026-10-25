/**
 * @file coordMatrix.js
 * @description Viewport Coordinate Matrix & High-DPI Mapping Engine.
 * Handles coordinate conversions between screen viewport, high-DPI canvas pixels,
 * and virtual document points. Supports pointer-centered zoom and pan offsets.
 */

export class CoordMatrix {
  /**
   * @param {Object} [options]
   * @param {number} [options.minZoom=0.2] - Minimum zoom limit (20%)
   * @param {number} [options.maxZoom=5.0] - Maximum zoom limit (500%)
   */
  constructor(options = {}) {
    this.zoom = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.minZoom = options.minZoom || 0.2;
    this.maxZoom = options.maxZoom || 5.0;
    this.dpr = window.devicePixelRatio || 1;
    this.cachedRect = null;
    this.rectTimestamp = 0;
  }

  /**
   * Updates DPR if window moved between displays with differing scale factors
   */
  updateDpr() {
    this.dpr = window.devicePixelRatio || 1;
    return this.dpr;
  }

  /**
   * Invalidate cached bounding rect (call on resize or scroll)
   */
  invalidateCache() {
    this.cachedRect = null;
  }

  /**
   * Retrieves bounding client rect with caching to avoid layout thrashing
   * @param {HTMLElement} element 
   * @returns {DOMRect}
   */
  getRect(element) {
    const now = performance.now();
    if (!this.cachedRect || now - this.rectTimestamp > 150) {
      this.cachedRect = element.getBoundingClientRect();
      this.rectTimestamp = now;
    }
    return this.cachedRect;
  }

  /**
   * Converts screen viewport coordinates (e.g. e.clientX, e.clientY) into
   * virtual document points (docX, docY) independent of screen zoom and DPI.
   * 
   * @param {number} screenX - Client X coordinate from PointerEvent
   * @param {number} screenY - Client Y coordinate from PointerEvent
   * @param {HTMLElement|DOMRect} canvasOrRect - Canvas element or its DOMRect
   * @returns {{x: number, y: number}}
   */
  screenToDoc(screenX, screenY, canvasOrRect) {
    const rect = canvasOrRect instanceof DOMRect || (canvasOrRect && canvasOrRect.left !== undefined)
      ? canvasOrRect
      : this.getRect(canvasOrRect);

    // Position relative to canvas bounding box
    const relX = screenX - rect.left;
    const relY = screenY - rect.top;

    // Normalizing with CSS width vs logical document width
    // When canvas CSS width = docWidth * zoom, relX / zoom = docX
    const docX = (relX - this.panX) / this.zoom;
    const docY = (relY - this.panY) / this.zoom;

    return { x: docX, y: docY };
  }

  /**
   * Converts virtual document coordinates into screen client coordinates
   * @param {number} docX 
   * @param {number} docY 
   * @param {HTMLElement|DOMRect} canvasOrRect 
   * @returns {{x: number, y: number}}
   */
  docToScreen(docX, docY, canvasOrRect) {
    const rect = canvasOrRect instanceof DOMRect || (canvasOrRect && canvasOrRect.left !== undefined)
      ? canvasOrRect
      : this.getRect(canvasOrRect);

    const screenX = rect.left + this.panX + (docX * this.zoom);
    const screenY = rect.top + this.panY + (docY * this.zoom);

    return { x: screenX, y: screenY };
  }

  /**
   * Applies the high-DPI scaling and zoom transformation to a 2D canvas context.
   * @param {CanvasRenderingContext2D} ctx 
   * @param {number} [customZoom] - Optional custom zoom override
   */
  applyCanvasTransform(ctx, customZoom = null) {
    const z = customZoom !== null ? customZoom : this.zoom;
    const scale = this.dpr;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
  }

  /**
   * Centers and fits the document width inside the viewport container
   * @param {number} docWidth - Logical width of paper page (e.g. 794px for A4)
   * @param {number} viewportWidth - Viewport container width
   * @param {number} [padding=40] - Desired padding around paper
   * @returns {number} New zoom factor
   */
  fitWidth(docWidth, viewportWidth, padding = 60) {
    const availableWidth = Math.max(100, viewportWidth - padding);
    const targetZoom = Math.min(Math.max(availableWidth / docWidth, this.minZoom), 2.5);
    this.zoom = parseFloat(targetZoom.toFixed(2));
    this.panX = 0;
    this.panY = 0;
    this.invalidateCache();
    return this.zoom;
  }

  /**
   * Resets zoom to 100% and centers
   */
  resetZoom() {
    this.zoom = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.invalidateCache();
    return this.zoom;
  }

  /**
   * Zooms in or out at a specific screen point (e.g. cursor location during wheel or pinch)
   * @param {number} deltaFactor - Multiplier, e.g. 1.1 for zoom in, 0.9 for zoom out
   * @param {number} screenX - Cursor client X
   * @param {number} screenY - Cursor client Y
   * @param {HTMLElement} viewportElement - Container element
   * @returns {number} New zoom level
   */
  zoomAtPoint(deltaFactor, screenX, screenY, viewportElement) {
    const prevZoom = this.zoom;
    let nextZoom = prevZoom * deltaFactor;
    nextZoom = Math.min(Math.max(nextZoom, this.minZoom), this.maxZoom);
    nextZoom = Math.round(nextZoom * 100) / 100;

    if (Math.abs(nextZoom - prevZoom) < 0.005) {
      return this.zoom;
    }

    this.zoom = nextZoom;
    this.invalidateCache();
    return this.zoom;
  }

  /**
   * Sets absolute zoom clamped between bounds
   * @param {number} zoomLevel 
   * @returns {number}
   */
  setZoom(zoomLevel) {
    this.zoom = Math.min(Math.max(zoomLevel, this.minZoom), this.maxZoom);
    this.zoom = Math.round(this.zoom * 100) / 100;
    this.invalidateCache();
    return this.zoom;
  }
}
