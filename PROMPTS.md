# GoodNotes Windows App: Multi-Model AI Prompts

This document contains the exact prompts to feed into **Gemini 3.8 Flash (High)** and **Claude Sonnet 4.6 (Thinking)** to build the application step-by-step with optimal token usage.

---

## 📋 Division of Labor Strategy

```
┌────────────────────────────────────────────────────────┐
│  Gemini 3.8 Flash (High) [Heavy Lifting - 85% of work] │
│  • HTML UI structure & modern GoodNotes styling        │
│  • Toolbars, sliders, color pickers, modals            │
│  • DOM event wiring & page thumbnail lists             │
│  • LocalStorage / IndexedDB project save & load        │
│  • Windows launchers (batch files, local server)       │
└────────────────────────────────────────────────────────┘
                           │
                           ▼ (Only when complex math arises)
┌────────────────────────────────────────────────────────┐
│   Claude Sonnet 4.6 (Thinking) [Surgical - 15% of work] │
│  1. Inking Stroke Physics & Bezier smoothing algorithms│
│  2. Zoom/Pan coordinate matrix transformation          │
│  3. Lasso polygon collision detection                  │
│  4. Shape classification & auto-snapping math          │
└────────────────────────────────────────────────────────┘
```

---

## 🚀 Step 1: Prompt for Gemini 3.8 Flash (High) *(Run First)*

Copy and paste this into the chat with **Gemini 3.8 Flash (High)** selected:

```markdown
Please read `GOODNOTES_MASTER_SPEC.md` and `GEMINI_BUILD_PLAN.md` in the current workspace.

Your goal is to scaffold and build the core application shell, GoodNotes styling, paper templates, and PDF integration (Phases 1 through 4):

1. **`index.html`**:
   - Top Header Bar: Documents button, editable document title, page navigator (Prev, Page X of Y, Next, Add Page), zoom controls (- / + / 100% / Fit Width), undo/redo, export dropdown (PDF, PNG, Project), and dark/light mode toggle.
   - Inking Ribbon: Pen (Ballpoint / Fountain), Highlighter, Eraser (Stroke / Precision), Lasso, Shapes, Text Box, Sticky Notes, 3 quick color circles + color picker, 3 thickness pills + custom slider.
   - Main Canvas Stage: Left collapsible thumbnails sidebar and 3-layer canvas container (`#bgCanvas`, `#vectorCanvas`, `#activeCanvas`).
   - Modals: Template picker (Plain, Ruled, Grid, Dotted, Cornell, Dark) and PDF file drop zone.

2. **`styles.css`**:
   - Modern GoodNotes 6 / Windows Fluent design system with glassmorphic blur (`backdrop-filter: blur(12px)`), crisp icons, smooth hover states, and responsive canvas viewport centering.

3. **`modules/templateDrawer.js`**:
   - Vector drawing functions for standard paper styles:
     - Plain (cream and dark charcoal)
     - College-ruled (with faint left margin line)
     - Square grid (5mm)
     - Dotted grid (5mm)
     - Cornell layout (header, cue column, bottom summary section)

4. **`modules/pdfManager.js`**:
   - Mozilla PDF.js integration to load user PDFs (e.g. lecture slides), render pages crisply at `window.devicePixelRatio` onto `#bgCanvas`, and generate sidebar thumbnail previews.

5. **`app.js`**:
   - Connect DOM elements, tool selection state, page switching, undo/redo stacks, and setup clean import stubs for Claude's mathematical modules: `strokeEngine.js`, `shapeRecognizer.js`, `lassoEngine.js`, and `coordMatrix.js`.

Ensure all files are cleanly structured, modular ES6, and production-ready.
```

---

## 🧠 Step 2: Prompt for Claude Sonnet 4.6 (Thinking) *(Run Second)*

Switch your model dropdown to **Claude Sonnet 4.6 (Thinking)** and paste this prompt:

```markdown
Please read `CLAUDE_TASK_SPEC.md` in the workspace.

Implement the four high-precision mathematical and algorithmic modules for the GoodNotes inking engine. Focus strictly on 60fps performance, mathematical accuracy, and smooth handwriting curves without UI boilerplate:

1. **`modules/strokeEngine.js`**:
   - Convert discrete raw input points `(x, y, pressure, time)` into continuous cubic Bezier curves using Catmull-Rom spline interpolation.
   - Filter out jittery micro-movements (< 2px distance).
   - Implement dynamic stroke width: velocity & pressure tapering for Fountain pen, uniform for Ballpoint, and semi-transparent multiply blend mode for Highlighter.
   - Implement `drawSegment(ctx, stroke)` for incremental 60fps active drawing on the top canvas, and `buildPath2D(stroke)` for permanent cached rendering on the vector canvas.

2. **`modules/shapeRecognizer.js`**:
   - Classify hand-drawn strokes into straight lines, rectangles/squares, circles/ellipses, and triangles.
   - Use linearity ratios ($D_{start,end} / \text{totalLength} > 0.92$), corner angular change detection, and center-of-mass distance variance.
   - Return clean snapped vector geometry when criteria match.

3. **`modules/lassoEngine.js`**:
   - Implement ray-casting Point-in-Polygon (PIP) collision detection.
   - Determine whether vector strokes are selected (points enclosed or perimeter intersected).
   - Calculate the Axis-Aligned Bounding Box (AABB) and provide translation $(\Delta x, \Delta y)$ affine transformations.

4. **`modules/coordMatrix.js`**:
   - Coordinate transformation engine mapping between screen viewport (`clientX/Y`), document page coordinates, and high-DPI canvas pixels (`devicePixelRatio`).
   - Support smooth pointer-centered zooming and panning offsets.

Write these as self-contained ES6 modules in `modules/` with complete JSDoc annotations.
```

---

## 🔗 Step 3: Final Integration Prompt for Gemini 3.8 Flash (High) *(Run Last)*

Switch back to **Gemini 3.8 Flash (High)** and paste this prompt:

```markdown
Claude has completed the mathematical modules in `modules/`.

Now finalize the application in `app.js`:
1. Wire `PointerEvents` (`pointerdown`, `pointermove`, `pointerup`) with `StrokeEngine` for 60fps active drawing on `#activeCanvas`, committing finished strokes to `#vectorCanvas`.
2. Connect `ShapeRecognizer` to auto-snap shapes when the pen pauses at the end of a stroke or when the Shape tool is selected.
3. Connect `LassoEngine` to draw a dashed marquee loop, select strokes, show a transform box, and drag-to-move.
4. Implement `modules/storageManager.js` to auto-save the notebook into `IndexedDB` and provide PDF/PNG export.
5. Verify that `launch_app.bat` and `server.py` launch the application smoothly in Windows Edge App Mode.
```
