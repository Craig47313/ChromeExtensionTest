// InkCanvas: a small vector drawing engine on top of <canvas>.
//
// Shapes are plain JSON objects kept in world coordinates, so drawings can be
// panned, zoomed, undone, saved to storage and re-rendered at any resolution.
// The same engine powers drawing notes in the app and the on-page annotator.
(function () {
  'use strict';
  if (globalThis.InkCanvas) return;

  const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const LINE_HEIGHT = 1.25;
  const GRID = 24;
  const MAX_HISTORY = 200;
  const SHAPE_TYPES = new Set(['pen', 'highlighter', 'line', 'arrow', 'rect', 'ellipse', 'text', 'image']);
  const DRAG_SHAPES = new Set(['line', 'arrow', 'rect', 'ellipse']);
  const ALL_TOOLS = ['select', 'pen', 'highlighter', 'eraser', 'line', 'arrow', 'rect', 'ellipse', 'text', 'hand'];
  const KEYMAP = { v: 'select', p: 'pen', h: 'highlighter', e: 'eraser', l: 'line', a: 'arrow', r: 'rect', o: 'ellipse', t: 'text', m: 'hand' };
  const SELECT_COLOR = '#6361e8';
  const HANDLE = 5; // half-size of the resize handle, in screen px

  const round = (v) => Math.round(v * 10) / 10;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function distToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1) : 0;
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  // Polyline approximating a shape's stroke, used for hit testing and bounds.
  function outline(s) {
    switch (s.type) {
      case 'pen':
      case 'highlighter':
        return s.points;
      case 'line':
      case 'arrow':
        return [[s.x1, s.y1], [s.x2, s.y2]];
      case 'rect':
        return [[s.x1, s.y1], [s.x2, s.y1], [s.x2, s.y2], [s.x1, s.y2], [s.x1, s.y1]];
      case 'ellipse': {
        const cx = (s.x1 + s.x2) / 2;
        const cy = (s.y1 + s.y2) / 2;
        const rx = Math.abs(s.x2 - s.x1) / 2;
        const ry = Math.abs(s.y2 - s.y1) / 2;
        const pts = [];
        for (let i = 0; i <= 48; i++) {
          const a = (i / 48) * Math.PI * 2;
          pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
        }
        return pts;
      }
      default:
        return [];
    }
  }

  function shapeBounds(s) {
    if (s.type === 'text' || s.type === 'image') {
      return { minX: s.x, minY: s.y, maxX: s.x + (s.w || 0), maxY: s.y + (s.h || 0) };
    }
    const pts = outline(s);
    if (!pts.length) return null;
    let pad = (s.size || 1) / 2;
    if (s.type === 'arrow') pad += Math.max(10, s.size * 3.5);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of pts) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
  }

  function isValidShape(s) {
    if (!s || typeof s !== 'object' || !SHAPE_TYPES.has(s.type)) return false;
    if (s.type === 'pen' || s.type === 'highlighter') return Array.isArray(s.points) && s.points.length > 0;
    if (s.type === 'text') return typeof s.text === 'string';
    if (s.type === 'image') return typeof s.src === 'string' && /^data:image\//.test(s.src);
    return [s.x1, s.y1, s.x2, s.y2].every(Number.isFinite);
  }

  // Shapes are never mutated in place (undo snapshots share them), so
  // transforms always return new objects.
  function translateShape(s, dx, dy) {
    const t = { ...s };
    if (s.points) t.points = s.points.map(([x, y]) => [round(x + dx), round(y + dy)]);
    else if ('x1' in s) Object.assign(t, { x1: round(s.x1 + dx), y1: round(s.y1 + dy), x2: round(s.x2 + dx), y2: round(s.y2 + dy) });
    else Object.assign(t, { x: round(s.x + dx), y: round(s.y + dy) });
    return t;
  }

  function scaleShape(s, ox, oy, k) {
    const f = (v, o) => round(o + (v - o) * k);
    const t = { ...s };
    if (s.points) t.points = s.points.map(([x, y]) => [f(x, ox), f(y, oy)]);
    else if ('x1' in s) Object.assign(t, { x1: f(s.x1, ox), y1: f(s.y1, oy), x2: f(s.x2, ox), y2: f(s.y2, oy) });
    else {
      Object.assign(t, { x: f(s.x, ox), y: f(s.y, oy), w: round(s.w * k), h: round(s.h * k) });
      if (s.type === 'text') t.fontSize = Math.max(4, round(s.fontSize * k));
    }
    return t;
  }

  function unionBounds(shapes) {
    let b = null;
    for (const s of shapes) {
      const sb = shapeBounds(s);
      if (!sb) continue;
      if (!b) b = { ...sb };
      else {
        b.minX = Math.min(b.minX, sb.minX);
        b.minY = Math.min(b.minY, sb.minY);
        b.maxX = Math.max(b.maxX, sb.maxX);
        b.maxY = Math.max(b.maxY, sb.maxY);
      }
    }
    return b;
  }

  class InkCanvas {
    constructor(canvas, opts = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.opts = opts;
      this.panEnabled = opts.pan !== false;
      this.frame = null; // { w, h } for fixed-size drawings (stickies / inline sketches)
      this.paperColor = null;
      this.tools = new Set(opts.tools || ALL_TOOLS);
      this.shapes = [];
      this.undoStack = [];
      this.redoStack = [];
      this.view = { x: 0, y: 0, scale: 1 };
      this.background = 'none';
      this.paper = opts.paper || null;
      this.inkColor = opts.inkColor || '#1e1e2e';
      this.gridColor = opts.gridColor || 'rgba(20,20,40,0.09)';
      this.tool = 'pen';
      this.styles = {
        pen: { color: 'ink', size: 4 },
        highlighter: { color: '#fcc419', size: 18 },
        eraser: { size: 24 },
        ...(opts.styles || {}),
      };
      this.images = new Map();
      this.current = null;
      this.erasing = null;
      this.panning = null;
      this.hover = null;
      this.spaceDown = false;
      this.activePointer = null;
      this.textEditor = null;
      this.editingShape = null;
      this.selection = new Set();
      this.transform = null; // active move/scale drag
      this.marquee = null; // active box selection
      this.dpr = 1;
      this.width = 0;
      this.height = 0;
      this._raf = 0;

      this._handlers = {
        pointerdown: (e) => this._pointerDown(e),
        pointermove: (e) => this._pointerMove(e),
        pointerup: (e) => this._pointerUp(e),
        pointercancel: (e) => this._pointerUp(e),
        pointerleave: () => {
          this.hover = null;
          this.requestRender();
        },
        contextmenu: (e) => e.preventDefault(),
        dblclick: (e) => {
          // Double-click a text shape with the select tool to edit it.
          if (this.tool !== 'select') return;
          const s = this._screen(e);
          const hit = this._topHit(this.toWorld(s.x, s.y), 4 / this.view.scale, (sh) => sh.type === 'text');
          if (hit) {
            this.clearSelection();
            this._startText(null, hit);
          }
        },
      };
      for (const [type, fn] of Object.entries(this._handlers)) canvas.addEventListener(type, fn);
      this._onWheel = (e) => this._wheel(e);
      canvas.addEventListener('wheel', this._onWheel, { passive: false });
      canvas.style.touchAction = 'none';

      this._ro = new ResizeObserver(() => this.resize());
      this._ro.observe(canvas);
      this.resize();
      this.updateCursor();
    }

    destroy() {
      this.commitText();
      for (const [type, fn] of Object.entries(this._handlers)) this.canvas.removeEventListener(type, fn);
      this.canvas.removeEventListener('wheel', this._onWheel);
      this._ro.disconnect();
      cancelAnimationFrame(this._raf);
    }

    // ---------- style ----------

    styleGroup(tool = this.tool) {
      if (tool === 'highlighter') return 'highlighter';
      if (tool === 'eraser') return 'eraser';
      return 'pen';
    }

    get color() {
      const g = this.styleGroup();
      return (this.styles[g] && this.styles[g].color) || this.styles.pen.color;
    }

    set color(c) {
      const g = this.styleGroup();
      (g === 'eraser' ? this.styles.pen : this.styles[g]).color = c;
      this._emit('onStyleChange');
    }

    get size() {
      return this.styles[this.styleGroup()].size;
    }

    set size(v) {
      this.styles[this.styleGroup()].size = clamp(Math.round(v), 1, 80);
      this._emit('onStyleChange');
      this.requestRender();
    }

    textSize() {
      return clamp(10 + this.styles.pen.size * 2.5, 12, 96);
    }

    resolveColor(c) {
      // Fixed-size sketches always sit on light paper, so ink stays dark.
      if (c === 'ink' || !c) return this.frame ? '#1e1e2e' : this.inkColor;
      return c;
    }

    setTool(tool) {
      if (!this.tools.has(tool)) return;
      this.commitText();
      if (tool !== 'select') this.clearSelection();
      this.tool = tool;
      this.updateCursor();
      this.requestRender();
      this._emit('onToolChange', tool);
    }

    updateCursor(hoverCursor) {
      let cursor = 'crosshair';
      if (this.panning) cursor = 'grabbing';
      else if (this.tool === 'hand' || (this.spaceDown && this.panEnabled)) cursor = 'grab';
      else if (this.tool === 'select') cursor = hoverCursor || 'default';
      else if (this.tool === 'eraser') cursor = 'none';
      else if (this.tool === 'text') cursor = 'text';
      this.canvas.style.cursor = cursor;
    }

    // ---------- geometry ----------

    resize() {
      const r = this.canvas.getBoundingClientRect();
      this.dpr = window.devicePixelRatio || 1;
      this.width = r.width;
      this.height = r.height;
      const w = Math.max(1, Math.round(r.width * this.dpr));
      const h = Math.max(1, Math.round(r.height * this.dpr));
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
      }
      if (this.frame && this.width) this.view = { x: 0, y: 0, scale: this.width / this.frame.w };
      this.render();
    }

    _screen(e) {
      const r = this.canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    toWorld(sx, sy) {
      return { x: (sx - this.view.x) / this.view.scale, y: (sy - this.view.y) / this.view.scale };
    }

    setView(x, y, scale = this.view.scale) {
      this.view = { x, y, scale };
      this._viewChanged();
    }

    resetView() {
      if (this.frame) return;
      this.setView(0, 0, 1);
    }

    zoomAt(sx, sy, factor) {
      if (this.frame) return;
      const scale = clamp(this.view.scale * factor, 0.1, 8);
      const k = scale / this.view.scale;
      this.view = { x: sx - (sx - this.view.x) * k, y: sy - (sy - this.view.y) * k, scale };
      this._viewChanged();
    }

    zoomBy(factor) {
      this.zoomAt(this.width / 2, this.height / 2, factor);
    }

    zoomToFit(padding = 32) {
      if (this.frame) return;
      const b = this.bounds();
      if (!b) return this.resetView();
      const w = b.maxX - b.minX;
      const h = b.maxY - b.minY;
      const scale = clamp(Math.min((this.width - padding * 2) / w, (this.height - padding * 2) / h, 1), 0.1, 8);
      this.setView(
        (this.width - w * scale) / 2 - b.minX * scale,
        (this.height - h * scale) / 2 - b.minY * scale,
        scale
      );
    }

    _viewChanged() {
      if (this.textEditor) this.commitText();
      this.requestRender();
      this._emit('onViewChange', this.view);
    }

    bounds() {
      let b = null;
      for (const s of this.shapes) {
        const sb = shapeBounds(s);
        if (!sb) continue;
        if (!b) b = { ...sb };
        else {
          b.minX = Math.min(b.minX, sb.minX);
          b.minY = Math.min(b.minY, sb.minY);
          b.maxX = Math.max(b.maxX, sb.maxX);
          b.maxY = Math.max(b.maxY, sb.maxY);
        }
      }
      return b;
    }

    // ---------- input ----------

    _pointerDown(e) {
      if (this.textEditor) {
        this.commitText();
        if (this.tool === 'text') return; // a click outside just finishes typing
      }
      if (e.button === 2) return;
      if (this.activePointer !== null && this.activePointer !== e.pointerId) return;

      const s = this._screen(e);
      const w = this.toWorld(s.x, s.y);
      this.activePointer = e.pointerId;
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch (_) {
        /* pointer may already be gone */
      }
      e.preventDefault();

      if (this.panEnabled && (this.tool === 'hand' || e.button === 1 || this.spaceDown)) {
        this.panning = { sx: e.clientX, sy: e.clientY, vx: this.view.x, vy: this.view.y };
        this.updateCursor();
        return;
      }
      if (e.button !== 0) {
        this.activePointer = null;
        return;
      }

      // Stylus eraser end / barrel button erases regardless of the active tool.
      const tool = e.buttons & 32 ? 'eraser' : this.tool;
      const group = this.styleGroup(tool);
      const style = this.styles[group];

      if (tool === 'pen' || tool === 'highlighter') {
        this.current = { type: tool, color: style.color, size: style.size, points: [[round(w.x), round(w.y)]] };
      } else if (DRAG_SHAPES.has(tool)) {
        this.current = { type: tool, color: style.color, size: style.size, x1: round(w.x), y1: round(w.y), x2: round(w.x), y2: round(w.y) };
      } else if (tool === 'eraser') {
        this.erasing = { before: this.shapes.slice(), removed: false };
        this._eraseAt(w);
      } else if (tool === 'text') {
        this.activePointer = null;
        const hit = this._topHit(w, 0, (sh) => sh.type === 'text');
        this._startText(w, hit);
      } else if (tool === 'select') {
        this._selectDown(s, w, e.shiftKey);
      }
      this.requestRender();
    }

    _selectDown(s, w, additive) {
      if (this._handleAt(s)) {
        this.transform = { mode: 'scale', base: this.shapes.slice(), sel: new Set(this.selection), b: this.selectionBounds(), start: w };
        return;
      }
      const hit = this._topHit(w, 6 / this.view.scale);
      const inBounds = this._inSelectionBounds(w);
      if (hit && additive && this.selection.has(hit)) {
        this.selection.delete(hit);
        this._selectionChanged();
        return;
      }
      if (hit && !this.selection.has(hit)) {
        if (!additive) this.selection.clear();
        this.selection.add(hit);
        this._selectionChanged();
      }
      if (hit || (inBounds && !additive)) {
        this.transform = { mode: 'move', base: this.shapes.slice(), sel: new Set(this.selection), start: w };
      } else {
        if (!additive && this.selection.size) {
          this.selection.clear();
          this._selectionChanged();
        }
        this.marquee = { x1: w.x, y1: w.y, x2: w.x, y2: w.y };
      }
    }

    _selectMove(w, shiftKey) {
      const t = this.transform;
      let dx = w.x - t.start.x;
      let dy = w.y - t.start.y;
      let fn;
      if (t.mode === 'move') {
        if (shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        fn = (sh) => translateShape(sh, dx, dy);
      } else {
        const bw = Math.max(1, t.b.maxX - t.b.minX);
        const bh = Math.max(1, t.b.maxY - t.b.minY);
        const k = Math.max(0.05, Math.max((bw + dx) / bw, (bh + dy) / bh));
        fn = (sh) => scaleShape(sh, t.b.minX, t.b.minY, k);
      }
      const next = new Set();
      this.shapes = t.base.map((sh) => {
        if (!t.sel.has(sh)) return sh;
        const n = fn(sh);
        next.add(n);
        return n;
      });
      this.selection = next;
      t.moved = dx !== 0 || dy !== 0;
    }

    _selectUp() {
      if (this.transform) {
        const t = this.transform;
        this.transform = null;
        if (t.moved) this._record(t.base);
        else {
          this.shapes = t.base;
          this.selection = t.sel;
        }
      } else if (this.marquee) {
        const m = this.marquee;
        this.marquee = null;
        const box = { minX: Math.min(m.x1, m.x2), minY: Math.min(m.y1, m.y2), maxX: Math.max(m.x1, m.x2), maxY: Math.max(m.y1, m.y2) };
        for (const sh of this.shapes) {
          const b = shapeBounds(sh);
          if (b && b.minX <= box.maxX && b.maxX >= box.minX && b.minY <= box.maxY && b.maxY >= box.minY) this.selection.add(sh);
        }
        this._selectionChanged();
      }
      this.requestRender();
    }

    // ---------- selection ----------

    selectionBounds() {
      return this.selection.size ? unionBounds(this.selection) : null;
    }

    _inSelectionBounds(w) {
      const b = this.selectionBounds();
      return !!b && w.x >= b.minX && w.x <= b.maxX && w.y >= b.minY && w.y <= b.maxY;
    }

    _handleAt(s) {
      const b = this.selectionBounds();
      if (!b) return false;
      const hx = b.maxX * this.view.scale + this.view.x;
      const hy = b.maxY * this.view.scale + this.view.y;
      return Math.abs(s.x - hx) <= HANDLE + 3 && Math.abs(s.y - hy) <= HANDLE + 3;
    }

    _selectionChanged() {
      this.requestRender();
      this._emit('onSelectionChange', this.selection.size);
    }

    clearSelection() {
      if (!this.selection.size) return;
      this.selection = new Set();
      this._selectionChanged();
    }

    selectAll() {
      this.setTool('select');
      this.selection = new Set(this.shapes);
      this._selectionChanged();
    }

    _transformSelection(fn) {
      if (!this.selection.size) return;
      const before = this.shapes.slice();
      const next = new Set();
      this.shapes = this.shapes.map((sh) => {
        if (!this.selection.has(sh)) return sh;
        const n = fn(sh);
        next.add(n);
        return n;
      });
      this.selection = next;
      this._record(before);
    }

    deleteSelection() {
      if (!this.selection.size) return;
      const sel = this.selection;
      this.selection = new Set();
      this._mutate(() => {
        this.shapes = this.shapes.filter((sh) => !sel.has(sh));
      });
      this._emit('onSelectionChange', 0);
    }

    duplicateSelection() {
      if (!this.selection.size) return;
      const offset = 16 / this.view.scale;
      const copies = this.shapes.filter((sh) => this.selection.has(sh)).map((sh) => translateShape(sh, offset, offset));
      this._mutate(() => this.shapes.push(...copies));
      this.selection = new Set(copies);
      this._selectionChanged();
    }

    // Recolor selected shapes (images keep their pixels). Returns true if applied.
    recolorSelection(color) {
      if (!this.selection.size) return false;
      this._transformSelection((sh) => (sh.type === 'image' ? sh : { ...sh, color }));
      return true;
    }

    // Move selected shapes to the front (top of the stack) or back.
    reorderSelection(toFront) {
      if (!this.selection.size) return;
      this._mutate(() => {
        const sel = this.shapes.filter((sh) => this.selection.has(sh));
        const rest = this.shapes.filter((sh) => !this.selection.has(sh));
        this.shapes = toFront ? rest.concat(sel) : sel.concat(rest);
      });
    }

    _pointerMove(e) {
      const s = this._screen(e);
      this.hover = s;
      if (e.pointerId !== this.activePointer) {
        if (this.tool === 'eraser') this.requestRender();
        else if (this.tool === 'select' && !this.spaceDown) {
          const w = this.toWorld(s.x, s.y);
          let hoverCursor = 'default';
          if (this._handleAt(s)) hoverCursor = 'nwse-resize';
          else if (this._inSelectionBounds(w) || this._topHit(w, 6 / this.view.scale)) hoverCursor = 'move';
          this.updateCursor(hoverCursor);
        }
        return;
      }
      if (this.panning) {
        this.view = { ...this.view, x: this.panning.vx + e.clientX - this.panning.sx, y: this.panning.vy + e.clientY - this.panning.sy };
        this._viewChanged();
        return;
      }
      const events = (e.getCoalescedEvents && e.getCoalescedEvents()) || [];
      const samples = events.length ? events : [e];

      if (this.transform) {
        this._selectMove(this.toWorld(s.x, s.y), e.shiftKey);
      } else if (this.marquee) {
        const w = this.toWorld(s.x, s.y);
        this.marquee.x2 = w.x;
        this.marquee.y2 = w.y;
      } else if (this.erasing) {
        for (const ev of samples) {
          const p = this._screen(ev);
          this._eraseAt(this.toWorld(p.x, p.y));
        }
      } else if (this.current) {
        const cur = this.current;
        if (cur.points) {
          const minDist = 0.75 / this.view.scale;
          for (const ev of samples) {
            const p = this._screen(ev);
            const w = this.toWorld(p.x, p.y);
            const last = cur.points[cur.points.length - 1];
            if (Math.hypot(w.x - last[0], w.y - last[1]) >= minDist) cur.points.push([round(w.x), round(w.y)]);
          }
        } else {
          const w = this.toWorld(s.x, s.y);
          let x2 = w.x;
          let y2 = w.y;
          if (e.shiftKey) [x2, y2] = this._constrain(cur, x2, y2);
          cur.x2 = round(x2);
          cur.y2 = round(y2);
        }
      }
      this.requestRender();
    }

    _pointerUp(e) {
      if (e.pointerId !== this.activePointer) return;
      this.activePointer = null;

      if (this.panning) {
        this.panning = null;
        this.updateCursor();
        return;
      }
      if (this.transform || this.marquee) {
        this._selectUp();
        return;
      }
      if (this.erasing) {
        const { before, removed } = this.erasing;
        this.erasing = null;
        if (removed) this._record(before);
        this.requestRender();
        return;
      }
      if (this.current) {
        const s = this.current;
        this.current = null;
        const tiny = !s.points && Math.hypot(s.x2 - s.x1, s.y2 - s.y1) * this.view.scale < 3;
        if (!tiny) this._mutate(() => this.shapes.push(s));
        this.requestRender();
      }
    }

    _constrain(s, x, y) {
      const dx = x - s.x1;
      const dy = y - s.y1;
      if (s.type === 'line' || s.type === 'arrow') {
        const step = Math.PI / 4;
        const a = Math.round(Math.atan2(dy, dx) / step) * step;
        const len = Math.hypot(dx, dy);
        return [s.x1 + Math.cos(a) * len, s.y1 + Math.sin(a) * len];
      }
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      return [s.x1 + Math.sign(dx || 1) * d, s.y1 + Math.sign(dy || 1) * d];
    }

    _wheel(e) {
      if (!this.panEnabled) return; // let the page / container scroll
      e.preventDefault();
      const s = this._screen(e);
      if (e.ctrlKey || e.metaKey) {
        this.zoomAt(s.x, s.y, Math.exp(-e.deltaY * 0.01));
      } else {
        const k = e.deltaMode === 1 ? 16 : 1;
        this.view = { ...this.view, x: this.view.x - e.deltaX * k, y: this.view.y - e.deltaY * k };
        this._viewChanged();
      }
    }

    // Returns true when the key was handled.
    handleKeyDown(e) {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z') {
        e.shiftKey ? this.redo() : this.undo();
        return true;
      }
      if (mod && key === 'y') {
        this.redo();
        return true;
      }
      if (mod && key === 'a' && this.tools.has('select') && this.shapes.length) {
        this.selectAll();
        return true;
      }
      if (this.selection.size) {
        if (mod && key === 'd') {
          this.duplicateSelection();
          return true;
        }
        if (!mod && (e.key === 'Delete' || e.key === 'Backspace')) {
          this.deleteSelection();
          return true;
        }
        if (e.key === 'Escape') {
          this.clearSelection();
          return true;
        }
        if (mod && (e.key === ']' || e.key === '[')) {
          this.reorderSelection(e.key === ']');
          return true;
        }
        const nudge = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
        if (nudge && !mod) {
          const step = (e.shiftKey ? 10 : 1) / this.view.scale;
          this._transformSelection((sh) => translateShape(sh, nudge[0] * step, nudge[1] * step));
          return true;
        }
      }
      if (mod || e.altKey) return false;
      if (e.key === ' ') {
        if (!this.panEnabled) return false;
        if (!this.spaceDown) {
          this.spaceDown = true;
          this.updateCursor();
        }
        return true;
      }
      if (e.key === '[' || e.key === ']') {
        this.size = this.size + (e.key === ']' ? 1 : -1) * Math.max(1, Math.round(this.size * 0.2));
        return true;
      }
      const tool = KEYMAP[key];
      if (tool && this.tools.has(tool)) {
        this.setTool(tool);
        return true;
      }
      return false;
    }

    handleKeyUp(e) {
      if (e.key === ' ' && this.spaceDown) {
        this.spaceDown = false;
        this.updateCursor();
      }
    }

    // ---------- editing ----------

    _hit(s, x, y, r) {
      if (s.type === 'text' || s.type === 'image') {
        return x >= s.x - r && x <= s.x + s.w + r && y >= s.y - r && y <= s.y + s.h + r;
      }
      const pts = outline(s);
      const tol = r + (s.size || 1) / 2;
      if (pts.length === 1) return Math.hypot(x - pts[0][0], y - pts[0][1]) <= tol;
      for (let i = 1; i < pts.length; i++) {
        if (distToSegment(x, y, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) <= tol) return true;
      }
      return false;
    }

    _topHit(w, r, filter = () => true) {
      for (let i = this.shapes.length - 1; i >= 0; i--) {
        const s = this.shapes[i];
        if (filter(s) && this._hit(s, w.x, w.y, r)) return s;
      }
      return null;
    }

    _eraseAt(w) {
      const r = this.styles.eraser.size / 2 / this.view.scale;
      const keep = this.shapes.filter((s) => !this._hit(s, w.x, w.y, r));
      if (keep.length !== this.shapes.length) {
        this.shapes = keep;
        this.erasing.removed = true;
      }
    }

    // Snapshot the current shapes, run a mutation, and record it for undo.
    _mutate(fn) {
      const before = this.shapes.slice();
      fn();
      this._record(before);
    }

    _record(before) {
      this.undoStack.push(before);
      if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
      this.redoStack = [];
      this._changed();
    }

    _changed() {
      this.requestRender();
      this._emit('onChange');
      this._emit('onHistoryChange');
    }

    get canUndo() {
      return this.undoStack.length > 0;
    }

    get canRedo() {
      return this.redoStack.length > 0;
    }

    undo() {
      this.commitText();
      if (!this.undoStack.length) return;
      this.clearSelection();
      this.redoStack.push(this.shapes);
      this.shapes = this.undoStack.pop();
      this._changed();
    }

    redo() {
      this.commitText();
      if (!this.redoStack.length) return;
      this.clearSelection();
      this.undoStack.push(this.shapes);
      this.shapes = this.redoStack.pop();
      this._changed();
    }

    clear() {
      this.commitText();
      if (!this.shapes.length) return;
      this.clearSelection();
      this._mutate(() => {
        this.shapes = [];
      });
    }

    setBackground(bg) {
      this.background = bg;
      this.requestRender();
      this._emit('onChange');
    }

    // Place an image (data URL). Without a position it is centered in view.
    addImage(src, naturalW, naturalH, at) {
      const maxW = (this.width * 0.8) / this.view.scale;
      const maxH = (this.height * 0.8) / this.view.scale;
      const k = Math.min(1, maxW / naturalW, maxH / naturalH) || 1;
      const w = round(naturalW * k);
      const h = round(naturalH * k);
      const center = at || this.toWorld(this.width / 2, this.height / 2);
      const shape = { type: 'image', src, x: round(center.x - w / 2), y: round(center.y - h / 2), w, h };
      this._mutate(() => this.shapes.push(shape));
    }

    // ---------- text ----------

    _measureText(text, fontSize) {
      const ctx = this.ctx;
      ctx.save();
      ctx.font = `${fontSize}px ${FONT}`;
      const lines = text.split('\n');
      const w = Math.max(...lines.map((l) => ctx.measureText(l).width));
      ctx.restore();
      return { w: round(w), h: round(lines.length * fontSize * LINE_HEIGHT) };
    }

    _startText(w, existing) {
      const fontSize = existing ? existing.fontSize : this.textSize();
      const color = existing ? existing.color : this.styles.pen.color;
      const pos = existing ? { x: existing.x, y: existing.y } : { x: w.x, y: w.y - (fontSize * LINE_HEIGHT) / 2 };
      const ta = document.createElement('textarea');
      ta.className = 'ink-text-input';
      ta.wrap = 'off';
      ta.spellcheck = false;
      ta.value = existing ? existing.text : '';
      const scale = this.view.scale;
      Object.assign(ta.style, {
        position: 'absolute',
        left: `${this.canvas.offsetLeft + pos.x * scale + this.view.x}px`,
        top: `${this.canvas.offsetTop + pos.y * scale + this.view.y}px`,
        font: `${fontSize * scale}px/${LINE_HEIGHT} ${FONT}`,
        color: this.resolveColor(color),
        background: 'transparent',
        border: '1px dashed rgba(110,110,240,.8)',
        borderRadius: '2px',
        outline: 'none',
        resize: 'none',
        padding: '0',
        margin: '-1px 0 0 -1px',
        overflow: 'hidden',
        whiteSpace: 'pre',
        minWidth: '24px',
        zIndex: '5',
        boxSizing: 'content-box',
      });
      const autosize = () => {
        ta.style.width = '0px';
        ta.style.height = '0px';
        ta.style.width = `${ta.scrollWidth + fontSize * scale * 0.5}px`;
        ta.style.height = `${ta.scrollHeight}px`;
      };
      ta.addEventListener('input', autosize);
      ta.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          this.commitText();
        }
      });
      ta.addEventListener('blur', () => this.commitText());
      this.canvas.parentElement.appendChild(ta);
      this.textEditor = { ta, pos, fontSize, color, existing };
      this.editingShape = existing || null;
      this.requestRender();
      autosize();
      setTimeout(() => {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      }, 0);
    }

    commitText() {
      const t = this.textEditor;
      if (!t) return;
      this.textEditor = null;
      this.editingShape = null;
      const text = t.ta.value.replace(/\s+$/, '');
      t.ta.remove();
      if (t.existing && text === t.existing.text) {
        this.requestRender();
        return;
      }
      const shape = text
        ? { type: 'text', text, color: t.color, fontSize: t.fontSize, x: round(t.pos.x), y: round(t.pos.y), ...this._measureText(text, t.fontSize) }
        : null;
      this._mutate(() => {
        if (t.existing) this.shapes = this.shapes.filter((s) => s !== t.existing);
        if (shape) this.shapes.push(shape);
      });
    }

    // ---------- rendering ----------

    requestRender() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => {
        this._raf = 0;
        this.render();
      });
    }

    render() {
      const { ctx, dpr, view } = this;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      const paper = this.frame ? this.paperColor || '#ffffff' : this.paper;
      if (paper) {
        ctx.fillStyle = paper;
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      }
      ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.x, dpr * view.y);
      this._drawBackground(ctx);
      for (const s of this.shapes) if (s !== this.editingShape) this._drawShape(ctx, s);
      if (this.current) this._drawShape(ctx, this.current);

      if (this.hover && this.tool === 'eraser' && !this.panning && !this.spaceDown) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.beginPath();
        ctx.arc(this.hover.x, this.hover.y, this.styles.eraser.size / 2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(127,127,127,0.12)';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(127,127,127,0.9)';
        ctx.stroke();
      }
      this._drawSelection(ctx);
    }

    _drawSelection(ctx) {
      const { dpr, view } = this;
      const toScreen = (x, y) => [x * view.scale + view.x, y * view.scale + view.y];
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineWidth = 1;
      ctx.strokeStyle = SELECT_COLOR;
      if (this.selection.size) {
        if (this.selection.size > 1) {
          ctx.globalAlpha = 0.45;
          for (const s of this.selection) {
            const b = shapeBounds(s);
            if (!b) continue;
            const [x1, y1] = toScreen(b.minX, b.minY);
            const [x2, y2] = toScreen(b.maxX, b.maxY);
            ctx.strokeRect(Math.round(x1) + 0.5, Math.round(y1) + 0.5, Math.round(x2 - x1), Math.round(y2 - y1));
          }
          ctx.globalAlpha = 1;
        }
        const b = this.selectionBounds();
        const [x1, y1] = toScreen(b.minX, b.minY);
        const [x2, y2] = toScreen(b.maxX, b.maxY);
        ctx.setLineDash([5, 4]);
        ctx.strokeRect(Math.round(x1 - 4) + 0.5, Math.round(y1 - 4) + 0.5, Math.round(x2 - x1 + 8), Math.round(y2 - y1 + 8));
        ctx.setLineDash([]);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x2 - HANDLE, y2 - HANDLE, HANDLE * 2, HANDLE * 2);
        ctx.strokeRect(x2 - HANDLE, y2 - HANDLE, HANDLE * 2, HANDLE * 2);
      }
      if (this.marquee) {
        const m = this.marquee;
        const [x1, y1] = toScreen(m.x1, m.y1);
        const [x2, y2] = toScreen(m.x2, m.y2);
        ctx.fillStyle = 'rgba(99,97,232,0.08)';
        ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      }
      ctx.restore();
    }

    _drawBackground(ctx) {
      const bg = this.background;
      if (!bg || bg === 'none') return;
      const { scale } = this.view;
      let step = GRID;
      while (step * scale < 12) step *= 2;
      const x0 = -this.view.x / scale;
      const y0 = -this.view.y / scale;
      const x1 = x0 + this.width / scale;
      const y1 = y0 + this.height / scale;
      const sx = Math.floor(x0 / step) * step;
      const sy = Math.floor(y0 / step) * step;

      ctx.save();
      if (bg === 'dots') {
        ctx.fillStyle = (this.frame ? 'rgba(20,20,40,0.12)' : this.gridColor);
        const r = 2 / scale;
        for (let x = sx; x <= x1; x += step) {
          for (let y = sy; y <= y1; y += step) ctx.fillRect(x - r / 2, y - r / 2, r, r);
        }
      } else {
        ctx.strokeStyle = (this.frame ? 'rgba(20,20,40,0.12)' : this.gridColor);
        ctx.lineWidth = 1 / scale;
        ctx.beginPath();
        if (bg === 'grid') {
          for (let x = sx; x <= x1; x += step) {
            ctx.moveTo(x, y0);
            ctx.lineTo(x, y1);
          }
        }
        for (let y = sy; y <= y1; y += step) {
          ctx.moveTo(x0, y);
          ctx.lineTo(x1, y);
        }
        ctx.stroke();
      }
      ctx.restore();
    }

    _drawShape(ctx, s) {
      ctx.save();
      const color = this.resolveColor(s.color);
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = s.size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      switch (s.type) {
        case 'highlighter':
          ctx.globalAlpha = 0.38;
          this._strokePath(ctx, s.points, s.size);
          break;
        case 'pen':
          this._strokePath(ctx, s.points, s.size);
          break;
        case 'line':
        case 'arrow': {
          ctx.beginPath();
          ctx.moveTo(s.x1, s.y1);
          ctx.lineTo(s.x2, s.y2);
          if (s.type === 'arrow') {
            const a = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
            const len = Math.max(10, s.size * 3.5);
            ctx.moveTo(s.x2 - len * Math.cos(a - Math.PI / 6), s.y2 - len * Math.sin(a - Math.PI / 6));
            ctx.lineTo(s.x2, s.y2);
            ctx.lineTo(s.x2 - len * Math.cos(a + Math.PI / 6), s.y2 - len * Math.sin(a + Math.PI / 6));
          }
          ctx.stroke();
          break;
        }
        case 'rect':
          ctx.strokeRect(Math.min(s.x1, s.x2), Math.min(s.y1, s.y2), Math.abs(s.x2 - s.x1), Math.abs(s.y2 - s.y1));
          break;
        case 'ellipse':
          ctx.beginPath();
          ctx.ellipse(
            (s.x1 + s.x2) / 2,
            (s.y1 + s.y2) / 2,
            Math.max(Math.abs(s.x2 - s.x1) / 2, 0.1),
            Math.max(Math.abs(s.y2 - s.y1) / 2, 0.1),
            0,
            0,
            Math.PI * 2
          );
          ctx.stroke();
          break;
        case 'text': {
          ctx.font = `${s.fontSize}px ${FONT}`;
          ctx.textBaseline = 'middle';
          const lh = s.fontSize * LINE_HEIGHT;
          s.text.split('\n').forEach((line, i) => ctx.fillText(line, s.x, s.y + i * lh + lh / 2));
          break;
        }
        case 'image': {
          const img = this._image(s.src);
          if (img.complete && img.naturalWidth) ctx.drawImage(img, s.x, s.y, s.w, s.h);
          else {
            ctx.fillStyle = 'rgba(127,127,127,0.15)';
            ctx.fillRect(s.x, s.y, s.w, s.h);
          }
          // Hairline frame so e.g. a white page screenshot stays visible on white paper.
          ctx.lineWidth = 1 / (ctx.getTransform().a || 1);
          ctx.strokeStyle = 'rgba(127,127,127,0.35)';
          ctx.strokeRect(s.x, s.y, s.w, s.h);
          break;
        }
      }
      ctx.restore();
    }

    _strokePath(ctx, pts, size) {
      if (pts.length === 1) {
        ctx.beginPath();
        ctx.arc(pts[0][0], pts[0][1], size / 2, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      if (pts.length === 2) {
        ctx.lineTo(pts[1][0], pts[1][1]);
      } else {
        // Quadratic curves through segment midpoints give smooth ink.
        for (let i = 1; i < pts.length - 1; i++) {
          const mx = (pts[i][0] + pts[i + 1][0]) / 2;
          const my = (pts[i][1] + pts[i + 1][1]) / 2;
          ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
        }
        const last = pts[pts.length - 1];
        ctx.lineTo(last[0], last[1]);
      }
      ctx.stroke();
    }

    _image(src) {
      let img = this.images.get(src);
      if (!img) {
        img = new Image();
        img.onload = () => this.requestRender();
        img.src = src;
        this.images.set(src, img);
      }
      return img;
    }

    // ---------- persistence & export ----------

    load(data, { keepView = false } = {}) {
      this.commitText();
      const d = data || {};
      this.shapes = Array.isArray(d.shapes) ? d.shapes.filter(isValidShape) : [];
      this.selection = new Set();
      this.transform = null;
      this.marquee = null;
      this.background = d.background || 'none';
      const f = d.frame;
      this.frame = f && f.w > 0 && f.h > 0 ? { w: f.w, h: f.h } : null;
      this.paperColor = this.frame ? d.paperColor || '#ffffff' : null;
      this.panEnabled = !this.frame && this.opts.pan !== false;
      this.undoStack = [];
      this.redoStack = [];
      this.current = null;
      this.erasing = null;
      if (!keepView) this.view = { x: 0, y: 0, scale: 1 };
      if (this.frame) this.resize();
      this.updateCursor();
      this.requestRender();
      this._emit('onHistoryChange');
      this._emit('onViewChange', this.view);
    }

    toJSON() {
      const out = { v: 1, background: this.background, shapes: this.shapes };
      if (this.frame) Object.assign(out, { frame: { ...this.frame }, paperColor: this.paperColor });
      return out;
    }

    // Change a fixed drawing's size or paper color (not part of undo history).
    setFrame(patch) {
      if (!this.frame) return;
      if (patch.w && patch.h) this.frame = { w: patch.w, h: patch.h };
      if (patch.paperColor) this.paperColor = patch.paperColor;
      this.resize();
      this._emit('onChange');
    }

    // Render all shapes (cropped to their bounds) into a data URL.
    async toImage({ type = 'image/png', quality = 0.92, maxSize = 8192, padding = 24, background = '#ffffff', scale = 2, ink = '#1e1e2e' } = {}) {
      // Fixed-size drawings export exactly their frame, paper and pattern included.
      const fixed = this.frame;
      if (fixed) {
        padding = 0;
        background = this.paperColor || '#ffffff';
      }
      const b = fixed ? { minX: 0, minY: 0, maxX: fixed.w, maxY: fixed.h } : this.bounds();
      if (!b) return null;
      await Promise.all(
        this.shapes
          .filter((s) => s.type === 'image')
          .map((s) => this._image(s.src).decode().catch(() => {}))
      );
      const w = b.maxX - b.minX + padding * 2;
      const h = b.maxY - b.minY + padding * 2;
      const k = Math.min(scale, maxSize / Math.max(w, h));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.ceil(w * k));
      c.height = Math.max(1, Math.ceil(h * k));
      const ctx = c.getContext('2d');
      if (background) {
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, c.width, c.height);
      }
      ctx.setTransform(k, 0, 0, k, (padding - b.minX) * k, (padding - b.minY) * k);
      if (fixed && this.background !== 'none') this._framePattern(ctx, fixed.w, fixed.h);
      const prevInk = this.inkColor;
      this.inkColor = ink;
      for (const s of this.shapes) this._drawShape(ctx, s);
      this.inkColor = prevInk;
      return c.toDataURL(type, quality);
    }

    _framePattern(ctx, w, h) {
      ctx.save();
      ctx.strokeStyle = ctx.fillStyle = 'rgba(20,20,40,0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let y = GRID; y < h; y += GRID) {
        if (this.background === 'dots') {
          for (let x = GRID; x < w; x += GRID) ctx.fillRect(x - 1, y - 1, 2, 2);
        } else {
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
        }
      }
      if (this.background === 'grid') {
        for (let x = GRID; x < w; x += GRID) {
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
        }
      }
      ctx.stroke();
      ctx.restore();
    }

    _emit(name, arg) {
      const fn = this.opts[name];
      if (typeof fn === 'function') fn(arg);
    }
  }

  InkCanvas.FONT = FONT;

  // Render drawing data to an image without showing it (e.g. inline sketches).
  InkCanvas.renderImage = async function (data, opts = {}) {
    const engine = new InkCanvas(document.createElement('canvas'), { pan: false });
    engine.load(data);
    const url = await engine.toImage({ type: 'image/png', scale: 2, ...opts });
    engine.destroy();
    return url;
  };
  globalThis.InkCanvas = InkCanvas;
})();
