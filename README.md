# GoodNotes for Windows (Web & Desktop Clone)

A modern, high-performance GoodNotes clone designed for Windows 10/11 with smooth pressure-sensitive inking, multi-page PDF annotation, paper templates, and export features.

---

## 📁 Repository Structure

```
.
├── GOODNOTES_MASTER_SPEC.md   # Complete architectural blueprint & feature specs
├── CLAUDE_TASK_SPEC.md        # Mathematical algorithms spec for Claude Sonnet (Thinking)
├── GEMINI_BUILD_PLAN.md       # Full application shell & integration plan for Gemini Flash
├── PROMPTS.md                 # Ready-to-use prompts for both models
├── server.py                  # Lightweight local server with Windows Edge App Mode launcher
├── launch_app.bat             # Double-click launcher for Windows
└── templates/                 # High-res paper templates (Plain, Ruled, Grid, Cornell)
```

---

## 🚀 Quick Start on Windows

1. Double click **`launch_app.bat`** (or run `python server.py`).
2. The application opens directly as a focused desktop window in Microsoft Edge App Mode.

---

## 🛠️ Multi-Model Development Workflow

To build or extend the application:
1. **Gemini 3.8 Flash (High):** Builds the UI shell, CSS styling, PDF.js multi-page loader, and DOM events (see `PROMPTS.md` Step 1).
2. **Claude Sonnet 4.6 (Thinking):** Writes the core mathematical algorithms in `modules/` (stroke smoothing, shape classification, lasso ray-casting, coordinate matrix) (see `PROMPTS.md` Step 2).
3. **Gemini 3.8 Flash (High):** Wires everything together, tests in Edge App Mode, and handles PDF/PNG export (see `PROMPTS.md` Step 3).
