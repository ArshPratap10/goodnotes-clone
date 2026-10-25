# Gemini 3.8 Flash (High) Build Plan: GoodNotes Windows App

**Role of Gemini Flash:** Execute the full visual, structural, and integration construction of the application (~85% of total codebase). Because Gemini Flash has large token capacity, it builds the core interface, styling, PDF.js integration, DOM event routing, and local persistence.

---

## 1. File Structure of the Application

```
GoodNotes_App/
│
├── GOODNOTES_MASTER_SPEC.md   # Architectural master blueprint
├── CLAUDE_TASK_SPEC.md        # Algorithmic modules specs for Claude
├── GEMINI_BUILD_PLAN.md       # Step-by-step construction plan (this file)
│
├── index.html                 # Complete GoodNotes application shell
├── styles.css                 # Sleek GoodNotes 6 / Windows Fluent UI styling
├── app.js                     # Main controller & UI state coordinator
│
├── modules/
│   ├── strokeEngine.js        # Stroke smoothing & inking engine
│   ├── shapeRecognizer.js     # Shape snapping & geometric classification
│   ├── lassoEngine.js         # Lasso selection & point-in-polygon math
│   ├── coordMatrix.js         # Zoom, pan, and coordinate transformations
│   ├── pdfManager.js          # PDF.js loader & multi-page background renderer
│   ├── templateDrawer.js      # Paper templates (ruled, grid, dotted, Cornell)
│   └── storageManager.js      # IndexedDB auto-save & export manager
│
├── server.py                  # Lightweight local server with Edge app launcher
└── launch_app.bat             # One-click Windows desktop launcher
```

---

## 2. Gemini Construction Phases

### Phase 1: Application Shell (`index.html`)
Build a semantic, accessible, and modern layout featuring:
* **Header Bar:**
  * Documents menu button with icon
  * Editable Document Title (`contenteditable` or input)
  * Page navigator: Previous, Page Counter (`Page 1 / 1`), Next, Add Page button
  * Zoom controls: Zoom Out, Percentage indicator, Zoom In, Reset Zoom
  * History buttons: Undo (`Ctrl+Z`), Redo (`Ctrl+Y`)
  * Export dropdown: PDF, PNG, Project JSON
  * Theme switch: Light / Dark mode
* **Floating Inking Ribbon:**
  * Tool selectors: Pen (Ballpoint / Fountain), Highlighter, Eraser (Stroke / Precision), Lasso, Shapes, Text Box, Sticky Note
  * Active tool visual indicator
  * Color presets (3 quick circles + color picker)
  * Stroke width presets (3 thickness pills + custom range slider)
* **Main Stage Layout:**
  * Left Collapsible Sidebar for Page Thumbnails
  * Center Canvas Viewport with multi-layered canvas (`#bgCanvas`, `#vectorCanvas`, `#activeCanvas`)
  * Floating Sticky Notes & Text Box overlay layer
* **Modals & Dialogs:**
  * Add Page Template Picker (Blank, Ruled, Grid, Dotted, Cornell, Dark)
  * PDF Import drag-and-drop overlay

### Phase 2: Design System & Styling (`styles.css`)
Implement a design matching GoodNotes 6 and Windows 11 Fluent Design:
* CSS variables for color palettes, spacing, border radiuses, and glassmorphic blurs (`backdrop-filter: blur(12px)`).
* Micro-interactions: smooth hover transitions, active button state glows, subtle elevation shadows.
* Paper backgrounds: realistic warm cream paper (`#fbfbfa`) and sleek dark mode paper (`#1e1e24`).
* High DPI responsiveness: scrollable viewport with auto-centering for canvas pages.

### Phase 3: Paper Template Generator (`modules/templateDrawer.js`)
Programmatic drawing of clean vector paper layouts:
* **Ruled:** Horizontal lines with standard 8mm or 7mm ruling, plus a faint vertical left margin line.
* **Grid:** Crisp 5mm light gray or cyan grid lines.
* **Dotted:** Balanced 5mm dot grid with subtle opacity.
* **Cornell:** Header block, left cue/recall column (2.5 inches wide), bottom summary section (2 inches high).
* **Dark Mode:** Deep charcoal paper with faint white/grey ruling for neon pen annotations.

### Phase 4: PDF.js Multi-Page Manager (`modules/pdfManager.js`)
* Integration with Mozilla's `PDF.js` (loaded locally or via high-speed CDN with local fallback).
* Reads binary data from user-selected PDF files or drag-and-drop.
* Dynamically extracts page count, dimensions, and renders each page to the `#bgCanvas` at native device pixel ratio.
* Generates live thumbnail previews for the left sidebar so users can jump to any slide or page instantly.

### Phase 5: Storage & Export (`modules/storageManager.js`)
* **IndexedDB Store:** Automatically saves all pages, vector strokes, and PDF references every 5 seconds.
* **PNG Export:** Merges background layer and vector inking layer into a high-res image download.
* **PDF Export:** Packages the annotated pages into a multi-page PDF download using `pdf-lib` / `jspdf`.
* **Project JSON:** Export and import `.gnotes` project files for backup or sharing.

---

## 3. How to Use with Claude
1. Gemini builds the UI, the template drawer, the PDF loader, and the event wiring.
2. In the `modules/` folder, placeholder interfaces are created for `strokeEngine.js`, `shapeRecognizer.js`, `lassoEngine.js`, and `coordMatrix.js`.
3. When you give `CLAUDE_TASK_SPEC.md` to Claude Sonnet, Claude writes the mathematical algorithms directly for those files.
4. Gemini connects them into `app.js` — resulting in a production-ready, ultra-smooth GoodNotes clone!
