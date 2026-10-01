// GraphView: renders a Cartesian grid with function curves, vertical lines and
// points onto a canvas. Supports drag-to-pan, wheel zoom, hover tracing and
// Desmos-style points of interest (zeros, intersections, extrema, y-intercepts).
(function () {
  'use strict';
  if (globalThis.GraphView) return;

  const FONT = '11px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const DEFAULT_VIEW = { cx: 0, cy: 0, sx: 40, sy: 40 }; // world center + pixels per unit
  const DEFAULT_OPTIONS = { grid: true, minor: true, axisNumbers: true, xAxis: true, yAxis: true, xLabel: '', yLabel: '', poi: 'all' };
  const POI_RADIUS = 4.5;

  // Pick a "nice" grid step (1, 2 or 5 × 10^n) close to the target size in world units.
  function niceStep(target) {
    const p = Math.pow(10, Math.floor(Math.log10(target)));
    const m = target / p;
    const step = m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10;
    return { step: step * p, minor: step === 2 ? 4 : 5 };
  }

  function label(v, step) {
    if (Math.abs(v) < step / 1e6) return '0';
    if (Math.abs(v) >= 1e6 || Math.abs(v) < 1e-4) return v.toExponential(1).replace('e+', 'e').replace('-', '−');
    const decimals = Math.max(0, -Math.floor(Math.log10(step)));
    return v.toFixed(Math.min(decimals, 8)).replace('-', '−');
  }

  function safe(fn, x) {
    try {
      const y = fn(x);
      return Number.isFinite(y) ? y : NaN;
    } catch (_) {
      return NaN;
    }
  }

  // Root of a continuous f on [a, b] with a sign change.
  function bisect(f, a, b, fa) {
    for (let i = 0; i < 60; i++) {
      const m = (a + b) / 2;
      const fm = f(m);
      if (!Number.isFinite(fm)) return null;
      if (fm === 0) return m;
      if (Math.sign(fm) === Math.sign(fa)) {
        a = m;
        fa = fm;
      } else b = m;
    }
    return (a + b) / 2;
  }

  // Minimum of f on [a, b] (golden-section search).
  function golden(f, a, b) {
    const g = (Math.sqrt(5) - 1) / 2;
    let c = b - g * (b - a);
    let d = a + g * (b - a);
    for (let i = 0; i < 60; i++) {
      if (f(c) < f(d)) b = d;
      else a = c;
      c = b - g * (b - a);
      d = a + g * (b - a);
    }
    return (a + b) / 2;
  }

  class GraphView {
    constructor(canvas, opts = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.opts = opts;
      this.view = { ...DEFAULT_VIEW };
      this.options = { ...DEFAULT_OPTIONS };
      this.items = []; // { kind: 'graph'|'vline'|'point', fn, value, point, color, rowId }
      this.selected = null; // rowId of the highlighted curve
      this.theme = { bg: '#fff', minor: 'rgba(0,0,0,.05)', major: 'rgba(0,0,0,.12)', axis: 'rgba(0,0,0,.6)', text: 'rgba(0,0,0,.6)', poi: '#8a8a8a' };
      this.pois = [];
      this.pinned = new Set(); // keys of POIs whose label stays open
      this.hover = null;
      this.dragging = null;
      this.width = 0;
      this.height = 0;
      this.dpr = 1;
      this._raf = 0;
      this._poiDirty = true;

      canvas.style.touchAction = 'none';
      canvas.addEventListener('pointerdown', (e) => this._down(e));
      canvas.addEventListener('pointermove', (e) => this._move(e));
      canvas.addEventListener('pointerup', (e) => this._up(e));
      canvas.addEventListener('pointercancel', (e) => this._up(e));
      canvas.addEventListener('pointerleave', () => {
        this.hover = null;
        this.requestRender();
      });
      canvas.addEventListener('wheel', (e) => this._wheel(e), { passive: false });
      canvas.addEventListener('dblclick', () => this.home());
      this._ro = new ResizeObserver(() => this.resize());
      this._ro.observe(canvas);
      this.resize();
    }

    // ---------- state ----------

    setItems(items) {
      this.items = items;
      this._poiDirty = true;
      this.requestRender();
    }

    setSelected(rowId) {
      if (this.selected === rowId) return;
      this.selected = rowId;
      this.requestRender();
    }

    setTheme(theme) {
      Object.assign(this.theme, theme);
      this.requestRender();
    }

    setOptions(options) {
      this.options = { ...DEFAULT_OPTIONS, ...options };
      this.requestRender();
    }

    setView(view) {
      const v = { ...DEFAULT_VIEW, ...(view || {}) };
      if (view && Number.isFinite(view.scale) && !Number.isFinite(view.sx)) v.sx = v.sy = view.scale; // old saves
      this.view = { cx: v.cx, cy: v.cy, sx: v.sx, sy: v.sy };
      this._poiDirty = true;
      this.requestRender();
    }

    // Visible world bounds.
    bounds() {
      const [xmin, ymax] = this.toWorld(0, 0);
      const [xmax, ymin] = this.toWorld(this.width, this.height);
      return { xmin, xmax, ymin, ymax };
    }

    setBounds({ xmin, xmax, ymin, ymax }) {
      if (!(xmax > xmin) || !(ymax > ymin) || !this.width || !this.height) return false;
      this.view = { cx: (xmin + xmax) / 2, cy: (ymin + ymax) / 2, sx: this.width / (xmax - xmin), sy: this.height / (ymax - ymin) };
      this._viewChanged();
      return true;
    }

    home() {
      this.view = { ...DEFAULT_VIEW };
      this._viewChanged();
    }

    zoom(factor, sx = this.width / 2, sy = this.height / 2) {
      const [wx, wy] = this.toWorld(sx, sy);
      const k = Math.min(1e6 / Math.max(this.view.sx, this.view.sy), Math.max(1e-4 / Math.min(this.view.sx, this.view.sy), factor));
      const nsx = this.view.sx * k;
      const nsy = this.view.sy * k;
      // Keep the world point under the cursor fixed.
      this.view = { sx: nsx, sy: nsy, cx: wx - (sx - this.width / 2) / nsx, cy: wy + (sy - this.height / 2) / nsy };
      this._viewChanged();
    }

    toScreen(x, y) {
      return [(x - this.view.cx) * this.view.sx + this.width / 2, this.height / 2 - (y - this.view.cy) * this.view.sy];
    }

    toWorld(sx, sy) {
      return [(sx - this.width / 2) / this.view.sx + this.view.cx, (this.height / 2 - sy) / this.view.sy + this.view.cy];
    }

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
      this._poiDirty = true;
      this.render();
    }

    requestRender() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => {
        this._raf = 0;
        this.render();
      });
    }

    _viewChanged() {
      this._poiDirty = true;
      this.requestRender();
      if (this.opts.onViewChange) this.opts.onViewChange(this.view);
    }

    // ---------- input ----------

    _pos(e) {
      const r = this.canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    }

    _down(e) {
      if (e.button !== 0) return;
      this.canvas.setPointerCapture(e.pointerId);
      this.dragging = { x: e.clientX, y: e.clientY, cx: this.view.cx, cy: this.view.cy, moved: false };
    }

    _move(e) {
      const [sx, sy] = this._pos(e);
      if (this.dragging) {
        const d = this.dragging;
        const dx = e.clientX - d.x;
        const dy = e.clientY - d.y;
        if (!d.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
        d.moved = true;
        this.canvas.style.cursor = 'grabbing';
        this.view = { ...this.view, cx: d.cx - dx / this.view.sx, cy: d.cy + dy / this.view.sy };
        this.hover = null;
        this._viewChanged();
        return;
      }
      this.hover = [sx, sy];
      this.canvas.style.cursor = this._poiAt(sx, sy) || this._curveAt(sx, sy) ? 'pointer' : '';
      this.requestRender();
    }

    _up(e) {
      if (!this.dragging) return;
      const moved = this.dragging.moved;
      this.dragging = null;
      this.canvas.style.cursor = '';
      const [sx, sy] = this._pos(e);
      this.hover = [sx, sy];
      if (!moved) this._click(sx, sy);
      this.requestRender();
    }

    _click(sx, sy) {
      const poi = this._poiAt(sx, sy);
      if (poi) {
        if (this.pinned.has(poi.key)) this.pinned.delete(poi.key);
        else this.pinned.add(poi.key);
        return;
      }
      const curve = this._curveAt(sx, sy);
      this.pinned.clear();
      if (this.opts.onSelect) this.opts.onSelect(curve ? curve.rowId : null);
    }

    _wheel(e) {
      e.preventDefault();
      const [sx, sy] = this._pos(e);
      this.zoom(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0022)), sx, sy);
    }

    _curveAt(sx, sy) {
      const x = this.toWorld(sx, sy)[0];
      let best = null;
      for (const item of this.items) {
        let d = Infinity;
        if (item.kind === 'graph') {
          const y = safe(item.fn, x);
          if (Number.isFinite(y)) d = Math.abs(this.toScreen(0, y)[1] - sy);
        } else if (item.kind === 'vline') {
          d = Math.abs(this.toScreen(item.value, 0)[0] - sx);
        } else if (item.kind === 'point') {
          const [px, py] = this.toScreen(item.point[0], item.point[1]);
          d = Math.hypot(px - sx, py - sy);
        }
        if (d < 10 && (!best || d < best.d)) best = { d, rowId: item.rowId };
      }
      return best;
    }

    _poiAt(sx, sy) {
      let best = null;
      for (const p of this._visiblePOIs()) {
        const [px, py] = this.toScreen(p.x, p.y);
        const d = Math.hypot(px - sx, py - sy);
        if (d <= POI_RADIUS + 5 && (!best || d < best.d)) best = { ...p, d };
      }
      return best;
    }

    // ---------- points of interest ----------

    _computePOIs() {
      this._poiDirty = false;
      this.pois = [];
      if (this.options.poi === 'off' || !this.width) return;
      const { xmin, xmax, ymin, ymax } = this.bounds();
      const graphs = this.items.filter((i) => i.kind === 'graph');
      if (!graphs.length) return;
      const N = Math.max(40, Math.ceil(this.width / 2));
      const xs = [];
      for (let i = 0; i <= N; i++) xs.push(xmin + ((xmax - xmin) * i) / N);
      const samples = graphs.map((g) => xs.map((x) => safe(g.fn, x)));
      const pad = (ymax - ymin) * 0.02;
      const out = [];
      const add = (x, y, kind, owners) => {
        if (!Number.isFinite(x) || !Number.isFinite(y) || y < ymin - pad || y > ymax + pad) return;
        // Skip near-duplicates (e.g. a root found from both sides).
        const tolX = 3 / this.view.sx;
        const tolY = 3 / this.view.sy;
        if (out.some((p) => Math.abs(p.x - x) < tolX && Math.abs(p.y - y) < tolY)) return;
        out.push({ x, y, kind, owners, key: `${kind}:${owners.join(',')}:${x.toPrecision(6)}` });
      };

      // Sign changes of h on the sample grid → refined roots.
      const roots = (h, vals, kind, owners, yOf) => {
        for (let i = 0; i < N; i++) {
          const a = vals[i];
          const b = vals[i + 1];
          if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
          if (a === 0) {
            add(xs[i], yOf(xs[i]), kind, owners);
            continue;
          }
          if (Math.sign(a) === Math.sign(b) || b === 0) continue;
          const x = bisect(h, xs[i], xs[i + 1], a);
          if (x === null) continue;
          // Reject asymptotes like tan(x) or 1/x: a real root has a small residual.
          if (Math.abs(h(x)) > (Math.abs(a) + Math.abs(b)) * 0.5) continue;
          add(x, yOf(x), kind, owners);
        }
      };

      graphs.forEach((g, gi) => {
        const f = (x) => safe(g.fn, x);
        const vals = samples[gi];
        const owners = [g.rowId];
        roots(f, vals, 'zero', owners, () => 0);
        // Touching zeros (e.g. x^2) that never change sign.
        for (let i = 1; i < N; i++) {
          const [a, b, c] = [vals[i - 1], vals[i], vals[i + 1]];
          if (![a, b, c].every(Number.isFinite)) continue;
          if (Math.abs(b) <= Math.abs(a) && Math.abs(b) <= Math.abs(c) && Math.sign(a) === Math.sign(c) && Math.sign(a) === Math.sign(b) && b !== 0) {
            const x = golden((t) => Math.abs(f(t)), xs[i - 1], xs[i + 1]);
            if (Math.abs(f(x)) * this.view.sy < 0.05) add(x, 0, 'zero', owners);
          }
        }
        // Local extrema from slope sign changes.
        for (let i = 1; i < N; i++) {
          const [a, b, c] = [vals[i - 1], vals[i], vals[i + 1]];
          if (![a, b, c].every(Number.isFinite)) continue;
          const d1 = b - a;
          const d2 = c - b;
          if (Math.abs(d1) + Math.abs(d2) < 1e-12) continue; // flat
          if (d1 > 0 && d2 < 0) {
            const x = golden((t) => -f(t), xs[i - 1], xs[i + 1]);
            add(x, f(x), 'max', owners);
          } else if (d1 < 0 && d2 > 0) {
            const x = golden(f, xs[i - 1], xs[i + 1]);
            add(x, f(x), 'min', owners);
          }
        }
        // y-intercept
        if (xmin <= 0 && xmax >= 0) add(0, f(0), 'y-intercept', owners);
      });

      // Intersections between each pair of curves.
      for (let i = 0; i < graphs.length; i++) {
        for (let j = i + 1; j < graphs.length; j++) {
          const fi = (x) => safe(graphs[i].fn, x);
          const fj = (x) => safe(graphs[j].fn, x);
          const h = (x) => fi(x) - fj(x);
          const vals = samples[i].map((v, k) => v - samples[j][k]);
          if (vals.every((v) => !Number.isFinite(v) || Math.abs(v) < 1e-12)) continue; // same curve
          roots(h, vals, 'intersection', [graphs[i].rowId, graphs[j].rowId], fi);
        }
        // Curve × vertical line
        for (const v of this.items.filter((it) => it.kind === 'vline')) {
          if (v.value >= xmin && v.value <= xmax) add(v.value, safe(graphs[i].fn, v.value), 'intersection', [graphs[i].rowId, v.rowId]);
        }
      }
      this.pois = out.slice(0, 400);
    }

    _visiblePOIs() {
      if (this._poiDirty) this._computePOIs();
      if (this.options.poi === 'selected') return this.pois.filter((p) => this.selected && p.owners.includes(this.selected));
      return this.pois;
    }

    // ---------- rendering ----------

    render(ctx = this.ctx, width = this.width, height = this.height, dpr = this.dpr, { hover = true, pois = true } = {}) {
      const { theme } = this;
      const saveW = this.width;
      const saveH = this.height;
      this.width = width;
      this.height = height;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = theme.bg;
      ctx.fillRect(0, 0, width, height);
      this._drawGrid(ctx);
      for (const item of this.items) {
        if (item.kind === 'graph') this._drawCurve(ctx, item);
        else if (item.kind === 'vline') this._drawVLine(ctx, item);
      }
      for (const item of this.items) if (item.kind === 'point') this._drawPoint(ctx, item);
      if (pois) this._drawPOIs(ctx, hover);
      if (hover && this.hover) this._drawTrace(ctx);
      this.width = saveW;
      this.height = saveH;
    }

    _drawGrid(ctx) {
      const { width, height, theme, options } = this;
      const gx = niceStep(90 / this.view.sx);
      const gy = niceStep(90 / this.view.sy);
      const { xmin: x0, xmax: x1, ymin: y0, ymax: y1 } = this.bounds();

      const lines = (sxStep, syStep, color) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = Math.ceil(x0 / sxStep) * sxStep; x <= x1; x += sxStep) {
          const px = Math.round(this.toScreen(x, 0)[0]) + 0.5;
          ctx.moveTo(px, 0);
          ctx.lineTo(px, height);
        }
        for (let y = Math.ceil(y0 / syStep) * syStep; y <= y1; y += syStep) {
          const py = Math.round(this.toScreen(0, y)[1]) + 0.5;
          ctx.moveTo(0, py);
          ctx.lineTo(width, py);
        }
        ctx.stroke();
      };
      if (options.grid) {
        if (options.minor) lines(gx.step / gx.minor, gy.step / gy.minor, theme.minor);
        lines(gx.step, gy.step, theme.major);
      }

      // Axes
      const [ax, ay] = this.toScreen(0, 0);
      ctx.strokeStyle = theme.axis;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (options.yAxis && ax >= 0 && ax <= width) {
        ctx.moveTo(Math.round(ax) + 0.5, 0);
        ctx.lineTo(Math.round(ax) + 0.5, height);
      }
      if (options.xAxis && ay >= 0 && ay <= height) {
        ctx.moveTo(0, Math.round(ay) + 0.5);
        ctx.lineTo(width, Math.round(ay) + 0.5);
      }
      ctx.stroke();

      ctx.font = FONT;
      ctx.fillStyle = theme.text;
      ctx.strokeStyle = theme.bg;
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      const text = (t, x, y) => {
        ctx.strokeText(t, x, y);
        ctx.fillText(t, x, y);
      };

      if (options.axisNumbers) {
        // Labels, pinned to the edge when the axis is off-screen.
        if (options.xAxis) {
          const ly = Math.min(Math.max(ay + 4, 4), height - 16);
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          for (let x = Math.ceil(x0 / gx.step) * gx.step; x <= x1; x += gx.step) {
            if (Math.abs(x) < gx.step / 2) continue;
            text(label(x, gx.step), this.toScreen(x, 0)[0], ly);
          }
        }
        if (options.yAxis) {
          ctx.textAlign = 'right';
          ctx.textBaseline = 'middle';
          const lx = Math.min(Math.max(ax - 5, 30), width - 4);
          for (let y = Math.ceil(y0 / gy.step) * gy.step; y <= y1; y += gy.step) {
            if (Math.abs(y) < gy.step / 2) continue;
            text(label(y, gy.step), lx, this.toScreen(0, y)[1]);
          }
        }
        if (options.xAxis && options.yAxis && ax >= 0 && ax <= width && ay >= 0 && ay <= height) {
          ctx.textAlign = 'right';
          ctx.textBaseline = 'top';
          text('0', ax - 4, ay + 4);
        }
      }

      // Axis titles
      ctx.font = `italic 600 14px "Cambria Math", "Times New Roman", serif`;
      if (options.xLabel && options.xAxis) {
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        text(options.xLabel, width - 8, Math.min(Math.max(ay - 6, 20), height - 4));
      }
      if (options.yLabel && options.yAxis) {
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        text(options.yLabel, Math.min(Math.max(ax + 8, 4), width - 60), 8);
      }
    }

    _drawCurve(ctx, item) {
      const { width, height } = this;
      ctx.strokeStyle = item.color;
      ctx.lineWidth = item.rowId && item.rowId === this.selected ? 4 : 2.5;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      let pen = false;
      let prevY = null;
      for (let px = -1; px <= width + 1; px += 1) {
        const y = safe(item.fn, this.toWorld(px, 0)[0]);
        if (!Number.isFinite(y)) {
          pen = false;
          prevY = null;
          continue;
        }
        const py = this.toScreen(0, y)[1];
        // Break on asymptotes so tan(x) doesn't draw vertical lines.
        if (prevY !== null && Math.abs(py - prevY) > height * 2) pen = false;
        const cy = Math.max(-height * 4, Math.min(height * 5, py));
        if (pen) ctx.lineTo(px, cy);
        else ctx.moveTo(px, cy);
        pen = true;
        prevY = py;
      }
      ctx.stroke();
    }

    _drawVLine(ctx, item) {
      if (!Number.isFinite(item.value)) return;
      const px = this.toScreen(item.value, 0)[0];
      ctx.strokeStyle = item.color;
      ctx.lineWidth = item.rowId && item.rowId === this.selected ? 4 : 2.5;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, this.height);
      ctx.stroke();
    }

    _drawPoint(ctx, item) {
      const [x, y] = item.point;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const [px, py] = this.toScreen(x, y);
      ctx.fillStyle = item.color;
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fill();
      this._tag(ctx, `(${InkMath.format(x, 4)}, ${InkMath.format(y, 4)})`, px + 8, py - 8, item.color);
    }

    _drawPOIs(ctx, hover) {
      const pois = this._visiblePOIs();
      const hot = hover && this.hover ? this._poiAt(this.hover[0], this.hover[1]) : null;
      for (const p of pois) {
        const [px, py] = this.toScreen(p.x, p.y);
        const big = (hot && hot.key === p.key) || this.pinned.has(p.key);
        const mine = this.selected && p.owners.includes(this.selected);
        ctx.beginPath();
        ctx.arc(px, py, big ? POI_RADIUS + 1.5 : POI_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = this.theme.poi;
        ctx.globalAlpha = this.selected && !mine ? 0.45 : 1;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = this.theme.bg;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      for (const p of pois) {
        if (!this.pinned.has(p.key) && !(hot && hot.key === p.key)) continue;
        const [px, py] = this.toScreen(p.x, p.y);
        const name = { zero: 'zero', intersection: 'intersection', max: 'maximum', min: 'minimum', 'y-intercept': 'y-intercept' }[p.kind];
        this._tag(ctx, `(${InkMath.format(p.x, 4)}, ${InkMath.format(p.y, 4)})  ${name}`, px + 9, py - 9, this.theme.poi);
      }
    }

    _tag(ctx, text, x, y, color) {
      ctx.font = `600 ${FONT}`;
      const w = ctx.measureText(text).width + 12;
      const bx = Math.max(4, Math.min(x, this.width - w - 4));
      const by = Math.max(4, y - 20);
      ctx.fillStyle = this.theme.bg;
      ctx.globalAlpha = 0.94;
      ctx.beginPath();
      ctx.roundRect(bx, by, w, 20, 6);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = this.theme.text;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, bx + 6, by + 10);
    }

    // Snap to the nearest curve under the cursor and show its coordinates.
    _drawTrace(ctx) {
      const [sx, sy] = this.hover;
      if (this._poiAt(sx, sy)) return;
      const x = this.toWorld(sx, sy)[0];
      let best = null;
      for (const item of this.items) {
        if (item.kind !== 'graph') continue;
        const y = safe(item.fn, x);
        if (!Number.isFinite(y)) continue;
        const py = this.toScreen(0, y)[1];
        const d = Math.abs(py - sy);
        if (d < 24 && (!best || d < best.d)) best = { d, y, py, color: item.color };
      }
      if (!best) return;
      ctx.fillStyle = best.color;
      ctx.beginPath();
      ctx.arc(sx, best.py, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = this.theme.bg;
      ctx.lineWidth = 2;
      ctx.stroke();
      this._tag(ctx, `(${InkMath.format(x, 4)}, ${InkMath.format(best.y, 4)})`, sx + 10, best.py - 8, best.color);
    }

    // Small JPEG snapshot for the note list.
    thumbnail(size = 240) {
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const ctx = c.getContext('2d');
      const saved = this.view;
      const k = (size / Math.max(1, Math.min(this.width, this.height))) * 0.9;
      this.view = { ...saved, sx: saved.sx * k, sy: saved.sy * k };
      this.render(ctx, size, size, 1, { hover: false, pois: false });
      this.view = saved;
      return c.toDataURL('image/jpeg', 0.8);
    }

    toPNG() {
      const c = document.createElement('canvas');
      c.width = Math.round(this.width * 2);
      c.height = Math.round(this.height * 2);
      this.render(c.getContext('2d'), this.width, this.height, 2, { hover: false });
      return c.toDataURL('image/png');
    }
  }

  GraphView.DEFAULT_OPTIONS = DEFAULT_OPTIONS;
  globalThis.GraphView = GraphView;
})();
