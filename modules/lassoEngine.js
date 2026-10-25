/**
 * @file lassoEngine.js
 * @description Lasso Selection, Ray-Casting Point-in-Polygon & Transform Engine.
 * Allows drawing a freeform loop to select vector strokes, shapes, and annotations,
 * computing bounding boxes, and applying affine translation and scaling.
 */

export class LassoEngine {
  constructor() {
    this.selectionPadding = 8;
  }

  /**
   * Ray-casting algorithm to test whether a 2D point is inside an arbitrary polygon.
   * Uses Jordan curve theorem / even-odd rule with $O(N)$ complexity.
   * 
   * @param {{x: number, y: number}} point 
   * @param {Array<{x: number, y: number}>} polygon 
   * @returns {boolean} True if inside
   */
  isPointInPolygon(point, polygon) {
    if (!polygon || polygon.length < 3) return false;

    const x = point.x;
    const y = point.y;
    let inside = false;
    const n = polygon.length;

    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = polygon[i].x, yi = polygon[i].y;
      const xj = polygon[j].x, yj = polygon[j].y;

      const intersect = ((yi > y) !== (yj > y)) &&
        (x < (xj - xi) * (y - yi) / (yj - yi) + xi);

      if (intersect) {
        inside = !inside;
      }
    }

    return inside;
  }

  /**
   * Checks whether two 2D line segments (p1-p2) and (p3-p4) intersect.
   */
  doSegmentsIntersect(p1, p2, p3, p4) {
    function ccw(a, b, c) {
      return (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
    }
    return (ccw(p1, p3, p4) !== ccw(p2, p3, p4)) && (ccw(p1, p2, p3) !== ccw(p1, p2, p4));
  }

  /**
   * Tests whether an entire stroke is selected by the lasso.
   * Returns true if:
   * 1. More than 45% of its sample points lie inside the lasso polygon, OR
   * 2. Any segment of the stroke intersects any edge of the lasso loop.
   * 
   * @param {Object} stroke 
   * @param {Array<{x: number, y: number}>} polygon 
   * @returns {boolean}
   */
  isStrokeSelected(stroke, polygon) {
    if (!stroke || !stroke.points || stroke.points.length === 0) return false;
    if (!polygon || polygon.length < 3) return false;

    const pts = stroke.points;
    const totalPts = pts.length;

    // Fast Axis-Aligned Bounding Box (AABB) rejection test
    const strokeBox = this.computeStrokeBounds(stroke);
    const polyBox = this.computePointsBounds(polygon);

    if (strokeBox.maxX < polyBox.minX || strokeBox.minX > polyBox.maxX ||
        strokeBox.maxY < polyBox.minY || strokeBox.minY > polyBox.maxY) {
      return false;
    }

    // Sample points (test up to 16 points)
    let insideCount = 0;
    const step = Math.max(1, Math.floor(totalPts / 16));
    let testedCount = 0;

    for (let i = 0; i < totalPts; i += step) {
      testedCount++;
      if (this.isPointInPolygon(pts[i], polygon)) {
        insideCount++;
      }
    }

    if (testedCount > 0 && (insideCount / testedCount) >= 0.35) {
      return true;
    }

    // Check edge intersections with bounded sample steps to prevent polynomial freeze
    const polyLen = polygon.length;
    const polyStep = Math.max(1, Math.floor(polyLen / 25));
    const strokeStep = Math.max(1, Math.floor(totalPts / 10));

    for (let i = 0; i < totalPts - 1; i += strokeStep) {
      const s1 = pts[i];
      const s2 = pts[Math.min(totalPts - 1, i + strokeStep)];

      for (let j = 0; j < polyLen; j += polyStep) {
        const poly1 = polygon[j];
        const poly2 = polygon[(j + polyStep) % polyLen];
        if (this.doSegmentsIntersect(s1, s2, poly1, poly2)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Tests whether a geometric shape is selected by the lasso.
   */
  isShapeSelected(shape, polygon) {
    if (!shape || !shape.geometry) return false;

    // Sample points from the shape geometry
    const testPoints = [];
    const g = shape.geometry;

    if (shape.type === 'line' || shape.type === 'arrow') {
      testPoints.push({ x: g.x1, y: g.y1 }, { x: g.x2, y: g.y2 }, { x: (g.x1 + g.x2) / 2, y: (g.y1 + g.y2) / 2 });
    } else if (shape.type === 'circle' || shape.type === 'ellipse') {
      testPoints.push({ x: g.cx, y: g.cy });
      const rx = g.r || g.rx || 20;
      const ry = g.r || g.ry || 20;
      testPoints.push({ x: g.cx + rx, y: g.cy }, { x: g.cx - rx, y: g.cy }, { x: g.cx, y: g.cy + ry });
    } else if (shape.type === 'rectangle' || shape.type === 'roundedRectangle') {
      testPoints.push(
        { x: g.x, y: g.y },
        { x: g.x + g.width, y: g.y },
        { x: g.x + g.width, y: g.y + g.height },
        { x: g.x, y: g.y + g.height },
        { x: g.x + g.width / 2, y: g.y + g.height / 2 }
      );
    } else if (shape.type === 'triangle') {
      testPoints.push(g.p1, g.p2, g.p3);
    } else if (shape.type === 'diamond') {
      testPoints.push(g.p1, g.p2, g.p3, g.p4);
    } else if (shape.type === 'star') {
      testPoints.push({ x: g.cx, y: g.cy });
      for (let i = 0; i < 5; i++) {
        const a = (i * Math.PI * 2) / 5 - Math.PI / 2;
        testPoints.push({ x: g.cx + Math.cos(a) * g.r, y: g.cy + Math.sin(a) * g.r });
      }
    } else if (shape.type === 'polygon' && g.vertices) {
      testPoints.push(...g.vertices);
    }

    let inside = 0;
    for (const pt of testPoints) {
      if (this.isPointInPolygon(pt, polygon)) inside++;
    }

    return inside >= Math.ceil(testPoints.length / 2);
  }

  /**
   * Finds all items (strokes and shapes) enclosed by or intersecting the lasso.
   * 
   * @param {Array<Object>} strokes 
   * @param {Array<Object>} shapes 
   * @param {Array<{x: number, y: number}>} polygon 
   * @returns {{selectedStrokes: Array<Object>, selectedShapes: Array<Object>}}
   */
  findSelectedItems(strokes, shapes, polygon) {
    const selectedStrokes = [];
    const selectedShapes = [];

    if (strokes) {
      for (const stroke of strokes) {
        if (this.isStrokeSelected(stroke, polygon)) {
          selectedStrokes.push(stroke);
        }
      }
    }

    if (shapes) {
      for (const shape of shapes) {
        if (this.isShapeSelected(shape, polygon)) {
          selectedShapes.push(shape);
        }
      }
    }

    return { selectedStrokes, selectedShapes };
  }

  /**
   * Computes the bounding box of a single stroke.
   */
  computeStrokeBounds(stroke) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of stroke.points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const pad = (stroke.width || 2) / 2;
    return {
      minX: minX - pad,
      maxX: maxX + pad,
      minY: minY - pad,
      maxY: maxY + pad,
      width: (maxX - minX) + (pad * 2),
      height: (maxY - minY) + (pad * 2)
    };
  }

  /**
   * Computes bounds of an array of points.
   */
  computePointsBounds(points) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
  }

  /**
   * Computes the overall Axis-Aligned Bounding Box (AABB) enclosing all selected items.
   * 
   * @param {Array<Object>} selectedStrokes 
   * @param {Array<Object>} selectedShapes 
   * @returns {Object|null} AABB with padding or null if empty
   */
  computeBoundingBox(selectedStrokes = [], selectedShapes = []) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let hasItems = false;

    for (const stroke of selectedStrokes) {
      const b = this.computeStrokeBounds(stroke);
      if (b.minX < minX) minX = b.minX;
      if (b.maxX > maxX) maxX = b.maxX;
      if (b.minY < minY) minY = b.minY;
      if (b.maxY > maxY) maxY = b.maxY;
      hasItems = true;
    }

    for (const shape of selectedShapes) {
      const g = shape.geometry;
      hasItems = true;
      if (shape.type === 'line' || shape.type === 'arrow') {
        minX = Math.min(minX, g.x1, g.x2);
        maxX = Math.max(maxX, g.x1, g.x2);
        minY = Math.min(minY, g.y1, g.y2);
        maxY = Math.max(maxY, g.y1, g.y2);
      } else if (shape.type === 'circle' || shape.type === 'ellipse') {
        const rx = g.r || g.rx || 20;
        const ry = g.r || g.ry || 20;
        minX = Math.min(minX, g.cx - rx);
        maxX = Math.max(maxX, g.cx + rx);
        minY = Math.min(minY, g.cy - ry);
        maxY = Math.max(maxY, g.cy + ry);
      } else if (shape.type === 'rectangle' || shape.type === 'roundedRectangle') {
        minX = Math.min(minX, g.x);
        maxX = Math.max(maxX, g.x + g.width);
        minY = Math.min(minY, g.y);
        maxY = Math.max(maxY, g.y + g.height);
      } else if (shape.type === 'triangle') {
        minX = Math.min(minX, g.p1.x, g.p2.x, g.p3.x);
        maxX = Math.max(maxX, g.p1.x, g.p2.x, g.p3.x);
        minY = Math.min(minY, g.p1.y, g.p2.y, g.p3.y);
        maxY = Math.max(maxY, g.p1.y, g.p2.y, g.p3.y);
      } else if (shape.type === 'diamond') {
        minX = Math.min(minX, g.p1.x, g.p2.x, g.p3.x, g.p4.x);
        maxX = Math.max(maxX, g.p1.x, g.p2.x, g.p3.x, g.p4.x);
        minY = Math.min(minY, g.p1.y, g.p2.y, g.p3.y, g.p4.y);
        maxY = Math.max(maxY, g.p1.y, g.p2.y, g.p3.y, g.p4.y);
      } else if (shape.type === 'star') {
        const r = g.r || 20;
        minX = Math.min(minX, g.cx - r);
        maxX = Math.max(maxX, g.cx + r);
        minY = Math.min(minY, g.cy - r);
        maxY = Math.max(maxY, g.cy + r);
      } else if (shape.type === 'polygon' && g.vertices) {
        for (const v of g.vertices) {
          minX = Math.min(minX, v.x);
          maxX = Math.max(maxX, v.x);
          minY = Math.min(minY, v.y);
          maxY = Math.max(maxY, v.y);
        }
      }
    }

    if (!hasItems) return null;

    const pad = this.selectionPadding;
    minX -= pad;
    maxX += pad;
    minY -= pad;
    maxY += pad;

    return {
      minX,
      maxX,
      minY,
      maxY,
      width: maxX - minX,
      height: maxY - minY,
      centerX: (minX + maxX) / 2,
      centerY: (minY + maxY) / 2
    };
  }

  /**
   * Applies translation (dx, dy) to selected items in-place.
   */
  applyTranslation(selectedStrokes = [], selectedShapes = [], dx, dy) {
    for (const stroke of selectedStrokes) {
      for (const p of stroke.points) {
        p.x += dx;
        p.y += dy;
      }
      stroke.cachedPath2D = null; // Invalidate cache
    }

    for (const shape of selectedShapes) {
      const g = shape.geometry;
      if (shape.type === 'line' || shape.type === 'arrow') {
        g.x1 += dx; g.y1 += dy;
        g.x2 += dx; g.y2 += dy;
      } else if (shape.type === 'circle' || shape.type === 'ellipse' || shape.type === 'star') {
        g.cx += dx; g.cy += dy;
      } else if (shape.type === 'rectangle' || shape.type === 'roundedRectangle') {
        g.x += dx; g.y += dy;
      } else if (shape.type === 'triangle') {
        g.p1.x += dx; g.p1.y += dy;
        g.p2.x += dx; g.p2.y += dy;
        g.p3.x += dx; g.p3.y += dy;
      } else if (shape.type === 'diamond') {
        g.p1.x += dx; g.p1.y += dy;
        g.p2.x += dx; g.p2.y += dy;
        g.p3.x += dx; g.p3.y += dy;
        g.p4.x += dx; g.p4.y += dy;
      } else if (shape.type === 'polygon' && g.vertices) {
        for (const v of g.vertices) {
          v.x += dx;
          v.y += dy;
        }
      }
    }
  }

  /**
   * Applies uniform scaling centered on (originX, originY) to selected items.
   */
  applyScale(selectedStrokes = [], selectedShapes = [], scaleFactor, originX, originY) {
    for (const stroke of selectedStrokes) {
      for (const p of stroke.points) {
        p.x = originX + (p.x - originX) * scaleFactor;
        p.y = originY + (p.y - originY) * scaleFactor;
        if (p.width) p.width *= scaleFactor;
      }
      if (stroke.width) stroke.width *= scaleFactor;
      stroke.cachedPath2D = null;
    }

    for (const shape of selectedShapes) {
      const g = shape.geometry;
      if (shape.type === 'line' || shape.type === 'arrow') {
        g.x1 = originX + (g.x1 - originX) * scaleFactor;
        g.y1 = originY + (g.y1 - originY) * scaleFactor;
        g.x2 = originX + (g.x2 - originX) * scaleFactor;
        g.y2 = originY + (g.y2 - originY) * scaleFactor;
      } else if (shape.type === 'circle') {
        g.cx = originX + (g.cx - originX) * scaleFactor;
        g.cy = originY + (g.cy - originY) * scaleFactor;
        g.r *= scaleFactor;
      } else if (shape.type === 'ellipse') {
        g.cx = originX + (g.cx - originX) * scaleFactor;
        g.cy = originY + (g.cy - originY) * scaleFactor;
        g.rx *= scaleFactor;
        g.ry *= scaleFactor;
      } else if (shape.type === 'rectangle' || shape.type === 'roundedRectangle') {
        const newX = originX + (g.x - originX) * scaleFactor;
        const newY = originY + (g.y - originY) * scaleFactor;
        g.x = newX;
        g.y = newY;
        g.width *= scaleFactor;
        g.height *= scaleFactor;
      } else if (shape.type === 'triangle') {
        g.p1.x = originX + (g.p1.x - originX) * scaleFactor;
        g.p1.y = originY + (g.p1.y - originY) * scaleFactor;
        g.p2.x = originX + (g.p2.x - originX) * scaleFactor;
        g.p2.y = originY + (g.p2.y - originY) * scaleFactor;
        g.p3.x = originX + (g.p3.x - originX) * scaleFactor;
        g.p3.y = originY + (g.p3.y - originY) * scaleFactor;
      } else if (shape.type === 'diamond') {
        g.p1.x = originX + (g.p1.x - originX) * scaleFactor;
        g.p1.y = originY + (g.p1.y - originY) * scaleFactor;
        g.p2.x = originX + (g.p2.x - originX) * scaleFactor;
        g.p2.y = originY + (g.p2.y - originY) * scaleFactor;
        g.p3.x = originX + (g.p3.x - originX) * scaleFactor;
        g.p3.y = originY + (g.p3.y - originY) * scaleFactor;
        g.p4.x = originX + (g.p4.x - originX) * scaleFactor;
        g.p4.y = originY + (g.p4.y - originY) * scaleFactor;
      } else if (shape.type === 'star') {
        g.cx = originX + (g.cx - originX) * scaleFactor;
        g.cy = originY + (g.cy - originY) * scaleFactor;
        g.r *= scaleFactor;
      } else if (shape.type === 'polygon' && g.vertices) {
        for (const v of g.vertices) {
          v.x = originX + (v.x - originX) * scaleFactor;
          v.y = originY + (v.y - originY) * scaleFactor;
        }
      }
      if (shape.lineWidth) shape.lineWidth *= scaleFactor;
    }
  }

  /**
   * Deep clones selected items with an offset for duplication.
   */
  duplicateItems(selectedStrokes = [], selectedShapes = [], offset = 20) {
    const clonedStrokes = selectedStrokes.map(s => {
      const clone = JSON.parse(JSON.stringify(s));
      clone.id = 'strk_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6);
      for (const p of clone.points) {
        p.x += offset;
        p.y += offset;
      }
      clone.cachedPath2D = null;
      return clone;
    });

    const clonedShapes = selectedShapes.map(sh => {
      const clone = JSON.parse(JSON.stringify(sh));
      clone.id = 'shp_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6);
      const g = clone.geometry;
      if (clone.type === 'line') {
        g.x1 += offset; g.y1 += offset;
        g.x2 += offset; g.y2 += offset;
      } else if (clone.type === 'circle' || clone.type === 'ellipse') {
        g.cx += offset; g.cy += offset;
      } else if (clone.type === 'rectangle') {
        g.x += offset; g.y += offset;
      } else if (clone.type === 'triangle') {
        g.p1.x += offset; g.p1.y += offset;
        g.p2.x += offset; g.p2.y += offset;
        g.p3.x += offset; g.p3.y += offset;
      }
      return clone;
    });

    return { clonedStrokes, clonedShapes };
  }

  /**
   * Renders the freeform lasso marquee line while drawing.
   */
  drawMarquee(ctx, polygon) {
    if (!polygon || polygon.length < 2) return;

    ctx.save();
    ctx.strokeStyle = '#0078d4';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 5]);
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(polygon[0].x, polygon[0].y);
    for (let i = 1; i < polygon.length; i++) {
      ctx.lineTo(polygon[i].x, polygon[i].y);
    }
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Renders the active selection box with corner handles and sleek styling.
   */
  drawSelectionBox(ctx, box) {
    if (!box) return;

    ctx.save();
    ctx.strokeStyle = '#0078d4';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);

    // Bounding rectangle
    ctx.strokeRect(box.minX, box.minY, box.width, box.height);

    // Subtle blue fill inside selection
    ctx.fillStyle = 'rgba(0, 120, 212, 0.05)';
    ctx.fillRect(box.minX, box.minY, box.width, box.height);

    // Draw handles (4 corners + scale handles)
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#0078d4';
    ctx.lineWidth = 2;

    const handleSize = 8;
    const halfH = handleSize / 2;

    const corners = [
      { x: box.minX, y: box.minY, cursor: 'nwse-resize' },
      { x: box.maxX, y: box.minY, cursor: 'nesw-resize' },
      { x: box.maxX, y: box.maxY, cursor: 'nwse-resize' },
      { x: box.minX, y: box.maxY, cursor: 'nesw-resize' }
    ];

    for (const c of corners) {
      ctx.fillRect(c.x - halfH, c.y - halfH, handleSize, handleSize);
      ctx.strokeRect(c.x - halfH, c.y - halfH, handleSize, handleSize);
    }

    ctx.restore();
  }
}
