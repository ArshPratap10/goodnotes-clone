# GoodNotes for Windows: Master Architectural Specification

**Version:** 1.0  
**Target Platform:** Windows 10 / 11 (Desktop Web App / Edge App Mode / Standalone)  
**Author:** AI Engineering Team  

---

## 1. Executive Summary

This project creates a high-performance, responsive, and aesthetically stunning Windows desktop note-taking and PDF annotation application inspired by **GoodNotes 6**. It combines smooth digital inking, multi-page PDF reading and annotation, paper templates (ruled, grid, dotted, Cornell), lasso selection, shape recognition, sticky notes, and standard PDF export.

The development is split strategically between:
1. **Gemini 3.8 Flash (High):** Builds the full application shell, modern Windows Fluent/GoodNotes UI, CSS styling, DOM event wiring, PDF.js rendering, page management, state persistence, and file exports (~85% of codebase).
2. **Claude Sonnet 4.6 (Thinking):** Focuses surgically on low-level mathematics: dynamic Bezier stroke smoothing, stylus pressure physics, shape classification algorithms, lasso collision detection, and coordinate matrix transformations (~15% of codebase).

---

## 2. Technology Stack & Design Principles

* **Frontend Engine:** Vanilla HTML5, CSS3, and ES6+ JavaScript (Zero bloated frameworks for instant startup and 60fps canvas performance).
* **Styling System:** CSS Custom Properties (Design Tokens), Glassmorphism, Windows Fluent Design + Cupertino aesthetics, Dark/Light modes.
* **Canvas API:** High-DPI HTML5 Canvas utilizing `window.devicePixelRatio` and standard `PointerEvent` API (`e.pressure`, `e.pointerType`).
* **PDF Engine:** Mozilla's `PDF.js` for fast multi-page rendering and text layer alignment.
* **PDF Export Engine:** `pdf-lib` / `jspdf` for merging original PDF pages with vector annotations into downloadable PDFs.
* **Storage Engine:** Browser `IndexedDB` for local persistence of notebooks, pages, and large vector data.
* **Desktop Launcher:** Standalone Python local server (`server.py`) + Windows launcher (`launch_app.bat`) running in Edge/Chrome App Mode (`--app=http://localhost:5055`), giving a borderless native Windows window.

---

## 3. High-Performance Canvas Architecture

Drawing thousands of vector strokes directly onto a single canvas causes severe input latency. This app implements a **3-Layer Decoupled Canvas Architecture**:

```
┌────────────────────────────────────────────────────────┐
│ Layer 3: Active Inking Canvas (Transparent Top Layer)  │
│ - Renders ONLY the stroke currently being drawn        │
│ - Runs at 60-120fps with zero redraw overhead          │
│ - Cleared immediately when stroke finishes (pointerup) │
├────────────────────────────────────────────────────────┤
│ Layer 2: Vector Annotation Canvas (Middle Layer)       │
│ - Holds all committed strokes, shapes, highlighter     │
│ - Supports undo/redo, lasso manipulation, opacity      │
│ - Re-renders only on page change, zoom, or undo/redo   │
├────────────────────────────────────────────────────────┤
│ Layer 1: PDF / Paper Template Canvas (Bottom Layer)    │
│ - Renders high-resolution PDF pages via PDF.js OR      │
│ - Renders paper templates (ruled, grid, dotted, etc.)  │
└────────────────────────────────────────────────────────┘
```

---

## 4. Complete Data Models

### 4.1. Document Schema
```typescript
interface NotebookDocument {
  id: string;                    // UUID
  title: string;                 // "Lecture 01 Notes"
  createdAt: number;             // Timestamp
  updatedAt: number;             // Timestamp
  pdfSource?: ArrayBuffer | null;// Raw PDF data if imported
  pages: PageData[];             // Array of pages
  currentPageIndex: number;      // Current active page index
}
```

### 4.2. Page Schema
```typescript
interface PageData {
  pageNumber: number;            // 1-indexed
  width: number;                 // Base width in points (e.g. 595.28 for A4)
  height: number;                // Base height in points (e.g. 841.89 for A4)
  template: 'pdf' | 'blank' | 'ruled' | 'grid' | 'dotted' | 'cornell';
  paperColor: 'white' | 'cream' | 'dark';
  strokes: StrokeData[];         // Inking strokes
  shapes: ShapeData[];           // Snapped geometric shapes
  textBoxes: TextBoxData[];      // Typed annotations
  stickyNotes: StickyNoteData[]; // Pastel sticky notes
}
```

### 4.3. Stroke Schema (Vector Representation)
```typescript
interface Point {
  x: number;
  y: number;
  pressure: number;              // 0.0 to 1.0 (from stylus or simulated)
  time: number;                  // Timestamp for velocity calculation
}

interface StrokeData {
  id: string;
  tool: 'pen' | 'fountain' | 'highlighter';
  color: string;                 // Hex or RGBA
  width: number;                 // Base stroke width in pixels
  opacity: number;               // 1.0 for pen, 0.4 for highlighter
  blendMode: 'source-over' | 'multiply';
  points: Point[];               // Raw input coordinates
  path2D?: Path2D;               // Cached smoothed Path2D for rapid rendering
}
```

---

## 5. UI / UX Specifications

### 5.1. Top Header Bar
* **Library/Back Button:** Returns to document shelf.
* **Document Title:** Inline editable text (e.g. `Lecture 01 Electrostatics`).
* **Page Navigation:** Previous `[ < ]`, Page Counter `Page 3 / 14`, Next `[ > ]`.
* **Zoom Controls:** Zoom Out `[ - ]`, Zoom Label `100%`, Zoom In `[ + ]`, Fit Width `[ ↔ ]`.
* **History:** Undo (`Ctrl+Z`), Redo (`Ctrl+Y`).
* **Theme Toggle:** Dark mode / Light mode app shell.
* **Export Menu:** Export Annotated PDF, Export Current Page as PNG, Save Project File.

### 5.2. Floating / Docked Inking Ribbon
* **Pen Tool:** Supports Ballpoint (uniform) and Fountain (velocity/pressure tapered).
* **Highlighter Tool:** Semi-transparent with `multiply` blend mode so text beneath stays crisp.
* **Eraser Tool:** Precision pixel eraser and Stroke Eraser (click stroke to delete) + "Erase Highlighter Only" toggle.
* **Lasso Selection Tool:** Draw freeform loop around strokes to select, move, scale, or delete.
* **Shapes Tool:** Auto-detects lines, rectangles, triangles, and ellipses; snaps when user holds pen still for 0.4s.
* **Text Tool:** Click anywhere to insert a rich typography text box.
* **Sticky Notes:** Quick add pastel notes in 5 colors (yellow, mint, peach, lavender, sky).
* **Quick-Pick Palette:** 3 customizable color circles + full color picker.
* **Quick-Pick Stroke Width:** Fine (0.3mm), Medium (0.7mm), Thick (1.5mm) + slider.

### 5.3. Left Thumbnails Sidebar
* Slide-out panel displaying live rendered mini-thumbnails of all pages.
* Drag-to-reorder, duplicate page, delete page, and **[ + Add Page ]** with template picker.

---

## 6. Division of Work: Gemini vs. Claude

| Responsibility | Handled By | Why |
| :--- | :--- | :--- |
| **Application UI & DOM Structure** | **Gemini 3.8 Flash** | Fast, token-efficient HTML5/CSS3 generation. |
| **GoodNotes Design System & CSS** | **Gemini 3.8 Flash** | Glassmorphism, animations, responsive layout. |
| **PDF.js Document Rendering** | **Gemini 3.8 Flash** | Standard API integration, canvas scaling. |
| **Sidebar & Page Management** | **Gemini 3.8 Flash** | DOM manipulation, thumbnail generation. |
| **Storage & File I/O** | **Gemini 3.8 Flash** | IndexedDB CRUD, JSON export/import. |
| **Desktop Launcher & Python Server** | **Gemini 3.8 Flash** | Environment setup, batch scripts. |
| **Dynamic Stroke Smoothing (Catmull-Rom/Bezier)** | **Claude Sonnet 4.6** | High-precision vector mathematics. |
| **Stylus Pressure & Velocity Tapering** | **Claude Sonnet 4.6** | Physics curves for realistic inking feel. |
| **Shape Recognition & Snapping Geometry** | **Claude Sonnet 4.6** | Geometric classification and least-squares fitting. |
| **Lasso Ray-Casting & Collision Detection** | **Claude Sonnet 4.6** | Spatial algorithms (Point-in-Polygon). |
| **Zoom/Pan Transformation Matrix** | **Claude Sonnet 4.6** | Mathematical coordinate mapping. |
| **Annotated Vector PDF Merger** | **Claude Sonnet 4.6** | Exact vector point mapping into PDF coordinate space. |
