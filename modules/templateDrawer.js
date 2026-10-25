/**
 * @file templateDrawer.js
 * @description Vector Paper Template Generator for GoodNotes.
 * Programmatically renders high-resolution paper templates:
 * Plain, Ruled (College/Narrow), Square Grid, Dotted, Cornell, and Dark Mode paper.
 */

export class TemplateDrawer {
  constructor() {
    this.palettes = {
      cream: {
        bg: '#FBF9F4',
        rule: 'rgba(74, 85, 104, 0.14)',
        margin: 'rgba(239, 68, 68, 0.35)',
        grid: 'rgba(74, 85, 104, 0.10)',
        dot: 'rgba(74, 85, 104, 0.28)',
        divider: 'rgba(74, 85, 104, 0.25)',
        text: 'rgba(74, 85, 104, 0.40)'
      },
      white: {
        bg: '#FFFFFF',
        rule: 'rgba(51, 65, 85, 0.12)',
        margin: 'rgba(239, 68, 68, 0.30)',
        grid: 'rgba(51, 65, 85, 0.08)',
        dot: 'rgba(51, 65, 85, 0.24)',
        divider: 'rgba(51, 65, 85, 0.22)',
        text: 'rgba(51, 65, 85, 0.40)'
      },
      dark: {
        bg: '#1E1F24',
        rule: 'rgba(255, 255, 255, 0.09)',
        margin: 'rgba(244, 63, 94, 0.35)',
        grid: 'rgba(255, 255, 255, 0.06)',
        dot: 'rgba(255, 255, 255, 0.18)',
        divider: 'rgba(255, 255, 255, 0.15)',
        text: 'rgba(255, 255, 255, 0.30)'
      },
      black: {
        bg: '#121316',
        rule: 'rgba(255, 255, 255, 0.08)',
        margin: 'rgba(244, 63, 94, 0.30)',
        grid: 'rgba(255, 255, 255, 0.05)',
        dot: 'rgba(255, 255, 255, 0.16)',
        divider: 'rgba(255, 255, 255, 0.14)',
        text: 'rgba(255, 255, 255, 0.25)'
      }
    };
  }

  /**
   * Retrieves color configuration for paper
   */
  getColors(paperColor = 'cream') {
    return this.palettes[paperColor] || this.palettes.cream;
  }

  /**
   * Primary entry point: draws the requested template onto a canvas context.
   * 
   * @param {CanvasRenderingContext2D} ctx 
   * @param {string} template - 'blank'|'ruled'|'ruled-narrow'|'grid'|'dotted'|'cornell'
   * @param {string} paperColor - 'cream'|'white'|'dark'|'black'
   * @param {number} width - Paper logical width (px)
   * @param {number} height - Paper logical height (px)
   */
  drawTemplate(ctx, template = 'ruled', paperColor = 'cream', width = 794, height = 1123) {
    const colors = this.getColors(paperColor);

    // 1. Fill background paper color
    ctx.save();
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, width, height);

    // 2. Render specific template geometry
    switch (template) {
      case 'ruled':
      case 'lined':
        this.drawRuled(ctx, colors, width, height, 28, 80, 70);
        break;

      case 'ruled-narrow':
      case 'lined-narrow':
        this.drawRuled(ctx, colors, width, height, 22, 60, 65);
        break;

      case 'grid':
        this.drawGrid(ctx, colors, width, height, 20);
        break;

      case 'dotted':
        this.drawDotted(ctx, colors, width, height, 20);
        break;

      case 'cornell':
        this.drawCornell(ctx, colors, width, height);
        break;

      case 'blank':
      case 'plain':
      default:
        // Plain paper needs no additional markings
        break;
    }

    ctx.restore();
  }

  /**
   * Renders College / Standard Ruled paper with left margin line.
   */
  drawRuled(ctx, colors, width, height, lineSpacing = 28, topMargin = 80, leftMargin = 70) {
    ctx.save();
    ctx.lineWidth = 1;

    // Horizontal ruled lines
    ctx.strokeStyle = colors.rule;
    ctx.beginPath();
    for (let y = topMargin; y < height - 30; y += lineSpacing) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();

    // Vertical red/accent left margin line
    ctx.strokeStyle = colors.margin;
    ctx.beginPath();
    ctx.moveTo(leftMargin, 0);
    ctx.lineTo(leftMargin, height);
    ctx.stroke();

    ctx.restore();
  }

  /**
   * Renders a 5mm square grid.
   */
  drawGrid(ctx, colors, width, height, gridSize = 20) {
    ctx.save();
    ctx.lineWidth = 0.75;
    ctx.strokeStyle = colors.grid;

    ctx.beginPath();
    // Vertical lines
    for (let x = gridSize; x < width; x += gridSize) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    // Horizontal lines
    for (let y = gridSize; y < height; y += gridSize) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();

    ctx.restore();
  }

  /**
   * Renders a dotted grid with circular dots.
   */
  drawDotted(ctx, colors, width, height, dotSpacing = 20) {
    ctx.save();
    ctx.fillStyle = colors.dot;

    const radius = 1.0;
    const startX = dotSpacing;
    const startY = dotSpacing;

    for (let x = startX; x < width; x += dotSpacing) {
      for (let y = startY; y < height; y += dotSpacing) {
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  /**
   * Renders standard Cornell Notes layout:
   * - Top Header block (Title, Date)
   * - Left Cue / Keywords column (approx 28% width)
   * - Right Notes section (lined)
   * - Bottom Summary section (approx 130px height)
   */
  drawCornell(ctx, colors, width, height) {
    ctx.save();

    const headerHeight = 70;
    const summaryHeight = 130;
    const cueWidth = Math.round(width * 0.28);
    const lineSpacing = 26;

    // Dividers
    ctx.strokeStyle = colors.divider;
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    // Header bottom line
    ctx.moveTo(0, headerHeight);
    ctx.lineTo(width, headerHeight);

    // Cue vertical divider
    ctx.moveTo(cueWidth, headerHeight);
    ctx.lineTo(cueWidth, height - summaryHeight);

    // Summary top line
    ctx.moveTo(0, height - summaryHeight);
    ctx.lineTo(width, height - summaryHeight);
    ctx.stroke();

    // Section Labels (Subtle text)
    ctx.font = '600 11px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = colors.text;

    // Cue Label
    ctx.fillText('CUES / KEYWORDS', 18, headerHeight + 22);

    // Notes Label
    ctx.fillText('NOTES', cueWidth + 20, headerHeight + 22);

    // Summary Label
    ctx.fillText('SUMMARY', 18, height - summaryHeight + 22);

    // Ruled lines in the Notes section
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = colors.rule;
    ctx.beginPath();
    for (let y = headerHeight + 35; y < height - summaryHeight - 15; y += lineSpacing) {
      ctx.moveTo(cueWidth, y);
      ctx.lineTo(width, y);
    }

    // Ruled lines in the Summary section
    for (let y = height - summaryHeight + 35; y < height - 15; y += lineSpacing) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();

    ctx.restore();
  }

  /**
   * Generates a mini thumbnail data URL for a given template to show in template picker.
   */
  generateThumbnail(template, paperColor, thumbWidth = 90, thumbHeight = 120) {
    const canvas = document.createElement('canvas');
    canvas.width = thumbWidth;
    canvas.height = thumbHeight;
    const ctx = canvas.getContext('2d');

    const scaleX = thumbWidth / 794;
    const scaleY = thumbHeight / 1123;
    const scale = Math.min(scaleX, scaleY);

    ctx.scale(scale, scale);
    this.drawTemplate(ctx, template, paperColor, 794, 1123);

    return canvas.toDataURL('image/png');
  }
}
