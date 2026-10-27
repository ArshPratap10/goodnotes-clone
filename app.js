/**
 * @file app.js
 * @description Master Controller for GoodNotes for Windows.
 * Integrates coordinate transformations, dynamic inking physics, shape recognition,
 * lasso selection, paper templates, PDF.js rendering, and IndexedDB persistence.
 */

import { CoordMatrix } from './modules/coordMatrix.js';
import { StrokeEngine } from './modules/strokeEngine.js';
import { ShapeRecognizer } from './modules/shapeRecognizer.js';
import { LassoEngine } from './modules/lassoEngine.js';
import { TemplateDrawer } from './modules/templateDrawer.js';
import { PdfManager } from './modules/pdfManager.js';
import { StorageManager } from './modules/storageManager.js';

class GoodNotesApp {
  constructor() {
    // 1. Initialize Subsystem Engines
    this.coord = new CoordMatrix();
    this.strokeEngine = new StrokeEngine();
    this.shapeRecognizer = new ShapeRecognizer();
    this.lassoEngine = new LassoEngine();
    this.templateDrawer = new TemplateDrawer();
    this.pdfManager = new PdfManager();
    this.storage = new StorageManager();

    // 2. Active Application State
    this.activeTool = 'ballpoint'; // 'ballpoint' | 'fountain' | 'highlighter' | 'eraser' | 'lasso' | 'shapes' | 'text' | 'sticky' | 'pan'
    
    // GoodNotes 3 Color Slots State (Customizable quick palette)
    this.colorSlots = ['#0f172a', '#2563eb', '#dc2626'];
    try {
      const savedSlots = JSON.parse(localStorage.getItem('goodnotes_color_slots'));
      if (Array.isArray(savedSlots) && savedSlots.length === 3) {
        this.colorSlots = savedSlots;
      }
    } catch (e) {}
    this.activeColorSlot = 0;
    this.activeColor = this.colorSlots[0];
    this.activeWidth = 2.5;
    this.eraserType = 'stroke'; // 'stroke' | 'precision'
    this.eraseHighlighterOnly = false;
    this.isSpacePressed = false;

    // Tool Specific Thickness Memory & Presets
    this.toolSizes = {
      ballpoint: 2.5,
      fountain: 3.5,
      highlighter: 20.0,
      eraser: 22.0,
      shapes: 3.0,
      text: 18.0
    };
    this.toolPresets = {
      ballpoint: [1.5, 2.5, 4.0],
      fountain: [2.0, 3.5, 6.0],
      highlighter: [12.0, 20.0, 32.0],
      eraser: [10.0, 22.0, 45.0],
      shapes: [1.5, 3.0, 5.0],
      text: [14.0, 18.0, 28.0]
    };
    this.toolMinMax = {
      ballpoint: { min: 0.5, max: 20, step: 0.5, unit: 'px' },
      fountain: { min: 0.5, max: 20, step: 0.5, unit: 'px' },
      highlighter: { min: 6, max: 60, step: 1, unit: 'px' },
      eraser: { min: 4, max: 80, step: 1, unit: 'px' },
      shapes: { min: 1, max: 25, step: 0.5, unit: 'px' },
      text: { min: 10, max: 72, step: 1, unit: 'pt' }
    };

    // Direct Shapes Mode & Drag-to-Create
    this.shapeMode = 'auto'; // 'auto' | 'line' | 'arrow' | 'rectangle' | 'roundedRectangle' | 'circle' | 'triangle' | 'star'
    this.shapeFill = 'none'; // 'none' | 'tint' | 'solid'
    this.isDrawingShape = false;
    this.shapeDragStart = null;

    // Hold-to-Snap Shape & Dynamic Resizing State
    this.activeSnappedShape = null;
    this.isResizingSnappedShape = false;
    this.snapAnchor = null;
    this.shapePauseAnchorPos = null;

    // Inking & Interaction State
    this.isDrawing = false;
    this.currentStroke = null;
    this.shapePauseTimer = null;
    this.lastPointerPos = null;
    this.isPanning = false;
    this.panStartPos = { x: 0, y: 0 };
    this.scrollStartPos = { left: 0, top: 0 };

    // Lasso State
    this.lassoPoints = [];
    this.selectedStrokes = [];
    this.selectedShapes = [];
    this.selectionBox = null;
    this.isDraggingSelection = false;
    this.selectionDragStart = null;
    this.selectedImageId = null;

    // Laser Pointer Tool State
    this.laserPoints = [];
    this.laserAnimRunning = false;

    // View Mode ('vertical' | 'single-page')
    this.viewMode = 'vertical';

    // Sidebar active tab ('thumbnails' | 'bookmarks' | 'outline')
    this.sidebarActiveTab = 'thumbnails';
    this.draggedThumbnailIndex = null;

    // History (Undo/Redo)
    this.undoStack = [];
    this.redoStack = [];
    this.maxHistory = 40;

    // Save & Auto-save Management
    this.isDirty = false;
    this.autoSaveInterval = null;

    // Toolbar Mode ('ribbon' | 'floating')
    this.toolbarMode = localStorage.getItem('goodnotes_toolbar_mode') || 'ribbon';

    // Library View & Home Screen State
    this.currentView = 'library'; // 'editor' | 'library'
    this.libraryFilter = 'all'; // 'all' | 'favorites' | 'recent' | 'pdfs'
    this.librarySort = 'recent'; // 'recent' | 'title' | 'pages'
    this.libraryViewMode = 'grid'; // 'grid' | 'list'
    this.librarySearchQuery = '';
    this.libraryNotebooks = [];
    this.activeCardContextMenu = null;
    this.newNotebookConfig = {
      coverTheme: 'modern-blue',
      template: 'ruled',
      paperColor: 'cream'
    };

    // Notebook Data Model (null until user opens or creates a notebook)
    this.notebook = null;

    // Cache DOM Elements
    this.dom = {};
  }

  /**
   * Helper: creates a fresh blank page schema
   */
  createDefaultPage(pageNumber, template = 'ruled', paperColor = 'cream', width = 794, height = 1123, pdfPageNumber = null) {
    return {
      pageNumber,
      template,
      paperColor,
      width,
      height,
      pdfPageNumber,
      isBookmarked: false,
      strokes: [],
      shapes: [],
      textBoxes: [],
      stickyNotes: [],
      images: []
    };
  }

  /**
   * Bootstraps the application after DOM content is loaded
   */
  async init() {
    this.cacheDomElements();
    this.bindEvents();
    this.bindKeyboardShortcuts();
    this.bindViewportScroll();
    this.bindFloatingToolbarEvents();

    // Start auto-save timer: saves every 1 minute if modified
    this.startAutoSaveTimer();

    // Restore toolbar mode preference
    this.setToolbarMode(this.toolbarMode, false);

    // Initial controls state
    this.viewMode = 'vertical';
    this.updateColorSlotButtons();
    this.updateThicknessControlsForTool(this.activeTool, this.activeWidth);

    // Display Electron data path in footer if running in Electron
    if (this.storage && this.storage.isElectron) {
      try {
        const info = await window.electronAPI.getDataDir();
        if (info && info.success && this.dom.electronDataPathInfo) {
          this.dom.electronDataPathInfo.style.display = 'block';
          this.dom.electronDataPathInfo.innerHTML = `📁 Storage folder: <span style="color:#94a3b8; user-select:all;">${info.notebooksDir}</span> <button id="btnOpenDataDirFooter" style="margin-left:8px; background:rgba(255,255,255,0.08); border:none; color:#cbd5e1; padding:2px 8px; border-radius:4px; cursor:pointer;">Open Folder</button>`;
          const btn = document.getElementById('btnOpenDataDirFooter');
          if (btn) btn.addEventListener('click', () => window.electronAPI.openNotebooksFolder());
        }
      } catch (e) {}
    }

    // Launch directly into Library View (Home Screen)
    // Do NOT automatically create or open any notebook on startup!
    await this.showLibraryView();
  }

  /**
   * Caches references to all essential DOM elements
   */
  cacheDomElements() {
    this.dom.appContainer = document.getElementById('appContainer');
    this.dom.headerBar = document.getElementById('headerBar');
    this.dom.inkingRibbon = document.getElementById('inkingRibbon');
    this.dom.mainStage = document.getElementById('mainStage');
    this.dom.canvasViewport = document.getElementById('canvasViewport');
    this.dom.pagesContainer = document.getElementById('pagesContainer');
    this.dom.pageWrapper = document.getElementById('pageWrapper');

    // Canvases
    this.dom.bgCanvas = document.getElementById('bgCanvas');
    this.dom.vectorCanvas = document.getElementById('vectorCanvas');
    this.dom.activeCanvas = document.getElementById('activeCanvas');
    this.dom.lassoCanvas = document.getElementById('lassoCanvas');
    this.dom.domOverlay = document.getElementById('domOverlay');

    this.dom.bgCtx = this.dom.bgCanvas.getContext('2d');
    this.dom.vectorCtx = this.dom.vectorCanvas.getContext('2d');
    this.dom.activeCtx = this.dom.activeCanvas.getContext('2d');
    this.dom.lassoCtx = this.dom.lassoCanvas.getContext('2d');

    // Header & Sidebar Controls
    this.dom.btnToggleSidebar = document.getElementById('btnToggleSidebar');
    this.dom.sidebarEdgeToggle = document.getElementById('sidebarEdgeToggle');
    this.dom.thumbnailsSidebar = document.getElementById('thumbnailsSidebar');
    this.dom.thumbnailsList = document.getElementById('thumbnailsList');
    this.dom.sidebarPageCount = document.getElementById('sidebarPageCount');
    this.dom.docTitleInput = document.getElementById('docTitleInput');

    // Sidebar 3 Tabs
    this.dom.tabBtnThumbnails = document.getElementById('tabBtnThumbnails');
    this.dom.tabBtnBookmarks = document.getElementById('tabBtnBookmarks');
    this.dom.tabBtnOutline = document.getElementById('tabBtnOutline');
    this.dom.tabPanelThumbnails = document.getElementById('tabPanelThumbnails');
    this.dom.tabPanelBookmarks = document.getElementById('tabPanelBookmarks');
    this.dom.tabPanelOutline = document.getElementById('tabPanelOutline');
    this.dom.bookmarksList = document.getElementById('bookmarksList');
    this.dom.outlineList = document.getElementById('outlineList');
    this.dom.sidebarBookmarkCount = document.getElementById('sidebarBookmarkCount');

    this.dom.btnPrevPage = document.getElementById('btnPrevPage');
    this.dom.btnNextPage = document.getElementById('btnNextPage');
    this.dom.currentPageNum = document.getElementById('currentPageNum');
    this.dom.totalPagesNum = document.getElementById('totalPagesNum');
    this.dom.btnAddPageHeader = document.getElementById('btnAddPageHeader');
    this.dom.btnAddPageSidebar = document.getElementById('btnAddPageSidebar');

    this.dom.btnZoomOut = document.getElementById('btnZoomOut');
    this.dom.btnZoomReset = document.getElementById('btnZoomReset');
    this.dom.btnZoomIn = document.getElementById('btnZoomIn');
    this.dom.btnFitWidth = document.getElementById('btnFitWidth');

    // View Mode & Edge Nav Buttons
    this.dom.btnViewMode = document.getElementById('btnViewMode');
    this.dom.viewModeVerticalIcon = document.getElementById('viewModeVerticalIcon');
    this.dom.viewModeSingleIcon = document.getElementById('viewModeSingleIcon');
    this.dom.btnPagePrevEdge = null;
    this.dom.btnPageNextEdge = null;

    this.dom.btnUndo = document.getElementById('btnUndo');
    this.dom.btnRedo = document.getElementById('btnRedo');

    this.dom.btnDocsMenu = document.getElementById('btnDocsMenu');
    this.dom.docsMenuDropdown = document.getElementById('docsMenuDropdown');
    this.dom.btnNewNotebook = document.getElementById('btnNewNotebook');
    this.dom.btnImportPdf = document.getElementById('btnImportPdf');
    this.dom.btnImportProject = document.getElementById('btnImportProject');

    this.dom.btnExportMenu = document.getElementById('btnExportMenu');
    this.dom.exportMenuDropdown = document.getElementById('exportMenuDropdown');
    this.dom.btnExportPDF = document.getElementById('btnExportPDF');
    this.dom.btnExportPNG = document.getElementById('btnExportPNG');
    this.dom.btnExportProjectJSON = document.getElementById('btnExportProjectJSON');

    this.dom.btnShortcutsHelp = document.getElementById('btnShortcutsHelp');
    this.dom.shortcutsModal = document.getElementById('shortcutsModal');
    this.dom.btnCloseShortcutsModal = document.getElementById('btnCloseShortcutsModal');

    this.dom.btnToggleTheme = document.getElementById('btnToggleTheme');

    // Tool Ribbon & Sub-Option Panels
    this.dom.toolButtons = document.querySelectorAll('.tool-btn');
    this.dom.toolEraser = document.getElementById('toolEraser');
    this.dom.eraserToolLabel = document.getElementById('eraserToolLabel');
    this.dom.eraserOptionsDropdown = document.getElementById('eraserOptionsDropdown');
    this.dom.btnEraserStroke = document.getElementById('btnEraserStroke');
    this.dom.btnEraserPrecision = document.getElementById('btnEraserPrecision');
    this.dom.eraserSizeButtons = document.querySelectorAll('.eraser-size-row .size-circle-btn');
    this.dom.chkEraseHighlighterOnly = document.getElementById('chkEraseHighlighterOnly');
    this.dom.btnClearCurrentPage = document.getElementById('btnClearCurrentPage');

    // Shapes Tool & Picker
    this.dom.toolShapes = document.getElementById('toolShapes');
    this.dom.shapesOptionsDropdown = document.getElementById('shapesOptionsDropdown');
    this.dom.shapesToolLabel = document.getElementById('shapesToolLabel');
    this.dom.shapePickerButtons = document.querySelectorAll('.shape-picker-btn');
    this.dom.fillChipButtons = document.querySelectorAll('.fill-chip-btn');

    // Live Eraser Cursor Preview
    this.dom.eraserCursorPreview = document.getElementById('eraserCursorPreview');

    this.dom.colorPresets = document.querySelectorAll('.color-preset');
    this.dom.btnColorPicker = document.getElementById('btnColorPicker');
    this.dom.paletteDropdown = document.getElementById('paletteDropdown');
    this.dom.currentColorSwatch = document.getElementById('currentColorSwatch');
    this.dom.nativeColorPicker = document.getElementById('nativeColorPicker');
    this.dom.paletteSlotNumber = document.getElementById('paletteSlotNumber');
    this.dom.paletteSlotBadge = document.getElementById('paletteSlotBadge');

    this.dom.thicknessPills = document.querySelectorAll('.thickness-pill');
    this.dom.strokeWidthSlider = document.getElementById('strokeWidthSlider');
    this.dom.strokeWidthValue = document.getElementById('strokeWidthValue');

    this.dom.saveStatusIndicator = document.getElementById('saveStatusIndicator');
    this.dom.saveStatusText = document.getElementById('saveStatusText');

    // Modals & Inputs
    this.dom.templateModal = document.getElementById('templateModal');
    this.dom.btnCloseTemplateModal = document.getElementById('btnCloseTemplateModal');
    this.dom.btnCancelTemplate = document.getElementById('btnCancelTemplate');
    this.dom.btnConfirmAddPage = document.getElementById('btnConfirmAddPage');
    this.dom.templateCards = document.querySelectorAll('.template-card');
    this.dom.colorChoiceButtons = document.querySelectorAll('.color-choice');
    this.dom.orientationButtons = document.querySelectorAll('.segment-btn');

    this.dom.pdfFileInput = document.getElementById('pdfFileInput');
    this.dom.projectFileInput = document.getElementById('projectFileInput');
    this.dom.dropOverlay = document.getElementById('dropOverlay');
    this.dom.toastContainer = document.getElementById('toastContainer');

    // Library View & Home Screen Elements
    this.dom.libraryView = document.getElementById('libraryView');
    this.dom.editorView = document.getElementById('editorView');
    this.dom.librarySearchInput = document.getElementById('librarySearchInput');
    this.dom.btnClearSearch = document.getElementById('btnClearSearch');
    this.dom.librarySortSelect = document.getElementById('librarySortSelect');
    this.dom.btnViewGrid = document.getElementById('btnViewGrid');
    this.dom.btnViewList = document.getElementById('btnViewList');
    this.dom.btnLibraryImportPdf = document.getElementById('btnLibraryImportPdf');
    this.dom.btnOpenFilesFolder = document.getElementById('btnOpenFilesFolder');
    this.dom.btnLibraryNewNotebook = document.getElementById('btnLibraryNewNotebook');
    this.dom.btnResumeEditor = document.getElementById('btnResumeEditor');
    this.dom.btnLibraryThemeToggle = document.getElementById('btnLibraryThemeToggle');
    this.dom.libraryNotebooksGrid = document.getElementById('libraryNotebooksGrid');
    this.dom.libraryShelfTitle = document.getElementById('libraryShelfTitle');
    this.dom.libraryShelfSub = document.getElementById('libraryShelfSub');

    // Library Filter Nav
    this.dom.navFilterAll = document.getElementById('navFilterAll');
    this.dom.navFilterFavorites = document.getElementById('navFilterFavorites');
    this.dom.navFilterRecent = document.getElementById('navFilterRecent');
    this.dom.navFilterPdfs = document.getElementById('navFilterPdfs');
    this.dom.libCountAll = document.getElementById('libCountAll');
    this.dom.libCountFavorites = document.getElementById('libCountFavorites');
    this.dom.libCountPdfs = document.getElementById('libCountPdfs');

    // New Notebook Creation Modal
    this.dom.newNotebookModal = document.getElementById('newNotebookModal');
    this.dom.btnCloseNewNotebookModal = document.getElementById('btnCloseNewNotebookModal');
    this.dom.btnCancelNewNotebook = document.getElementById('btnCancelNewNotebook');
    this.dom.btnConfirmCreateNotebook = document.getElementById('btnConfirmCreateNotebook');
    this.dom.newNotebookTitleInput = document.getElementById('newNotebookTitleInput');
    this.dom.coverThemeCards = document.querySelectorAll('.cover-theme-card');
    this.dom.newTemplateCards = document.querySelectorAll('#newNotebookTemplateGrid .template-card');
    this.dom.newPaperColorChoices = document.querySelectorAll('#newNotebookPaperColorPicker .color-choice');

    this.dom.btnOpenLibrary = document.getElementById('btnOpenLibrary');

    // Floating Studio Toolbar Elements
    this.dom.floatingToolbar = document.getElementById('floatingToolbar');
    this.dom.btnToggleToolbarMode = document.getElementById('btnToggleToolbarMode');

    // Mini Add (+) Menu
    this.dom.btnMiniAdd = document.getElementById('btnMiniAdd');
    this.dom.miniAddDropdown = document.getElementById('miniAddDropdown');
    this.dom.btnMiniAddPage = document.getElementById('btnMiniAddPage');
    this.dom.btnMiniAddPageModal = document.getElementById('btnMiniAddPageModal');
    this.dom.btnMiniAddImage = document.getElementById('btnMiniAddImage');
    this.dom.btnMiniAddSticky = document.getElementById('btnMiniAddSticky');

    // Mini Inking Tools
    this.dom.btnMiniSelect = document.getElementById('btnMiniSelect');
    this.dom.btnMiniText = document.getElementById('btnMiniText');
    this.dom.btnMiniPen = document.getElementById('btnMiniPen');
    this.dom.miniPenActiveIcon = document.getElementById('miniPenActiveIcon');
    this.dom.miniPenFlyout = document.getElementById('miniPenFlyout');
    this.dom.btnMiniPenBallpoint = document.getElementById('btnMiniPenBallpoint');
    this.dom.btnMiniPenFountain = document.getElementById('btnMiniPenFountain');
    this.dom.btnMiniPenHighlighter = document.getElementById('btnMiniPenHighlighter');
    this.dom.miniPenThicknessValueText = document.getElementById('miniPenThicknessValueText');
    this.dom.miniPenThickFine = document.getElementById('miniPenThickFine');
    this.dom.miniPenThickMed = document.getElementById('miniPenThickMed');
    this.dom.miniPenThickBold = document.getElementById('miniPenThickBold');
    this.dom.miniPenThicknessSlider = document.getElementById('miniPenThicknessSlider');
    this.dom.miniPenThicknessPresets = document.querySelectorAll('.mini-thickness-chips .mini-chip-btn');

    // Mini Eraser
    this.dom.btnMiniEraser = document.getElementById('btnMiniEraser');
    this.dom.miniEraserFlyout = document.getElementById('miniEraserFlyout');
    this.dom.miniEraserStroke = document.getElementById('miniEraserStroke');
    this.dom.miniEraserPrecision = document.getElementById('miniEraserPrecision');
    this.dom.miniEraserSizes = document.querySelectorAll('.mini-eraser-sizes .mini-size-circle');
    this.dom.miniChkEraseHighlighterOnly = document.getElementById('miniChkEraseHighlighterOnly');
    this.dom.miniBtnClearPage = document.getElementById('miniBtnClearPage');

    // Mini Shapes
    this.dom.btnMiniShapes = document.getElementById('btnMiniShapes');
    this.dom.miniShapesFlyout = document.getElementById('miniShapesFlyout');
    this.dom.miniShapeButtons = document.querySelectorAll('.mini-shapes-grid .mini-shape-btn');
    this.dom.miniFillNone = document.getElementById('miniFillNone');
    this.dom.miniFillTint = document.getElementById('miniFillTint');
    this.dom.miniFillSolid = document.getElementById('miniFillSolid');

    // Mini Laser
    this.dom.btnMiniLaser = document.getElementById('btnMiniLaser');

    // Mini Colors & Popover
    this.dom.btnMiniColor = document.getElementById('btnMiniColor');
    this.dom.miniColorDot = document.getElementById('miniColorDot');
    this.dom.miniColorDropdown = document.getElementById('miniColorDropdown');
    this.dom.miniColorPresets = document.querySelectorAll('.mini-color-preset');
    this.dom.miniPalDots = document.querySelectorAll('.mini-pal-dot');
    this.dom.miniPaletteCustomInput = document.getElementById('miniPaletteCustomInput');

    // Mini History & Clear
    this.dom.btnMiniUndo = document.getElementById('btnMiniUndo');
    this.dom.btnMiniRedo = document.getElementById('btnMiniRedo');
    this.dom.btnMiniClear = document.getElementById('btnMiniClear');

    // Mini Export
    this.dom.btnMiniExportTrigger = document.getElementById('btnMiniExportTrigger');
    this.dom.miniExportFlyout = document.getElementById('miniExportFlyout');
    this.dom.btnMiniExportPDF = document.getElementById('btnMiniExportPDF');
    this.dom.btnMiniExportPNG = document.getElementById('btnMiniExportPNG');
    this.dom.btnMiniExportProject = document.getElementById('btnMiniExportProject');

    // Mini More Dropdown & Page Nav
    this.dom.btnMiniMore = document.getElementById('btnMiniMore');
    this.dom.miniMoreDropdown = document.getElementById('miniMoreDropdown');
    this.dom.btnMiniPrevPage = document.getElementById('btnMiniPrevPage');
    this.dom.miniPageCounter = document.getElementById('miniPageCounter');
    this.dom.miniCurrentPageNum = document.getElementById('miniCurrentPageNum');
    this.dom.miniTotalPagesNum = document.getElementById('miniTotalPagesNum');
    this.dom.btnMiniNextPage = document.getElementById('btnMiniNextPage');
    this.dom.btnMiniZoomOut = document.getElementById('btnMiniZoomOut');
    this.dom.btnMiniZoomReset = document.getElementById('btnMiniZoomReset');
    this.dom.btnMiniZoomIn = document.getElementById('btnMiniZoomIn');
    this.dom.btnMiniFitWidth = document.getElementById('btnMiniFitWidth');
    this.dom.btnMiniTogglePaper = document.getElementById('btnMiniTogglePaper');
    this.dom.btnMiniToggleThumbnails = document.getElementById('btnMiniToggleThumbnails');
    this.dom.btnMiniToggleTheme = document.getElementById('btnMiniToggleTheme');
    this.dom.btnMiniShortcuts = document.getElementById('btnMiniShortcuts');
    this.dom.btnMiniSaveManual = document.getElementById('btnMiniSaveManual');
    this.dom.btnMiniToggleRibbon = document.getElementById('btnMiniToggleRibbon');

    // Mini Shell
    this.dom.btnMiniLibrary = document.getElementById('btnMiniLibrary');
    this.dom.btnMiniClose = document.getElementById('btnMiniClose');
  }

  /**
   * Binds UI click, dropdown, and input events
   */
  bindEvents() {
    // 1. Sidebar Toggle (Header button + Floating edge arrow tab)
    const toggleSidebar = () => {
      const isCollapsed = this.dom.thumbnailsSidebar.classList.toggle('collapsed');
      this.coord.invalidateCache();
    };
    this.dom.btnToggleSidebar.addEventListener('click', toggleSidebar);
    if (this.dom.sidebarEdgeToggle) {
      this.dom.sidebarEdgeToggle.addEventListener('click', toggleSidebar);
    }

    // Sidebar 3 Tabs Switching (GoodNotes Hallmark)
    if (this.dom.tabBtnThumbnails) {
      this.dom.tabBtnThumbnails.addEventListener('click', () => this.switchSidebarTab('thumbnails'));
    }
    if (this.dom.tabBtnBookmarks) {
      this.dom.tabBtnBookmarks.addEventListener('click', () => this.switchSidebarTab('bookmarks'));
    }
    if (this.dom.tabBtnOutline) {
      this.dom.tabBtnOutline.addEventListener('click', () => this.switchSidebarTab('outline'));
    }

    // 2. Document Title Inline Editing
    this.dom.docTitleInput.addEventListener('change', () => {
      const newTitle = this.dom.docTitleInput.value.trim() || 'Untitled Notebook';
      if (this.notebook) this.notebook.title = newTitle;
      this.updateDocTitleDisplay(newTitle);
      this.scheduleSave();
    });
    this.dom.docTitleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.dom.docTitleInput.blur();
    });

    // 3. Page Navigation
    this.dom.btnPrevPage.addEventListener('click', () => this.goToPrevPage());
    this.dom.btnNextPage.addEventListener('click', () => this.goToNextPage());
    this.dom.btnAddPageHeader.addEventListener('click', () => this.openTemplateModal());
    this.dom.btnAddPageSidebar.addEventListener('click', () => this.openTemplateModal());

    // 4. Zoom Controls & View Mode
    this.dom.btnZoomIn.addEventListener('click', () => this.applyZoom(1.15));
    this.dom.btnZoomOut.addEventListener('click', () => this.applyZoom(0.85));
    this.dom.btnZoomReset.addEventListener('click', () => {
      this.coord.resetZoom();
      this.updateZoomDisplay();
      this.renderCurrentPage();
    });
    this.dom.btnFitWidth.addEventListener('click', () => {
      const page = this.getCurrentPage();
      const vpWidth = this.dom.canvasViewport.clientWidth;
      this.coord.fitWidth(page.width, vpWidth);
      this.updateZoomDisplay();
      this.renderCurrentPage();
    });

    // View Mode Toggle (Vertical Continuous vs Single Page Horizontal)
    if (this.dom.btnViewMode) {
      this.dom.btnViewMode.addEventListener('click', () => this.toggleViewMode());
    }

    // Mouse Wheel Zoom (Ctrl + Wheel)
    this.dom.canvasViewport.addEventListener('wheel', (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.08 : 0.92;
        this.coord.zoomAtPoint(factor, e.clientX, e.clientY, this.dom.canvasViewport);
        this.updateZoomDisplay();
        this.renderCurrentPage();
      }
    }, { passive: false });

    // 5. Undo / Redo
    this.dom.btnUndo.addEventListener('click', () => this.undo());
    this.dom.btnRedo.addEventListener('click', () => this.redo());

    // 6. Navigation & Dropdown Toggles
    if (this.dom.btnDocsMenu) {
      this.dom.btnDocsMenu.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showLibraryView();
      });
    }
    if (this.dom.btnOpenLibrary) {
      this.dom.btnOpenLibrary.addEventListener('click', () => {
        if (this.dom.docsMenuDropdown) this.dom.docsMenuDropdown.classList.add('hidden');
        this.showLibraryView();
      });
    }
    if (this.dom.btnResumeEditor) {
      this.dom.btnResumeEditor.addEventListener('click', () => {
        this.showEditorView();
      });
    }

    this.bindDropdown(this.dom.btnExportMenu, this.dom.exportMenuDropdown);
    this.bindDropdown(this.dom.btnColorPicker, this.dom.paletteDropdown);

    // Library Live Search
    if (this.dom.librarySearchInput) {
      this.dom.librarySearchInput.addEventListener('input', (e) => {
        this.librarySearchQuery = e.target.value.trim().toLowerCase();
        if (this.dom.btnClearSearch) {
          this.dom.btnClearSearch.classList.toggle('hidden', !this.librarySearchQuery);
        }
        this.renderLibraryNotebooks();
      });
    }
    if (this.dom.btnClearSearch) {
      this.dom.btnClearSearch.addEventListener('click', () => {
        this.dom.librarySearchInput.value = '';
        this.librarySearchQuery = '';
        this.dom.btnClearSearch.classList.add('hidden');
        this.renderLibraryNotebooks();
      });
    }

    // Library Sorting
    if (this.dom.librarySortSelect) {
      this.dom.librarySortSelect.addEventListener('change', (e) => {
        this.librarySort = e.target.value;
        this.renderLibraryNotebooks();
      });
    }

    // View Mode Toggle (Grid / List)
    if (this.dom.btnViewGrid) {
      this.dom.btnViewGrid.addEventListener('click', () => {
        this.libraryViewMode = 'grid';
        this.dom.btnViewGrid.classList.add('active');
        if (this.dom.btnViewList) this.dom.btnViewList.classList.remove('active');
        if (this.dom.libraryNotebooksGrid) this.dom.libraryNotebooksGrid.classList.remove('list-view');
      });
    }
    if (this.dom.btnViewList) {
      this.dom.btnViewList.addEventListener('click', () => {
        this.libraryViewMode = 'list';
        this.dom.btnViewList.classList.add('active');
        if (this.dom.btnViewGrid) this.dom.btnViewGrid.classList.remove('active');
        if (this.dom.libraryNotebooksGrid) this.dom.libraryNotebooksGrid.classList.add('list-view');
      });
    }

    // Library Filter Tabs (All, Favorites, Recent, PDFs)
    const filterTabs = [
      { el: this.dom.navFilterAll, filter: 'all', title: 'All Documents', sub: 'Showing all saved notebooks' },
      { el: this.dom.navFilterFavorites, filter: 'favorites', title: 'Favorites', sub: 'Your starred notebooks and PDFs' },
      { el: this.dom.navFilterRecent, filter: 'recent', title: 'Recent Documents', sub: 'Sorted by most recently edited' },
      { el: this.dom.navFilterPdfs, filter: 'pdfs', title: 'PDF Documents', sub: 'Imported PDF lecture notes and textbooks' }
    ];
    filterTabs.forEach(({ el, filter, title, sub }) => {
      if (el) {
        el.addEventListener('click', () => {
          document.querySelectorAll('.lib-nav-item').forEach(btn => btn.classList.remove('active'));
          el.classList.add('active');
          this.libraryFilter = filter;
          if (this.dom.libraryShelfTitle) this.dom.libraryShelfTitle.textContent = title;
          if (this.dom.libraryShelfSub) this.dom.libraryShelfSub.textContent = sub;
          this.renderLibraryNotebooks();
        });
      }
    });

    // Library Import PDF
    if (this.dom.btnLibraryImportPdf) {
      this.dom.btnLibraryImportPdf.addEventListener('click', async () => {
        await this._triggerPdfImport();
      });
    }

    // Open Files Folder (Electron only)
    if (this.dom.btnOpenFilesFolder) {
      if (window.electronAPI && window.electronAPI.isElectron) {
        this.dom.btnOpenFilesFolder.style.display = '';
      }
      this.dom.btnOpenFilesFolder.addEventListener('click', () => this.storage.openDataFolder());
    }

    // New Notebook Openers
    if (this.dom.btnLibraryNewNotebook) {
      this.dom.btnLibraryNewNotebook.addEventListener('click', () => this.openNewNotebookModal());
    }
    if (this.dom.btnNewNotebook) {
      this.dom.btnNewNotebook.addEventListener('click', () => {
        if (this.dom.docsMenuDropdown) this.dom.docsMenuDropdown.classList.add('hidden');
        this.openNewNotebookModal();
      });
    }

    // New Notebook Modal Actions
    if (this.dom.btnCloseNewNotebookModal) {
      this.dom.btnCloseNewNotebookModal.addEventListener('click', () => this.closeNewNotebookModal());
    }
    if (this.dom.btnCancelNewNotebook) {
      this.dom.btnCancelNewNotebook.addEventListener('click', () => this.closeNewNotebookModal());
    }
    if (this.dom.btnConfirmCreateNotebook) {
      this.dom.btnConfirmCreateNotebook.addEventListener('click', () => this.confirmCreateNewNotebook());
    }
    if (this.dom.newNotebookTitleInput) {
      this.dom.newNotebookTitleInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.confirmCreateNewNotebook();
        }
      });
    }

    // New Notebook Modal Theme / Template Pickers
    if (this.dom.coverThemeCards) {
      this.dom.coverThemeCards.forEach(card => {
        card.addEventListener('click', () => {
          this.dom.coverThemeCards.forEach(c => c.classList.remove('active'));
          card.classList.add('active');
          this.newNotebookConfig.coverTheme = card.dataset.cover;
        });
      });
    }
    if (this.dom.newTemplateCards) {
      this.dom.newTemplateCards.forEach(card => {
        card.addEventListener('click', () => {
          this.dom.newTemplateCards.forEach(c => c.classList.remove('active'));
          card.classList.add('active');
          this.newNotebookConfig.template = card.dataset.template;
        });
      });
    }
    if (this.dom.newPaperColorChoices) {
      this.dom.newPaperColorChoices.forEach(btn => {
        btn.addEventListener('click', () => {
          this.dom.newPaperColorChoices.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.newNotebookConfig.paperColor = btn.dataset.color;
        });
      });
    }

    // Library Dark/Light Theme Toggle
    if (this.dom.btnLibraryThemeToggle) {
      this.dom.btnLibraryThemeToggle.addEventListener('click', () => {
        this.toggleTheme();
      });
    }

    // Dismiss active card context menu on document click
    document.addEventListener('pointerdown', (e) => {
      if (this.activeCardContextMenu && !e.target.closest('.card-context-menu') && !e.target.closest('.btn-card-menu')) {
        this.closeActiveCardContextMenu();
      }
    });

    // Eraser Options Dropdown Wiring
    if (this.dom.toolEraser) {
      this.dom.toolEraser.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.dom.eraserOptionsDropdown.classList.toggle('hidden');
      });
    }

    if (this.dom.btnEraserStroke) {
      this.dom.btnEraserStroke.addEventListener('click', () => {
        this.eraserType = 'stroke';
        this.dom.btnEraserStroke.classList.add('active');
        if (this.dom.btnEraserPrecision) this.dom.btnEraserPrecision.classList.remove('active');
        if (this.dom.eraserToolLabel) this.dom.eraserToolLabel.innerText = 'Eraser';
        this.showToast('Stroke Eraser: Deletes full stroke on touch');
      });
    }

    if (this.dom.btnEraserPrecision) {
      this.dom.btnEraserPrecision.addEventListener('click', () => {
        this.eraserType = 'precision';
        this.dom.btnEraserPrecision.classList.add('active');
        if (this.dom.btnEraserStroke) this.dom.btnEraserStroke.classList.remove('active');
        if (this.dom.eraserToolLabel) this.dom.eraserToolLabel.innerText = 'Precision';
        this.showToast('Precision Eraser: Erases exact contact area');
      });
    }

    // Eraser Size Buttons (Small, Medium, Large)
    if (this.dom.eraserSizeButtons) {
      this.dom.eraserSizeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          const sz = parseFloat(btn.dataset.eraserSize);
          this.setActiveWidth(sz);
          this.dom.eraserSizeButtons.forEach(b => b.classList.toggle('active', b === btn));
          this.showToast(`Eraser Size: ${sz}px`);
        });
      });
    }

    if (this.dom.chkEraseHighlighterOnly) {
      this.dom.chkEraseHighlighterOnly.addEventListener('change', (e) => {
        this.eraseHighlighterOnly = e.target.checked;
        this.showToast(this.eraseHighlighterOnly ? 'Erasing Highlighter Only' : 'Erasing All Inking');
      });
    }

    if (this.dom.btnClearCurrentPage) {
      this.dom.btnClearCurrentPage.addEventListener('click', () => {
        this.pushUndoSnapshot();
        const page = this.getCurrentPage();
        page.strokes = [];
        page.shapes = [];
        page.textBoxes = [];
        page.stickyNotes = [];
        this.clearLassoSelection();
        this.renderCurrentPage();
        this.renderThumbnailsSidebar();
        this.dom.eraserOptionsDropdown.classList.add('hidden');
        this.showToast('Page inking cleared');
        this.scheduleSave();
      });
    }

    // Shapes Tool & Dropdown Wiring
    if (this.dom.toolShapes) {
      this.dom.toolShapes.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.dom.shapesOptionsDropdown.classList.toggle('hidden');
      });
    }

    // Shape Picker Buttons (Auto, Line, Arrow, Rectangle, Rounded, Circle, Triangle, Star)
    if (this.dom.shapePickerButtons) {
      this.dom.shapePickerButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          this.shapeMode = btn.dataset.shape;
          this.dom.shapePickerButtons.forEach(b => b.classList.toggle('active', b === btn));
          const labelSpan = btn.querySelector('span');
          const labelText = labelSpan ? labelSpan.innerText : this.shapeMode;
          if (this.dom.shapesToolLabel) {
            this.dom.shapesToolLabel.innerText = this.shapeMode === 'auto' ? 'Shapes' : labelText;
          }
          this.setActiveTool('shapes');
          this.dom.shapesOptionsDropdown.classList.add('hidden');
          this.showToast(this.shapeMode === 'auto' ? 'Auto-Snap: Draw by hand & pause' : `Drag to create ${labelText}`);
        });
      });
    }

    // Shape Fill Mode Chips (None, Tint, Solid)
    if (this.dom.fillChipButtons) {
      this.dom.fillChipButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          this.shapeFill = btn.dataset.fill;
          this.dom.fillChipButtons.forEach(b => b.classList.toggle('active', b === btn));
          this.showToast(`Shape Fill: ${btn.innerText}`);
        });
      });
    }

    // 7. Tool Buttons Selection
    this.dom.toolButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tool = btn.dataset.tool;
        if (!tool) return;

        // Toggle sub-option dropdowns if already active or clicked on chevron
        if (tool === 'eraser') {
          if (this.activeTool === 'eraser' || e.target.closest('.chevron')) {
            this.dom.eraserOptionsDropdown.classList.toggle('hidden');
            return;
          }
        } else if (tool === 'shapes') {
          if (this.activeTool === 'shapes' || e.target.closest('.chevron')) {
            this.dom.shapesOptionsDropdown.classList.toggle('hidden');
            return;
          }
        }

        // Close sub-panels when picking another tool
        if (this.dom.eraserOptionsDropdown) this.dom.eraserOptionsDropdown.classList.add('hidden');
        if (this.dom.shapesOptionsDropdown) this.dom.shapesOptionsDropdown.classList.add('hidden');

        this.setActiveTool(tool);
      });
    });

    // 8. Color Palette Presets (3 Customizable GoodNotes Slots)
    this.dom.colorPresets.forEach((preset, idx) => {
      // Primary Click: if already active -> open palette to customize this slot; if inactive -> activate slot
      preset.addEventListener('click', (e) => {
        e.stopPropagation();
        const slotIdx = parseInt(preset.dataset.slot ?? idx, 10);
        if (this.activeColorSlot === slotIdx && preset.classList.contains('active')) {
          this.openColorPaletteForSlot(slotIdx);
        } else {
          this.activateColorSlot(slotIdx);
          this.dom.paletteDropdown.classList.add('hidden');
        }
      });

      // Right-click or Double-click on any slot directly opens the palette to customize it
      preset.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const slotIdx = parseInt(preset.dataset.slot ?? idx, 10);
        this.openColorPaletteForSlot(slotIdx);
      });
      preset.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const slotIdx = parseInt(preset.dataset.slot ?? idx, 10);
        this.openColorPaletteForSlot(slotIdx);
      });
    });

    // Custom Color Picker Button in Ribbon
    if (this.dom.btnColorPicker) {
      this.dom.btnColorPicker.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openColorPaletteForSlot(this.activeColorSlot);
      });
    }

    // Palette Swatches: clicking any swatch updates the active slot's color!
    document.querySelectorAll('.palette-dot').forEach(dot => {
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        const color = dot.dataset.color;
        if (color) {
          this.setSlotColor(this.activeColorSlot, color);
          this.dom.paletteDropdown.classList.add('hidden');
        }
      });
    });

    // Native Color Picker input: updates active slot's color in real time
    if (this.dom.nativeColorPicker) {
      this.dom.nativeColorPicker.addEventListener('input', (e) => {
        this.setSlotColor(this.activeColorSlot, e.target.value);
      });
    }

    // 9. Thickness Controls
    this.dom.thicknessPills.forEach(pill => {
      pill.addEventListener('click', () => {
        const width = parseFloat(pill.dataset.width);
        this.setActiveWidth(width);
      });
    });

    this.dom.strokeWidthSlider.addEventListener('input', (e) => {
      this.setActiveWidth(parseFloat(e.target.value));
    });

    // 10. Theme Toggle
    this.dom.btnToggleTheme.addEventListener('click', () => {
      this.toggleTheme();
    });

    // 11. Modal Handlers
    this.dom.btnCloseTemplateModal.addEventListener('click', () => this.closeTemplateModal());
    this.dom.btnCancelTemplate.addEventListener('click', () => this.closeTemplateModal());
    this.dom.btnConfirmAddPage.addEventListener('click', () => this.confirmAddPage());

    this.dom.templateCards.forEach(card => {
      card.addEventListener('click', () => {
        this.dom.templateCards.forEach(c => c.classList.remove('active'));
        card.classList.add('active');
      });
    });

    this.dom.colorChoiceButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        this.dom.colorChoiceButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    this.dom.orientationButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        this.dom.orientationButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // Shortcuts modal
    this.dom.btnShortcutsHelp.addEventListener('click', () => this.dom.shortcutsModal.classList.remove('hidden'));
    this.dom.btnCloseShortcutsModal.addEventListener('click', () => this.dom.shortcutsModal.classList.add('hidden'));

    // 12. Library Actions
    this.dom.btnNewNotebook.addEventListener('click', () => {
      if (confirm('Create a new notebook? Any unsaved changes in current notebook are stored in local database.')) {
        this.notebook = {
          id: 'notebook_' + Date.now().toString(36),
          title: 'New Notebook',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          currentPageIndex: 0,
          pdfSource: null,
          pages: [this.createDefaultPage(1, 'ruled', 'cream', 794, 1123)]
        };
        this.updateDocTitleDisplay(this.notebook.title);
        this.undoStack = [];
        this.redoStack = [];
        this.renderCurrentPage();
        this.renderThumbnailsSidebar();
        this.updatePageCounter();
        this.updateHistoryButtons();
        this.dom.docsMenuDropdown.classList.add('hidden');
        this.scheduleSave();
        this.showToast('New notebook created');
      }
    });

    this.dom.btnImportPdf.addEventListener('click', async () => {
      this.dom.docsMenuDropdown.classList.add('hidden');
      await this._triggerPdfImport();
    });

    this.dom.pdfFileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file) await this.handlePdfImport(file);
      this.dom.pdfFileInput.value = '';
    });

    this.dom.btnImportProject.addEventListener('click', () => {
      this.dom.projectFileInput.click();
      this.dom.docsMenuDropdown.classList.add('hidden');
    });

    this.dom.projectFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) this.handleProjectImport(file);
      this.dom.projectFileInput.value = '';
    });

    // 13. Export Actions
    this.dom.btnExportPDF.addEventListener('click', async () => {
      this.dom.exportMenuDropdown.classList.add('hidden');
      this.showToast('Generating annotated PDF...');
      try {
        await this.storage.exportToPDF(this.notebook, async (pageIndex) => {
          return await this.renderPageCompositeCanvas(pageIndex);
        });
        this.showToast('Annotated PDF downloaded successfully');
      } catch (err) {
        console.error('PDF Export failed:', err);
        this.showToast('Export failed: ' + err.message);
      }
    });

    this.dom.btnExportPNG.addEventListener('click', () => {
      this.dom.exportMenuDropdown.classList.add('hidden');
      const page = this.getCurrentPage();
      const filename = `${this.notebook.title}_Page_${page.pageNumber}.png`;
      this.storage.exportPageToPNG(this.dom.bgCanvas, this.dom.vectorCanvas, page.textBoxes, page.stickyNotes, filename);
      this.showToast('Page exported as PNG');
    });

    this.dom.btnExportProjectJSON.addEventListener('click', () => {
      this.dom.exportMenuDropdown.classList.add('hidden');
      this.storage.exportProjectJSON(this.notebook);
      this.showToast('.gnotes project file exported');
    });

    // 14. Drag & Drop File Handling
    window.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.dom.dropOverlay.classList.remove('hidden');
    });
    this.dom.dropOverlay.addEventListener('dragleave', (e) => {
      if (e.relatedTarget === null) {
        this.dom.dropOverlay.classList.add('hidden');
      }
    });
    this.dom.dropOverlay.addEventListener('drop', async (e) => {
      e.preventDefault();
      this.dom.dropOverlay.classList.add('hidden');
      const file = e.dataTransfer.files[0];
      if (!file) return;

      if (file.name.endsWith('.pdf')) {
        await this.handlePdfImport(file);
      } else if (file.name.endsWith('.gnotes') || file.name.endsWith('.json')) {
        this.handleProjectImport(file);
      } else if (file.type && file.type.startsWith('image/')) {
        await this.insertImageFile(file);
      } else {
        this.showToast('Please drop a valid .pdf, .gnotes, or image file');
      }
    });

    // 15. Inking Canvas Pointer Events
    this.bindPointerEvents();
  }

  /**
   * Helper for accessible dropdowns
   */
  bindDropdown(button, menu) {
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = menu.classList.contains('hidden');
      document.querySelectorAll('.dropdown-panel').forEach(d => d.classList.add('hidden'));
      if (isHidden) menu.classList.remove('hidden');
    });

    document.addEventListener('click', (e) => {
      if (!menu.contains(e.target) && !button.contains(e.target)) {
        menu.classList.add('hidden');
      }
    });
  }

  /**
   * Sets up global keyboard shortcuts
   */
  bindKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      // Ctrl+S / Cmd+S: Save immediately anytime, even when typing in input/textbox
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        if (this.notebook) {
          this.saveImmediately();
          this.showToast('Notebook saved (Ctrl+S)');
        }
        return;
      }

      // F8: Toggle between Floating Minimalist Bar and Classic Ribbon
      if (e.key === 'F8') {
        e.preventDefault();
        this.toggleToolbarMode();
        return;
      }

      // Ignore if user is typing in title input or sticky note / textbox
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
        return;
      }

      if (e.code === 'Space' && !this.isSpacePressed) {
        this.isSpacePressed = true;
        this.dom.canvasViewport.classList.add('panning');
      }

      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z' || e.key === 'Z') {
          e.preventDefault();
          if (e.shiftKey) this.redo();
          else this.undo();
        } else if (e.key === 'y' || e.key === 'Y') {
          e.preventDefault();
          this.redo();
        }
        return;
      }

      switch (e.key.toLowerCase()) {
        case 'p': this.setActiveTool('ballpoint'); break;
        case 'f': this.setActiveTool('fountain'); break;
        case 'h': this.setActiveTool('highlighter'); break;
        case 'e': this.setActiveTool('eraser'); break;
        case 'l': this.setActiveTool('lasso'); break;
        case 's': this.setActiveTool('shapes'); break;
        case 't': this.setActiveTool('text'); break;
        case 'n': this.setActiveTool('sticky'); break;
        case 'b': this.togglePageBookmark(this.notebook.currentPageIndex); break;
        case 'arrowdown':
        case 'arrowright':
        case 'pagedown':
        case ']':
          e.preventDefault();
          this.goToNextPage();
          break;
        case 'arrowup':
        case 'arrowleft':
        case 'pageup':
        case '[':
          e.preventDefault();
          this.goToPrevPage();
          break;
        case 'tab':
          e.preventDefault();
          this.dom.thumbnailsSidebar.classList.toggle('collapsed');
          this.coord.invalidateCache();
          break;
        case 'delete':
        case 'backspace':
          if (this.selectedImageId) {
            e.preventDefault();
            this.deleteSelectedImage();
            break;
          }
          if (this.selectedStrokes.length > 0 || this.selectedShapes.length > 0) {
            e.preventDefault();
            this.deleteLassoSelection();
          }
          break;
        case '?':
          this.dom.shortcutsModal.classList.toggle('hidden');
          break;
        case 'escape':
          if (this.selectedImageId) {
            this.selectedImageId = null;
            this.renderDomOverlay(this.getCurrentPage(), this.coord.zoom);
          }
          if (this.selectionBox || document.getElementById('activeLassoToolbar')) {
            e.preventDefault();
            this.clearLassoSelection();
          }
          break;
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.isSpacePressed = false;
        if (this.activeTool !== 'pan') {
          this.dom.canvasViewport.classList.remove('panning');
        }
      }
    });

    // Global Paste Listener (Ctrl+V) for instant image paste onto canvas
    window.addEventListener('paste', (e) => this.handlePasteEvent(e));
  }

  /**
   * Primary Inking & Pointer Events Dispatcher
   */
  bindPointerEvents() {
    const container = this.dom.pagesContainer || this.dom.canvasViewport;

    container.addEventListener('pointerdown', (e) => this.handlePointerDown(e));
    window.addEventListener('pointermove', (e) => this.handlePointerMove(e));
    window.addEventListener('pointerup', (e) => this.handlePointerUp(e));
    window.addEventListener('pointercancel', (e) => this.handlePointerUp(e));

    // Live Eraser Cursor Tracking on Canvas Viewport
    container.addEventListener('pointermove', (e) => {
      if (this.activeTool === 'eraser' && this.dom.pageWrapper) {
        const docPos = this.coord.screenToDoc(e.clientX, e.clientY, this.dom.pageWrapper);
        this.updateEraserCursorPreview(docPos);
      }
    });
    container.addEventListener('pointerleave', () => {
      if (this.dom.eraserCursorPreview) {
        this.dom.eraserCursorPreview.classList.add('hidden');
      }
    });

    // Dismiss floating lasso selection toolbar if clicking outside it
    document.addEventListener('pointerdown', (e) => {
      const toolbar = document.getElementById('activeLassoToolbar');
      if (toolbar && !toolbar.contains(e.target)) {
        if (!e.target.closest('.page-wrapper')) {
          this.clearLassoSelection();
        }
      }
    });
  }

  handlePointerDown(e) {
    if (e.button !== 0 && e.button !== 1) return; // Only primary or middle click

    const isPanAction = this.activeTool === 'pan' || this.isSpacePressed || e.button === 1;

    if (isPanAction) {
      this.isPanning = true;
      this.panStartPos = { x: e.clientX, y: e.clientY };
      this.scrollStartPos = {
        left: this.dom.canvasViewport.scrollLeft,
        top: this.dom.canvasViewport.scrollTop
      };
      this.dom.canvasViewport.classList.add('panning');
      return;
    }

    // Auto-detect target page wrapper in multi-page continuous scroll
    const pageEl = e.target.closest('.page-wrapper');
    if (pageEl) {
      const pageIdx = parseInt(pageEl.dataset.pageIndex, 10);
      if (!isNaN(pageIdx) && pageIdx !== this.notebook.currentPageIndex) {
        this.setActivePage(pageIdx, false);
      }
    }

    if (!this.dom.pageWrapper) return;
    const docPos = this.coord.screenToDoc(e.clientX, e.clientY, this.dom.pageWrapper);
    this.isDrawing = true;
    this.lastPointerPos = docPos;

    // Dismiss lasso selection menu if drawing with any other tool or clicking outside selection box
    if (this.selectionBox || document.getElementById('activeLassoToolbar')) {
      if (this.activeTool !== 'lasso' || !this.isPointInAABB(docPos, this.selectionBox)) {
        this.clearLassoSelection();
      }
    }

    // Deselect active image if clicking outside image cards
    if (this.selectedImageId) {
      this.selectedImageId = null;
      const allSelectedCards = this.dom.domOverlay.querySelectorAll('.canvas-image-card.selected');
      allSelectedCards.forEach(c => c.classList.remove('selected'));
    }

    // 1. Text Tool -> Create new Text Box
    if (this.activeTool === 'text') {
      this.isDrawing = false;
      this.createTextBoxAt(docPos.x, docPos.y);
      return;
    }

    // 2. Sticky Note Tool -> Create new Sticky Note
    if (this.activeTool === 'sticky') {
      this.isDrawing = false;
      this.createStickyNoteAt(docPos.x, docPos.y);
      return;
    }

    // 3. Lasso Tool
    if (this.activeTool === 'lasso') {
      // Check if clicking inside existing selection box
      if (this.selectionBox && this.isPointInAABB(docPos, this.selectionBox)) {
        this.isDraggingSelection = true;
        this.selectionDragStart = docPos;
        this.lassoDragAnchor = docPos;
        this.preLassoSnapshot = this.takeSnapshot();
        return;
      }

      // Otherwise start new lasso selection loop
      this.clearLassoSelection();
      this.lassoPoints = [docPos];
      this.dom.lassoCtx.clearRect(0, 0, this.dom.lassoCanvas.width, this.dom.lassoCanvas.height);
      return;
    }

    // 4. Laser Pointer Tool (Glowing transient presentation trail)
    if (this.activeTool === 'laser') {
      this.isDrawing = true;
      this.laserPoints = [{ x: docPos.x, y: docPos.y, time: Date.now() }];
      this.startLaserAnimation();
      return;
    }

    // 5. Eraser Tool
    if (this.activeTool === 'eraser') {
      this.preEraseSnapshot = this.takeSnapshot();
      this.eraseActionModified = false;
      this.lastErasePos = docPos;
      this.performEraseAt(docPos.x, docPos.y);
      return;
    }

    // 5. Shapes Tool with Direct Drag-To-Create Mode
    if (this.activeTool === 'shapes' && this.shapeMode !== 'auto') {
      this.isDrawingShape = true;
      this.shapeDragStart = docPos;
      this.preActionSnapshot = this.takeSnapshot();
      return;
    }

    // 6. Inking Tools (ballpoint, fountain, highlighter, auto-shapes)
    this.preActionSnapshot = this.takeSnapshot();
    const toolType = this.activeTool === 'shapes' ? 'ballpoint' : this.activeTool;

    this.activeSnappedShape = null;
    this.isResizingSnappedShape = false;
    this.snapAnchor = null;
    this.shapePauseAnchorPos = docPos;

    this.currentStroke = this.strokeEngine.createStroke({
      tool: toolType,
      color: this.activeColor,
      width: this.activeWidth,
      opacity: toolType === 'highlighter' ? 0.38 : 1.0
    });

    // Clear active temporary inking layer
    this.dom.activeCtx.clearRect(0, 0, this.dom.activeCanvas.width, this.dom.activeCanvas.height);

    this.strokeEngine.addPoint(this.currentStroke, {
      x: docPos.x,
      y: docPos.y,
      pressure: e.pressure || 0.5,
      time: performance.now()
    });

    // Reset shape auto-snapping timer
    this.resetShapePauseTimer();
  }

  handlePointerMove(e) {
    if (this.isPanning) {
      const dx = e.clientX - this.panStartPos.x;
      const dy = e.clientY - this.panStartPos.y;
      this.dom.canvasViewport.scrollLeft = this.scrollStartPos.left - dx;
      this.dom.canvasViewport.scrollTop = this.scrollStartPos.top - dy;
      return;
    }

    // Safety check: if no mouse buttons are pressed, ensure drawing and erasing are stopped
    if (e.buttons === 0) {
      if (this.isDrawing) {
        this.handlePointerUp(e);
      }
      this.isDrawing = false;
      this.isDraggingSelection = false;
      return;
    }

    if (!this.isDrawing && !this.isDraggingSelection) return;

    const docPos = this.coord.screenToDoc(e.clientX, e.clientY, this.dom.pageWrapper);

    // 1. Resizing Snapped Shape (Hold & Drag to Resize)
    if (this.activeSnappedShape && this.isDrawing) {
      this.resizeSnappedShape(docPos);
      this.dom.activeCtx.clearRect(0, 0, this.dom.activeCanvas.width, this.dom.activeCanvas.height);
      this.shapeRecognizer.drawSnappedShape(this.dom.activeCtx, this.activeSnappedShape, this.activeColor, this.activeWidth);
      return;
    }

    // Direct Drag-To-Create Shape Preview
    if (this.isDrawingShape && this.shapeDragStart) {
      const previewShape = this.buildDragShape(this.shapeDragStart, docPos);
      this.dom.activeCtx.clearRect(0, 0, this.dom.activeCanvas.width, this.dom.activeCanvas.height);
      this.shapeRecognizer.drawSnappedShape(this.dom.activeCtx, previewShape, this.activeColor, this.activeWidth);
      return;
    }

    // Dragging Lasso Selection
    if (this.isDraggingSelection && this.selectionDragStart) {
      const dx = docPos.x - this.selectionDragStart.x;
      const dy = docPos.y - this.selectionDragStart.y;
      this.lassoEngine.applyTranslation(this.selectedStrokes, this.selectedShapes, dx, dy);
      this.selectionDragStart = docPos;
      this.selectionBox = this.lassoEngine.computeBoundingBox(this.selectedStrokes, this.selectedShapes);
      this.renderVectorCanvas();
      this.renderLassoSelectionBox();
      return;
    }

    // Lasso Drawing Marquee (throttled by 5px to keep loop lightweight)
    if (this.activeTool === 'lasso') {
      const lastPt = this.lassoPoints[this.lassoPoints.length - 1];
      if (!lastPt || Math.hypot(docPos.x - lastPt.x, docPos.y - lastPt.y) > 5) {
        this.lassoPoints.push(docPos);
        this.dom.lassoCtx.clearRect(0, 0, this.dom.lassoCanvas.width, this.dom.lassoCanvas.height);
        this.lassoEngine.drawMarquee(this.dom.lassoCtx, this.lassoPoints);
      }
      return;
    }

    // Laser Pointer Trail
    if (this.activeTool === 'laser') {
      if (this.isDrawing && this.laserPoints) {
        this.laserPoints.push({ x: docPos.x, y: docPos.y, time: Date.now() });
      }
      return;
    }

    // Eraser Path Erasing with continuous interpolation
    if (this.activeTool === 'eraser') {
      if (this.lastErasePos) {
        const dist = Math.hypot(docPos.x - this.lastErasePos.x, docPos.y - this.lastErasePos.y);
        const tolerance = Math.max(6, (this.activeWidth || 22) / 2);
        const step = Math.max(4, tolerance * 0.45);
        if (dist > step) {
          const steps = Math.ceil(dist / step);
          for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const ix = this.lastErasePos.x + (docPos.x - this.lastErasePos.x) * t;
            const iy = this.lastErasePos.y + (docPos.y - this.lastErasePos.y) * t;
            this.performEraseAt(ix, iy);
          }
        } else {
          this.performEraseAt(docPos.x, docPos.y);
        }
      } else {
        this.performEraseAt(docPos.x, docPos.y);
      }
      this.lastErasePos = docPos;
      this.updateEraserCursorPreview(docPos);
      return;
    }

    // Active Inking
    if (this.currentStroke) {
      const added = this.strokeEngine.addPoint(this.currentStroke, {
        x: docPos.x,
        y: docPos.y,
        pressure: e.pressure || 0.5,
        time: performance.now()
      });

      if (added) {
        this.strokeEngine.drawSegment(this.dom.activeCtx, this.currentStroke);
      }

      this.lastPointerPos = docPos;

      // Jitter tolerance: only reset pause timer if moving > 5px from pause anchor
      if (!this.shapePauseAnchorPos || Math.hypot(docPos.x - this.shapePauseAnchorPos.x, docPos.y - this.shapePauseAnchorPos.y) > 5) {
        this.shapePauseAnchorPos = docPos;
        this.resetShapePauseTimer();
      }
    }
  }

  handlePointerUp(e) {
    if (this.isPanning) {
      this.isPanning = false;
      this.dom.canvasViewport.classList.remove('panning');
      return;
    }

    const docPos = this.coord.screenToDoc(e.clientX, e.clientY, this.dom.pageWrapper);

    if (this.isDraggingSelection) {
      this.isDraggingSelection = false;
      this.selectionDragStart = null;
      if (this.lassoDragAnchor && this.preLassoSnapshot) {
        const moved = Math.hypot(docPos.x - this.lassoDragAnchor.x, docPos.y - this.lassoDragAnchor.y);
        if (moved > 2) {
          this.pushUndoSnapshot(this.preLassoSnapshot);
        }
      }
      this.preLassoSnapshot = null;
      this.lassoDragAnchor = null;
      this.markDirty();
      this.renderThumbnailsSidebar();
      if (this.selectionBox) {
        this.showLassoToolbar();
      }
      return;
    }

    if (this.activeTool === 'laser') {
      this.isDrawing = false;
      return;
    }

    if (this.activeTool === 'eraser') {
      this.isDrawing = false;
      this.lastErasePos = null;
      if (this.eraseActionModified && this.preEraseSnapshot) {
        this.pushUndoSnapshot(this.preEraseSnapshot);
      }
      this.eraseActionModified = false;
      this.preEraseSnapshot = null;
      this.markDirty();
      return;
    }

    if (!this.isDrawing) return;
    this.isDrawing = false;
    this.clearShapePauseTimer();

    // 1. If a shape snapped and was held/resized, COMMIT THE PERFECT SHAPE!
    if (this.activeSnappedShape) {
      if (this.preActionSnapshot) {
        this.pushUndoSnapshot(this.preActionSnapshot);
        this.preActionSnapshot = null;
      }

      this.dom.activeCtx.clearRect(0, 0, this.dom.activeCanvas.width, this.dom.activeCanvas.height);
      const finalShape = {
        id: 'shp_' + Date.now().toString(36),
        type: this.activeSnappedShape.type,
        geometry: { ...this.activeSnappedShape.geometry },
        color: this.activeColor,
        lineWidth: this.activeWidth,
        fillColor: this.activeSnappedShape.fillColor || (this.shapeFill === 'tint' ? this.hexToRgba(this.activeColor, 0.22) : (this.shapeFill === 'solid' ? this.hexToRgba(this.activeColor, 0.88) : null))
      };

      const page = this.getCurrentPage();
      page.shapes.push(finalShape);

      this.activeSnappedShape = null;
      this.isResizingSnappedShape = false;
      this.snapAnchor = null;
      this.currentStroke = null;

      this.renderVectorCanvas();
      this.updateCurrentThumbnailDebounced();
      this.markDirty();
      return;
    }

    // 2. Finalize Direct Drag-to-Create Shape
    if (this.isDrawingShape && this.shapeDragStart) {
      this.isDrawingShape = false;
      this.dom.activeCtx.clearRect(0, 0, this.dom.activeCanvas.width, this.dom.activeCanvas.height);

      const dist = Math.hypot(docPos.x - this.shapeDragStart.x, docPos.y - this.shapeDragStart.y);
      if (dist > 5) {
        if (this.preActionSnapshot) {
          this.pushUndoSnapshot(this.preActionSnapshot);
          this.preActionSnapshot = null;
        }

        const finalShape = this.buildDragShape(this.shapeDragStart, docPos);
        finalShape.id = 'shp_' + Date.now().toString(36);
        finalShape.color = this.activeColor;
        finalShape.lineWidth = this.activeWidth;

        const page = this.getCurrentPage();
        page.shapes.push(finalShape);
        this.renderVectorCanvas();
        this.updateCurrentThumbnailDebounced();
        this.markDirty();
      }
      this.shapeDragStart = null;
      return;
    }

    // 3. Finalize Lasso
    if (this.activeTool === 'lasso') {
      if (this.lassoPoints.length > 6) {
        const page = this.getCurrentPage();
        const results = this.lassoEngine.findSelectedItems(page.strokes, page.shapes, this.lassoPoints);
        this.selectedStrokes = results.selectedStrokes;
        this.selectedShapes = results.selectedShapes;
        this.selectionBox = this.lassoEngine.computeBoundingBox(this.selectedStrokes, this.selectedShapes);

        this.dom.lassoCtx.clearRect(0, 0, this.dom.lassoCanvas.width, this.dom.lassoCanvas.height);

        if (this.selectionBox) {
          this.renderLassoSelectionBox();
          this.showLassoToolbar();
        } else {
          this.clearLassoSelection();
        }
      } else {
        this.clearLassoSelection();
      }
      return;
    }

    // 4. Finalize Regular Inking Stroke
    if (this.currentStroke && this.currentStroke.points.length > 0) {
      const page = this.getCurrentPage();

      // Check Shape Recognition if Shapes tool is active in auto mode
      let snappedShape = null;
      if (this.activeTool === 'shapes' && this.shapeMode === 'auto') {
        snappedShape = this.shapeRecognizer.classify(this.currentStroke.points);
      }

      // Clear active canvas
      this.dom.activeCtx.clearRect(0, 0, this.dom.activeCanvas.width, this.dom.activeCanvas.height);

      if (this.preActionSnapshot) {
        this.pushUndoSnapshot(this.preActionSnapshot);
        this.preActionSnapshot = null;
      }

      if (snappedShape) {
        let fillColor = null;
        if (this.shapeFill === 'tint') fillColor = this.hexToRgba(this.activeColor, 0.22);
        else if (this.shapeFill === 'solid') fillColor = this.hexToRgba(this.activeColor, 0.88);

        page.shapes.push({
          id: 'shp_' + Date.now().toString(36),
          type: snappedShape.type,
          geometry: snappedShape.geometry,
          color: this.activeColor,
          lineWidth: this.activeWidth,
          fillColor
        });
      } else {
        page.strokes.push(this.currentStroke);
      }

      this.currentStroke = null;
      this.renderVectorCanvas();
      this.updateCurrentThumbnailDebounced();
      this.markDirty();
    }
  }

  /**
   * Constructs shape geometry from drag start to drag current/end
   */
  buildDragShape(start, end) {
    const w = Math.abs(end.x - start.x);
    const h = Math.abs(end.y - start.y);
    const minX = Math.min(start.x, end.x);
    const minY = Math.min(start.y, end.y);
    const maxX = Math.max(start.x, end.x);
    const maxY = Math.max(start.y, end.y);

    let geometry = {};
    const type = this.shapeMode;

    switch (type) {
      case 'line':
      case 'arrow':
        geometry = { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
        break;

      case 'rectangle':
      case 'roundedRectangle':
        geometry = { x: minX, y: minY, width: Math.max(6, w), height: Math.max(6, h) };
        break;

      case 'circle':
        const cx = minX + w / 2;
        const cy = minY + h / 2;
        const rx = Math.max(4, w / 2);
        const ry = Math.max(4, h / 2);
        geometry = { cx, cy, r: (rx + ry) / 2, rx, ry };
        break;

      case 'triangle':
        geometry = {
          p1: { x: (minX + maxX) / 2, y: minY },
          p2: { x: minX, y: maxY },
          p3: { x: maxX, y: maxY }
        };
        break;

      case 'diamond':
        geometry = {
          p1: { x: minX + w / 2, y: minY },
          p2: { x: maxX, y: minY + h / 2 },
          p3: { x: minX + w / 2, y: maxY },
          p4: { x: minX, y: minY + h / 2 }
        };
        break;

      case 'star':
        geometry = {
          x: minX,
          y: minY,
          width: Math.max(10, w),
          height: Math.max(10, h),
          cx: minX + w / 2,
          cy: minY + h / 2,
          r: Math.max(w, h) / 2
        };
        break;

      default:
        geometry = { x: minX, y: minY, width: Math.max(6, w), height: Math.max(6, h) };
    }

    let fillColor = null;
    if (this.shapeFill === 'tint') {
      fillColor = this.hexToRgba(this.activeColor, 0.22);
    } else if (this.shapeFill === 'solid') {
      fillColor = this.hexToRgba(this.activeColor, 0.88);
    }

    return {
      type,
      geometry,
      fillColor
    };
  }

  /**
   * Helper to convert hex colors to RGBA with alpha
   */
  hexToRgba(hex, alpha = 1.0) {
    if (!hex || hex.startsWith('rgb')) return hex;
    let c = hex.replace('#', '');
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    const num = parseInt(c, 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  /**
   * Live visual eraser cursor preview tracking pointer position
   */
  updateEraserCursorPreview(docPos) {
    if (!this.dom.eraserCursorPreview) return;
    if (this.activeTool !== 'eraser') {
      this.dom.eraserCursorPreview.classList.add('hidden');
      return;
    }

    const zoom = this.coord.zoom;
    const diameter = Math.max(10, (this.activeWidth || 22) * zoom);
    this.dom.eraserCursorPreview.style.width = `${diameter}px`;
    this.dom.eraserCursorPreview.style.height = `${diameter}px`;

    if (docPos) {
      this.dom.eraserCursorPreview.style.left = `${docPos.x * zoom}px`;
      this.dom.eraserCursorPreview.style.top = `${docPos.y * zoom}px`;
    }
    this.dom.eraserCursorPreview.classList.remove('hidden');
  }

  /**
   * Eraser Hit Logic with dynamic size tolerance
   */
  performEraseAt(x, y) {
    const page = this.getCurrentPage();
    // Dynamic tolerance based on chosen eraser size
    const tolerance = Math.max(6, (this.activeWidth || 22) / 2);
    let modified = false;

    // Stroke Eraser: deletes entire stroke on contact
    if (this.eraserType === 'stroke') {
      const initialCount = page.strokes.length;
      page.strokes = page.strokes.filter(s => {
        if (this.eraseHighlighterOnly && s.tool !== 'highlighter') return true;
        const hit = this.strokeEngine.isPointNearStroke(s, x, y, tolerance);
        return !hit;
      });

      if (page.strokes.length !== initialCount) {
        modified = true;
      }

      // Also check geometric shapes
      const initialShapes = page.shapes.length;
      page.shapes = page.shapes.filter(sh => {
        const shapeStroke = { points: this.samplePointsFromShape(sh), width: sh.lineWidth || 2 };
        return !this.strokeEngine.isPointNearStroke(shapeStroke, x, y, tolerance);
      });

      if (page.shapes.length !== initialShapes) {
        modified = true;
      }
    } else {
      // Precision Eraser: splits stroke cleanly around circular contact area using clipStrokeByCircle
      const newStrokes = [];
      for (const s of page.strokes) {
        if (this.eraseHighlighterOnly && s.tool !== 'highlighter') {
          newStrokes.push(s);
          continue;
        }

        const res = this.strokeEngine.clipStrokeByCircle(s, x, y, tolerance);
        if (res.modified) {
          modified = true;
          newStrokes.push(...res.strokes);
        } else {
          newStrokes.push(s);
        }
      }
      page.strokes = newStrokes;

      // Also check geometric shapes for precision eraser: if contact with shape, remove it
      const initialShapes = page.shapes.length;
      page.shapes = page.shapes.filter(sh => {
        const shapeStroke = { points: this.samplePointsFromShape(sh), width: sh.lineWidth || 2 };
        return !this.strokeEngine.isPointNearStroke(shapeStroke, x, y, tolerance);
      });

      if (page.shapes.length !== initialShapes) {
        modified = true;
      }
    }

    if (modified) {
      this.eraseActionModified = true;
      this.renderVectorCanvas();
      this.updateCurrentThumbnailDebounced();
      this.markDirty();
    }
  }

  samplePointsFromShape(shape) {
    const g = shape.geometry;
    if (!g) return [];
    if (shape.type === 'line' || shape.type === 'arrow') {
      return [{ x: g.x1, y: g.y1 }, { x: g.x2, y: g.y2 }];
    }
    if (shape.type === 'rectangle' || shape.type === 'roundedRectangle') {
      return [
        { x: g.x, y: g.y },
        { x: g.x + g.width, y: g.y },
        { x: g.x + g.width, y: g.y + g.height },
        { x: g.x, y: g.y + g.height }
      ];
    }
    if (shape.type === 'circle' || shape.type === 'ellipse') {
      const pts = [];
      const rx = g.r || g.rx || 20;
      const ry = g.r || g.ry || 20;
      for (let i = 0; i < 8; i++) {
        const theta = (i / 8) * Math.PI * 2;
        pts.push({ x: g.cx + Math.cos(theta) * rx, y: g.cy + Math.sin(theta) * ry });
      }
      return pts;
    }
    if (shape.type === 'triangle') {
      return [g.p1, g.p2, g.p3];
    }
    if (shape.type === 'star') {
      const cx = g.cx || (g.x + g.width / 2);
      const cy = g.cy || (g.y + g.height / 2);
      const outerR = g.r || Math.min(Math.abs(g.width), Math.abs(g.height)) / 2;
      const innerR = outerR * 0.42;
      const pts = [];
      for (let i = 0; i < 10; i++) {
        const radius = i % 2 === 0 ? outerR : innerR;
        const a = (i * Math.PI) / 5 - Math.PI / 2;
        pts.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) });
      }
      return pts;
    }
    if (shape.type === 'diamond') {
      return [g.p1, g.p2, g.p3, g.p4];
    }
    if (shape.type === 'polygon' && g.vertices) {
      return g.vertices;
    }
    return [];
  }

  /**
   * Shape snapping pause timer: if pen is held still at the end of a stroke, snap & enable dynamic resizing!
   */
  resetShapePauseTimer() {
    this.clearShapePauseTimer();
    // Allow auto-snap on ballpoint, fountain, and shapes tool (auto mode)
    const canSnap = this.activeTool === 'ballpoint' || this.activeTool === 'fountain' || (this.activeTool === 'shapes' && this.shapeMode === 'auto');
    if (!canSnap) return;

    this.shapePauseTimer = setTimeout(() => {
      if (this.isDrawing && this.currentStroke && this.currentStroke.points.length >= 6) {
        const snapped = this.shapeRecognizer.classify(this.currentStroke.points);
        if (snapped) {
          this.activeSnappedShape = snapped;
          this.isResizingSnappedShape = true;
          this.initSnapAnchor(snapped, this.lastPointerPos || this.currentStroke.points[this.currentStroke.points.length - 1]);

          // Compute fill if configured
          let fillColor = null;
          if (this.shapeFill === 'tint') fillColor = this.hexToRgba(this.activeColor, 0.22);
          else if (this.shapeFill === 'solid') fillColor = this.hexToRgba(this.activeColor, 0.88);
          this.activeSnappedShape.fillColor = fillColor;

          // Visual snap on active canvas
          this.dom.activeCtx.clearRect(0, 0, this.dom.activeCanvas.width, this.dom.activeCanvas.height);
          this.shapeRecognizer.drawSnappedShape(this.dom.activeCtx, this.activeSnappedShape, this.activeColor, this.activeWidth);
          this.showToast(`Snapped to ${snapped.type} (Hold & drag to resize)`);
        }
      }
    }, 380);
  }

  clearShapePauseTimer() {
    if (this.shapePauseTimer) {
      clearTimeout(this.shapePauseTimer);
      this.shapePauseTimer = null;
    }
  }

  /**
   * Sets up anchor reference point for dynamic shape resizing
   */
  initSnapAnchor(snapped, currentPos) {
    const g = snapped.geometry;
    const type = snapped.type;

    if (type === 'line' || type === 'arrow') {
      this.snapAnchor = { x: g.x1, y: g.y1 };
    } else if (type === 'circle' || type === 'ellipse') {
      this.snapAnchor = { cx: g.cx, cy: g.cy, origR: g.r || g.rx || 20 };
    } else if (type === 'rectangle' || type === 'roundedRectangle') {
      // Find which corner currentPos is closest to, and use the OPPOSITE corner as anchor
      const corners = [
        { anchor: { x: g.x + g.width, y: g.y + g.height }, cursor: { x: g.x, y: g.y } },
        { anchor: { x: g.x, y: g.y + g.height }, cursor: { x: g.x + g.width, y: g.y } },
        { anchor: { x: g.x + g.width, y: g.y }, cursor: { x: g.x, y: g.y + g.height } },
        { anchor: { x: g.x, y: g.y }, cursor: { x: g.x + g.width, y: g.y + g.height } }
      ];
      let best = corners[3];
      let minDist = Infinity;
      const pos = currentPos || { x: g.x + g.width, y: g.y + g.height };
      for (const c of corners) {
        const d = Math.hypot(pos.x - c.cursor.x, pos.y - c.cursor.y);
        if (d < minDist) { minDist = d; best = c; }
      }
      this.snapAnchor = best.anchor;
    } else if (type === 'triangle') {
      const cx = (g.p1.x + g.p2.x + g.p3.x) / 3;
      const cy = (g.p1.y + g.p2.y + g.p3.y) / 3;
      const pos = currentPos || { x: cx, y: cy };
      this.snapAnchor = {
        center: { x: cx, y: cy },
        p1: { ...g.p1 },
        p2: { ...g.p2 },
        p3: { ...g.p3 },
        baseDist: Math.max(15, Math.hypot(pos.x - cx, pos.y - cy))
      };
    } else if (type === 'diamond') {
      const cx = (g.p1.x + g.p3.x) / 2;
      const cy = (g.p2.y + g.p4.y) / 2;
      this.snapAnchor = { cx, cy };
    } else if (type === 'star') {
      const cx = g.cx || (g.x + (g.width || 0) / 2);
      const cy = g.cy || (g.y + (g.height || 0) / 2);
      this.snapAnchor = { cx, cy };
    } else if (type === 'polygon' && g.vertices) {
      let sx = 0, sy = 0;
      for (const v of g.vertices) { sx += v.x; sy += v.y; }
      const cx = sx / g.vertices.length;
      const cy = sy / g.vertices.length;
      this.snapAnchor = {
        cx, cy,
        origVertices: g.vertices.map(v => ({ x: v.x, y: v.y })),
        baseDist: Math.max(15, Math.hypot((currentPos?.x || cx) - cx, (currentPos?.y || cy) - cy))
      };
    } else {
      this.snapAnchor = { x: g.x || 0, y: g.y || 0 };
    }
  }

  /**
   * Dynamically resizes a snapped shape in real time as the user drags before lifting
   */
  resizeSnappedShape(docPos) {
    if (!this.activeSnappedShape || !this.snapAnchor) return;
    const g = this.activeSnappedShape.geometry;
    const type = this.activeSnappedShape.type;

    if (type === 'line' || type === 'arrow') {
      let x1 = this.snapAnchor.x;
      let y1 = this.snapAnchor.y;
      let x2 = docPos.x;
      let y2 = docPos.y;

      const dx = x2 - x1;
      const dy = y2 - y1;
      const angle = Math.atan2(dy, dx);
      const deg = Math.abs((angle * 180) / Math.PI);
      if (deg < 6 || deg > 174) y2 = y1;
      else if (Math.abs(deg - 90) < 6) x2 = x1;

      g.x1 = x1;
      g.y1 = y1;
      g.x2 = x2;
      g.y2 = y2;
    } else if (type === 'circle') {
      const dist = Math.hypot(docPos.x - this.snapAnchor.cx, docPos.y - this.snapAnchor.cy);
      g.r = Math.max(8, dist);
      g.rx = g.r;
      g.ry = g.r;
    } else if (type === 'ellipse') {
      g.rx = Math.max(8, Math.abs(docPos.x - this.snapAnchor.cx));
      g.ry = Math.max(8, Math.abs(docPos.y - this.snapAnchor.cy));
      g.r = (g.rx + g.ry) / 2;
    } else if (type === 'rectangle' || type === 'roundedRectangle') {
      const x1 = this.snapAnchor.x;
      const y1 = this.snapAnchor.y;
      const x2 = docPos.x;
      const y2 = docPos.y;
      g.x = Math.min(x1, x2);
      g.y = Math.min(y1, y2);
      g.width = Math.max(10, Math.abs(x2 - x1));
      g.height = Math.max(10, Math.abs(y2 - y1));
    } else if (type === 'triangle') {
      const c = this.snapAnchor.center;
      const currentDist = Math.hypot(docPos.x - c.x, docPos.y - c.y);
      const scale = Math.max(0.15, currentDist / (this.snapAnchor.baseDist || 20));
      g.p1 = { x: c.x + (this.snapAnchor.p1.x - c.x) * scale, y: c.y + (this.snapAnchor.p1.y - c.y) * scale };
      g.p2 = { x: c.x + (this.snapAnchor.p2.x - c.x) * scale, y: c.y + (this.snapAnchor.p2.y - c.y) * scale };
      g.p3 = { x: c.x + (this.snapAnchor.p3.x - c.x) * scale, y: c.y + (this.snapAnchor.p3.y - c.y) * scale };
    } else if (type === 'diamond') {
      const cx = this.snapAnchor.cx;
      const cy = this.snapAnchor.cy;
      const rx = Math.max(10, Math.abs(docPos.x - cx));
      const ry = Math.max(10, Math.abs(docPos.y - cy));
      g.p1 = { x: cx, y: cy - ry };
      g.p2 = { x: cx + rx, y: cy };
      g.p3 = { x: cx, y: cy + ry };
      g.p4 = { x: cx - rx, y: cy };
    } else if (type === 'star') {
      const cx = this.snapAnchor.cx;
      const cy = this.snapAnchor.cy;
      g.cx = cx;
      g.cy = cy;
      g.r = Math.max(10, Math.hypot(docPos.x - cx, docPos.y - cy));
    } else if (type === 'polygon' && this.snapAnchor.origVertices) {
      const cx = this.snapAnchor.cx;
      const cy = this.snapAnchor.cy;
      const currentDist = Math.hypot(docPos.x - cx, docPos.y - cy);
      const scale = Math.max(0.15, currentDist / (this.snapAnchor.baseDist || 20));
      g.vertices = this.snapAnchor.origVertices.map(v => ({
        x: cx + (v.x - cx) * scale,
        y: cy + (v.y - cy) * scale
      }));
    }
  }

  /**
   * Renders the complete multi-page document in continuous vertical view
   * @param {boolean} [forceBackgroundRedraw=false]
   */
  renderCurrentPage(forceBackgroundRedraw = false) {
    if (!this.notebook || !this.notebook.pages || this.notebook.pages.length === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const zoom = this.coord.zoom;
    const scaleFactor = zoom * dpr;

    // Check if pagesContainer structure needs rebuild
    const existingWrappers = this.dom.pagesContainer ? this.dom.pagesContainer.querySelectorAll('.page-wrapper') : [];
    const structureNeedsRebuild = existingWrappers.length !== this.notebook.pages.length;

    if (structureNeedsRebuild && this.dom.pagesContainer) {
      // Detach persistent interactive canvas layers before clearing
      if (this.dom.activeCanvas && this.dom.activeCanvas.parentElement) {
        this.dom.activeCanvas.remove();
      }
      if (this.dom.lassoCanvas && this.dom.lassoCanvas.parentElement) {
        this.dom.lassoCanvas.remove();
      }
      if (this.dom.eraserCursorPreview && this.dom.eraserCursorPreview.parentElement) {
        this.dom.eraserCursorPreview.remove();
      }

      this.dom.pagesContainer.innerHTML = '';

      for (let i = 0; i < this.notebook.pages.length; i++) {
        const p = this.notebook.pages[i];
        const displayW = Math.round(p.width * zoom);
        const displayH = Math.round(p.height * zoom);

        const pageEl = document.createElement('div');
        pageEl.className = `page-wrapper ${i === this.notebook.currentPageIndex ? 'active-page' : ''}`;
        pageEl.id = `pageWrapper_${i}`;
        pageEl.dataset.pageIndex = i;
        pageEl.style.width = `${displayW}px`;
        pageEl.style.height = `${displayH}px`;

        pageEl.innerHTML = `
          <button class="page-bookmark-btn ${p.isBookmarked ? 'bookmarked' : ''}" id="btnPageBookmark_${i}" data-page-index="${i}" title="${p.isBookmarked ? 'Remove Bookmark' : 'Bookmark Page'}" aria-label="Bookmark page">
            <svg width="18" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          </button>
          <canvas id="bgCanvas_${i}" class="canvas-layer layer-bg" width="${Math.round(displayW * dpr)}" height="${Math.round(displayH * dpr)}"></canvas>
          <canvas id="vectorCanvas_${i}" class="canvas-layer layer-vector" width="${Math.round(displayW * dpr)}" height="${Math.round(displayH * dpr)}"></canvas>
          <div id="domOverlay_${i}" class="dom-overlay"></div>
          <div class="page-number-pill">Page ${i + 1}</div>
        `;

        const bkmBtn = pageEl.querySelector('.page-bookmark-btn');
        if (bkmBtn) {
          bkmBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.togglePageBookmark(i);
          });
        }

        this.dom.pagesContainer.appendChild(pageEl);
      }

      // Add inline Add Page divider button at the bottom of the document
      const addPageDivider = document.createElement('div');
      addPageDivider.className = 'add-page-divider';
      addPageDivider.id = 'addPageInlineBtn';
      addPageDivider.innerHTML = `
        <div class="add-page-dash"></div>
        <button class="add-page-pill-btn" type="button" title="Add New Page">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          <span>Add Page</span>
        </button>
        <div class="add-page-dash"></div>
      `;
      addPageDivider.querySelector('.add-page-pill-btn').addEventListener('click', () => {
        this.confirmAddPage();
      });
      this.dom.pagesContainer.appendChild(addPageDivider);
    }

    // Render every page in the continuous vertical stack
    for (let i = 0; i < this.notebook.pages.length; i++) {
      const p = this.notebook.pages[i];
      const pageEl = document.getElementById(`pageWrapper_${i}`) || this.dom.pageWrapper;
      if (!pageEl) continue;

      const displayW = Math.round(p.width * zoom);
      const displayH = Math.round(p.height * zoom);
      const targetW = Math.round(displayW * dpr);
      const targetH = Math.round(displayH * dpr);

      pageEl.style.width = `${displayW}px`;
      pageEl.style.height = `${displayH}px`;

      const bgCanvas = pageEl.querySelector('.layer-bg');
      const vectorCanvas = pageEl.querySelector('.layer-vector');
      const domOverlay = pageEl.querySelector('.dom-overlay');

      if (bgCanvas && vectorCanvas) {
        const bgCtx = bgCanvas.getContext('2d');
        const vectorCtx = vectorCanvas.getContext('2d');

        const needsResize = bgCanvas.width !== targetW || bgCanvas.height !== targetH;
        if (needsResize) {
          bgCanvas.width = targetW;
          bgCanvas.height = targetH;
          vectorCanvas.width = targetW;
          vectorCanvas.height = targetH;
        }

        bgCtx.setTransform(scaleFactor, 0, 0, scaleFactor, 0, 0);
        vectorCtx.setTransform(scaleFactor, 0, 0, scaleFactor, 0, 0);

        // Render Layer 1: Background Template or PDF
        if (needsResize || forceBackgroundRedraw || structureNeedsRebuild) {
          this.renderBackgroundCanvasForPage(p, bgCanvas, bgCtx);
        }

        // Render Layer 2: Vector Annotations
        this.renderVectorCanvasForPage(p, vectorCanvas, vectorCtx);
      }

      // Render Layer 5: DOM Overlay (Sticky notes, text boxes, and images)
      if (domOverlay) {
        this.renderDomOverlayForPage(p, domOverlay, zoom);
      }

      // Sync bookmark ribbon state
      const bkmBtn = pageEl.querySelector('.page-bookmark-btn');
      if (bkmBtn) {
        bkmBtn.classList.toggle('bookmarked', Boolean(p.isBookmarked));
        bkmBtn.title = p.isBookmarked ? 'Remove Bookmark' : 'Bookmark Page';
      }
    }

    if (this.dom.pagesContainer) {
      this.dom.pagesContainer.classList.remove('single-page-mode');
    }

    // Set active page and configure the active inking layers
    const curIdx = Math.min(this.notebook.currentPageIndex, this.notebook.pages.length - 1);
    this.setActivePage(curIdx, false);

    const activePage = this.notebook.pages[curIdx];
    const activeDisplayW = Math.round(activePage.width * zoom);
    const activeDisplayH = Math.round(activePage.height * zoom);
    const activeTargetW = Math.round(activeDisplayW * dpr);
    const activeTargetH = Math.round(activeDisplayH * dpr);

    if (this.dom.activeCanvas) {
      this.dom.activeCanvas.width = activeTargetW;
      this.dom.activeCanvas.height = activeTargetH;
      this.dom.activeCtx.setTransform(scaleFactor, 0, 0, scaleFactor, 0, 0);
    }
    if (this.dom.lassoCanvas) {
      this.dom.lassoCanvas.width = activeTargetW;
      this.dom.lassoCanvas.height = activeTargetH;
      this.dom.lassoCtx.setTransform(scaleFactor, 0, 0, scaleFactor, 0, 0);
    }
  }

  /**
   * Sets the current active page in the multi-page continuous stack
   */
  setActivePage(index, smoothScroll = false) {
    if (index < 0 || index >= this.notebook.pages.length) return;
    this.notebook.currentPageIndex = index;

    const pageWrappers = this.dom.pagesContainer ? this.dom.pagesContainer.querySelectorAll('.page-wrapper') : [];
    pageWrappers.forEach((el, idx) => {
      el.classList.toggle('active-page', idx === index);
    });

    const activeWrapper = document.getElementById(`pageWrapper_${index}`) || this.dom.pageWrapper;
    if (activeWrapper) {
      this.dom.pageWrapper = activeWrapper;

      // Mount interactive activeCanvas, lassoCanvas, and eraserCursor into the active page
      if (this.dom.activeCanvas && this.dom.activeCanvas.parentElement !== activeWrapper) {
        activeWrapper.appendChild(this.dom.activeCanvas);
      }
      if (this.dom.lassoCanvas && this.dom.lassoCanvas.parentElement !== activeWrapper) {
        activeWrapper.appendChild(this.dom.lassoCanvas);
      }
      if (this.dom.eraserCursorPreview && this.dom.eraserCursorPreview.parentElement !== activeWrapper) {
        activeWrapper.appendChild(this.dom.eraserCursorPreview);
      }

      const bg = activeWrapper.querySelector('.layer-bg');
      if (bg) {
        this.dom.bgCanvas = bg;
        this.dom.bgCtx = bg.getContext('2d');
      }

      const vec = activeWrapper.querySelector('.layer-vector');
      if (vec) {
        this.dom.vectorCanvas = vec;
        this.dom.vectorCtx = vec.getContext('2d');
      }

      const ov = activeWrapper.querySelector('.dom-overlay');
      if (ov) {
        this.dom.domOverlay = ov;
      }

      if (smoothScroll) {
        activeWrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }

    this.updatePageCounter();
    this.updateThumbnailsActiveState();
    this.coord.invalidateCache();
  }

  /**
   * Binds continuous vertical scroll tracking on viewport to keep active page in sync
   */
  bindViewportScroll() {
    let scrollRaf = null;
    this.dom.canvasViewport.addEventListener('scroll', () => {
      if (this.isDrawing || this.isPanning || !this.dom.pagesContainer) return;
      if (scrollRaf) cancelAnimationFrame(scrollRaf);
      scrollRaf = requestAnimationFrame(() => {
        const vpRect = this.dom.canvasViewport.getBoundingClientRect();
        const focusY = vpRect.top + vpRect.height * 0.35;

        let closestIdx = this.notebook.currentPageIndex;
        let minDiff = Infinity;

        const pageEls = this.dom.pagesContainer.querySelectorAll('.page-wrapper');
        pageEls.forEach((el) => {
          const r = el.getBoundingClientRect();
          const centerY = r.top + r.height / 2;
          const diff = Math.abs(centerY - focusY);
          if (diff < minDiff) {
            minDiff = diff;
            closestIdx = parseInt(el.dataset.pageIndex, 10);
          }
        });

        if (closestIdx !== this.notebook.currentPageIndex && !isNaN(closestIdx)) {
          this.setActivePage(closestIdx, false);
        }
      });
    }, { passive: true });
  }

  /**
   * Renders Background Canvas for a specific page
   */
  async renderBackgroundCanvasForPage(page, canvas, ctx) {
    ctx.clearRect(0, 0, page.width, page.height);

    if (page.template === 'pdf' && page.pdfPageNumber) {
      if (this.pdfManager.hasCachedPage(page.pdfPageNumber)) {
        this.pdfManager.drawCachedPageToCtx(page.pdfPageNumber, ctx, page.width, page.height);
      } else {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, page.width, page.height);

        this.pdfManager.renderPageOffscreen(page.pdfPageNumber, page.width, page.height).then((offscreen) => {
          if (offscreen) {
            ctx.clearRect(0, 0, page.width, page.height);
            ctx.drawImage(offscreen, 0, 0, page.width, page.height);
          }
        });
      }

      this.prefetchAdjacentPdfPages(page.pdfPageNumber, page.width, page.height);
    } else {
      const isDarkApp = document.body.classList.contains('theme-dark');
      const paperColor = isDarkApp ? (page.paperColor === 'cream' ? 'dark' : page.paperColor) : page.paperColor;
      this.templateDrawer.drawTemplate(ctx, page.template, paperColor, page.width, page.height);
    }
  }

  /**
   * Renders Background Canvas (Layer 1) for the active page
   */
  async renderBackgroundCanvas(page) {
    if (!this.dom.bgCanvas || !this.dom.bgCtx) return;
    return this.renderBackgroundCanvasForPage(page, this.dom.bgCanvas, this.dom.bgCtx);
  }

  /**
   * Prefetches adjacent PDF pages in background idle slices for zero-lag page navigation
   */
  prefetchAdjacentPdfPages(currentNum, width, height) {
    if (!this.pdfManager || !this.pdfManager.pdfDoc) return;
    const nextNum = currentNum + 1;
    const prevNum = currentNum - 1;

    if (nextNum <= this.pdfManager.pageCount && !this.pdfManager.hasCachedPage(nextNum)) {
      setTimeout(() => this.pdfManager.renderPageOffscreen(nextNum, width, height).catch(() => {}), 150);
    }
    if (prevNum >= 1 && !this.pdfManager.hasCachedPage(prevNum)) {
      setTimeout(() => this.pdfManager.renderPageOffscreen(prevNum, width, height).catch(() => {}), 300);
    }
  }

  /**
   * Renders Vector Canvas for a specific page
   */
  renderVectorCanvasForPage(page, canvas, ctx) {
    ctx.clearRect(0, 0, page.width, page.height);
    const isDark = document.body.classList.contains('theme-dark');

    // 1. Draw Highlighters first so they sit cleanly under normal pen strokes
    for (const s of page.strokes) {
      if (s.tool === 'highlighter') {
        this.strokeEngine.renderStroke(ctx, s, isDark);
      }
    }

    // 2. Draw Geometric Shapes
    for (const sh of page.shapes) {
      this.shapeRecognizer.drawSnappedShape(ctx, sh, sh.color, sh.lineWidth);
    }

    // 3. Draw Normal Pen / Fountain Strokes
    for (const s of page.strokes) {
      if (s.tool !== 'highlighter') {
        this.strokeEngine.renderStroke(ctx, s, isDark);
      }
    }
  }

  /**
   * Renders Vector Canvas (Layer 2) for active page
   */
  renderVectorCanvas() {
    const page = this.getCurrentPage();
    if (!page || !this.dom.vectorCanvas || !this.dom.vectorCtx) return;
    this.renderVectorCanvasForPage(page, this.dom.vectorCanvas, this.dom.vectorCtx);
  }

  /**
   * Renders Sticky Notes, Text Boxes, and Images for the active page
   */
  renderDomOverlay(page, zoom = 1.0) {
    if (!this.dom.domOverlay) return;
    this.renderDomOverlayForPage(page, this.dom.domOverlay, zoom);
  }

  /**
   * Renders Sticky Notes, Text Boxes, and Images onto a specified DOM Overlay
   */
  renderDomOverlayForPage(page, overlayEl, zoom = 1.0) {
    overlayEl.innerHTML = '';

    // Render Sticky Notes
    for (const note of page.stickyNotes) {
      const noteEl = document.createElement('div');
      noteEl.className = 'sticky-note';
      noteEl.style.left = `${note.x * zoom}px`;
      noteEl.style.top = `${note.y * zoom}px`;
      noteEl.style.width = `${(note.width || 180) * zoom}px`;
      noteEl.style.minHeight = `${(note.height || 160) * zoom}px`;
      noteEl.style.backgroundColor = note.color || '#fef08a';

      noteEl.innerHTML = `
        <div class="sticky-header">
          <div class="sticky-color-dot" style="background:#fef08a" title="Change Color"></div>
          <button class="sticky-close-btn" title="Delete Note">&times;</button>
        </div>
        <textarea class="sticky-textarea" placeholder="Write a note...">${note.text || ''}</textarea>
      `;

      // Event bindings for note
      const textarea = noteEl.querySelector('.sticky-textarea');
      textarea.addEventListener('input', () => {
        note.text = textarea.value;
        this.scheduleSave();
      });

      const closeBtn = noteEl.querySelector('.sticky-close-btn');
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.pushUndoSnapshot();
        page.stickyNotes = page.stickyNotes.filter(n => n.id !== note.id);
        this.renderDomOverlayForPage(page, overlayEl, zoom);
        this.scheduleSave();
      });

      // Draggable sticky note
      this.makeDraggable(noteEl, note, zoom);

      overlayEl.appendChild(noteEl);
    }

    // Render Text Boxes
    for (const tb of page.textBoxes) {
      const tbEl = document.createElement('div');
      tbEl.className = 'annotation-textbox';
      tbEl.contentEditable = 'true';
      tbEl.spellcheck = false;
      tbEl.style.left = `${tb.x * zoom}px`;
      tbEl.style.top = `${tb.y * zoom}px`;
      tbEl.style.fontSize = `${(tb.fontSize || 16) * zoom}px`;
      tbEl.style.color = tb.color || this.activeColor;
      tbEl.innerText = tb.text || '';

      tbEl.addEventListener('input', () => {
        tb.text = tbEl.innerText;
        this.scheduleSave();
      });

      tbEl.addEventListener('blur', () => {
        if (!tb.text.trim()) {
          page.textBoxes = page.textBoxes.filter(t => t.id !== tb.id);
          this.renderDomOverlayForPage(page, overlayEl, zoom);
        }
      });

      this.makeDraggable(tbEl, tb, zoom);
      overlayEl.appendChild(tbEl);
    }

    // Render Images
    if (page.images && page.images.length > 0) {
      for (const img of page.images) {
        const cardEl = document.createElement('div');
        const isSelected = this.selectedImageId === img.id;
        cardEl.className = 'canvas-image-card' + (isSelected ? ' selected' : '');
        cardEl.dataset.id = img.id;
        cardEl.style.left = `${img.x * zoom}px`;
        cardEl.style.top = `${img.y * zoom}px`;
        cardEl.style.width = `${img.width * zoom}px`;
        cardEl.style.height = `${img.height * zoom}px`;

        cardEl.innerHTML = `
          <img class="canvas-image-content" src="${img.dataUrl || img.src}" alt="Inserted image" draggable="false">
          <div class="image-actions-bar">
            <button class="image-action-btn delete-btn" title="Delete Image (Del)">&times;</button>
          </div>
          <div class="image-resize-handle" title="Drag to resize"></div>
        `;

        // Selection on pointer down
        cardEl.addEventListener('pointerdown', (e) => {
          if (e.target.classList.contains('delete-btn') || e.target.classList.contains('image-resize-handle')) {
            return;
          }
          e.stopPropagation();
          this.selectImage(img.id);
        });

        // Delete button
        const delBtn = cardEl.querySelector('.delete-btn');
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.deleteImage(img.id);
        });

        // Draggable
        this.makeImageDraggable(cardEl, img, zoom);

        // Resizable
        const resizeHandle = cardEl.querySelector('.image-resize-handle');
        this.makeImageResizable(cardEl, resizeHandle, img, zoom);

        overlayEl.appendChild(cardEl);
      }
    }
  }

  selectImage(imageId) {
    this.selectedImageId = imageId;
    const allCards = this.dom.domOverlay.querySelectorAll('.canvas-image-card');
    allCards.forEach(card => {
      if (card.dataset.id === imageId) {
        card.classList.add('selected');
      } else {
        card.classList.remove('selected');
      }
    });
  }

  deleteImage(imageId) {
    const page = this.getCurrentPage();
    if (!page || !page.images) return;
    this.pushUndoSnapshot();
    page.images = page.images.filter(img => img.id !== imageId);
    if (this.selectedImageId === imageId) {
      this.selectedImageId = null;
    }
    this.renderDomOverlay(page, this.coord.zoom);
    this.scheduleSave();
    this.showToast('Image deleted');
  }

  deleteSelectedImage() {
    if (this.selectedImageId) {
      this.deleteImage(this.selectedImageId);
    }
  }

  makeImageDraggable(element, imgData, zoom) {
    let startX = 0, startY = 0;
    let initialX = 0, initialY = 0;
    let didMove = false;

    element.addEventListener('pointerdown', (e) => {
      if (e.target.classList.contains('delete-btn') || e.target.classList.contains('image-resize-handle')) {
        return;
      }
      e.stopPropagation();
      startX = e.clientX;
      startY = e.clientY;
      initialX = imgData.x;
      initialY = imgData.y;
      didMove = false;

      element.classList.add('dragging');
      this.selectImage(imgData.id);

      const onPointerMove = (moveEvent) => {
        const dx = (moveEvent.clientX - startX) / zoom;
        const dy = (moveEvent.clientY - startY) / zoom;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) didMove = true;
        imgData.x = Math.round(initialX + dx);
        imgData.y = Math.round(initialY + dy);
        element.style.left = `${imgData.x * zoom}px`;
        element.style.top = `${imgData.y * zoom}px`;
      };

      const onPointerUp = () => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        element.classList.remove('dragging');
        if (didMove) {
          this.pushUndoSnapshot();
          this.scheduleSave();
        }
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    });
  }

  makeImageResizable(element, handleEl, imgData, zoom) {
    let startClientX = 0, startClientY = 0;
    let initialWidth = 0, initialHeight = 0;
    const aspectRatio = imgData.aspectRatio || (imgData.width / imgData.height) || 1.0;
    let didResize = false;

    handleEl.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      startClientX = e.clientX;
      startClientY = e.clientY;
      initialWidth = imgData.width;
      initialHeight = imgData.height;
      didResize = false;

      const onPointerMove = (moveEvent) => {
        const dx = (moveEvent.clientX - startClientX) / zoom;
        let newWidth = Math.max(40, initialWidth + dx);
        let newHeight = newWidth / aspectRatio;

        if (newHeight < 30) {
          newHeight = 30;
          newWidth = newHeight * aspectRatio;
        }

        if (Math.abs(newWidth - initialWidth) > 2) didResize = true;

        imgData.width = Math.round(newWidth);
        imgData.height = Math.round(newHeight);
        element.style.width = `${imgData.width * zoom}px`;
        element.style.height = `${imgData.height * zoom}px`;
      };

      const onPointerUp = () => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        if (didResize) {
          this.pushUndoSnapshot();
          this.scheduleSave();
        }
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    });
  }

  async handlePasteEvent(e) {
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
      return;
    }

    const clipboardData = e.clipboardData || window.clipboardData;
    if (!clipboardData) return;

    const items = clipboardData.items;
    let imageFile = null;

    if (items && items.length > 0) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type && item.type.indexOf('image') !== -1) {
          imageFile = item.getAsFile();
          if (imageFile) break;
        }
      }
    }

    if (!imageFile && clipboardData.files && clipboardData.files.length > 0) {
      for (let i = 0; i < clipboardData.files.length; i++) {
        const file = clipboardData.files[i];
        if (file.type && file.type.startsWith('image/')) {
          imageFile = file;
          break;
        }
      }
    }

    if (imageFile) {
      e.preventDefault();
      await this.insertImageFile(imageFile);
    }
  }

  async insertImageFile(file, position = null) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target.result;
        const img = new Image();
        img.onload = () => {
          const page = this.getCurrentPage();
          if (!page) {
            resolve(null);
            return;
          }

          if (!page.images) {
            page.images = [];
          }

          const naturalWidth = img.naturalWidth || img.width || 300;
          const naturalHeight = img.naturalHeight || img.height || 300;
          const aspectRatio = naturalWidth / naturalHeight;

          let targetWidth = Math.min(440, page.width * 0.65, naturalWidth);
          let targetHeight = targetWidth / aspectRatio;

          let targetX, targetY;
          if (position) {
            targetX = position.x - targetWidth / 2;
            targetY = position.y - targetHeight / 2;
          } else {
            const vpRect = this.dom.canvasViewport.getBoundingClientRect();
            const centerX = vpRect.left + vpRect.width / 2;
            const centerY = vpRect.top + vpRect.height / 2;
            const docCenter = this.coord.screenToDoc(centerX, centerY, this.dom.pageWrapper);
            targetX = docCenter.x - targetWidth / 2;
            targetY = docCenter.y - targetHeight / 2;
          }

          targetX = Math.max(20, Math.min(page.width - targetWidth - 20, targetX));
          targetY = Math.max(20, Math.min(page.height - targetHeight - 20, targetY));

          const newImage = {
            id: 'img_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 5),
            x: Math.round(targetX),
            y: Math.round(targetY),
            width: Math.round(targetWidth),
            height: Math.round(targetHeight),
            naturalWidth,
            naturalHeight,
            aspectRatio,
            src: dataUrl,
            dataUrl: dataUrl
          };

          this.pushUndoSnapshot();
          page.images.push(newImage);
          this.selectedImageId = newImage.id;
          this.renderDomOverlay(page, this.coord.zoom);
          this.scheduleSave();
          this.showToast('Image pasted into page');
          resolve(newImage);
        };
        img.onerror = (err) => {
          this.showToast('Failed to load image');
          reject(err);
        };
        img.src = dataUrl;
      };
      reader.onerror = (err) => {
        this.showToast('Failed to read image file');
        reject(err);
      };
      reader.readAsDataURL(file);
    });
  }

  drawImageToCtx(ctx, imgData) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, imgData.x, imgData.y, imgData.width, imgData.height);
        resolve(true);
      };
      img.onerror = () => resolve(false);
      img.src = imgData.dataUrl || imgData.src;
    });
  }

  makeDraggable(element, dataObj, zoom) {
    let startX = 0, startY = 0;
    let initialX = 0, initialY = 0;

    element.addEventListener('pointerdown', (e) => {
      if (e.target.tagName === 'TEXTAREA' || e.target.classList.contains('sticky-close-btn')) {
        return; // Allow text editing without dragging
      }
      e.stopPropagation();
      startX = e.clientX;
      startY = e.clientY;
      initialX = dataObj.x;
      initialY = dataObj.y;

      const onPointerMove = (moveEvent) => {
        const dx = (moveEvent.clientX - startX) / zoom;
        const dy = (moveEvent.clientY - startY) / zoom;
        dataObj.x = initialX + dx;
        dataObj.y = initialY + dy;
        element.style.left = `${dataObj.x * zoom}px`;
        element.style.top = `${dataObj.y * zoom}px`;
      };

      const onPointerUp = () => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        this.scheduleSave();
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    });
  }

  createTextBoxAt(docX, docY) {
    this.pushUndoSnapshot();
    const page = this.getCurrentPage();
    const newTb = {
      id: 'tb_' + Date.now().toString(36),
      x: docX,
      y: docY,
      fontSize: 16,
      color: this.activeColor,
      text: ''
    };
    page.textBoxes.push(newTb);
    this.renderDomOverlay(page, this.coord.zoom);

    // Focus newly created element
    setTimeout(() => {
      const els = this.dom.domOverlay.querySelectorAll('.annotation-textbox');
      const latest = els[els.length - 1];
      if (latest) latest.focus();
    }, 50);
  }

  createStickyNoteAt(docX, docY) {
    this.pushUndoSnapshot();
    const page = this.getCurrentPage();
    const colors = ['#fef08a', '#bbf7d0', '#fed7aa', '#bae6fd', '#fbcfe8'];
    const chosenColor = colors[page.stickyNotes.length % colors.length];

    const newNote = {
      id: 'note_' + Date.now().toString(36),
      x: docX - 90,
      y: docY - 40,
      width: 180,
      height: 160,
      color: chosenColor,
      text: ''
    };
    page.stickyNotes.push(newNote);
    this.renderDomOverlay(page, this.coord.zoom);
    this.scheduleSave();
  }

  /**
   * Lasso Selection Box & Floating Action Toolbar
   */
  renderLassoSelectionBox() {
    this.dom.lassoCtx.clearRect(0, 0, this.dom.lassoCanvas.width, this.dom.lassoCanvas.height);
    if (!this.selectionBox) return;

    this.lassoEngine.drawSelectionBox(this.dom.lassoCtx, this.selectionBox);
  }

  showLassoToolbar() {
    this.removeLassoToolbar();
    if (!this.selectionBox) return;

    const zoom = this.coord.zoom;
    const toolbar = document.createElement('div');
    toolbar.className = 'lasso-toolbar';
    toolbar.id = 'activeLassoToolbar';
    toolbar.style.left = `${this.selectionBox.centerX * zoom}px`;
    toolbar.style.top = `${this.selectionBox.minY * zoom}px`;

    toolbar.innerHTML = `
      <button class="lasso-toolbar-btn" id="btnDuplicateSelection" title="Duplicate">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        <span>Duplicate</span>
      </button>
      <button class="lasso-toolbar-btn" id="btnRecolorSelection" title="Change Color">
        <span class="palette-dot" style="width:14px;height:14px;display:inline-block;background:${this.activeColor}"></span>
        <span>Color</span>
      </button>
      <button class="lasso-toolbar-btn danger" id="btnDeleteSelection" title="Delete">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
        <span>Delete</span>
      </button>
    `;

    // Duplicate
    toolbar.querySelector('#btnDuplicateSelection').addEventListener('click', (e) => {
      e.stopPropagation();
      this.pushUndoSnapshot();
      const page = this.getCurrentPage();
      const { clonedStrokes, clonedShapes } = this.lassoEngine.duplicateItems(this.selectedStrokes, this.selectedShapes, 25);
      page.strokes.push(...clonedStrokes);
      page.shapes.push(...clonedShapes);
      this.selectedStrokes = clonedStrokes;
      this.selectedShapes = clonedShapes;
      this.selectionBox = this.lassoEngine.computeBoundingBox(this.selectedStrokes, this.selectedShapes);
      this.renderVectorCanvas();
      this.renderLassoSelectionBox();
      this.showLassoToolbar();
      this.scheduleSave();
      this.showToast('Duplicated selection');
    });

    // Re-color
    toolbar.querySelector('#btnRecolorSelection').addEventListener('click', (e) => {
      e.stopPropagation();
      this.pushUndoSnapshot();
      for (const s of this.selectedStrokes) {
        s.color = this.activeColor;
      }
      for (const sh of this.selectedShapes) {
        sh.color = this.activeColor;
      }
      this.renderVectorCanvas();
      this.renderLassoSelectionBox();
      this.showToast('Applied color to selection');
      this.scheduleSave();
    });

    // Delete
    toolbar.querySelector('#btnDeleteSelection').addEventListener('click', (e) => {
      e.stopPropagation();
      this.deleteLassoSelection();
    });

    this.dom.domOverlay.appendChild(toolbar);
  }

  removeLassoToolbar() {
    const existing = document.getElementById('activeLassoToolbar');
    if (existing) existing.remove();
    document.querySelectorAll('.lasso-toolbar').forEach(el => el.remove());
  }

  clearLassoSelection() {
    this.selectedStrokes = [];
    this.selectedShapes = [];
    this.selectionBox = null;
    this.lassoPoints = [];
    this.dom.lassoCtx.clearRect(0, 0, this.dom.lassoCanvas.width, this.dom.lassoCanvas.height);
    this.removeLassoToolbar();
  }

  deleteLassoSelection() {
    this.pushUndoSnapshot();
    const page = this.getCurrentPage();
    const strokeIds = new Set(this.selectedStrokes.map(s => s.id));
    const shapeIds = new Set(this.selectedShapes.map(sh => sh.id));

    page.strokes = page.strokes.filter(s => !strokeIds.has(s.id));
    page.shapes = page.shapes.filter(sh => !shapeIds.has(sh.id));

    this.clearLassoSelection();
    this.renderVectorCanvas();
    this.renderThumbnailsSidebar();
    this.scheduleSave();
    this.showToast('Deleted selected items');
  }

  isPointInAABB(p, box) {
    return p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY;
  }

  /**
   * Thumbnails Sidebar List Generation with Drag-and-Drop Page Reordering
   */
  async renderThumbnailsSidebar() {
    const list = this.dom.thumbnailsList;
    if (!list) return;
    list.innerHTML = '';
    if (this.dom.sidebarPageCount) {
      this.dom.sidebarPageCount.innerText = this.notebook.pages.length;
    }

    for (let i = 0; i < this.notebook.pages.length; i++) {
      const page = this.notebook.pages[i];
      const isActive = i === this.notebook.currentPageIndex;

      const item = document.createElement('div');
      item.className = `thumb-item ${isActive ? 'active' : ''}`;
      item.dataset.index = i;
      item.setAttribute('draggable', 'true');

      item.innerHTML = `
        <div class="thumb-card">
          ${page.isBookmarked ? `
            <div class="thumb-bookmark-badge" title="Bookmarked Page">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            </div>
          ` : ''}
          <canvas class="thumb-preview-img" width="130" height="184"></canvas>
          <div class="thumb-actions">
            <button class="thumb-action-btn btn-duplicate-page" title="Duplicate Page">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
            <button class="thumb-action-btn btn-delete-page" title="Delete Page">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
            </button>
          </div>
        </div>
        <div class="thumb-label">Page ${page.pageNumber}</div>
      `;

      // Render thumbnail preview onto canvas
      const canvas = item.querySelector('.thumb-preview-img');
      this.drawMiniThumbnail(canvas, page);

      // Click to switch page
      item.addEventListener('click', (e) => {
        if (!e.target.closest('.thumb-action-btn')) {
          this.switchPage(i);
        }
      });

      // Duplicate button
      item.querySelector('.btn-duplicate-page').addEventListener('click', (e) => {
        e.stopPropagation();
        this.duplicatePage(i);
      });

      // Delete button
      item.querySelector('.btn-delete-page').addEventListener('click', (e) => {
        e.stopPropagation();
        this.deletePage(i);
      });

      // HTML5 Drag and Drop for Page Reordering
      item.addEventListener('dragstart', (e) => {
        this.draggedThumbnailIndex = i;
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', i.toString());
      });

      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const rect = item.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (e.clientY < midY) {
          item.classList.add('drag-over-top');
          item.classList.remove('drag-over-bottom');
        } else {
          item.classList.add('drag-over-bottom');
          item.classList.remove('drag-over-top');
        }
      });

      item.addEventListener('dragleave', () => {
        item.classList.remove('drag-over-top', 'drag-over-bottom');
      });

      item.addEventListener('drop', (e) => {
        e.preventDefault();
        item.classList.remove('drag-over-top', 'drag-over-bottom');
        const fromIdx = this.draggedThumbnailIndex !== null ? this.draggedThumbnailIndex : parseInt(e.dataTransfer.getData('text/plain'), 10);
        if (isNaN(fromIdx) || fromIdx === i) return;

        const rect = item.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        let toIdx = e.clientY < midY ? i : i + 1;
        if (fromIdx < toIdx) {
          toIdx--;
        }
        this.reorderPages(fromIdx, toIdx);
      });

      item.addEventListener('dragend', () => {
        item.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom');
        this.draggedThumbnailIndex = null;
      });

      list.appendChild(item);
    }
  }

  /**
   * Ultra-fast debounced update of ONLY the active page's thumbnail canvas
   */
  updateCurrentThumbnailDebounced() {
    if (this.thumbRafId) return;
    this.thumbRafId = requestAnimationFrame(() => {
      this.thumbRafId = null;
      const activeItem = this.dom.thumbnailsList.querySelector(`.thumb-item[data-index="${this.notebook.currentPageIndex}"]`);
      if (activeItem) {
        const canvas = activeItem.querySelector('.thumb-preview-img');
        if (canvas) {
          this.drawMiniThumbnail(canvas, this.getCurrentPage());
        }
      }
    });
  }

  drawMiniThumbnail(canvas, page) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const scale = Math.min(w / page.width, h / page.height);
    ctx.save();
    ctx.scale(scale, scale);

    // Draw background
    if (page.template === 'pdf' && page.pdfPageNumber && this.pdfManager.thumbnailCache.has(page.pdfPageNumber)) {
      const img = new Image();
      img.src = this.pdfManager.thumbnailCache.get(page.pdfPageNumber);
      ctx.drawImage(img, 0, 0, page.width, page.height);
    } else {
      this.templateDrawer.drawTemplate(ctx, page.template, page.paperColor, page.width, page.height);
    }

    // Draw strokes
    for (const s of page.strokes) {
      this.strokeEngine.renderStroke(ctx, s);
    }
    for (const sh of page.shapes) {
      this.shapeRecognizer.drawSnappedShape(ctx, sh, sh.color, sh.lineWidth);
    }

    ctx.restore();
  }

  /**
   * Page Management Navigation
   */
  getCurrentPage() {
    if (!this.notebook || !this.notebook.pages) return null;
    return this.notebook.pages[this.notebook.currentPageIndex];
  }

  switchPage(index, smoothScroll = true) {
    if (!this.notebook || !this.notebook.pages) return;
    if (index < 0 || index >= this.notebook.pages.length) return;
    this.clearLassoSelection();
    this.setActivePage(index, smoothScroll);
    this.coord.invalidateCache();
  }

  goToPrevPage() {
    if (!this.notebook || !this.notebook.pages) return;
    if (this.notebook.currentPageIndex > 0) {
      this.switchPage(this.notebook.currentPageIndex - 1, true);
    }
  }

  goToNextPage() {
    if (!this.notebook || !this.notebook.pages) return;
    if (this.notebook.currentPageIndex < this.notebook.pages.length - 1) {
      this.switchPage(this.notebook.currentPageIndex + 1, true);
    }
  }

  updatePageCounter() {
    if (!this.notebook || !this.notebook.pages) {
      if (this.dom.currentPageNum) this.dom.currentPageNum.innerText = '1';
      if (this.dom.totalPagesNum) this.dom.totalPagesNum.innerText = '1';
      if (this.dom.miniCurrentPageNum) this.dom.miniCurrentPageNum.innerText = '1';
      if (this.dom.miniTotalPagesNum) this.dom.miniTotalPagesNum.innerText = '1';
      if (this.dom.btnPrevPage) this.dom.btnPrevPage.disabled = true;
      if (this.dom.btnNextPage) this.dom.btnNextPage.disabled = true;
      if (this.dom.btnMiniPrevPage) this.dom.btnMiniPrevPage.disabled = true;
      if (this.dom.btnMiniNextPage) this.dom.btnMiniNextPage.disabled = true;
      return;
    }
    const cur = (this.notebook.currentPageIndex + 1).toString();
    const total = (this.notebook.pages.length).toString();
    const isFirst = this.notebook.currentPageIndex === 0;
    const isLast = this.notebook.currentPageIndex === this.notebook.pages.length - 1;

    if (this.dom.currentPageNum) this.dom.currentPageNum.innerText = cur;
    if (this.dom.totalPagesNum) this.dom.totalPagesNum.innerText = total;
    if (this.dom.miniCurrentPageNum) this.dom.miniCurrentPageNum.innerText = cur;
    if (this.dom.miniTotalPagesNum) this.dom.miniTotalPagesNum.innerText = total;

    if (this.dom.btnPrevPage) this.dom.btnPrevPage.disabled = isFirst;
    if (this.dom.btnNextPage) this.dom.btnNextPage.disabled = isLast;
    if (this.dom.btnMiniPrevPage) this.dom.btnMiniPrevPage.disabled = isFirst;
    if (this.dom.btnMiniNextPage) this.dom.btnMiniNextPage.disabled = isLast;
  }

  updateThumbnailsActiveState() {
    const items = this.dom.thumbnailsList.querySelectorAll('.thumb-item');
    items.forEach((item, idx) => {
      item.classList.toggle('active', idx === this.notebook.currentPageIndex);
    });
  }

  openTemplateModal() {
    this.dom.templateModal.classList.remove('hidden');
  }

  closeTemplateModal() {
    this.dom.templateModal.classList.add('hidden');
  }

  confirmAddPage() {
    const activeTemplateCard = document.querySelector('.template-card.active');
    const activeColorChoice = document.querySelector('.color-choice.active');
    const activeOrientChoice = document.querySelector('.segment-btn.active');

    const template = activeTemplateCard ? activeTemplateCard.dataset.template : 'ruled';
    const paperColor = activeColorChoice ? activeColorChoice.dataset.color : 'cream';
    const orientation = activeOrientChoice ? activeOrientChoice.dataset.orient : 'portrait';

    let width = 794;
    let height = 1123;
    if (orientation === 'landscape') {
      width = 1123;
      height = 794;
    }

    const newPageNum = this.notebook.pages.length + 1;
    const newPage = this.createDefaultPage(newPageNum, template, paperColor, width, height);

    this.pushUndoSnapshot();
    this.notebook.pages.push(newPage);
    this.closeTemplateModal();
    this.switchPage(this.notebook.pages.length - 1);
    this.renderThumbnailsSidebar();
    this.scheduleSave();
    this.showToast(`Page ${newPageNum} added (${template})`);
  }

  duplicatePage(index) {
    this.pushUndoSnapshot();
    const source = this.notebook.pages[index];
    const clone = JSON.parse(JSON.stringify(source));
    clone.pageNumber = this.notebook.pages.length + 1;
    this.notebook.pages.splice(index + 1, 0, clone);
    this.renumberPages();
    this.switchPage(index + 1);
    this.renderThumbnailsSidebar();
    this.scheduleSave();
    this.showToast(`Page duplicated`);
  }

  deletePage(index) {
    if (this.notebook.pages.length <= 1) {
      this.showToast('Notebook must have at least one page');
      return;
    }
    if (confirm(`Delete page ${index + 1}?`)) {
      this.pushUndoSnapshot();
      this.notebook.pages.splice(index, 1);
      this.renumberPages();
      const nextIndex = Math.min(index, this.notebook.pages.length - 1);
      this.switchPage(nextIndex);
      this.renderThumbnailsSidebar();
      this.scheduleSave();
      this.showToast('Page deleted');
    }
  }

  renumberPages() {
    this.notebook.pages.forEach((p, idx) => {
      p.pageNumber = idx + 1;
    });
  }

  /**
   * Reorders pages via Drag & Drop or Page Management
   */
  reorderPages(fromIndex, toIndex) {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= this.notebook.pages.length || toIndex >= this.notebook.pages.length) return;

    this.pushUndoSnapshot();

    const [movedPage] = this.notebook.pages.splice(fromIndex, 1);
    this.notebook.pages.splice(toIndex, 0, movedPage);

    // Renumber all pages sequentially
    this.renumberPages();

    // Adjust active page index
    if (this.notebook.currentPageIndex === fromIndex) {
      this.notebook.currentPageIndex = toIndex;
    } else if (fromIndex < this.notebook.currentPageIndex && toIndex >= this.notebook.currentPageIndex) {
      this.notebook.currentPageIndex--;
    } else if (fromIndex > this.notebook.currentPageIndex && toIndex <= this.notebook.currentPageIndex) {
      this.notebook.currentPageIndex++;
    }

    this.renderCurrentPage();
    this.renderThumbnailsSidebar();
    this.renderBookmarksList();
    this.updatePageCounter();
    this.scheduleSave();
    this.showToast(`Moved Page ${fromIndex + 1} to position ${toIndex + 1}`);
  }

  /**
   * Toggles bookmark state on a specific page
   */
  togglePageBookmark(pageIndex) {
    if (pageIndex < 0 || pageIndex >= this.notebook.pages.length) return;
    const page = this.notebook.pages[pageIndex];
    page.isBookmarked = !page.isBookmarked;

    const ribbonBtn = document.getElementById(`btnPageBookmark_${pageIndex}`);
    if (ribbonBtn) {
      ribbonBtn.classList.toggle('bookmarked', page.isBookmarked);
      ribbonBtn.title = page.isBookmarked ? 'Remove Bookmark' : 'Bookmark Page';
    }

    this.renderThumbnailsSidebar();
    this.renderBookmarksList();
    this.scheduleSave();
    this.showToast(page.isBookmarked ? `Page ${page.pageNumber} bookmarked` : `Page ${page.pageNumber} bookmark removed`);
  }

  /**
   * Renders the filtered list of bookmarked pages in the Bookmarks Tab
   */
  renderBookmarksList() {
    if (!this.dom.bookmarksList) return;
    const list = this.dom.bookmarksList;
    list.innerHTML = '';
    const bookmarkedPages = [];
    this.notebook.pages.forEach((p, idx) => {
      if (p.isBookmarked) bookmarkedPages.push({ page: p, index: idx });
    });

    if (this.dom.sidebarBookmarkCount) {
      this.dom.sidebarBookmarkCount.innerText = bookmarkedPages.length;
    }

    if (bookmarkedPages.length === 0) {
      list.innerHTML = `
        <div class="bookmark-empty-state">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          <p><strong>No bookmarks yet</strong></p>
          <p>Click the red bookmark ribbon at the top right of any page to bookmark it for fast reference.</p>
        </div>
      `;
      return;
    }

    bookmarkedPages.forEach(({ page, index }) => {
      const card = document.createElement('div');
      card.className = `bookmark-card ${index === this.notebook.currentPageIndex ? 'active' : ''}`;
      card.innerHTML = `
        <canvas class="bookmark-mini-thumb" width="42" height="56"></canvas>
        <div class="bookmark-card-info">
          <div class="bookmark-card-title">Page ${page.pageNumber}</div>
          <div class="bookmark-card-sub">${page.template === 'pdf' ? 'PDF Document' : (page.template + ' template')}</div>
        </div>
        <button class="bookmark-remove-btn" title="Remove bookmark" data-index="${index}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
        </button>
      `;

      const miniCanvas = card.querySelector('.bookmark-mini-thumb');
      this.drawMiniThumbnail(miniCanvas, page);

      card.addEventListener('click', (e) => {
        if (!e.target.closest('.bookmark-remove-btn')) {
          this.switchPage(index);
        }
      });

      card.querySelector('.bookmark-remove-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        this.togglePageBookmark(index);
      });

      list.appendChild(card);
    });
  }

  /**
   * Renders the Document Table of Contents / Outline
   */
  renderOutlineList() {
    if (!this.dom.outlineList) return;
    const list = this.dom.outlineList;
    list.innerHTML = '';

    const outline = this.notebook.outline || [];
    if (!outline || outline.length === 0) {
      list.innerHTML = `
        <div class="outline-empty-state">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
          <p><strong>No outline available</strong></p>
          <p>This notebook does not contain an embedded PDF table of contents.</p>
        </div>
      `;
      return;
    }

    const renderItems = (items, depth = 0) => {
      items.forEach(item => {
        const row = document.createElement('div');
        row.className = `outline-item depth-${Math.min(depth, 3)}`;
        row.innerHTML = `
          <span class="outline-item-title" title="${item.title}">${item.title}</span>
          <span class="outline-item-page">p. ${item.pageNumber}</span>
        `;
        row.addEventListener('click', () => {
          const targetIndex = item.pageNumber - 1;
          if (targetIndex >= 0 && targetIndex < this.notebook.pages.length) {
            this.switchPage(targetIndex);
          }
        });
        list.appendChild(row);

        if (item.items && item.items.length > 0) {
          renderItems(item.items, depth + 1);
        }
      });
    };

    renderItems(outline, 0);
  }

  /**
   * Switches the active tab in the thumbnails sidebar
   */
  switchSidebarTab(tabName) {
    this.sidebarActiveTab = tabName;
    const tabs = ['thumbnails', 'bookmarks', 'outline'];
    tabs.forEach(tab => {
      const btn = document.getElementById(`tabBtn${tab.charAt(0).toUpperCase() + tab.slice(1)}`);
      const panel = document.getElementById(`tabPanel${tab.charAt(0).toUpperCase() + tab.slice(1)}`);
      if (btn) btn.classList.toggle('active', tab === tabName);
      if (panel) {
        panel.classList.toggle('active', tab === tabName);
        panel.classList.toggle('hidden', tab !== tabName);
      }
    });

    if (tabName === 'thumbnails') {
      this.renderThumbnailsSidebar();
    } else if (tabName === 'bookmarks') {
      this.renderBookmarksList();
    } else if (tabName === 'outline') {
      this.renderOutlineList();
    }
  }

  /**
   * Sets document view mode (enforced to continuous vertical scroll)
   */
  setViewMode(mode = 'vertical') {
    this.viewMode = 'vertical';
    this.notebook.viewMode = 'vertical';
    if (this.dom.pagesContainer) {
      this.dom.pagesContainer.classList.remove('single-page-mode');
    }
    this.updatePageCounter();
  }

  toggleViewMode() {
    this.setViewMode('vertical');
  }

  /**
   * Animates glowing presenter laser pointer with decaying trail
   */
  startLaserAnimation() {
    if (this.laserAnimRunning) return;
    this.laserAnimRunning = true;
    const animate = () => {
      if (!this.laserAnimRunning) return;
      const now = Date.now();
      // Keep points younger than 900ms
      this.laserPoints = (this.laserPoints || []).filter(p => now - p.time < 900);

      if (this.dom.activeCtx && this.dom.activeCanvas) {
        this.dom.activeCtx.clearRect(0, 0, this.dom.activeCanvas.width, this.dom.activeCanvas.height);

        if (this.laserPoints.length > 0) {
          const ctx = this.dom.activeCtx;
          ctx.save();
          ctx.shadowColor = '#ef4444';
          ctx.shadowBlur = 12;

          for (let i = 1; i < this.laserPoints.length; i++) {
            const p0 = this.laserPoints[i - 1];
            const p1 = this.laserPoints[i];
            const age = now - p1.time;
            const alpha = Math.max(0, 1 - age / 900);
            ctx.beginPath();
            ctx.moveTo(p0.x, p0.y);
            ctx.lineTo(p1.x, p1.y);
            ctx.strokeStyle = `rgba(239, 68, 68, ${alpha * 0.8})`;
            ctx.lineWidth = Math.max(2, alpha * 6);
            ctx.lineCap = 'round';
            ctx.stroke();
          }

          const head = this.laserPoints[this.laserPoints.length - 1];
          if (head) {
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(head.x, head.y, 4, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = 'rgba(239, 68, 68, 0.9)';
            ctx.beginPath();
            ctx.arc(head.x, head.y, 8, 0, Math.PI * 2);
            ctx.fill();
          }

          ctx.restore();
          requestAnimationFrame(animate);
        } else {
          this.laserAnimRunning = false;
        }
      } else {
        this.laserAnimRunning = false;
      }
    };
    requestAnimationFrame(animate);
  }

  /**
   * PDF Document Import
   */
  async _triggerPdfImport() {
    if (this.storage.isElectron) {
      const result = await this.storage.openPdfDialog();
      if (!result) return;
      try {
        const bytes = Uint8Array.from(atob(result.base64), c => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: 'application/pdf' });
        // Give blob a name property so handlePdfImport can read file.name
        Object.defineProperty(blob, 'name', { value: result.name });
        await this.handlePdfImport(blob);
      } catch (err) {
        console.error('Electron PDF import failed:', err);
        this.showToast('PDF import failed: ' + err.message);
      }
    } else {
      this.dom.pdfFileInput.click();
    }
  }

  async handlePdfImport(file) {
    try {
      this.showToast('Loading PDF document...');
      const result = await this.pdfManager.loadPdf(file);

      // Create pages matching the PDF structure
      const newPages = [];
      for (let i = 1; i <= result.pageCount; i++) {
        const info = this.pdfManager.getPageInfo(i);
        const p = this.createDefaultPage(i, 'pdf', 'white', info.width, info.height, i);
        newPages.push(p);
      }

      // Extract outline from PDF
      let outline = [];
      try {
        outline = await this.pdfManager.getOutline();
      } catch (outlineErr) {
        console.warn('Could not extract PDF outline:', outlineErr);
      }

      const newId = 'notebook_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 4);
      this.notebook = {
        id: newId,
        title: file.name.replace(/\.[^/.]+$/, ""),
        coverTheme: 'pdf',
        isFavorite: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        currentPageIndex: 0,
        pdfSource: this.pdfManager.rawArrayBuffer,
        outline: outline,
        viewMode: 'vertical',
        pages: newPages
      };

      this.undoStack = [];
      this.redoStack = [];

      this.updateDocTitleDisplay(this.notebook.title);
      this.showEditorView();
      this.renderCurrentPage();
      this.renderThumbnailsSidebar();
      this.renderBookmarksList();
      this.renderOutlineList();
      this.updatePageCounter();
      this.updateHistoryButtons();
      await this.saveImmediately();
      this.showToast(`Imported "${file.name}" (${result.pageCount} pages)`);
    } catch (err) {
      console.error('PDF Import Error:', err);
      this.showToast('Failed to load PDF: ' + err.message);
    }
  }

  /**
   * .gnotes Project File Import
   */
  handleProjectImport(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const imported = JSON.parse(e.target.result);
        if (imported.pages && imported.pages.length > 0) {
          this.notebook = imported;
          this.updateDocTitleDisplay(imported.title || 'Imported Notebook');
          this.renderCurrentPage();
          this.renderThumbnailsSidebar();
          this.updatePageCounter();
          this.scheduleSave();
          this.showToast('Imported project successfully');
        } else {
          this.showToast('Invalid project file format');
        }
      } catch (err) {
        this.showToast('Failed to parse project file');
      }
    };
    reader.readAsText(file);
  }

  /**
   * Composite Canvas Renderer (Used for Full-Resolution PDF & PNG Export)
   */
  async renderPageCompositeCanvas(pageIndex) {
    const page = this.notebook.pages[pageIndex];
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = page.width;
    exportCanvas.height = page.height;
    const ctx = exportCanvas.getContext('2d');

    // 1. Background (PDF or Template)
    if (page.template === 'pdf' && page.pdfPageNumber) {
      await this.pdfManager.renderPageToCanvas(page.pdfPageNumber, exportCanvas, page.width, page.height);
    } else {
      this.templateDrawer.drawTemplate(ctx, page.template, page.paperColor, page.width, page.height);
    }

    // 2. Images (under vector strokes, on top of page background)
    if (page.images && page.images.length > 0) {
      for (const img of page.images) {
        await this.drawImageToCtx(ctx, img);
      }
    }

    // 3. Vector Strokes & Shapes
    for (const s of page.strokes) {
      this.strokeEngine.renderStroke(ctx, s);
    }
    for (const sh of page.shapes) {
      this.shapeRecognizer.drawSnappedShape(ctx, sh, sh.color, sh.lineWidth);
    }

    // 3. Sticky Notes
    for (const note of page.stickyNotes) {
      this.storage.drawStickyNoteToCtx(ctx, note, 1.0);
    }

    // 4. Text Boxes
    for (const tb of page.textBoxes) {
      this.storage.drawTextBoxToCtx(ctx, tb, 1.0);
    }

    return exportCanvas;
  }

  /**
   * Tool, Color & Width Setters with Per-Tool Memory
   */
  setActiveTool(tool) {
    this.activeTool = tool;
    this.dom.toolButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    });

    if (tool !== 'lasso') {
      this.clearLassoSelection();
    }

    if (tool === 'pan') {
      this.dom.canvasViewport.classList.add('panning');
    } else {
      this.dom.canvasViewport.classList.remove('panning');
    }

    // Restore remembered thickness for this tool & sync ribbon pills and slider
    if (this.toolSizes[tool] !== undefined) {
      this.activeWidth = this.toolSizes[tool];
      this.updateThicknessControlsForTool(tool, this.activeWidth);
    }

    // Hide eraser cursor preview if leaving eraser tool
    if (this.dom.eraserCursorPreview && tool !== 'eraser') {
      this.dom.eraserCursorPreview.classList.add('hidden');
    }

    // Clean up laser trail if leaving laser tool
    if (tool !== 'laser' && this.laserPoints && this.laserPoints.length > 0) {
      this.laserPoints = [];
      this.laserAnimRunning = false;
      if (this.dom.activeCtx && this.dom.activeCanvas) {
        this.dom.activeCtx.clearRect(0, 0, this.dom.activeCanvas.width, this.dom.activeCanvas.height);
      }
    }

    this.updateFloatingToolbarActiveTool();
  }

  setActiveColor(color) {
    this.activeColor = color;
    if (this.dom.currentColorSwatch) {
      this.dom.currentColorSwatch.style.backgroundColor = color;
    }
    // Match active slot if matching color
    let matchedSlot = -1;
    if (this.dom.colorPresets) {
      this.dom.colorPresets.forEach((preset, idx) => {
        const match = preset.dataset.color && preset.dataset.color.toLowerCase() === color.toLowerCase();
        preset.classList.toggle('active', match);
        if (match) matchedSlot = idx;
      });
    }
    if (matchedSlot !== -1) {
      this.activeColorSlot = matchedSlot;
    }
    this.updateFloatingToolbarColor();
  }

  /**
   * Updates all 3 color slot buttons in the toolbar based on this.colorSlots
   */
  updateColorSlotButtons() {
    const activeColor = this.colorSlots[this.activeColorSlot] || this.activeColor;
    if (this.dom.colorPresets) {
      this.dom.colorPresets.forEach((preset, idx) => {
        const color = this.colorSlots[idx] || '#0f172a';
        preset.dataset.color = color;
        preset.dataset.slot = idx;
        preset.style.setProperty('--preset-color', color);
        preset.title = `Slot ${idx + 1} (${color}) - Click to select, click again or right-click to change`;
        preset.classList.toggle('active', idx === this.activeColorSlot);
      });
    }
    if (this.dom.miniColorPresets) {
      this.dom.miniColorPresets.forEach((preset, idx) => {
        const color = this.colorSlots[idx] || '#0f172a';
        preset.dataset.color = color;
        preset.dataset.slot = idx;
        preset.style.setProperty('--preset-color', color);
        preset.title = `Slot ${idx + 1} (${color}) - Click to select, click again or right-click to change`;
        preset.classList.toggle('active', idx === this.activeColorSlot);
      });
    }
    if (this.dom.currentColorSwatch) {
      this.dom.currentColorSwatch.style.backgroundColor = activeColor;
    }
    if (this.dom.miniSlotIndicatorNum) {
      this.dom.miniSlotIndicatorNum.innerText = (this.activeColorSlot + 1).toString();
    }
    if (this.dom.miniPaletteCustomInput) {
      this.dom.miniPaletteCustomInput.value = activeColor;
    }
    this.updateFloatingToolbarColor();
  }

  updateFloatingToolbarColor() {
    const activeColor = this.colorSlots[this.activeColorSlot] || this.activeColor;
    if (this.dom.miniColorDot) {
      this.dom.miniColorDot.style.backgroundColor = activeColor;
    }
    if (this.dom.miniPaletteCustomInput) {
      this.dom.miniPaletteCustomInput.value = activeColor;
    }
    if (this.dom.miniColorPresets) {
      this.dom.miniColorPresets.forEach((preset, idx) => {
        const color = this.colorSlots[idx] || '#0f172a';
        preset.dataset.color = color;
        preset.dataset.slot = idx;
        preset.style.setProperty('--preset-color', color);
        preset.classList.toggle('active', idx === this.activeColorSlot);
      });
    }
  }

  /**
   * Activates a specific color slot (0, 1, or 2)
   */
  activateColorSlot(slotIndex) {
    if (slotIndex < 0 || slotIndex >= this.colorSlots.length) return;
    this.activeColorSlot = slotIndex;
    const color = this.colorSlots[slotIndex];
    this.setActiveColor(color);
    this.updateColorSlotButtons();
  }

  /**
   * Opens the color palette popover anchored to and configured for a specific slot
   */
  openColorPaletteForSlot(slotIndex) {
    if (slotIndex < 0 || slotIndex >= this.colorSlots.length) slotIndex = 0;
    this.activeColorSlot = slotIndex;
    const color = this.colorSlots[slotIndex];

    if (this.dom.paletteSlotNumber) {
      this.dom.paletteSlotNumber.innerText = (slotIndex + 1).toString();
    }
    if (this.dom.paletteSlotBadge) {
      this.dom.paletteSlotBadge.style.backgroundColor = color;
    }
    if (this.dom.nativeColorPicker) {
      this.dom.nativeColorPicker.value = color;
    }

    // Close any other open dropdowns
    if (this.dom.eraserOptionsDropdown) this.dom.eraserOptionsDropdown.classList.add('hidden');
    if (this.dom.shapesOptionsDropdown) this.dom.shapesOptionsDropdown.classList.add('hidden');
    if (this.dom.docsMenuDropdown) this.dom.docsMenuDropdown.classList.add('hidden');
    if (this.dom.exportMenuDropdown) this.dom.exportMenuDropdown.classList.add('hidden');

    if (this.dom.paletteDropdown) {
      this.dom.paletteDropdown.classList.toggle('hidden');
    }
  }

  /**
   * Sets new color for a specific slot and saves to persistent storage
   */
  setSlotColor(slotIndex, newColor) {
    if (slotIndex < 0 || slotIndex >= this.colorSlots.length) slotIndex = 0;
    this.colorSlots[slotIndex] = newColor;
    try {
      localStorage.setItem('goodnotes_color_slots', JSON.stringify(this.colorSlots));
    } catch (e) {}

    const slotBtn = this.dom.colorPresets ? this.dom.colorPresets[slotIndex] : null;
    if (slotBtn) {
      slotBtn.dataset.color = newColor;
      slotBtn.style.setProperty('--preset-color', newColor);
      slotBtn.title = `Slot ${slotIndex + 1} (${newColor}) - Click to select, click again or right-click to change`;
    }
    if (this.dom.paletteSlotBadge) {
      this.dom.paletteSlotBadge.style.backgroundColor = newColor;
    }
    if (this.dom.nativeColorPicker) {
      this.dom.nativeColorPicker.value = newColor;
    }

    this.setActiveColor(newColor);
    this.updateColorSlotButtons();
    this.showToast(`Color Slot ${slotIndex + 1} updated to ${newColor.toUpperCase()}`);
  }

  setActiveWidth(width) {
    this.activeWidth = width;
    if (this.toolSizes[this.activeTool] !== undefined) {
      this.toolSizes[this.activeTool] = width;
    }

    const config = this.toolMinMax[this.activeTool] || { unit: 'px', step: 0.5 };
    this.dom.strokeWidthSlider.value = width;
    this.dom.strokeWidthValue.innerText = `${width}${config.unit}`;

    this.dom.thicknessPills.forEach(pill => {
      const pWidth = parseFloat(pill.dataset.width);
      pill.classList.toggle('active', Math.abs(pWidth - width) < (config.step * 0.9));
    });

    // Sync mini pen flyout thickness controls
    if (this.dom.miniPenThicknessSlider) {
      this.dom.miniPenThicknessSlider.value = width;
    }
    if (this.dom.miniPenThicknessValueText) {
      this.dom.miniPenThicknessValueText.innerText = `${width}${config.unit}`;
    }
    if (this.dom.miniPenThicknessPresets) {
      this.dom.miniPenThicknessPresets.forEach(chip => {
        const pWidth = parseFloat(chip.dataset.width);
        chip.classList.toggle('active', Math.abs(pWidth - width) < (config.step * 0.9));
      });
    }

    // If eraser tool, also sync the eraser size circle buttons
    if (this.activeTool === 'eraser' && this.dom.eraserSizeButtons) {
      this.dom.eraserSizeButtons.forEach(btn => {
        const sz = parseFloat(btn.dataset.eraserSize);
        btn.classList.toggle('active', Math.abs(sz - width) < 2);
      });
    }
    if (this.activeTool === 'eraser' && this.dom.miniEraserSizes) {
      this.dom.miniEraserSizes.forEach(btn => {
        const sz = parseFloat(btn.dataset.size);
        btn.classList.toggle('active', Math.abs(sz - width) < 2);
      });
    }

    // Update eraser cursor preview size
    this.updateEraserCursorPreview();
  }

  /**
   * Dynamically configures the thickness slider and 3 quick pills for the active tool
   */
  updateThicknessControlsForTool(tool, width) {
    const config = this.toolMinMax[tool] || { min: 1, max: 40, step: 0.5, unit: 'px' };
    const presets = this.toolPresets[tool] || [2.0, 4.5, 8.0];

    this.dom.strokeWidthSlider.min = config.min;
    this.dom.strokeWidthSlider.max = config.max;
    this.dom.strokeWidthSlider.step = config.step;
    this.dom.strokeWidthSlider.value = width;
    this.dom.strokeWidthValue.innerText = `${width}${config.unit}`;

    // Update 3 ribbon pills with this tool's presets
    if (this.dom.thicknessPills) {
      this.dom.thicknessPills.forEach((pill, idx) => {
        const presetVal = presets[idx] || 2.0;
        pill.dataset.width = presetVal;
        pill.title = `${tool.toUpperCase()} Width: ${presetVal}${config.unit}`;
        pill.classList.toggle('active', Math.abs(presetVal - width) < (config.step * 0.9));

        const dot = pill.querySelector('.dot-preview');
        if (dot) {
          // Dynamically scale dot size between 3px and 14px
          const normalized = Math.min(1, Math.max(0.1, (presetVal - config.min) / (config.max - config.min)));
          const dotPx = Math.round(3 + normalized * 11);
          dot.style.width = `${dotPx}px`;
          dot.style.height = `${dotPx}px`;
        }
      });
    }

    // Sync mini pen flyout thickness controls
    if (this.dom.miniPenThicknessSlider) {
      this.dom.miniPenThicknessSlider.min = config.min;
      this.dom.miniPenThicknessSlider.max = config.max;
      this.dom.miniPenThicknessSlider.step = config.step;
      this.dom.miniPenThicknessSlider.value = width;
    }
    if (this.dom.miniPenThicknessValueText) {
      this.dom.miniPenThicknessValueText.innerText = `${width}${config.unit}`;
    }
    if (this.dom.miniPenThicknessPresets) {
      this.dom.miniPenThicknessPresets.forEach((chip, idx) => {
        const presetVal = presets[idx] || (idx === 0 ? 1.5 : idx === 1 ? 3.0 : 6.0);
        chip.dataset.width = presetVal;
        chip.innerText = idx === 0 ? `Fine (${presetVal})` : idx === 1 ? `Med (${presetVal})` : `Bold (${presetVal})`;
        chip.classList.toggle('active', Math.abs(presetVal - width) < (config.step * 0.9));
      });
    }

    // If eraser tool, also sync the eraser size circle buttons
    if (tool === 'eraser') {
      if (this.dom.eraserSizeButtons) {
        this.dom.eraserSizeButtons.forEach(btn => {
          const sz = parseFloat(btn.dataset.eraserSize);
          btn.classList.toggle('active', Math.abs(sz - width) < 2);
        });
      }
      if (this.dom.miniEraserSizes) {
        this.dom.miniEraserSizes.forEach(btn => {
          const sz = parseFloat(btn.dataset.size);
          btn.classList.toggle('active', Math.abs(sz - width) < 2);
        });
      }
    }
  }

  applyZoom(multiplier) {
    this.coord.setZoom(this.coord.zoom * multiplier);
    this.updateZoomDisplay();
    this.renderCurrentPage();
  }

  updateZoomDisplay() {
    const text = `${Math.round(this.coord.zoom * 100)}%`;
    if (this.dom.btnZoomReset) this.dom.btnZoomReset.innerText = text;
    if (this.dom.btnMiniZoomReset) this.dom.btnMiniZoomReset.innerText = text;
  }

  /**
   * Captures a deep, immutable snapshot of the current page's ink and elements.
   */
  takeSnapshot() {
    const page = this.getCurrentPage();
    if (!page || !this.notebook) return null;
    return {
      pageIndex: this.notebook.currentPageIndex,
      strokes: page.strokes.map(s => ({
        id: s.id,
        tool: s.tool,
        color: s.color,
        width: s.width,
        opacity: s.opacity,
        blendMode: s.blendMode,
        points: s.points.map(p => ({ x: p.x, y: p.y, pressure: p.pressure, time: p.time }))
      })),
      shapes: page.shapes.map(sh => ({
        ...sh,
        geometry: JSON.parse(JSON.stringify(sh.geometry))
      })),
      textBoxes: page.textBoxes.map(t => ({ ...t })),
      stickyNotes: page.stickyNotes.map(n => ({ ...n })),
      images: (page.images || []).map(img => ({ ...img }))
    };
  }

  /**
   * Undo / Redo History Management (Zero-Lag In-Memory Snapshots)
   */
  pushUndoSnapshot(snapshot = null) {
    const snap = snapshot || this.takeSnapshot();
    if (!snap) return;

    this.undoStack.push(snap);
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
    this.redoStack = []; // Clear redo on new user action
    this.updateHistoryButtons();
  }

  undo() {
    if (this.undoStack.length === 0) return;

    // Push current state to redo
    const currentSnapshot = this.takeSnapshot();
    if (currentSnapshot) {
      this.redoStack.push(currentSnapshot);
    }

    const prev = this.undoStack.pop();
    if (prev.pageIndex !== this.notebook.currentPageIndex) {
      this.switchPage(prev.pageIndex, false);
    }

    const targetPage = this.notebook.pages[prev.pageIndex];
    targetPage.strokes = prev.strokes;
    targetPage.shapes = prev.shapes;
    targetPage.textBoxes = prev.textBoxes;
    targetPage.stickyNotes = prev.stickyNotes;
    targetPage.images = (prev.images || []).map(img => ({ ...img }));

    this.clearLassoSelection();
    const vecCanvas = document.getElementById(`vectorCanvas_${prev.pageIndex}`) || this.dom.vectorCanvas;
    if (vecCanvas) {
      this.renderVectorCanvasForPage(targetPage, vecCanvas, vecCanvas.getContext('2d'));
    }
    const domOverlay = document.getElementById(`domOverlay_${prev.pageIndex}`) || this.dom.domOverlay;
    if (domOverlay) {
      this.renderDomOverlayForPage(targetPage, domOverlay, this.coord.zoom);
    }
    this.updateCurrentThumbnailDebounced();
    this.updateHistoryButtons();
    this.markDirty();
    this.showToast('Undo');
  }

  redo() {
    if (this.redoStack.length === 0) return;

    // Push current state to undo
    const currentSnapshot = this.takeSnapshot();
    if (currentSnapshot) {
      this.undoStack.push(currentSnapshot);
    }

    const next = this.redoStack.pop();
    if (next.pageIndex !== this.notebook.currentPageIndex) {
      this.switchPage(next.pageIndex, false);
    }

    const targetPage = this.notebook.pages[next.pageIndex];
    targetPage.strokes = next.strokes;
    targetPage.shapes = next.shapes;
    targetPage.textBoxes = next.textBoxes;
    targetPage.stickyNotes = next.stickyNotes;
    targetPage.images = (next.images || []).map(img => ({ ...img }));

    this.clearLassoSelection();
    const vecCanvas = document.getElementById(`vectorCanvas_${next.pageIndex}`) || this.dom.vectorCanvas;
    if (vecCanvas) {
      this.renderVectorCanvasForPage(targetPage, vecCanvas, vecCanvas.getContext('2d'));
    }
    const domOverlay = document.getElementById(`domOverlay_${next.pageIndex}`) || this.dom.domOverlay;
    if (domOverlay) {
      this.renderDomOverlayForPage(targetPage, domOverlay, this.coord.zoom);
    }
    this.updateCurrentThumbnailDebounced();
    this.updateHistoryButtons();
    this.markDirty();
    this.showToast('Redo');
  }

  updateHistoryButtons() {
    const canUndo = this.undoStack.length > 0;
    const canRedo = this.redoStack.length > 0;
    if (this.dom.btnUndo) this.dom.btnUndo.disabled = !canUndo;
    if (this.dom.btnRedo) this.dom.btnRedo.disabled = !canRedo;
    if (this.dom.btnMiniUndo) this.dom.btnMiniUndo.disabled = !canUndo;
    if (this.dom.btnMiniRedo) this.dom.btnMiniRedo.disabled = !canRedo;
  }

  /**
   * Marks notebook as modified with unsaved changes.
   */
  markDirty() {
    this.isDirty = true;
    this.updateSaveIndicator('unsaved');
  }

  /**
   * Starts periodic auto-save timer: runs every 60 seconds (1 minute).
   */
  startAutoSaveTimer() {
    if (this.autoSaveInterval) clearInterval(this.autoSaveInterval);
    this.autoSaveInterval = setInterval(async () => {
      if (this.isDirty && this.notebook && this.currentView === 'editor') {
        await this.saveImmediately();
      }
    }, 60000); // 1-minute auto-save
  }

  /**
   * Saves the notebook document to local storage without lag.
   */
  async saveImmediately() {
    if (!this.storage || !this.notebook) return;
    this.updateSaveIndicator('saving');
    try {
      // Clean and persist undo/redo stacks capped at last 30 snapshots
      this.notebook._undoStack = (this.undoStack || []).slice(-30).map(s => ({
        pageIndex: s.pageIndex,
        strokes: s.strokes ? s.strokes.map(st => ({
          id: st.id,
          tool: st.tool,
          color: st.color,
          width: st.width,
          opacity: st.opacity,
          blendMode: st.blendMode,
          points: st.points
        })) : [],
        shapes: s.shapes || [],
        textBoxes: s.textBoxes || [],
        stickyNotes: s.stickyNotes || [],
        images: s.images || []
      }));
      this.notebook._redoStack = (this.redoStack || []).slice(-30).map(s => ({
        pageIndex: s.pageIndex,
        strokes: s.strokes ? s.strokes.map(st => ({
          id: st.id,
          tool: st.tool,
          color: st.color,
          width: st.width,
          opacity: st.opacity,
          blendMode: st.blendMode,
          points: st.points
        })) : [],
        shapes: s.shapes || [],
        textBoxes: s.textBoxes || [],
        stickyNotes: s.stickyNotes || [],
        images: s.images || []
      }));
      this.notebook.updatedAt = Date.now();
      await this.storage.saveNotebookInstant(this.notebook);
      this.isDirty = false;
      this.updateSaveIndicator('saved');
    } catch (err) {
      console.warn('Save error:', err);
      this.updateSaveIndicator('unsaved');
    }
  }

  updateSaveIndicator(status) {
    if (this.dom.saveStatusIndicator && this.dom.saveStatusText) {
      if (status === 'saving') {
        this.dom.saveStatusIndicator.className = 'save-status-badge saving';
        this.dom.saveStatusText.textContent = 'Saving...';
      } else if (status === 'unsaved') {
        this.dom.saveStatusIndicator.className = 'save-status-badge unsaved';
        this.dom.saveStatusText.textContent = 'Unsaved changes';
      } else {
        this.dom.saveStatusIndicator.className = 'save-status-badge saved';
        this.dom.saveStatusText.textContent = 'Saved';
      }
    }
    if (this.dom.miniSaveStatusIndicator && this.dom.miniSaveStatusText) {
      if (status === 'saving') {
        this.dom.miniSaveStatusIndicator.className = 'mini-save-status saving';
        this.dom.miniSaveStatusText.textContent = 'Saving...';
      } else if (status === 'unsaved') {
        this.dom.miniSaveStatusIndicator.className = 'mini-save-status unsaved';
        this.dom.miniSaveStatusText.textContent = 'Unsaved';
      } else {
        this.dom.miniSaveStatusIndicator.className = 'mini-save-status saved';
        this.dom.miniSaveStatusText.textContent = 'Saved';
      }
    }
  }

  scheduleSave() {
    this.markDirty();
  }

  /**
   * Switches to the GoodNotes Document Library Home Screen.
   */
  async showLibraryView() {
    if (this.notebook && this.isDirty) {
      await this.saveImmediately();
    }
    if (this.dom.editorView) this.dom.editorView.classList.add('hidden');
    if (this.dom.libraryView) this.dom.libraryView.classList.remove('hidden');
    if (this.dom.floatingToolbar) this.dom.floatingToolbar.classList.add('hidden');
    this.currentView = 'library';
    await this.renderLibraryView();
  }

  /**
   * Switches back to the Document Editor Canvas.
   */
  showEditorView() {
    if (!this.notebook) return;
    if (this.dom.libraryView) this.dom.libraryView.classList.add('hidden');
    if (this.dom.editorView) this.dom.editorView.classList.remove('hidden');
    this.currentView = 'editor';
    this.setToolbarMode(this.toolbarMode, false);
    this.coord.invalidateCache();
    this.updateDocTitleDisplay(this.notebook.title || 'Untitled Notebook');
    this.renderCurrentPage();
    this.renderThumbnailsSidebar();
    this.updatePageCounter();
    this.updateHistoryButtons();
    this.updateColorSlotButtons();
    this.updateFloatingToolbarActiveTool();
  }

  /**
   * Sets toolbar layout mode: 'ribbon' (classic GoodNotes ribbon) | 'floating' (minimalist pill bar)
   */
  setToolbarMode(mode, showNotification = true) {
    this.toolbarMode = mode;
    try {
      localStorage.setItem('goodnotes_toolbar_mode', mode);
    } catch (e) {}

    if (mode === 'floating') {
      if (this.dom.headerBar) this.dom.headerBar.classList.add('hidden-ribbon');
      if (this.dom.inkingRibbon) this.dom.inkingRibbon.classList.add('hidden-ribbon');
      if (this.dom.floatingToolbar && this.currentView === 'editor') {
        this.dom.floatingToolbar.classList.remove('hidden');
      }
      if (this.dom.appContainer) this.dom.appContainer.classList.add('floating-mode');
      if (showNotification) this.showToast('Minimalist Floating Toolbar (F8 to toggle)');
    } else {
      if (this.dom.headerBar) this.dom.headerBar.classList.remove('hidden-ribbon');
      if (this.dom.inkingRibbon) this.dom.inkingRibbon.classList.remove('hidden-ribbon');
      if (this.dom.floatingToolbar) this.dom.floatingToolbar.classList.add('hidden');
      if (this.dom.appContainer) this.dom.appContainer.classList.remove('floating-mode');
      if (showNotification) this.showToast('Classic GoodNotes Ribbon (F8 to toggle)');
    }

    this.updateFloatingToolbarActiveTool();
    this.updateFloatingToolbarColor();
    this.coord.invalidateCache();
  }

  toggleToolbarMode() {
    const newMode = this.toolbarMode === 'floating' ? 'ribbon' : 'floating';
    this.setToolbarMode(newMode, true);
  }

  updateDocTitleDisplay(title) {
    if (this.dom.docTitleInput) this.dom.docTitleInput.value = title;
    if (this.dom.miniDocTitleInput) this.dom.miniDocTitleInput.value = title;
  }

  updateFloatingToolbarActiveTool() {
    if (!this.dom.floatingToolbar) return;
    const miniBtns = this.dom.floatingToolbar.querySelectorAll('.mini-tool-btn[data-tool]');
    const isPenTool = (this.activeTool === 'ballpoint' || this.activeTool === 'fountain' || this.activeTool === 'highlighter');

    miniBtns.forEach(btn => {
      const tool = btn.dataset.tool;
      if (tool === 'ballpoint' || tool === 'fountain' || tool === 'highlighter') {
        btn.classList.toggle('active', isPenTool);
      } else {
        btn.classList.toggle('active', tool === this.activeTool);
      }
    });

    // Update pen dropdown active item
    if (this.dom.miniPenFlyout) {
      const items = this.dom.miniPenFlyout.querySelectorAll('.mini-menu-item[data-pen]');
      items.forEach(item => {
        item.classList.toggle('active', item.dataset.pen === this.activeTool);
      });
    }

    // Update shapes active button
    if (this.dom.miniShapesFlyout) {
      const shapeBtns = this.dom.miniShapesFlyout.querySelectorAll('.mini-shape-btn');
      shapeBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.shape === this.shapeMode);
      });
    }
  }

  closeAllMiniDropdowns() {
    if (this.dom.miniAddDropdown) this.dom.miniAddDropdown.classList.add('hidden');
    if (this.dom.miniPenFlyout) this.dom.miniPenFlyout.classList.add('hidden');
    if (this.dom.miniEraserFlyout) this.dom.miniEraserFlyout.classList.add('hidden');
    if (this.dom.miniShapesFlyout) this.dom.miniShapesFlyout.classList.add('hidden');
    if (this.dom.miniColorDropdown) this.dom.miniColorDropdown.classList.add('hidden');
    if (this.dom.miniPaletteFlyout) this.dom.miniPaletteFlyout.classList.add('hidden');
    if (this.dom.miniThicknessFlyout) this.dom.miniThicknessFlyout.classList.add('hidden');
    if (this.dom.miniExportFlyout) this.dom.miniExportFlyout.classList.add('hidden');
    if (this.dom.miniMoreDropdown) this.dom.miniMoreDropdown.classList.add('hidden');
  }

  addStickyNoteAtCenter() {
    const page = this.getCurrentPage();
    if (!page) return;
    this.pushUndoSnapshot();
    const newNote = {
      id: 'sticky_' + Date.now().toString(36),
      text: '',
      color: '#fef08a',
      x: (page.width / 2) - 80,
      y: (page.height / 2) - 80,
      width: 160,
      height: 160
    };
    page.stickyNotes = page.stickyNotes || [];
    page.stickyNotes.push(newNote);
    const domOverlay = document.getElementById(`domOverlay_${this.notebook.currentPageIndex}`) || this.dom.domOverlay;
    if (domOverlay) {
      this.renderDomOverlayForPage(page, domOverlay, this.coord.zoom);
    }
    this.markDirty();
    this.showToast('Added sticky note');
  }

  bindFloatingToolbarEvents() {
    // 1. Select / Lasso Tool
    if (this.dom.btnMiniSelect) {
      this.dom.btnMiniSelect.addEventListener('click', () => {
        this.closeAllMiniDropdowns();
        this.setActiveTool('lasso');
      });
    }

    // 2. Add / Insert Element Dropdown (+)
    if (this.dom.btnMiniAdd) {
      this.dom.btnMiniAdd.addEventListener('click', (e) => {
        e.stopPropagation();
        const wasHidden = this.dom.miniAddDropdown ? this.dom.miniAddDropdown.classList.contains('hidden') : true;
        this.closeAllMiniDropdowns();
        if (wasHidden && this.dom.miniAddDropdown) this.dom.miniAddDropdown.classList.remove('hidden');
      });
    }
    if (this.dom.btnMiniAddPage) {
      this.dom.btnMiniAddPage.addEventListener('click', () => {
        this.closeAllMiniDropdowns();
        this.addNewPage();
      });
    }
    if (this.dom.btnMiniAddPageModal) {
      this.dom.btnMiniAddPageModal.addEventListener('click', () => {
        this.closeAllMiniDropdowns();
        this.openTemplateModal();
      });
    }
    if (this.dom.btnMiniAddImage) {
      this.dom.btnMiniAddImage.addEventListener('click', () => {
        this.closeAllMiniDropdowns();
        if (this.dom.imageFileInput) this.dom.imageFileInput.click();
      });
    }
    if (this.dom.btnMiniAddSticky) {
      this.dom.btnMiniAddSticky.addEventListener('click', () => {
        this.closeAllMiniDropdowns();
        this.addStickyNoteAtCenter();
      });
    }

    // 3. Text Tool (T)
    if (this.dom.btnMiniText) {
      this.dom.btnMiniText.addEventListener('click', () => {
        this.closeAllMiniDropdowns();
        this.setActiveTool('text');
      });
    }

    // 4. Pen Tool & Flyout (Types + Thickness)
    if (this.dom.btnMiniPen) {
      this.dom.btnMiniPen.addEventListener('click', (e) => {
        e.stopPropagation();
        const isPenTool = (this.activeTool === 'ballpoint' || this.activeTool === 'fountain' || this.activeTool === 'highlighter');
        if (isPenTool && this.dom.miniPenFlyout) {
          const wasHidden = this.dom.miniPenFlyout.classList.contains('hidden');
          this.closeAllMiniDropdowns();
          if (wasHidden) this.dom.miniPenFlyout.classList.remove('hidden');
        } else {
          this.closeAllMiniDropdowns();
          this.setActiveTool(this.lastPenTool || 'ballpoint');
        }
      });
      this.dom.btnMiniPen.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.closeAllMiniDropdowns();
        if (this.dom.miniPenFlyout) this.dom.miniPenFlyout.classList.toggle('hidden');
      });
    }
    if (this.dom.btnMiniPenBallpoint) {
      this.dom.btnMiniPenBallpoint.addEventListener('click', () => {
        this.lastPenTool = 'ballpoint';
        this.setActiveTool('ballpoint');
        this.closeAllMiniDropdowns();
      });
    }
    if (this.dom.btnMiniPenFountain) {
      this.dom.btnMiniPenFountain.addEventListener('click', () => {
        this.lastPenTool = 'fountain';
        this.setActiveTool('fountain');
        this.closeAllMiniDropdowns();
      });
    }
    if (this.dom.btnMiniPenHighlighter) {
      this.dom.btnMiniPenHighlighter.addEventListener('click', () => {
        this.lastPenTool = 'highlighter';
        this.setActiveTool('highlighter');
        this.closeAllMiniDropdowns();
      });
    }
    // Pen Thickness presets & slider
    if (this.dom.miniPenThicknessPresets) {
      this.dom.miniPenThicknessPresets.forEach(chip => {
        chip.addEventListener('click', (e) => {
          e.stopPropagation();
          const w = parseFloat(chip.dataset.width);
          if (!isNaN(w)) {
            this.setActiveWidth(w);
          }
        });
      });
    }
    if (this.dom.miniPenThicknessSlider) {
      this.dom.miniPenThicknessSlider.addEventListener('input', (e) => {
        const w = parseFloat(e.target.value);
        if (!isNaN(w)) {
          this.setActiveWidth(w);
        }
      });
    }

    // 5. Eraser Tool & Flyout
    if (this.dom.btnMiniEraser) {
      this.dom.btnMiniEraser.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.activeTool === 'eraser' && this.dom.miniEraserFlyout) {
          const wasHidden = this.dom.miniEraserFlyout.classList.contains('hidden');
          this.closeAllMiniDropdowns();
          if (wasHidden) this.dom.miniEraserFlyout.classList.remove('hidden');
        } else {
          this.closeAllMiniDropdowns();
          this.setActiveTool('eraser');
        }
      });
      this.dom.btnMiniEraser.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.closeAllMiniDropdowns();
        if (this.dom.miniEraserFlyout) this.dom.miniEraserFlyout.classList.toggle('hidden');
      });
    }
    if (this.dom.miniEraserStroke) {
      this.dom.miniEraserStroke.addEventListener('click', () => {
        this.eraserType = 'stroke';
        this.dom.miniEraserStroke.classList.add('active');
        if (this.dom.miniEraserPrecision) this.dom.miniEraserPrecision.classList.remove('active');
        if (this.dom.btnEraserStroke) this.dom.btnEraserStroke.classList.add('active');
        if (this.dom.btnEraserPrecision) this.dom.btnEraserPrecision.classList.remove('active');
        this.showToast('Stroke Eraser: Erases full stroke on contact');
      });
    }
    if (this.dom.miniEraserPrecision) {
      this.dom.miniEraserPrecision.addEventListener('click', () => {
        this.eraserType = 'precision';
        this.dom.miniEraserPrecision.classList.add('active');
        if (this.dom.miniEraserStroke) this.dom.miniEraserStroke.classList.remove('active');
        if (this.dom.btnEraserPrecision) this.dom.btnEraserPrecision.classList.add('active');
        if (this.dom.btnEraserStroke) this.dom.btnEraserStroke.classList.remove('active');
        this.showToast('Precision Eraser: Erases exact contact area');
      });
    }
    if (this.dom.miniEraserSizes) {
      this.dom.miniEraserSizes.forEach(btn => {
        btn.addEventListener('click', () => {
          const sz = parseFloat(btn.dataset.size);
          this.setActiveWidth(sz);
          this.dom.miniEraserSizes.forEach(b => b.classList.toggle('active', b === btn));
          if (this.dom.eraserSizeButtons) {
            this.dom.eraserSizeButtons.forEach(b => b.classList.toggle('active', parseFloat(b.dataset.eraserSize) === sz));
          }
          this.showToast(`Eraser Size: ${sz}px`);
        });
      });
    }
    if (this.dom.miniChkEraseHighlighterOnly) {
      this.dom.miniChkEraseHighlighterOnly.addEventListener('change', (e) => {
        this.eraseHighlighterOnly = e.target.checked;
        if (this.dom.chkEraseHighlighterOnly) this.dom.chkEraseHighlighterOnly.checked = this.eraseHighlighterOnly;
        this.showToast(this.eraseHighlighterOnly ? 'Erasing Highlighter Only' : 'Erasing All Inking');
      });
    }
    if (this.dom.miniBtnClearPage) {
      this.dom.miniBtnClearPage.addEventListener('click', () => {
        const page = this.getCurrentPage();
        if (!page) return;
        this.pushUndoSnapshot();
        page.strokes = [];
        page.shapes = [];
        page.textBoxes = [];
        page.stickyNotes = [];
        this.clearLassoSelection();
        this.renderCurrentPage();
        this.renderThumbnailsSidebar();
        this.markDirty();
        this.closeAllMiniDropdowns();
        this.showToast('Cleared page inking');
      });
    }

    // 6. Shapes Tool & Flyout
    if (this.dom.btnMiniShapes) {
      this.dom.btnMiniShapes.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.activeTool === 'shapes' && this.dom.miniShapesFlyout) {
          const wasHidden = this.dom.miniShapesFlyout.classList.contains('hidden');
          this.closeAllMiniDropdowns();
          if (wasHidden) this.dom.miniShapesFlyout.classList.remove('hidden');
        } else {
          this.closeAllMiniDropdowns();
          this.setActiveTool('shapes');
        }
      });
      this.dom.btnMiniShapes.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.closeAllMiniDropdowns();
        if (this.dom.miniShapesFlyout) this.dom.miniShapesFlyout.classList.toggle('hidden');
      });
    }
    if (this.dom.miniShapeButtons) {
      this.dom.miniShapeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          this.shapeMode = btn.dataset.shape;
          this.dom.miniShapeButtons.forEach(b => b.classList.toggle('active', b === btn));
          if (this.dom.shapePickerButtons) {
            this.dom.shapePickerButtons.forEach(b => b.classList.toggle('active', b.dataset.shape === this.shapeMode));
          }
          this.setActiveTool('shapes');
          this.closeAllMiniDropdowns();
          this.showToast(`Shape: ${btn.title || this.shapeMode}`);
        });
      });
    }
    ['None', 'Tint', 'Solid'].forEach(fillType => {
      const btn = this.dom[`miniFill${fillType}`];
      if (btn) {
        btn.addEventListener('click', () => {
          this.shapeFill = fillType.toLowerCase();
          ['miniFillNone', 'miniFillTint', 'miniFillSolid'].forEach(k => {
            if (this.dom[k]) this.dom[k].classList.toggle('active', this.dom[k] === btn);
          });
          if (this.dom.fillChipButtons) {
            this.dom.fillChipButtons.forEach(b => b.classList.toggle('active', b.dataset.fill === this.shapeFill));
          }
          this.showToast(`Shape Fill: ${fillType}`);
        });
      }
    });

    // 7. Laser Tool
    if (this.dom.btnMiniLaser) {
      this.dom.btnMiniLaser.addEventListener('click', () => {
        this.closeAllMiniDropdowns();
        this.setActiveTool('laser');
      });
    }

    // 8. Color Dot & Dropdown
    if (this.dom.btnMiniColor) {
      this.dom.btnMiniColor.addEventListener('click', (e) => {
        e.stopPropagation();
        const wasHidden = this.dom.miniColorDropdown ? this.dom.miniColorDropdown.classList.contains('hidden') : true;
        this.closeAllMiniDropdowns();
        if (wasHidden && this.dom.miniColorDropdown) this.dom.miniColorDropdown.classList.remove('hidden');
      });
    }
    if (this.dom.miniColorPresets) {
      this.dom.miniColorPresets.forEach((preset, idx) => {
        preset.addEventListener('click', (e) => {
          e.stopPropagation();
          const slotIdx = parseInt(preset.dataset.slot ?? idx, 10);
          this.activateColorSlot(slotIdx);
        });
      });
    }
    if (this.dom.miniPalDots) {
      this.dom.miniPalDots.forEach(dot => {
        dot.addEventListener('click', (e) => {
          e.stopPropagation();
          const color = dot.dataset.color;
          if (color) {
            this.setSlotColor(this.activeColorSlot, color);
          }
        });
      });
    }
    if (this.dom.miniPaletteCustomInput) {
      this.dom.miniPaletteCustomInput.addEventListener('input', (e) => {
        this.setSlotColor(this.activeColorSlot, e.target.value);
      });
    }

    // 9 & 10. History (Undo / Redo)
    if (this.dom.btnMiniUndo) this.dom.btnMiniUndo.addEventListener('click', () => this.undo());
    if (this.dom.btnMiniRedo) this.dom.btnMiniRedo.addEventListener('click', () => this.redo());

    // 11. Clear Page
    if (this.dom.btnMiniClear) {
      this.dom.btnMiniClear.addEventListener('click', () => {
        const page = this.getCurrentPage();
        if (!page) return;
        this.pushUndoSnapshot();
        page.strokes = [];
        page.shapes = [];
        page.textBoxes = [];
        page.stickyNotes = [];
        this.clearLassoSelection();
        this.renderCurrentPage();
        this.renderThumbnailsSidebar();
        this.markDirty();
        this.closeAllMiniDropdowns();
        this.showToast('Cleared page inking');
      });
    }

    // 12. Export Menu
    if (this.dom.btnMiniExportTrigger) {
      this.dom.btnMiniExportTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const wasHidden = this.dom.miniExportFlyout ? this.dom.miniExportFlyout.classList.contains('hidden') : true;
        this.closeAllMiniDropdowns();
        if (wasHidden && this.dom.miniExportFlyout) this.dom.miniExportFlyout.classList.remove('hidden');
      });
    }
    if (this.dom.btnMiniExportPDF) {
      this.dom.btnMiniExportPDF.addEventListener('click', () => {
        this.closeAllMiniDropdowns();
        this.exportPDF();
      });
    }
    if (this.dom.btnMiniExportPNG) {
      this.dom.btnMiniExportPNG.addEventListener('click', () => {
        this.closeAllMiniDropdowns();
        this.exportPagePNG();
      });
    }
    if (this.dom.btnMiniExportProject) {
      this.dom.btnMiniExportProject.addEventListener('click', () => {
        this.closeAllMiniDropdowns();
        this.exportProjectJSON();
      });
    }

    // 13. More Options Dropdown
    if (this.dom.btnMiniMore) {
      this.dom.btnMiniMore.addEventListener('click', (e) => {
        e.stopPropagation();
        const wasHidden = this.dom.miniMoreDropdown ? this.dom.miniMoreDropdown.classList.contains('hidden') : true;
        this.closeAllMiniDropdowns();
        if (wasHidden && this.dom.miniMoreDropdown) this.dom.miniMoreDropdown.classList.remove('hidden');
      });
    }
    if (this.dom.btnMiniPrevPage) {
      this.dom.btnMiniPrevPage.addEventListener('click', () => {
        this.closeAllMiniDropdowns();
        this.prevPage();
      });
    }
    if (this.dom.miniPageCounter) {
      this.dom.miniPageCounter.addEventListener('click', () => {
        this.closeAllMiniDropdowns();
        this.jumpToPagePrompt();
      });
    }
    if (this.dom.btnMiniNextPage) {
      this.dom.btnMiniNextPage.addEventListener('click', () => {
        this.closeAllMiniDropdowns();
        this.nextPage();
      });
    }
    if (this.dom.btnMiniZoomOut) this.dom.btnMiniZoomOut.addEventListener('click', () => this.applyZoom(1 / 1.15));
    if (this.dom.btnMiniZoomReset) {
      this.dom.btnMiniZoomReset.addEventListener('click', () => {
        this.coord.setZoom(1.0);
        this.updateZoomDisplay();
        this.renderCurrentPage();
      });
    }
    if (this.dom.btnMiniZoomIn) this.dom.btnMiniZoomIn.addEventListener('click', () => this.applyZoom(1.15));
    if (this.dom.btnMiniFitWidth) this.dom.btnMiniFitWidth.addEventListener('click', () => this.fitToWidth());
    if (this.dom.btnMiniTogglePaper) {
      this.dom.btnMiniTogglePaper.addEventListener('click', () => {
        this.closeAllMiniDropdowns();
        const page = this.getCurrentPage();
        if (page) {
          page.paperColor = page.paperColor === 'black' ? 'cream' : 'black';
          this.renderCurrentPage();
          this.markDirty();
          this.showToast(`Paper switched to ${page.paperColor === 'black' ? 'Blackboard' : 'Cream'}`);
        }
      });
    }
    if (this.dom.btnMiniToggleThumbnails) {
      this.dom.btnMiniToggleThumbnails.addEventListener('click', () => {
        this.closeAllMiniDropdowns();
        if (this.dom.thumbnailsSidebar) {
          this.dom.thumbnailsSidebar.classList.toggle('collapsed');
          this.coord.invalidateCache();
        }
      });
    }
    if (this.dom.btnMiniToggleTheme) {
      this.dom.btnMiniToggleTheme.addEventListener('click', () => {
        this.closeAllMiniDropdowns();
        this.toggleTheme();
      });
    }
    if (this.dom.btnMiniShortcuts) {
      this.dom.btnMiniShortcuts.addEventListener('click', () => {
        this.closeAllMiniDropdowns();
        if (this.dom.shortcutsModal) this.dom.shortcutsModal.classList.remove('hidden');
      });
    }
    if (this.dom.btnMiniSaveManual) {
      this.dom.btnMiniSaveManual.addEventListener('click', () => {
        this.closeAllMiniDropdowns();
        this.saveImmediately();
        this.showToast('Notebook saved');
      });
    }
    if (this.dom.btnMiniToggleRibbon) {
      this.dom.btnMiniToggleRibbon.addEventListener('click', () => {
        this.closeAllMiniDropdowns();
        this.setToolbarMode('ribbon', true);
      });
    }

    // 14. Library View
    if (this.dom.btnMiniLibrary) {
      this.dom.btnMiniLibrary.addEventListener('click', () => {
        this.closeAllMiniDropdowns();
        this.showLibraryView();
      });
    }

    // 15. Red Close Button -> switches to Ribbon
    if (this.dom.btnMiniClose) {
      this.dom.btnMiniClose.addEventListener('click', () => {
        this.closeAllMiniDropdowns();
        this.setToolbarMode('ribbon', true);
      });
    }

    if (this.dom.btnToggleToolbarMode) {
      this.dom.btnToggleToolbarMode.addEventListener('click', () => this.toggleToolbarMode());
    }

    // Close floating popups when clicking outside
    document.addEventListener('click', (e) => {
      if (this.dom.floatingToolbar && !this.dom.floatingToolbar.contains(e.target)) {
        this.closeAllMiniDropdowns();
      }
    });
  }

  /**
   * Fetches all notebooks from IndexedDB, updates filter counters, and renders shelf cards.
   */
  async renderLibraryView() {
    try {
      this.libraryNotebooks = await this.storage.getAllNotebooks();
    } catch (err) {
      console.warn('Error loading notebooks:', err);
      this.libraryNotebooks = [];
    }

    // Ensure active notebook is present in the list if open
    if (this.notebook && this.notebook.id && !this.libraryNotebooks.some(n => n.id === this.notebook.id)) {
      this.libraryNotebooks.unshift({
        id: this.notebook.id,
        title: this.notebook.title || 'Untitled Notebook',
        coverTheme: this.notebook.coverTheme || 'modern-blue',
        pageCount: this.notebook.pages ? this.notebook.pages.length : 1,
        hasPdf: Boolean(this.notebook.pdfSource),
        isFavorite: Boolean(this.notebook.isFavorite),
        createdAt: this.notebook.createdAt || Date.now(),
        updatedAt: this.notebook.updatedAt || Date.now(),
        template: this.notebook.pages && this.notebook.pages[0] ? this.notebook.pages[0].template : 'ruled',
        paperColor: this.notebook.pages && this.notebook.pages[0] ? this.notebook.pages[0].paperColor : 'cream'
      });
    }

    // Toggle Resume Editor button in library header
    if (this.dom.btnResumeEditor) {
      this.dom.btnResumeEditor.style.display = this.notebook ? 'inline-flex' : 'none';
    }

    // Update filter badge counts
    const totalCount = this.libraryNotebooks.length;
    const favCount = this.libraryNotebooks.filter(n => n.isFavorite).length;
    const pdfCount = this.libraryNotebooks.filter(n => n.hasPdf).length;

    if (this.dom.libCountAll) this.dom.libCountAll.textContent = totalCount;
    if (this.dom.libCountFavorites) this.dom.libCountFavorites.textContent = favCount;
    if (this.dom.libCountPdfs) this.dom.libCountPdfs.textContent = pdfCount;

    this.renderLibraryNotebooks();
  }

  /**
   * Renders the filtered & sorted notebook cards onto the shelf grid.
   */
  renderLibraryNotebooks() {
    if (!this.dom.libraryNotebooksGrid) return;
    this.closeActiveCardContextMenu();

    let items = [...this.libraryNotebooks];

    // Filter by tab
    if (this.libraryFilter === 'favorites') {
      items = items.filter(n => n.isFavorite);
    } else if (this.libraryFilter === 'pdfs') {
      items = items.filter(n => n.hasPdf);
    }

    // Filter by search query
    if (this.librarySearchQuery) {
      items = items.filter(n => (n.title || '').toLowerCase().includes(this.librarySearchQuery));
    }

    // Sort
    if (this.librarySort === 'title') {
      items.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    } else if (this.librarySort === 'pages') {
      items.sort((a, b) => (b.pageCount || 1) - (a.pageCount || 1));
    } else {
      // Recent (default)
      items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    }

    this.dom.libraryNotebooksGrid.innerHTML = '';

    // 1. Always prepend the "+ New Notebook" card in Grid mode
    if (this.libraryViewMode === 'grid') {
      const newCard = document.createElement('div');
      newCard.className = 'new-notebook-card';
      newCard.title = 'Create a new blank notebook';
      newCard.innerHTML = `
        <div class="plus-icon-circle">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </div>
        <span class="new-notebook-label">New Notebook</span>
      `;
      newCard.addEventListener('click', () => this.openNewNotebookModal());
      this.dom.libraryNotebooksGrid.appendChild(newCard);
    }

    // 2. Render each notebook card
    if (items.length === 0) {
      if (this.libraryViewMode === 'list') {
        const empty = document.createElement('div');
        empty.className = 'empty-hint';
        empty.style.padding = '40px 0';
        empty.textContent = 'No documents found matching current filter.';
        this.dom.libraryNotebooksGrid.appendChild(empty);
      }
      return;
    }

    items.forEach(nb => {
      const card = document.createElement('div');
      card.className = 'notebook-card';
      card.dataset.id = nb.id;

      const themeClass = nb.hasPdf ? 'theme-pdf' : `theme-${nb.coverTheme || 'modern-blue'}`;
      const timeAgo = this.formatTimeAgo(nb.updatedAt);
      const isFav = Boolean(nb.isFavorite);

      card.innerHTML = `
        <div class="notebook-cover-wrapper ${themeClass}">
          <div class="cover-spine"></div>
          ${nb.hasPdf ? '<div class="cover-pdf-badge">PDF</div>' : ''}
          <div class="cover-center-badge">
            <span class="cover-center-title">${this.escapeHtml(nb.title)}</span>
            <span class="cover-center-sub">${nb.pageCount || 1} ${nb.pageCount === 1 ? 'Page' : 'Pages'}</span>
          </div>
        </div>
        <div class="card-meta">
          <div class="card-title-row">
            <span class="card-title" title="${this.escapeHtml(nb.title)}">${this.escapeHtml(nb.title)}</span>
            <div class="card-actions-wrapper">
              <button class="btn-card-fav ${isFav ? 'active' : ''}" title="${isFav ? 'Remove from Favorites' : 'Add to Favorites'}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                </svg>
              </button>
              <button class="btn-card-menu" title="Document Options">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="1"/>
                  <circle cx="12" cy="5" r="1"/>
                  <circle cx="12" cy="19" r="1"/>
                </svg>
              </button>
            </div>
          </div>
          <div class="card-sub-row">
            <span>${nb.pageCount || 1} p</span>
            <span class="card-dot-sep"></span>
            <span>${timeAgo}</span>
          </div>
        </div>
      `;

      // Open on card cover / title click
      card.addEventListener('click', (e) => {
        if (e.target.closest('.btn-card-fav') || e.target.closest('.btn-card-menu') || e.target.closest('.card-context-menu')) {
          return;
        }
        this.openNotebook(nb.id);
      });

      // Favorite toggle
      const btnFav = card.querySelector('.btn-card-fav');
      btnFav.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await this.storage.toggleFavoriteNotebook(nb.id);
          nb.isFavorite = !nb.isFavorite;
          if (this.notebook && this.notebook.id === nb.id) {
            this.notebook.isFavorite = nb.isFavorite;
          }
          btnFav.classList.toggle('active', nb.isFavorite);
          const favCountNow = this.libraryNotebooks.filter(n => n.isFavorite).length;
          if (this.dom.libCountFavorites) this.dom.libCountFavorites.textContent = favCountNow;
          if (this.libraryFilter === 'favorites' && !nb.isFavorite) {
            this.renderLibraryNotebooks();
          }
        } catch (err) {
          console.warn('Favorite toggle error:', err);
        }
      });

      // Context menu
      const btnMenu = card.querySelector('.btn-card-menu');
      btnMenu.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showCardContextMenu(card, nb, btnMenu);
      });

      this.dom.libraryNotebooksGrid.appendChild(card);
    });
  }

  /**
   * Opens an existing notebook by ID from IndexedDB.
   */
  async openNotebook(notebookId) {
    try {
      this.showToast('Opening notebook...');
      if (this.notebook && this.notebook.id !== notebookId && this.isDirty) {
        await this.saveImmediately();
      }

      const doc = await this.storage.loadNotebook(notebookId);
      if (!doc || !doc.pages || doc.pages.length === 0) {
        this.showToast('Notebook could not be loaded.');
        return;
      }

      this.notebook = doc;
      this.isDirty = false;
      // Restore persisted undo/redo history
      this.undoStack = Array.isArray(doc._undoStack) ? doc._undoStack : [];
      this.redoStack = Array.isArray(doc._redoStack) ? doc._redoStack : [];

      // Restore PDF source if present
      if (doc.pdfSource) {
        try {
          await this.pdfManager.loadPdf(doc.pdfSource);
        } catch (pdfErr) {
          console.warn('Could not restore PDF source:', pdfErr);
        }
      }

      this.updateDocTitleDisplay(doc.title || 'Untitled Notebook');
      this.showEditorView();
      this.showToast(`Opened "${doc.title}"`);
    } catch (err) {
      console.error('Error opening notebook:', err);
      this.showToast('Error opening notebook: ' + err.message);
    }
  }

  /**
   * Opens the GoodNotes New Notebook modal with cover theme & paper template picker.
   */
  openNewNotebookModal() {
    if (!this.dom.newNotebookModal) return;
    this.dom.newNotebookTitleInput.value = 'Untitled Notebook';
    this.dom.newNotebookModal.classList.remove('hidden');
    setTimeout(() => {
      this.dom.newNotebookTitleInput.focus();
      this.dom.newNotebookTitleInput.select();
    }, 50);
  }

  closeNewNotebookModal() {
    if (this.dom.newNotebookModal) {
      this.dom.newNotebookModal.classList.add('hidden');
    }
  }

  /**
   * Confirms new notebook creation, saves immediately, and switches to editor.
   */
  async confirmCreateNewNotebook() {
    const title = this.dom.newNotebookTitleInput.value.trim() || 'Untitled Notebook';
    const activeCover = document.querySelector('.cover-theme-card.active');
    const activeTemplate = document.querySelector('#newNotebookTemplateGrid .template-card.active');
    const activePaperColor = document.querySelector('#newNotebookPaperColorPicker .color-choice.active');

    const coverTheme = activeCover ? activeCover.dataset.cover : (this.newNotebookConfig.coverTheme || 'modern-blue');
    const template = activeTemplate ? activeTemplate.dataset.template : (this.newNotebookConfig.template || 'ruled');
    const paperColor = activePaperColor ? activePaperColor.dataset.color : (this.newNotebookConfig.paperColor || 'cream');

    // Save previous notebook
    if (this.notebook) {
      await this.saveImmediately();
    }

    const newId = 'notebook_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 4);
    const newNotebook = {
      id: newId,
      title,
      coverTheme,
      isFavorite: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      currentPageIndex: 0,
      pdfSource: null,
      pages: [
        this.createDefaultPage(1, template, paperColor, 794, 1123)
      ]
    };

    try {
      await this.storage.saveNotebookInstant(newNotebook);
      this.notebook = newNotebook;
      this.undoStack = [];
      this.redoStack = [];

      this.updateDocTitleDisplay(title);
      this.closeNewNotebookModal();
      this.showEditorView();
      this.showToast(`Created "${title}"`);
    } catch (err) {
      console.error('Failed to create notebook:', err);
      this.showToast('Failed to create notebook: ' + err.message);
    }
  }

  /**
   * Displays context options for a card: Open, Duplicate, Rename, Export PDF, Delete
   */
  showCardContextMenu(card, nb, triggerButton) {
    this.closeActiveCardContextMenu();

    const menu = document.createElement('div');
    menu.className = 'card-context-menu';
    menu.innerHTML = `
      <button class="context-menu-item" data-action="open">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        <span>Open</span>
      </button>
      <button class="context-menu-item" data-action="duplicate">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        <span>Duplicate</span>
      </button>
      <button class="context-menu-item" data-action="rename">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
        <span>Rename...</span>
      </button>
      <button class="context-menu-item" data-action="export-pdf">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        <span>Export as PDF</span>
      </button>
      <div class="dropdown-divider"></div>
      <button class="context-menu-item danger" data-action="delete">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        <span>Delete</span>
      </button>
    `;

    menu.addEventListener('click', async (e) => {
      e.stopPropagation();
      const item = e.target.closest('.context-menu-item');
      if (!item) return;
      const action = item.dataset.action;
      this.closeActiveCardContextMenu();

      if (action === 'open') {
        this.openNotebook(nb.id);
      } else if (action === 'duplicate') {
        try {
          this.showToast('Duplicating notebook...');
          await this.storage.duplicateNotebook(nb.id);
          await this.renderLibraryView();
          this.showToast('Notebook duplicated');
        } catch (err) {
          this.showToast('Failed to duplicate: ' + err.message);
        }
      } else if (action === 'rename') {
        const newTitle = prompt('Enter new notebook title:', nb.title);
        if (newTitle && newTitle.trim()) {
          try {
            await this.storage.renameNotebook(nb.id, newTitle.trim());
            if (this.notebook && this.notebook.id === nb.id) {
              this.notebook.title = newTitle.trim();
              this.updateDocTitleDisplay(newTitle.trim());
            }
            await this.renderLibraryView();
            this.showToast('Notebook renamed');
          } catch (err) {
            this.showToast('Failed to rename: ' + err.message);
          }
        }
      } else if (action === 'export-pdf') {
        try {
          this.showToast('Generating PDF...');
          const fullDoc = await this.storage.loadNotebook(nb.id);
          if (fullDoc) {
            if (fullDoc.pdfSource) {
              await this.pdfManager.loadPdf(fullDoc.pdfSource);
            }
            await this.storage.exportToPDF(fullDoc, async (pageIdx) => {
              const oldCurrent = this.notebook;
              this.notebook = fullDoc;
              const canvas = await this.renderPageCompositeCanvas(pageIdx);
              this.notebook = oldCurrent;
              return canvas;
            });
            this.showToast('PDF downloaded successfully');
          }
        } catch (err) {
          this.showToast('Export failed: ' + err.message);
        }
      } else if (action === 'delete') {
        if (confirm(`Are you sure you want to delete "${nb.title}"?`)) {
          try {
            await this.storage.deleteNotebook(nb.id);
            if (this.notebook && this.notebook.id === nb.id) {
              // Create fresh notebook if deleted the active one
              this.notebook = {
                id: 'notebook_' + Date.now().toString(36),
                title: 'Untitled Notebook',
                coverTheme: 'modern-blue',
                isFavorite: false,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                currentPageIndex: 0,
                pdfSource: null,
                pages: [this.createDefaultPage(1, 'ruled', 'cream', 794, 1123)]
              };
              await this.storage.saveNotebookInstant(this.notebook);
            }
            await this.renderLibraryView();
            this.showToast('Notebook deleted');
          } catch (err) {
            this.showToast('Failed to delete: ' + err.message);
          }
        }
      }
    });

    card.appendChild(menu);
    this.activeCardContextMenu = menu;
  }

  closeActiveCardContextMenu() {
    if (this.activeCardContextMenu) {
      this.activeCardContextMenu.remove();
      this.activeCardContextMenu = null;
    }
  }

  toggleTheme() {
    const isDark = document.body.classList.toggle('theme-dark');
    document.body.classList.toggle('theme-light', !isDark);
    if (this.dom.btnToggleTheme) {
      this.dom.btnToggleTheme.querySelector('.sun-icon').classList.toggle('hidden', isDark);
      this.dom.btnToggleTheme.querySelector('.moon-icon').classList.toggle('hidden', !isDark);
    }
    if (this.currentView === 'editor') {
      this.renderCurrentPage();
    }
  }

  formatTimeAgo(timestamp) {
    if (!timestamp) return 'Just now';
    const elapsed = Date.now() - timestamp;
    const mins = Math.floor(elapsed / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString();
  }

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
      <span>${message}</span>
    `;
    this.dom.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 2400);
  }
}

// Instantiate and launch GoodNotes
window.addEventListener('DOMContentLoaded', () => {
  const app = new GoodNotesApp();
  window.goodNotesApp = app;
  app.init();

  // Electron-specific setup
  if (window.electronAPI && window.electronAPI.isElectron) {
    // Show data folder path in library footer
    window.electronAPI.getDataDir().then(r => {
      const el = document.getElementById('electronDataPathInfo');
      if (el && r.success) {
        el.textContent = `📁 Notebooks saved to: ${r.notebooksDir}`;
        el.style.display = 'block';
      }
    });
    // Show Files Folder button
    const folderBtn = document.getElementById('btnOpenFilesFolder');
    if (folderBtn) folderBtn.style.display = '';
  }

  window.addEventListener('beforeunload', () => {
    if (app.storage && app.notebook && app.isDirty) {
      app.notebook._undoStack = (app.undoStack || []).slice(-30);
      app.notebook._redoStack = (app.redoStack || []).slice(-30);
      app.storage.saveNotebookInstant(app.notebook);
    }
  });
});
