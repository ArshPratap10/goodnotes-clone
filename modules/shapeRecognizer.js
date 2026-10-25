/**
 * @file shapeRecognizer.js
 * @description Advanced Geometric Shape Classification & Auto-Snapping Engine.
 * Intelligently recognizes hand-drawn straight lines, arrows, triangles, rectangles,
 * squares, rounded rectangles, diamonds, circles, ellipses, stars, and polygons,
 * transforming rough stylus/mouse gestures into crisp mathematical vector geometry.
 */

export class ShapeRecognizer {
  constructor(options = {}) {
    this.linearityThreshold = options.linearityThreshold || 0.86;
    this.circleVarianceThreshold = options.circleVarianceThreshold || 0.22;
    this.closureThreshold = options.closureThreshold || 0.40;
  }

  /**
   * Classifies an array of points into a geometric shape.
   * 
   * @param {Array<{x: number, y: number}>} points 
   * @returns {Object|null} Shape classification result or null if unrecognized
   */
  classify(points) {
    if (!points || points.length < 3) return null;

    const n = points.length;
    const start = points[0];
    const end = points[n - 1];

    let totalLength = 0;
    for (let i = 0; i < n - 1; i++) {
      totalLength += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
    }

    if (totalLength < 16) return null; // Ignore tiny twitch strokes

    const directDist = Math.hypot(end.x - start.x, end.y - start.y);
    const linearity = directDist / totalLength;
    const bbox = this.computeBoundingBox(points);
    const diag = Math.hypot(bbox.width, bbox.height);
    const closureRatio = directDist / totalLength;
    const isClosed = closureRatio < this.closureThreshold || directDist < Math.max(24, diag * 0.18);

    // 1. Check for Straight Line (Quick linear chord)
    if (linearity >= this.linearityThreshold) {
      return this.createStraightLine(start, end, linearity);
    }

    // 2. Check for Arrow (Open stroke: straight shaft + arrowhead near tip)
    if (!isClosed && totalLength > 30) {
      const arrowResult = this.testArrow(points, start, n);
      if (arrowResult) return arrowResult;
    }

    // 3. For Closed or Loop Strokes: Evaluate Polygons, Circles, Diamonds, Stars
    if (isClosed && bbox.width > 10 && bbox.height > 10) {
      // Center of mass and radial distribution
      let sumX = 0, sumY = 0;
      for (let i = 0; i < n; i++) {
        sumX += points[i].x;
        sumY += points[i].y;
      }
      const cx = sumX / n;
      const cy = sumY / n;

      const dists = [];
      let sumDist = 0;
      for (let i = 0; i < n; i++) {
        const d = Math.hypot(points[i].x - cx, points[i].y - cy);
        dists.push(d);
        sumDist += d;
      }
      const meanRadius = sumDist / n;

      let varianceSum = 0;
      for (let i = 0; i < n; i++) {
        varianceSum += (dists[i] - meanRadius) ** 2;
      }
      const stdDev = Math.sqrt(varianceSum / n);
      const coeffVariation = stdDev / meanRadius;

      // Area metrics
      const area = this.computePolygonArea(points);
      const bboxArea = Math.max(1, bbox.width * bbox.height);
      const areaRatio = area / bboxArea;
      const aspectRatio = bbox.width / bbox.height;

      // Simplify polygon using Douglas-Peucker with adaptive tolerance
      const eps = Math.max(6, Math.min(22, diag * 0.075));
      let vertices = this.simplifyClosedPolyline(points, eps);

      // Remove closure duplicate vertex if distance is small
      if (vertices.length > 2 && Math.hypot(vertices[vertices.length - 1].x - vertices[0].x, vertices[vertices.length - 1].y - vertices[0].y) < 35) {
        vertices = vertices.slice(0, -1);
      }

      const numCorners = vertices.length;

      // A. Star Detection (5-pointed star: self-intersecting or 5 outward peaks)
      if (numCorners === 5 && areaRatio < 0.38) {
        return {
          type: 'star',
          confidence: 0.90,
          geometry: {
            cx: bbox.cx,
            cy: bbox.cy,
            r: Math.max(bbox.width, bbox.height) / 2
          }
        };
      }

      // B. Triangle Detection:
      // Exactly 3 simplified corners OR areaRatio <= 0.58 with 3-4 corners and high radial variance
      if (numCorners === 3 || (numCorners === 4 && areaRatio < 0.56 && coeffVariation > 0.20)) {
        let triPts = vertices;
        if (triPts.length === 4) {
          // Merge two closest vertices into one
          let minPairDist = Infinity;
          let mergeIdx = 0;
          for (let i = 0; i < 4; i++) {
            const next = (i + 1) % 4;
            const d = Math.hypot(triPts[i].x - triPts[next].x, triPts[i].y - triPts[next].y);
            if (d < minPairDist) {
              minPairDist = d;
              mergeIdx = i;
            }
          }
          triPts = triPts.filter((_, idx) => idx !== mergeIdx);
        }

        if (triPts.length >= 3) {
          return {
            type: 'triangle',
            confidence: 0.92,
            geometry: {
              p1: { x: triPts[0].x, y: triPts[0].y },
              p2: { x: triPts[1].x, y: triPts[1].y },
              p3: { x: triPts[2].x, y: triPts[2].y }
            }
          };
        }
      }

      // C. Diamond / Rhombus Detection:
      // 4 corners, area ratio ~0.50 (between 0.40 and 0.62)
      if (numCorners === 4 && areaRatio >= 0.40 && areaRatio <= 0.62) {
        return {
          type: 'diamond',
          confidence: 0.88,
          geometry: {
            p1: { x: bbox.cx, y: bbox.minY },
            p2: { x: bbox.maxX, y: bbox.cy },
            p3: { x: bbox.cx, y: bbox.maxY },
            p4: { x: bbox.minX, y: bbox.cy }
          }
        };
      }

      // D. Circle Detection:
      // Very low radial variance or round aspect ratio with low variance
      if (coeffVariation < 0.18 || (aspectRatio >= 0.80 && aspectRatio <= 1.25 && coeffVariation < 0.24)) {
        return {
          type: 'circle',
          confidence: Math.max(0.75, 1.0 - coeffVariation),
          geometry: {
            cx: bbox.cx,
            cy: bbox.cy,
            r: (bbox.width + bbox.height) / 4
          }
        };
      }

      // E. Ellipse Detection:
      if (coeffVariation < 0.32 && areaRatio >= 0.62 && areaRatio <= 0.86) {
        return {
          type: 'ellipse',
          confidence: 0.85,
          geometry: {
            cx: bbox.cx,
            cy: bbox.cy,
            rx: bbox.width / 2,
            ry: bbox.height / 2
          }
        };
      }

      // F. Rectangle / Square Detection:
      // 4 corners or high bounding box fill (areaRatio > 0.72)
      if (numCorners === 4 || areaRatio > 0.72) {
        const isSquare = aspectRatio >= 0.85 && aspectRatio <= 1.15;
        if (isSquare) {
          const side = (bbox.width + bbox.height) / 2;
          return {
            type: 'rectangle',
            subType: 'square',
            confidence: 0.90,
            geometry: {
              x: bbox.cx - side / 2,
              y: bbox.cy - side / 2,
              width: side,
              height: side
            }
          };
        }

        return {
          type: 'rectangle',
          confidence: 0.88,
          geometry: {
            x: bbox.minX,
            y: bbox.minY,
            width: bbox.width,
            height: bbox.height
          }
        };
      }

      // G. Convex Polygon Detection (5 or 6 corners)
      if (numCorners === 5 || numCorners === 6) {
        return {
          type: 'polygon',
          confidence: 0.82,
          geometry: {
            vertices: vertices.map(v => ({ x: v.x, y: v.y }))
          }
        };
      }
    }

    // Fallback: Test if line ends were curled slightly
    if (linearity >= 0.80 && !isClosed) {
      return this.createStraightLine(start, end, linearity);
    }

    return null;
  }

  /**
   * Snaps a line to exact horizontal, vertical, or 45-degree angle if close.
   */
  createStraightLine(start, end, confidence) {
    let p1 = { x: start.x, y: start.y };
    let p2 = { x: end.x, y: end.y };

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const angle = Math.atan2(dy, dx);
    const deg = Math.abs((angle * 180) / Math.PI);

    // Snap to horizontal (0 deg or 180 deg)
    if (deg < 6 || deg > 174) {
      p2.y = p1.y;
    }
    // Snap to vertical (90 deg)
    else if (Math.abs(deg - 90) < 6) {
      p2.x = p1.x;
    }
    // Snap to 45 or 135 deg
    else if (Math.abs(deg - 45) < 5 || Math.abs(deg - 135) < 5) {
      const len = Math.hypot(dx, dy);
      const signX = dx >= 0 ? 1 : -1;
      const signY = dy >= 0 ? 1 : -1;
      const comp = len * Math.SQRT1_2;
      p2.x = p1.x + signX * comp;
      p2.y = p1.y + signY * comp;
    }

    return {
      type: 'line',
      confidence,
      geometry: {
        x1: p1.x,
        y1: p1.y,
        x2: p2.x,
        y2: p2.y
      }
    };
  }

  /**
   * Tests for an arrow gesture (straight shaft followed by head turn)
   */
  testArrow(points, start, n) {
    // Find point farthest from start (the arrow tip)
    let maxD = 0;
    let tipIdx = 0;
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(points[i].x - start.x, points[i].y - start.y);
      if (d > maxD) {
        maxD = d;
        tipIdx = i;
      }
    }

    // Shaft must represent between 45% and 88% of stroke points
    if (tipIdx >= Math.floor(n * 0.45) && tipIdx <= Math.floor(n * 0.88) && maxD > 25) {
      const shaft = points.slice(0, tipIdx + 1);
      let shaftLen = 0;
      for (let i = 0; i < shaft.length - 1; i++) {
        shaftLen += Math.hypot(shaft[i + 1].x - shaft[i].x, shaft[i + 1].y - shaft[i].y);
      }
      const shaftLinearity = maxD / shaftLen;

      // Ensure the head points do not retreat all the way back to the start
      const tipPt = points[tipIdx];
      let headNearTip = true;
      for (let i = tipIdx + 1; i < n; i++) {
        if (Math.hypot(points[i].x - tipPt.x, points[i].y - tipPt.y) > maxD * 0.55) {
          headNearTip = false;
          break;
        }
      }

      if (shaftLinearity >= 0.86 && headNearTip) {
        return {
          type: 'arrow',
          confidence: 0.90,
          geometry: {
            x1: start.x,
            y1: start.y,
            x2: tipPt.x,
            y2: tipPt.y
          }
        };
      }
    }

    return null;
  }

  /**
   * Computes axis-aligned bounding box of a point set
   */
  computeBoundingBox(points) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    return {
      minX,
      maxX,
      minY,
      maxY,
      width: maxX - minX,
      height: maxY - minY,
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2
    };
  }

  /**
   * Computes polygon area using the Shoelace formula
   */
  computePolygonArea(points) {
    let area = 0;
    const n = points.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += points[i].x * points[j].y;
      area -= points[j].x * points[i].y;
    }
    return Math.abs(area / 2);
  }

  /**
   * Simplifies a closed polyline by splitting at the farthest point and running RDP
   */
  simplifyClosedPolyline(points, epsilon) {
    if (points.length < 5) return points;
    let maxD = 0;
    let farIdx = 0;
    const start = points[0];
    for (let i = 0; i < points.length; i++) {
      const d = Math.hypot(points[i].x - start.x, points[i].y - start.y);
      if (d > maxD) {
        maxD = d;
        farIdx = i;
      }
    }

    if (farIdx < 2 || farIdx > points.length - 3) {
      return this.ramerDouglasPeucker(points, epsilon);
    }

    const part1 = this.ramerDouglasPeucker(points.slice(0, farIdx + 1), epsilon);
    const part2 = this.ramerDouglasPeucker(points.slice(farIdx), epsilon);
    return part1.slice(0, -1).concat(part2);
  }

  /**
   * Standard Ramer-Douglas-Peucker algorithm
   */
  ramerDouglasPeucker(points, epsilon) {
    if (points.length <= 2) return points;

    let maxDist = 0;
    let index = 0;
    const start = points[0];
    const end = points[points.length - 1];

    for (let i = 1; i < points.length - 1; i++) {
      const d = this.perpendicularDistance(points[i], start, end);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }

    if (maxDist > epsilon) {
      const left = this.ramerDouglasPeucker(points.slice(0, index + 1), epsilon);
      const right = this.ramerDouglasPeucker(points.slice(index), epsilon);
      return left.slice(0, -1).concat(right);
    } else {
      return [start, end];
    }
  }

  perpendicularDistance(pt, lineStart, lineEnd) {
    const dx = lineEnd.x - lineStart.x;
    const dy = lineEnd.y - lineStart.y;
    const mag = Math.hypot(dx, dy);
    if (mag === 0) return Math.hypot(pt.x - lineStart.x, pt.y - lineStart.y);
    return Math.abs(dy * pt.x - dx * pt.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x) / mag;
  }

  /**
   * Draws a snapped geometric shape to a canvas context.
   * 
   * @param {CanvasRenderingContext2D} ctx 
   * @param {Object} shapeResult 
   * @param {string} color 
   * @param {number} lineWidth 
   */
  drawSnappedShape(ctx, shapeResult, color, lineWidth) {
    if (!shapeResult || !shapeResult.geometry) return;

    ctx.save();
    ctx.strokeStyle = color || shapeResult.color || '#0f172a';
    ctx.lineWidth = lineWidth || shapeResult.lineWidth || 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const g = shapeResult.geometry;
    const fillStyle = shapeResult.fillColor || null;

    ctx.beginPath();
    switch (shapeResult.type) {
      case 'line':
        ctx.moveTo(g.x1, g.y1);
        ctx.lineTo(g.x2, g.y2);
        break;

      case 'arrow':
        // Draw shaft
        ctx.moveTo(g.x1, g.y1);
        ctx.lineTo(g.x2, g.y2);

        // Draw arrowhead
        const angle = Math.atan2(g.y2 - g.y1, g.x2 - g.x1);
        const headLen = Math.max(14, ctx.lineWidth * 3.8);
        const a1 = angle - Math.PI / 6;
        const a2 = angle + Math.PI / 6;

        ctx.lineTo(g.x2 - headLen * Math.cos(a1), g.y2 - headLen * Math.sin(a1));
        ctx.moveTo(g.x2, g.y2);
        ctx.lineTo(g.x2 - headLen * Math.cos(a2), g.y2 - headLen * Math.sin(a2));
        break;

      case 'circle':
        ctx.arc(g.cx, g.cy, Math.abs(g.r), 0, Math.PI * 2);
        break;

      case 'ellipse':
        ctx.ellipse(g.cx, g.cy, Math.abs(g.rx || g.r), Math.abs(g.ry || g.r), 0, 0, Math.PI * 2);
        break;

      case 'rectangle':
        ctx.rect(g.x, g.y, g.width, g.height);
        break;

      case 'roundedRectangle':
        const r = g.r || Math.min(16, Math.abs(g.width) / 4, Math.abs(g.height) / 4);
        if (ctx.roundRect) {
          ctx.roundRect(g.x, g.y, g.width, g.height, r);
        } else {
          ctx.rect(g.x, g.y, g.width, g.height);
        }
        break;

      case 'triangle':
        ctx.moveTo(g.p1.x, g.p1.y);
        ctx.lineTo(g.p2.x, g.p2.y);
        ctx.lineTo(g.p3.x, g.p3.y);
        ctx.closePath();
        break;

      case 'diamond':
        ctx.moveTo(g.p1.x, g.p1.y);
        ctx.lineTo(g.p2.x, g.p2.y);
        ctx.lineTo(g.p3.x, g.p3.y);
        ctx.lineTo(g.p4.x, g.p4.y);
        ctx.closePath();
        break;

      case 'star':
        const cx = g.cx || (g.x + (g.width || 0) / 2);
        const cy = g.cy || (g.y + (g.height || 0) / 2);
        const outerR = g.r || Math.min(Math.abs(g.width || 40), Math.abs(g.height || 40)) / 2;
        const innerR = outerR * 0.40;
        for (let i = 0; i < 10; i++) {
          const radius = i % 2 === 0 ? outerR : innerR;
          const a = (i * Math.PI) / 5 - Math.PI / 2;
          const x = cx + radius * Math.cos(a);
          const y = cy + radius * Math.sin(a);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        break;

      case 'polygon':
        if (g.vertices && g.vertices.length > 2) {
          ctx.moveTo(g.vertices[0].x, g.vertices[0].y);
          for (let i = 1; i < g.vertices.length; i++) {
            ctx.lineTo(g.vertices[i].x, g.vertices[i].y);
          }
          ctx.closePath();
        }
        break;
    }

    if (fillStyle && fillStyle !== 'none') {
      ctx.fillStyle = fillStyle;
      ctx.fill();
    }
    ctx.stroke();
    ctx.restore();
  }
}
