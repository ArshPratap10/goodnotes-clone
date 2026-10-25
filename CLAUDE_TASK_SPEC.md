# Specialized Mathematical & Algorithmic Modules for Claude Sonnet 4.6 (Thinking)

**Notice to Claude Sonnet:** You are tasked with implementing the high-precision algorithmic modules for a **GoodNotes-style Windows Inking Application**. 
The application shell, HTML, CSS, DOM event listeners, and UI are handled separately. Your focus is strictly on **mathematical elegance, zero latency, coordinate transformations, and algorithmic precision**.

All modules must be written in clean, modern ES6+ JavaScript, fully commented, with no external dependencies (pure math and Canvas 2D APIs).

---

## Task 1: Dynamic Stroke Smoothing & Inking Physics (`strokeEngine.js`)

### Objective
Raw input from a mouse or stylus consists of discrete, jagged `(x, y, pressure)` points. You must convert these raw points into a butter-smooth, continuous vector curve using **Catmull-Rom to Cubic Bezier conversion** with dynamic width modulation based on pressure and drawing speed.

### Specifications
1. **Point Smoothing:** 
   * Convert an array of discrete points into smooth cubic Bezier segments using standard midpoint or Catmull-Rom splines.
   * Eliminate micro-jitters (filter out points that are closer than 2 pixels from the previous point).
2. **Dynamic Width Calculation:**
   * For the **Fountain Pen**: stroke width varies dynamically based on stylus pressure (`0.0` to `1.0`) and velocity $v = \frac{\Delta d}{\Delta t}$. Fast strokes should taper naturally; slow strokes should be slightly broader.
   * For the **Ballpoint Pen**: width is uniform, but stroke start and end should have subtle rounded caps.
   * For the **Highlighter**: stroke width is wide and uniform with flat or slightly rounded ends.
3. **Rendering Pipeline:**
   * Provide a method `renderLiveStroke(ctx, currentStroke, newPoint)` to incrementally draw the newest segment to the active canvas with zero redraw overhead.
   * Provide a method `generatePath2D(stroke)` that builds and returns a complete, reusable `Path2D` object for the entire stroke to be rendered on the vector layer.

### Interface to Implement
```javascript
export class StrokeEngine {
  constructor(options = {}) {
    this.minDistance = options.minDistance || 2.0;
    this.smoothingFactor = options.smoothingFactor || 0.85;
  }

  /**
   * Cleans raw input and adds point with velocity calculation
   */
  addPoint(stroke, rawPoint) { /* ... */ }

  /**
   * Computes dynamic stroke width based on tool type, pressure, and velocity
   */
  computeWidth(tool, baseWidth, pressure, velocity) { /* ... */ }

  /**
   * Draws only the latest smoothed segment to the active 2D canvas
   */
  drawSegment(ctx, stroke) { /* ... */ }

  /**
   * Generates a permanent Path2D from all points in the completed stroke
   */
  buildPath2D(stroke) { /* ... */ }
}
```

---

## Task 2: Geometric Shape Recognition & Snapping (`shapeRecognizer.js`)

### Objective
Implement the GoodNotes shape-snapping feature: when the user draws a rough shape (line, circle/ellipse, rectangle, triangle) and pauses their pen at the end of the stroke (or when shape mode is active), classify the stroke and output the snapped geometric shape.

### Classification Rules
1. **Straight Line:**
   * Calculate linearity: ratio of distance between start and end point $D(p_{start}, p_{end})$ vs total path length $L = \sum |p_{i+1} - p_i|$. If ratio $> 0.92$, snap to a crisp straight line.
2. **Rectangle / Square:**
   * If start and end points are close ($D < 15\% \times \text{perimeter}$) and corner detection (significant angle change in trajectory) identifies 4 dominant corners, fit a bounding rectangle or oriented bounding box (OBB).
3. **Circle / Ellipse:**
   * If path is closed, calculate center of mass $(\bar{x}, \bar{y})$. Calculate the variance of distances from all points to the center. If distance variance is very low, snap to a perfect circle ($r = \text{mean}(d)$) or an axis-aligned ellipse.
4. **Triangle:**
   * Closed shape with 3 dominant corner vertices. Snap to the 3 connected straight lines.

### Interface to Implement
```javascript
export class ShapeRecognizer {
  /**
   * Analyzes an array of points and returns the classified shape or null if not a recognized shape.
   * @param {Point[]} points
   * @returns {ShapeResult | null}
   */
  classify(points) {
    // Return format:
    // {
    //   type: 'line' | 'rectangle' | 'circle' | 'ellipse' | 'triangle',
    //   confidence: number, // 0.0 to 1.0
    //   geometry: { ...specific parameters like start/end, center/radius, or vertices... }
    // }
  }

  /**
   * Draws the snapped geometry to the canvas context
   */
  drawSnappedShape(ctx, shapeResult, color, lineWidth) { /* ... */ }
}
```

---

## Task 3: Lasso Tool & Point-In-Polygon Collision (`lassoEngine.js`)

### Objective
The user draws an arbitrary closed loop (lasso). The engine must identify which vector strokes and shapes lie inside the lasso, calculate an encompassing bounding box with handles, and provide translation/scaling affine transformations.

### Specifications
1. **Ray-Casting Algorithm (Point-in-Polygon):**
   * Implement a standard ray-casting algorithm to test if a point $(x, y)$ is inside the polygon formed by the lasso loop.
2. **Stroke Inclusion Test:**
   * A stroke is considered selected if either:
     * More than 50% of its sample points lie inside the lasso polygon, OR
     * The stroke intersects the lasso perimeter.
3. **Bounding Box & Transform Matrix:**
   * Compute the minimal axis-aligned bounding box (AABB) around all selected items.
   * Provide transformation methods to translate $\Delta x, \Delta y$ and uniformly scale the selected items.

### Interface to Implement
```javascript
export class LassoEngine {
  /**
   * Ray casting algorithm to check if point is inside polygon
   */
  isPointInPolygon(point, polygon) { /* ... */ }

  /**
   * Checks if an entire stroke intersects or is enclosed by the lasso polygon
   */
  isStrokeSelected(stroke, polygon) { /* ... */ }

  /**
   * Finds all strokes and shapes enclosed by the lasso
   */
  findSelectedItems(items, polygon) { /* ... */ }

  /**
   * Calculates the bounding box around all selected items
   */
  computeBoundingBox(selectedItems) { /* ... */ }

  /**
   * Applies translation (dx, dy) to all points in the selected items
   */
  applyTransform(selectedItems, dx, dy, scale) { /* ... */ }
}
```

---

## Task 4: Viewport Coordinate Matrix & High-DPI Mapping (`coordMatrix.js`)

### Objective
Ensure that zoom, pan, and screen resolution changes never cause inking offsets or blurry rendering.

### Specifications
1. **Coordinate Conversion:**
   * Screen Coordinates: Event client `(clientX, clientY)` relative to the viewport.
   * Document Coordinates: Position on the virtual paper/PDF page in points `(docX, docY)`.
   * High-DPI Canvas Coordinates: Pixel coordinates scaled by `window.devicePixelRatio`.
2. **Zoom & Pan:**
   * Support zooming centered on pointer position (pinch-to-zoom / wheel zoom).
   * Transform matrix mapping between screen and document spaces:
     $$\begin{pmatrix} x_{doc} \\ y_{doc} \end{pmatrix} = \frac{1}{\text{zoom}} \begin{pmatrix} x_{screen} - \text{panX} \\ y_{screen} - \text{panY} \end{pmatrix}$$

### Interface to Implement
```javascript
export class CoordMatrix {
  constructor() {
    this.zoom = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.dpr = window.devicePixelRatio || 1;
  }

  screenToDoc(screenX, screenY, canvasBoundingRect) { /* ... */ }
  docToScreen(docX, docY, canvasBoundingRect) { /* ... */ }
  applyCanvasTransform(ctx) { /* ... */ }
  zoomAtPoint(deltaZoom, screenCenterX, screenCenterY) { /* ... */ }
}
```

---

## Deliverables Summary for Claude Sonnet
When generating code for these modules:
* Return self-contained JavaScript files (`strokeEngine.js`, `shapeRecognizer.js`, `lassoEngine.js`, `coordMatrix.js`).
* Use pure mathematical algorithms with fast execution loops ($O(N)$ wherever possible).
* Include JSDoc comments explaining the geometric rationale.
