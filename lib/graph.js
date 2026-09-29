// GraphView: renders a Cartesian grid with function curves, vertical lines and
// points onto a canvas. Supports drag-to-pan, wheel zoom and hover tracing.
(function () {
  'use strict';
  if (globalThis.GraphView) return;

  const FONT = '11px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

  // Pick a "nice" grid step (1, 2 or 5 × 10^n) close to the target size in world units.
  function niceStep(target) {
    const p = Math.pow(10, Math.floor(Math.log10(target)));
    const m = target / p;
    const step = m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10;
    return { step: step * p, minor: step === 2 ? 4 : 5 };
  }

  function label(v, step) {
    if (Math.abs(v) < step / 1e6) return '0';
    const decimals = Math.max(0, -Math.floor(Math.log10(step)) + (step / Math.pow(10, Math.floor(Math.log10(step))) === 2.5 ? 1 : 0));
    if (Math.abs(v) >= 1e6 || (Math.abs(v) < 1e-4 && v !== 0)) return v.toExponential(1).replace('e+', 'e').replace('-', '−');
    return v.toFixed(Math.min(decimals, 8)).replace('-', '−');
  }

  class GraphView {
    constructor(canvas, opts = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.opts = opts;
      this.view = { cx: 0, cy: 0, scale: 40 }; // world center + pixels per unit
      this.items = []; // { kind: 'graph'|'vline'|'point', fn, value, point, color }
      this.theme = { bg: '#fff', minor: 'rgba(0,0,0,.05)', major: 'rgba(0,0,0,.12)', axis: 'rgba(0,0,0,.6)', text: 'rgba(0,0,0,.6)' };
      this.hover = null;
      this.dragging = null;
      this.width = 0;
      this.height = 0;
      this.dpr = 1;
      this._raf = 0;

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

    setItems(items) {
      this.items = items;
      this.requestRender();
    }

    setTheme(theme) {
      Object.assign(this.theme, theme);
      this.requestRender();
    }

    setView(view) {
      this.view = { ...this.view, ...view };
      this.requestRender();
    }

    home() {
      this.view = { cx: 0, cy: 0, scale: 40 };
      this._viewChanged();
    }

    zoom(factor, sx = this.width / 2, sy = this.height / 2) {
      const [wx, wy] = this.toWorld(sx, sy);
      const scale = Math.min(1e6, Math.max(1e-4, this.view.scale * factor));
      // Keep the world point under the cursor fixed.
      this.view = { scale, cx: wx - (sx - this.width / 2) / scale, cy: wy + (sy - this.height / 2) / scale };
      this._viewChanged();
    }

    toScreen(x, y) {
      return [(x - this.view.cx) * this.view.scale + this.width / 2, this.height / 2 - (y - this.view.cy) * this.view.scale];
    }

    toWorld(sx, sy) {
      return [(sx - this.width / 2) / this.view.scale + this.view.cx, (this.height / 2 - sy) / this.view.scale + this.view.cy];
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
      this.canvas.style.cursor = 'grabbing';
    }

    _move(e) {
      const [sx, sy] = this._pos(e);
      if (this.dragging) {
        const d = this.dragging;
        const dx = e.clientX - d.x;
        const dy = e.clientY - d.y;
        if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true;
        this.view = { ...this.view, cx: d.cx - dx / this.view.scale, cy: d.cy + dy / this.view.scale };
        this.hover = null;
        this._viewChanged();
        return;
      }
      this.hover = [sx, sy];
      this.requestRender();
    }

    _up(e) {
      if (!this.dragging) return;
      this.dragging = null;
      this.canvas.style.cursor = '';
      this.hover = this._pos(e);
      this.requestRender();
    }

    _wheel(e) {
      e.preventDefault();
      const [sx, sy] = this._pos(e);
      this.zoom(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0022)), sx, sy);
    }

    // ---------- rendering ----------

    render(ctx = this.ctx, width = this.width, height = this.height, dpr = this.dpr, { hover = true } = {}) {
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
      if (hover && this.hover) this._drawTrace(ctx);
      this.width = saveW;
      this.height = saveH;
    }

    _drawGrid(ctx) {
      const { width, height, theme } = this;
      const { step, minor } = niceStep(90 / this.view.scale);
      const [x0, y1] = this.toWorld(0, 0);
      const [x1, y0] = this.toWorld(width, height);

      const lines = (s, color) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = Math.ceil(x0 / s) * s; x <= x1; x += s) {
          const px = Math.round(this.toScreen(x, 0)[0]) + 0.5;
          ctx.moveTo(px, 0);
          ctx.lineTo(px, height);
        }
        for (let y = Math.ceil(y0 / s) * s; y <= y1; y += s) {
          const py = Math.round(this.toScreen(0, y)[1]) + 0.5;
          ctx.moveTo(0, py);
          ctx.lineTo(width, py);
        }
        ctx.stroke();
      };
      lines(step / minor, theme.minor);
      lines(step, theme.major);

      // Axes
      const [ax, ay] = this.toScreen(0, 0);
      ctx.strokeStyle = theme.axis;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (ax >= 0 && ax <= width) {
        ctx.moveTo(Math.round(ax) + 0.5, 0);
        ctx.lineTo(Math.round(ax) + 0.5, height);
      }
      if (ay >= 0 && ay <= height) {
        ctx.moveTo(0, Math.round(ay) + 0.5);
        ctx.lineTo(width, Math.round(ay) + 0.5);
      }
      ctx.stroke();

      // Labels, pinned to the edge when the axis is off-screen.
      ctx.font = FONT;
      ctx.fillStyle = theme.text;
      ctx.strokeStyle = theme.bg;
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      const ly = Math.min(Math.max(ay + 4, 4), height - 16);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
        if (Math.abs(x) < step / 2) continue;
        const px = this.toScreen(x, 0)[0];
        const t = label(x, step);
        ctx.strokeText(t, px, ly);
        ctx.fillText(t, px, ly);
      }
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      const lx = Math.min(Math.max(ax - 5, 30), width - 4);
      for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
        if (Math.abs(y) < step / 2) continue;
        const py = this.toScreen(0, y)[1];
        const t = label(y, step);
        ctx.strokeText(t, lx, py);
        ctx.fillText(t, lx, py);
      }
      if (ax >= 0 && ax <= width && ay >= 0 && ay <= height) {
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.strokeText('0', ax - 4, ay + 4);
        ctx.fillText('0', ax - 4, ay + 4);
      }
    }

    _drawCurve(ctx, item) {
      const { width, height } = this;
      ctx.strokeStyle = item.color;
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      let pen = false;
      let prevY = null;
      const step = 1; // one sample per pixel column
      for (let px = -step; px <= width + step; px += step) {
        const x = this.toWorld(px, 0)[0];
        let y;
        try {
          y = item.fn(x);
        } catch (_) {
          y = NaN;
        }
        if (!Number.isFinite(y)) {
          pen = false;
          prevY = null;
          continue;
        }
        const py = this.toScreen(0, y)[1];
        // Break on asymptotes (huge jump crossing the view) so tan(x) doesn't draw verticals.
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
      ctx.lineWidth = 2.5;
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

    _tag(ctx, text, x, y, color) {
      ctx.font = `600 ${FONT}`;
      const w = ctx.measureText(text).width + 12;
      const bx = Math.min(x, this.width - w - 4);
      const by = Math.max(4, y - 20);
      ctx.fillStyle = this.theme.bg;
      ctx.globalAlpha = 0.92;
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
      const x = this.toWorld(sx, sy)[0];
      let best = null;
      for (const item of this.items) {
        if (item.kind !== 'graph') continue;
        let y;
        try {
          y = item.fn(x);
        } catch (_) {
          continue;
        }
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
      this.view = { ...saved, scale: saved.scale * (size / Math.max(1, Math.min(this.width, this.height))) * 0.9 };
      this.render(ctx, size, size, 1, { hover: false });
      this.view = saved;
      return c.toDataURL('image/jpeg', 0.8);
    }
  }

  globalThis.GraphView = GraphView;
})();
