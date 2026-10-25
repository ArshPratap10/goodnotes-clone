/**
 * @file strokeEngine.js
 * @description Dynamic Inking Physics & Bezier Curve Smoothing Engine.
 * Converts raw stylus/mouse input points into butter-smooth vector curves
 * with pressure sensitivity, velocity tapering, Catmull-Rom to Cubic Bezier
 * interpolation, and high-performance incremental rendering.
 */

export class StrokeEngine {
  /**
   * @param {Object} [options]
   * @param {number} [options.minDistance=2.0] - Minimum distance in px to filter micro-jitters
   * @param {number} [options.smoothingFactor=0.85] - Factor for curve interpolation
   */
  constructor(options = {}) {
    this.minDistance = options.minDistance !== undefined ? options.minDistance : 1.8;
    this.smoothingFactor = options.smoothingFactor || 0.85;
  }

  /**
   * Creates a new stroke object.
   * @param {Object} config
   * @param {'pen'|'fountain'|'highlighter'} [config.tool='pen']
   * @param {string} [config.color='#1e293b']
   * @param {number} [config.width=2.5]
   * @param {number} [config.opacity=1.0]
   * @returns {Object} StrokeData
   */
  createStroke({ tool = 'pen', color = '#1e293b', width = 2.5, opacity = 1.0 } = {}) {
    let blendMode = 'source-over';
    let effectiveOpacity = opacity;

    if (tool === 'highlighter') {
      blendMode = 'multiply';
      effectiveOpacity = 0.38;
      width = Math.max(width, 14.0); // Highlighters have thicker default width
    }

    return {
      id: 'strk_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6),
      tool,
      color,
      width,
      opacity: effectiveOpacity,
      blendMode,
      points: [],
      cachedPath2D: null
    };
  }

  /**
   * Adds and cleans a raw point into the active stroke.
   * Computes velocity and dynamic width.
   * 
   * @param {Object} stroke - Active StrokeData
   * @param {{x: number, y: number, pressure?: number, time?: number}} rawPoint 
   * @returns {boolean} True if point was added, false if filtered out as jitter
   */
  addPoint(stroke, rawPoint) {
    const x = rawPoint.x;
    const y = rawPoint.y;
    const pressure = rawPoint.pressure !== undefined && rawPoint.pressure > 0 ? rawPoint.pressure : 0.5;
    const time = rawPoint.time || performance.now();

    const points = stroke.points;
    const len = points.length;

    if (len > 0) {
      const prev = points[len - 1];
      const dx = x - prev.x;
      const dy = y - prev.y;
      const dist = Math.hypot(dx, dy);

      // Micro-jitter filtration: ignore points that are too close
      if (dist < this.minDistance) {
        return false;
      }

      const dt = Math.max(1, time - prev.time);
      const velocity = dist / dt; // pixels per millisecond

      const width = this.computeWidth(stroke.tool, stroke.width, pressure, velocity, prev.width);

      points.push({
        x,
        y,
        pressure,
        time,
        velocity,
        width,
        distFromPrev: dist
      });
    } else {
      // First point of the stroke
      const initialWidth = this.computeWidth(stroke.tool, stroke.width, pressure, 0, stroke.width);
      points.push({
        x,
        y,
        pressure,
        time,
        velocity: 0,
        width: initialWidth,
        distFromPrev: 0
      });
    }

    // Invalidate cached path
    stroke.cachedPath2D = null;
    return true;
  }

  /**
   * Computes dynamic stroke width based on tool type, stylus pressure, and velocity.
   * 
   * @param {string} tool - 'pen' | 'fountain' | 'highlighter'
   * @param {number} baseWidth - Configured tool base width
   * @param {number} pressure - Stylus pressure (0.0 to 1.0)
   * @param {number} velocity - Current drawing velocity in px/ms
   * @param {number} [prevWidth] - Previous segment width for smoothing
   * @returns {number} Dynamic pixel width
   */
  computeWidth(tool, baseWidth, pressure, velocity, prevWidth = null) {
    if (tool === 'ballpoint' || tool === 'pen') {
      // Subtle pressure modulation for ballpoint
      const pressureFactor = 0.8 + (pressure * 0.4); // 0.8x to 1.2x
      return baseWidth * pressureFactor;
    }

    if (tool === 'highlighter') {
      // Highlighters maintain uniform thick stroke
      return baseWidth;
    }

    if (tool === 'fountain') {
      // Fountain pen: responsive to velocity (tapering) and pressure
      // Higher velocity -> thinner stroke (ink stretches)
      // Higher pressure -> wider stroke (tines spread)
      const v = Math.min(Math.max(velocity, 0), 4.0);
      const velocityFactor = Math.max(0.45, 1.0 - (v * 0.22));

      // Stylus pressure response
      const pressureFactor = 0.35 + (pressure * 1.3); // 0.35x to 1.65x

      let targetWidth = baseWidth * velocityFactor * pressureFactor;
      targetWidth = Math.max(baseWidth * 0.3, Math.min(baseWidth * 2.2, targetWidth));

      // Exponential moving average to prevent harsh stepped edges
      if (prevWidth !== null) {
        return (prevWidth * 0.65) + (targetWidth * 0.35);
      }
      return targetWidth;
    }

    return baseWidth;
  }

  /**
   * Incrementally draws the latest segment of the active stroke onto the canvas.
   * Runs at 60-120fps with minimal computational overhead.
   * 
   * @param {CanvasRenderingContext2D} ctx - Context of activeCanvas
   * @param {Object} stroke - Active stroke data
   */
  drawSegment(ctx, stroke) {
    const pts = stroke.points;
    const len = pts.length;
    if (len < 2) return;

    ctx.save();
    ctx.lineCap = stroke.tool === 'highlighter' ? 'square' : 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.globalAlpha = stroke.opacity;

    if (stroke.blendMode && stroke.blendMode !== 'source-over') {
      ctx.globalCompositeOperation = stroke.blendMode;
    }

    if (len === 2) {
      // Initial line segment
      const p0 = pts[0];
      const p1 = pts[1];
      ctx.lineWidth = (p0.width + p1.width) / 2;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    } else {
      // Draw smooth quadratic curve through midpoints
      const p0 = pts[len - 3];
      const p1 = pts[len - 2];
      const p2 = pts[len - 1];

      const mid1x = (p0.x + p1.x) / 2;
      const mid1y = (p0.y + p1.y) / 2;
      const mid2x = (p1.x + p2.x) / 2;
      const mid2y = (p1.y + p2.y) / 2;

      ctx.lineWidth = p1.width;
      ctx.beginPath();
      ctx.moveTo(mid1x, mid1y);
      ctx.quadraticCurveTo(p1.x, p1.y, mid2x, mid2y);
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Generates a reusable Path2D object for the complete stroke.
   * Uses midpoint quadratic Bezier splines for maximum fidelity and smooth arcs.
   * 
   * @param {Object} stroke 
   * @returns {Path2D}
   */
  buildPath2D(stroke) {
    if (stroke.cachedPath2D) {
      return stroke.cachedPath2D;
    }

    const path = new Path2D();
    const pts = stroke.points;
    const len = pts.length;

    if (len === 0) return path;

    if (len === 1) {
      // Dot
      const r = pts[0].width / 2;
      path.arc(pts[0].x, pts[0].y, r, 0, Math.PI * 2);
      stroke.cachedPath2D = path;
      return path;
    }

    if (len === 2) {
      path.moveTo(pts[0].x, pts[0].y);
      path.lineTo(pts[1].x, pts[1].y);
      stroke.cachedPath2D = path;
      return path;
    }

    path.moveTo(pts[0].x, pts[0].y);

    // Initial midpoint
    let p0 = pts[0];
    let p1 = pts[1];
    let midX = (p0.x + p1.x) / 2;
    let midY = (p0.y + p1.y) / 2;
    path.lineTo(midX, midY);

    for (let i = 1; i < len - 1; i++) {
      const current = pts[i];
      const next = pts[i + 1];
      const nextMidX = (current.x + next.x) / 2;
      const nextMidY = (current.y + next.y) / 2;
      path.quadraticCurveTo(current.x, current.y, nextMidX, nextMidY);
    }

    // Connect to final point
    const last = pts[len - 1];
    path.lineTo(last.x, last.y);

    stroke.cachedPath2D = path;
    return path;
  }

  /**
   * Renders a complete stroke with full quality onto any canvas context.
   * Utilizes cached Path2D for instantaneous hardware-accelerated GPU rendering.
   * 
   * @param {CanvasRenderingContext2D} ctx 
   * @param {Object} stroke 
   * @param {boolean} [isDarkBackground=false]
   */
  renderStroke(ctx, stroke, isDarkBackground = false) {
    const pts = stroke.points;
    const len = pts.length;
    if (len === 0) return;

    ctx.save();
    ctx.lineCap = stroke.tool === 'highlighter' ? 'square' : 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.globalAlpha = stroke.opacity;

    // In dark mode, multiply blend mode makes highlighters invisible against black.
    // Use 'screen' or 'source-over' with adjusted opacity for dark mode.
    if (stroke.tool === 'highlighter') {
      if (isDarkBackground) {
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = 0.55;
      } else {
        ctx.globalCompositeOperation = 'multiply';
      }
    } else if (stroke.blendMode && stroke.blendMode !== 'source-over') {
      ctx.globalCompositeOperation = stroke.blendMode;
    }

    if (len === 1) {
      const p = pts[0];
      ctx.beginPath();
      ctx.arc(p.x, p.y, (p.width || stroke.width) / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    // High performance Path2D rendering
    const path = this.buildPath2D(stroke);
    ctx.lineWidth = stroke.width;
    ctx.stroke(path);

    ctx.restore();
  }

  /**
   * Tests if a target point is near any segment of the stroke (used for Eraser).
   * 
   * @param {Object} stroke 
   * @param {number} px - Target docX
   * @param {number} py - Target docY
   * @param {number} tolerance - Hit distance threshold in px
   * @returns {boolean}
   */
  isPointNearStroke(stroke, px, py, tolerance = 10) {
    const pts = stroke.points;
    const len = pts.length;
    if (len === 0) return false;

    const hitDist = tolerance + (stroke.width / 2);

    // Quick bounding box check
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < len; i++) {
      const p = pts[i];
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    if (px < minX - hitDist || px > maxX + hitDist || py < minY - hitDist || py > maxY + hitDist) {
      return false;
    }

    // Single point test
    if (len === 1) {
      return Math.hypot(px - pts[0].x, py - pts[0].y) <= hitDist;
    }

    // Segment distance test
    for (let i = 0; i < len - 1; i++) {
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const dist = this.distToSegmentSquared(px, py, p1.x, p1.y, p2.x, p2.y);
      if (dist <= hitDist * hitDist) {
        return true;
      }
    }

    return false;
  }

  /**
   * Helper: Squared distance from point (px, py) to line segment (x1, y1)-(x2, y2)
   */
  distToSegmentSquared(px, py, x1, y1, x2, y2) {
    const l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
    if (l2 === 0) return (px - x1) * (px - x1) + (py - y1) * (py - y1);
    let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
    t = Math.max(0, Math.min(1, t));
    const projX = x1 + t * (x2 - x1);
    const projY = y1 + t * (y2 - y1);
    const dx = px - projX;
    const dy = py - projY;
    return dx * dx + dy * dy;
  }

  /**
   * Mathematically clips a vector stroke against an eraser circle.
   * Splits intersecting strokes into clean contiguous sub-strokes with exact entry/exit points.
   * 
   * @param {Object} stroke 
   * @param {number} cx - Eraser center X
   * @param {number} cy - Eraser center Y
   * @param {number} radius - Eraser radius
   * @returns {{ modified: boolean, strokes: Array<Object> }}
   */
  clipStrokeByCircle(stroke, cx, cy, radius) {
    const pts = stroke.points;
    if (!pts || pts.length === 0) return { modified: false, strokes: [] };
    const effR = radius + (stroke.width || 2) / 2;
    const effR2 = effR * effR;

    // Fast bounding box rejection test
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    if (cx < minX - effR || cx > maxX + effR || cy < minY - effR || cy > maxY + effR) {
      return { modified: false, strokes: [stroke] };
    }

    function isInside(p) {
      const dx = p.x - cx;
      const dy = p.y - cy;
      return (dx * dx + dy * dy) <= effR2;
    }

    function lerpPoint(p1, p2, t) {
      return {
        x: p1.x + (p2.x - p1.x) * t,
        y: p1.y + (p2.y - p1.y) * t,
        width: p1.width ? p1.width + (p2.width - p1.width) * t : stroke.width,
        pressure: p1.pressure !== undefined ? p1.pressure + (p2.pressure - p1.pressure) * t : 0.5,
        time: p1.time ? p1.time + (p2.time - p1.time) * t : Date.now()
      };
    }

    const resultStrokes = [];
    let currentPiece = [];

    function finishPiece() {
      if (currentPiece.length >= 2) {
        resultStrokes.push({
          ...stroke,
          id: 'strk_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6),
          points: currentPiece,
          cachedPath2D: null
        });
      } else if (currentPiece.length === 1) {
        resultStrokes.push({
          ...stroke,
          id: 'strk_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6),
          points: [currentPiece[0], { ...currentPiece[0], x: currentPiece[0].x + 0.1 }],
          cachedPath2D: null
        });
      }
      currentPiece = [];
    }

    if (pts.length === 1) {
      if (isInside(pts[0])) return { modified: true, strokes: [] };
      return { modified: false, strokes: [stroke] };
    }

    let prevInside = isInside(pts[0]);
    if (!prevInside) {
      currentPiece.push(pts[0]);
    }

    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i];
      const p2 = pts[i + 1];

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const segLen2 = dx * dx + dy * dy;

      if (segLen2 === 0) continue;

      const fx = p1.x - cx;
      const fy = p1.y - cy;

      const A = segLen2;
      const B = 2 * (fx * dx + fy * dy);
      const C = fx * fx + fy * fy - effR2;

      const disc = B * B - 4 * A * C;
      const p2Inside = isInside(p2);

      if (disc < 0) {
        if (!prevInside) {
          currentPiece.push(p2);
        }
      } else {
        const sqrtDisc = Math.sqrt(disc);
        const t1 = (-B - sqrtDisc) / (2 * A);
        const t2 = (-B + sqrtDisc) / (2 * A);

        const ts = [];
        if (t1 > 0.0001 && t1 < 0.9999) ts.push(t1);
        if (t2 > 0.0001 && t2 < 0.9999) ts.push(t2);
        ts.sort((a, b) => a - b);

        if (ts.length === 0) {
          if (!p2Inside) {
            currentPiece.push(p2);
          }
        } else if (ts.length === 1) {
          const t = ts[0];
          const clipPt = lerpPoint(p1, p2, t);
          if (!prevInside && p2Inside) {
            currentPiece.push(clipPt);
            finishPiece();
          } else if (prevInside && !p2Inside) {
            currentPiece = [clipPt, p2];
          } else {
            if (!p2Inside) currentPiece.push(p2);
          }
        } else if (ts.length === 2) {
          const clip1 = lerpPoint(p1, p2, ts[0]);
          const clip2 = lerpPoint(p1, p2, ts[1]);

          if (!prevInside) {
            currentPiece.push(clip1);
            finishPiece();
          }
          if (!p2Inside) {
            currentPiece = [clip2, p2];
          }
        }
      }

      prevInside = p2Inside;
    }

    finishPiece();

    const isIdentical = resultStrokes.length === 1 && resultStrokes[0].points.length === pts.length;
    return { modified: !isIdentical, strokes: resultStrokes };
  }
}
