// CalcEditor: Desmos-style expression list + live graph for "calc" notes.
(function () {
  'use strict';

  const COLORS = ['#c74440', '#2d70b3', '#388c46', '#6042a6', '#fa7e19', '#1e1e2e'];
  const GRAPHABLE = new Set(['graph', 'vline', 'point']);
  const INK = '#1e1e2e'; // the black curve color, flipped to light ink in dark mode
  const newId = () => Math.random().toString(36).slice(2, 10);

  const LIGHT = { minor: 'rgba(20,20,40,.05)', major: 'rgba(20,20,40,.13)', axis: 'rgba(20,20,40,.62)', text: 'rgba(20,20,40,.66)' };
  const DARK = { minor: 'rgba(255,255,255,.05)', major: 'rgba(255,255,255,.12)', axis: 'rgba(255,255,255,.6)', text: 'rgba(255,255,255,.68)' };

  function niceBound(v) {
    const a = Math.abs(v);
    if (a <= 10) return 10;
    const p = Math.pow(10, Math.floor(Math.log10(a)));
    return Math.ceil(a / p) * p;
  }

  class CalcEditor {
    constructor({ rowsEl, canvas, angleBtn, onChange }) {
      this.rowsEl = rowsEl;
      this.angleBtn = angleBtn;
      this.onChange = onChange || (() => {});
      this.rows = [];
      this.angle = 'rad';
      this.dark = false;
      this.results = [];
      this.els = new Map(); // row id → elements
      this.graph = new GraphView(canvas, { onViewChange: () => this.onChange() });

      rowsEl.addEventListener('click', (e) => {
        if (e.target !== rowsEl) return;
        // Clicking the empty space below the list focuses/creates a trailing row.
        const last = this.rows[this.rows.length - 1];
        if (last && !last.text.trim()) this.focusRow(last.id);
        else this.insertRow(this.rows.length, '');
      });
      angleBtn.addEventListener('click', () => {
        this.angle = this.angle === 'rad' ? 'deg' : 'rad';
        this.update();
        this.onChange();
      });
    }

    // ---------- data ----------

    load(data) {
      const d = data || {};
      this.rows = (Array.isArray(d.rows) ? d.rows : [])
        .filter((r) => r && typeof r.text === 'string')
        .map((r, i) => ({ id: r.id || newId(), text: r.text, color: r.color || COLORS[i % COLORS.length], hidden: !!r.hidden }));
      if (!this.rows.length) this.rows.push(this._newRow(''));
      this.angle = d.angle === 'deg' ? 'deg' : 'rad';
      this.graph.setView(d.view && Number.isFinite(d.view.scale) ? d.view : { cx: 0, cy: 0, scale: 40 });
      this.renderRows();
      this.update();
    }

    toJSON() {
      return {
        v: 1,
        angle: this.angle,
        view: { ...this.graph.view },
        rows: this.rows.map(({ id, text, color, hidden }) => ({ id, text, color, hidden })),
      };
    }

    plainText() {
      return this.rows.map((r) => r.text.trim()).filter(Boolean).join(' · ');
    }

    thumbnail() {
      return this.graph.thumbnail(240);
    }

    setDark(dark, paper) {
      this.dark = dark;
      this.graph.setTheme({ ...(dark ? DARK : LIGHT), bg: paper });
      if (this.rows.length) this.update();
    }

    shown(color) {
      return this.dark && color === INK ? '#ececf1' : color;
    }

    _newRow(text) {
      const used = new Set(this.rows.map((r) => r.color));
      const color = COLORS.find((c) => !used.has(c)) || COLORS[this.rows.length % COLORS.length];
      return { id: newId(), text, color, hidden: false };
    }

    insertRow(index, text, { focus = true } = {}) {
      const row = this._newRow(text);
      this.rows.splice(index, 0, row);
      this.renderRows();
      this.update();
      this.onChange();
      if (focus) this.focusRow(row.id);
      return row;
    }

    deleteRow(id, { focusPrev = false } = {}) {
      const i = this.rows.findIndex((r) => r.id === id);
      if (i < 0) return;
      this.rows.splice(i, 1);
      if (!this.rows.length) this.rows.push(this._newRow(''));
      this.renderRows();
      this.update();
      this.onChange();
      if (focusPrev) this.focusRow(this.rows[Math.max(0, i - 1)].id, true);
    }

    focusRow(id, atEnd = true) {
      const el = this.els.get(id);
      if (!el) return;
      el.input.focus();
      if (atEnd) el.input.setSelectionRange(el.input.value.length, el.input.value.length);
    }

    clear() {
      this.rows = [this._newRow('')];
      this.renderRows();
      this.update();
      this.onChange();
    }

    // ---------- rendering ----------

    renderRows() {
      const frag = document.createDocumentFragment();
      this.els.clear();
      this.rows.forEach((row, i) => {
        const el = document.createElement('div');
        el.className = 'calc-row';
        el.dataset.id = row.id;

        const gutter = document.createElement('div');
        gutter.className = 'row-gutter';
        const num = document.createElement('span');
        num.className = 'row-num';
        num.textContent = i + 1;
        const icon = document.createElement('button');
        icon.className = 'row-icon';
        icon.tabIndex = -1;
        icon.addEventListener('click', () => {
          const r = this.rows.find((x) => x.id === row.id);
          if (!r || !GRAPHABLE.has((this.results[this.rows.indexOf(r)] || {}).kind)) return;
          r.hidden = !r.hidden;
          this.update();
          this.onChange();
        });
        icon.addEventListener('contextmenu', (e) => {
          // Right-click cycles the curve color.
          e.preventDefault();
          const r = this.rows.find((x) => x.id === row.id);
          r.color = COLORS[(COLORS.indexOf(r.color) + 1) % COLORS.length];
          this.update();
          this.onChange();
        });
        gutter.append(num, icon);

        const main = document.createElement('div');
        main.className = 'row-main';
        const input = document.createElement('input');
        input.className = 'row-input';
        input.value = row.text;
        input.spellcheck = false;
        input.autocomplete = 'off';
        input.setAttribute('aria-label', `Expression ${i + 1}`);
        if (i === 0 && this.rows.length === 1 && !row.text) input.placeholder = 'Type math, e.g. 2+2, y = x^2, a = 3';
        input.addEventListener('input', () => {
          row.text = input.value;
          this.update();
          this.onChange();
        });
        input.addEventListener('keydown', (e) => this._onKey(e, row));
        input.addEventListener('focus', () => el.classList.add('active'));
        input.addEventListener('blur', () => el.classList.remove('active'));
        const extra = document.createElement('div');
        extra.className = 'row-extra';
        main.append(input, extra);

        const del = document.createElement('button');
        del.className = 'row-del';
        del.title = 'Delete expression';
        del.setAttribute('aria-label', `Delete expression ${i + 1}`);
        del.innerHTML = InkIcons.svg('x', 18);
        del.addEventListener('click', () => this.deleteRow(row.id));

        el.append(gutter, main, del);
        frag.appendChild(el);
        this.els.set(row.id, { el, icon, input, extra });
      });
      this.rowsEl.replaceChildren(frag);
    }

    _onKey(e, row) {
      const i = this.rows.indexOf(row);
      const el = this.els.get(row.id);
      if (e.key === 'Enter') {
        e.preventDefault();
        const next = this.rows[i + 1];
        if (next && !next.text.trim()) this.focusRow(next.id);
        else this.insertRow(i + 1, '');
      } else if (e.key === 'Backspace' && !el.input.value && this.rows.length > 1) {
        e.preventDefault();
        this.deleteRow(row.id, { focusPrev: true });
      } else if (e.key === 'ArrowUp' && i > 0) {
        e.preventDefault();
        this.focusRow(this.rows[i - 1].id);
      } else if (e.key === 'ArrowDown' && i < this.rows.length - 1) {
        e.preventDefault();
        this.focusRow(this.rows[i + 1].id);
      }
    }

    // Re-evaluate everything and refresh results, icons and the graph.
    update() {
      this.angleBtn.textContent = this.angle.toUpperCase();
      this.angleBtn.title = this.angle === 'rad' ? 'Angles in radians (click for degrees)' : 'Angles in degrees (click for radians)';
      this.results = InkMath.evaluate(this.rows, { angle: this.angle });
      const items = [];
      this.rows.forEach((row, i) => {
        const res = this.results[i];
        const els = this.els.get(row.id);
        if (els) this._renderExtra(row, res, els);
        if (GRAPHABLE.has(res.kind) && !row.hidden) items.push({ ...res, color: this.shown(row.color) });
      });
      this.graph.setItems(items);
    }

    _renderExtra(row, res, { el, icon, extra }) {
      el.classList.toggle('error', res.kind === 'error');
      icon.className = 'row-icon';
      icon.style.color = this.shown(row.color);
      icon.title = '';
      if (res.kind === 'error') {
        icon.classList.add('warn');
        icon.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24"><path d="M12 3 2 21h20z" fill="#e8743b"/><path d="M12 10v5M12 18h.01" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>';
        icon.title = res.message;
      } else if (GRAPHABLE.has(res.kind)) {
        icon.classList.add('graphable');
        if (row.hidden) icon.classList.add('off');
        icon.title = row.hidden ? 'Show on graph' : 'Hide from graph (right-click: change color)';
        icon.innerHTML =
          res.kind === 'point'
            ? '<svg width="14" height="14" viewBox="0 0 24 24"><circle cx="12" cy="12" r="6" fill="#fff"/></svg>'
            : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"><path d="M3 16c3 0 3.5-8 6-8s3.5 8 6 8 3.5-8 6-8"/></svg>';
      } else {
        icon.innerHTML = '';
      }

      extra.textContent = '';
      extra.className = 'row-extra';
      if (res.kind === 'value' || (res.kind === 'def' && res.value !== undefined)) {
        const out = document.createElement('button');
        out.className = 'row-result';
        out.title = 'Copy result';
        const text = InkMath.format(res.value);
        out.innerHTML = '<span class="eq">=</span>';
        const val = document.createElement('span');
        val.className = 'val';
        val.textContent = text;
        out.appendChild(val);
        out.addEventListener('click', () => {
          navigator.clipboard.writeText(String(res.value)).catch(() => {});
          out.classList.add('copied');
          setTimeout(() => out.classList.remove('copied'), 900);
        });
        extra.appendChild(out);
      } else if (res.kind === 'slider') {
        extra.appendChild(this._slider(row, res));
      } else if (res.kind === 'error') {
        if (res.missing && res.missing.length) {
          const wrap = document.createElement('div');
          wrap.className = 'row-sliders';
          wrap.append('add slider:');
          const names = res.missing;
          const add = (list) => {
            const idx = this.rows.indexOf(row);
            list.forEach((n, k) => this.insertRow(idx + 1 + k, `${n} = 1`, { focus: false }));
          };
          for (const n of names) {
            const b = document.createElement('button');
            b.className = 'chip';
            b.textContent = n;
            b.addEventListener('click', () => add([n]));
            wrap.appendChild(b);
          }
          if (names.length > 1) {
            const all = document.createElement('button');
            all.className = 'chip primary';
            all.textContent = 'all';
            all.addEventListener('click', () => add(names));
            wrap.appendChild(all);
          }
          extra.appendChild(wrap);
        } else if (document.activeElement !== this.els.get(row.id).input) {
          const msg = document.createElement('div');
          msg.className = 'row-msg';
          msg.textContent = res.message;
          extra.appendChild(msg);
        }
      }
    }

    _slider(row, res) {
      const wrap = document.createElement('div');
      wrap.className = 'row-slider';
      const bound = niceBound(res.value);
      const min = res.value < 0 || bound > 10 ? -bound : -10;
      const max = bound;
      const lo = document.createElement('span');
      lo.textContent = InkMath.format(min);
      const hi = document.createElement('span');
      hi.textContent = InkMath.format(max);
      const range = document.createElement('input');
      range.type = 'range';
      range.min = min;
      range.max = max;
      range.step = (max - min) / 200;
      range.value = res.value;
      range.setAttribute('aria-label', `${res.name} slider`);
      range.addEventListener('input', () => {
        const step = Number(range.step);
        const v = Math.round(Number(range.value) / step) * step;
        const text = `${res.name} = ${parseFloat(v.toPrecision(6))}`;
        row.text = text;
        const els = this.els.get(row.id);
        els.input.value = text;
        // Refresh the graph without rebuilding this slider mid-drag.
        this.results = InkMath.evaluate(this.rows, { angle: this.angle });
        const items = [];
        this.rows.forEach((r, i) => {
          const rr = this.results[i];
          if (r !== row && this.els.get(r.id)) this._renderExtra(r, rr, this.els.get(r.id));
          if (GRAPHABLE.has(rr.kind) && !r.hidden) items.push({ ...rr, color: this.shown(r.color) });
        });
        this.graph.setItems(items);
        this.onChange();
      });
      wrap.append(lo, range, hi);
      return wrap;
    }
  }

  globalThis.CalcEditor = CalcEditor;
})();
