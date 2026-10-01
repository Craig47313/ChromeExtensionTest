// CalcEditor: Desmos-style expression list + live graph for "calc" notes.
(function () {
  'use strict';

  const COLORS = ['#c74440', '#2d70b3', '#388c46', '#6042a6', '#fa7e19', '#1e1e2e'];
  const GRAPHABLE = new Set(['graph', 'vline', 'point']);
  const INK = '#1e1e2e'; // the black curve color, flipped to light ink in dark mode
  const DEFAULT_SETTINGS = { angle: 'rad', ...GraphView.DEFAULT_OPTIONS };
  const newId = () => Math.random().toString(36).slice(2, 10);

  const LIGHT = { minor: 'rgba(20,20,20,.05)', major: 'rgba(20,20,20,.13)', axis: 'rgba(20,20,20,.62)', text: 'rgba(20,20,20,.68)', poi: '#7d7d7d' };
  const DARK = { minor: 'rgba(255,255,255,.05)', major: 'rgba(255,255,255,.12)', axis: 'rgba(255,255,255,.6)', text: 'rgba(255,255,255,.7)', poi: '#9a9a9a' };

  function niceBound(v) {
    const a = Math.abs(v);
    if (a <= 10) return 10;
    const p = Math.pow(10, Math.floor(Math.log10(a)));
    return Math.ceil(a / p) * p;
  }

  function el(tag, props = {}, children = []) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') n.className = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k in n) n[k] = v;
      else n.setAttribute(k, v);
    }
    for (const c of [].concat(children)) if (c != null) n.append(c);
    return n;
  }

  class CalcEditor {
    constructor({ rowsEl, canvas, graphEl, onChange }) {
      this.rowsEl = rowsEl;
      this.graphEl = graphEl;
      this.onChange = onChange || (() => {});
      this.rows = [];
      this.settings = { ...DEFAULT_SETTINGS };
      this.dark = false;
      this.results = [];
      this.els = new Map(); // row id → elements
      this.graph = new GraphView(canvas, {
        onViewChange: () => {
          this._syncRangeInputs();
          this.onChange();
        },
        onSelect: (rowId) => this.select(rowId, { focus: true }),
      });

      // Clicking the blank area under the list jumps to the empty last row.
      rowsEl.addEventListener('mousedown', (e) => {
        if (e.target !== rowsEl) return;
        e.preventDefault();
        this.focusRow(this.rows[this.rows.length - 1].id);
      });
      this._buildControls();
    }

    // ---------- data ----------

    load(data) {
      const d = data || {};
      this.rows = (Array.isArray(d.rows) ? d.rows : [])
        .filter((r) => r && typeof r.text === 'string')
        .map((r, i) => ({ id: r.id || newId(), text: r.text, color: r.color || COLORS[i % COLORS.length], hidden: !!r.hidden }));
      this.settings = { ...DEFAULT_SETTINGS, ...(d.settings || {}) };
      if (d.angle && !(d.settings && d.settings.angle)) this.settings.angle = d.angle === 'deg' ? 'deg' : 'rad';
      this.graph.setOptions(this.settings);
      this.graph.setView(d.view);
      this.graph.setSelected(null);
      this._ensureTrailing(false);
      this.renderRows();
      this.update();
      this._syncSettings();
    }

    toJSON() {
      const rows = this.rows.slice();
      while (rows.length && !rows[rows.length - 1].text.trim()) rows.pop();
      return {
        v: 2,
        settings: { ...this.settings },
        view: { ...this.graph.view },
        rows: rows.map(({ id, text, color, hidden }) => ({ id, text, color, hidden })),
      };
    }

    isEmpty() {
      return !this.rows.some((r) => r.text.trim());
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
      const used = new Set(this.rows.filter((r) => r.text.trim()).map((r) => r.color));
      const color = COLORS.find((c) => !used.has(c)) || COLORS[this.rows.length % COLORS.length];
      return { id: newId(), text, color, hidden: false };
    }

    // Desmos-style: there's always one empty row at the bottom.
    _ensureTrailing(dom = true) {
      const last = this.rows[this.rows.length - 1];
      if (last && !last.text.trim()) return;
      const row = this._newRow('');
      this.rows.push(row);
      if (dom) {
        this.rowsEl.appendChild(this._rowEl(row));
        this._renumber();
      }
    }

    insertRow(index, text, { focus = true } = {}) {
      const row = this._newRow(text);
      this.rows.splice(index, 0, row);
      this._ensureTrailing(false);
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
      this._ensureTrailing(false);
      if (this.graph.selected === id) this.graph.setSelected(null);
      this.renderRows();
      this.update();
      this.onChange();
      if (focusPrev) this.focusRow(this.rows[Math.max(0, i - 1)].id, true);
    }

    focusRow(id, atEnd = true) {
      const e = this.els.get(id);
      if (!e) return;
      e.input.focus();
      if (atEnd) e.input.setSelectionRange(e.input.value.length, e.input.value.length);
    }

    select(rowId, { focus = false } = {}) {
      this.graph.setSelected(rowId);
      for (const [id, e] of this.els) e.el.classList.toggle('selected', id === rowId);
      if (rowId && focus) {
        const e = this.els.get(rowId);
        if (e) {
          e.el.scrollIntoView({ block: 'nearest' });
          this.focusRow(rowId);
        }
      }
    }

    clear() {
      this.rows = [];
      this._ensureTrailing(false);
      this.graph.setSelected(null);
      this.renderRows();
      this.update();
      this.onChange();
    }

    // ---------- rows ----------

    renderRows() {
      this.els.clear();
      this.rowsEl.replaceChildren(...this.rows.map((r) => this._rowEl(r)));
      this._renumber();
    }

    _renumber() {
      this.rows.forEach((row, i) => {
        const e = this.els.get(row.id);
        if (!e) return;
        e.num.textContent = i + 1;
        e.input.setAttribute('aria-label', `Expression ${i + 1}`);
        const trailing = i === this.rows.length - 1 && !row.text.trim();
        e.el.classList.toggle('trailing', trailing);
        e.input.placeholder = this.rows.length === 1 ? 'Type math: 2+2, y = x^2, a = 3, (1, 2)' : '';
      });
    }

    _rowEl(row) {
      const num = el('span', { class: 'row-num' });
      const icon = el('button', { class: 'row-icon', tabIndex: -1 });
      icon.addEventListener('click', () => {
        if (!GRAPHABLE.has((this.results[this.rows.indexOf(row)] || {}).kind)) return;
        row.hidden = !row.hidden;
        this.update();
        this.onChange();
      });
      icon.addEventListener('contextmenu', (e) => {
        // Right-click cycles the curve color.
        e.preventDefault();
        row.color = COLORS[(COLORS.indexOf(row.color) + 1) % COLORS.length];
        this.update();
        this.onChange();
      });
      const input = el('input', { class: 'row-input', value: row.text, spellcheck: false, autocomplete: 'off' });
      const extra = el('div', { class: 'row-extra' });
      const del = el('button', { class: 'row-del', title: 'Delete expression', html: InkIcons.svg('x', 18) });
      del.setAttribute('aria-label', 'Delete expression');
      del.addEventListener('click', () => this.deleteRow(row.id));
      const node = el('div', { class: 'calc-row' }, [el('div', { class: 'row-gutter' }, [num, icon]), el('div', { class: 'row-main' }, [input, extra]), del]);
      node.dataset.id = row.id;

      input.addEventListener('input', () => {
        row.text = input.value;
        this._ensureTrailing();
        this._renumber();
        this.update();
        this.onChange();
      });
      input.addEventListener('keydown', (e) => this._onKey(e, row));
      input.addEventListener('focus', () => {
        node.classList.add('active');
        this.select(GRAPHABLE.has((this.results[this.rows.indexOf(row)] || {}).kind) ? row.id : null);
      });
      input.addEventListener('blur', () => {
        node.classList.remove('active');
        // Show any error message once the user leaves the row.
        const i = this.rows.indexOf(row);
        if (i >= 0 && this.results[i]) this._renderExtra(row, this.results[i], this.els.get(row.id));
      });
      this.els.set(row.id, { el: node, num, icon, input, extra });
      return node;
    }

    _onKey(e, row) {
      const i = this.rows.indexOf(row);
      const e2 = this.els.get(row.id);
      if (e.key === 'Enter') {
        e.preventDefault();
        const next = this.rows[i + 1];
        if (next && !next.text.trim()) this.focusRow(next.id);
        else this.insertRow(i + 1, '');
      } else if (e.key === 'Backspace' && !e2.input.value && this.rows.length > 1 && i > 0) {
        e.preventDefault();
        if (i === this.rows.length - 1) this.focusRow(this.rows[i - 1].id);
        else this.deleteRow(row.id, { focusPrev: true });
      } else if (e.key === 'ArrowUp' && i > 0) {
        e.preventDefault();
        this.focusRow(this.rows[i - 1].id);
      } else if (e.key === 'ArrowDown' && i < this.rows.length - 1) {
        e.preventDefault();
        this.focusRow(this.rows[i + 1].id);
      }
    }

    // Re-evaluate everything and refresh results, icons and the graph.
    update({ skip } = {}) {
      this.results = InkMath.evaluate(this.rows, { angle: this.settings.angle });
      const items = [];
      this.rows.forEach((row, i) => {
        const res = this.results[i];
        const e = this.els.get(row.id);
        if (e && row !== skip) this._renderExtra(row, res, e);
        if (GRAPHABLE.has(res.kind) && !row.hidden) items.push({ ...res, color: this.shown(row.color), rowId: row.id });
      });
      this.graph.setItems(items);
    }

    _renderExtra(row, res, { el: node, icon, extra, input }) {
      node.classList.toggle('error', res.kind === 'error');
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
      if (res.kind === 'value' || (res.kind === 'def' && res.value !== undefined)) {
        const val = el('span', { class: 'val' }, InkMath.format(res.value));
        const out = el('button', { class: 'row-result', title: 'Copy result', html: '<span class="eq">=</span>' }, val);
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
          const add = (list) => {
            const idx = this.rows.indexOf(row);
            list.forEach((n, k) => this.insertRow(idx + 1 + k, `${n} = 1`, { focus: false }));
          };
          const wrap = el('div', { class: 'row-sliders' }, 'add slider:');
          for (const n of res.missing) wrap.appendChild(el('button', { class: 'chip', onclick: () => add([n]) }, n));
          if (res.missing.length > 1) wrap.appendChild(el('button', { class: 'chip primary', onclick: () => add(res.missing) }, 'all'));
          extra.appendChild(wrap);
        } else if (document.activeElement !== input) {
          extra.appendChild(el('div', { class: 'row-msg' }, res.message));
        }
      }
    }

    _slider(row, res) {
      const bound = niceBound(res.value);
      const min = res.value < 0 || bound > 10 ? -bound : -10;
      const max = bound;
      const range = el('input', { type: 'range', min, max, step: (max - min) / 200, value: res.value });
      range.setAttribute('aria-label', `${res.name} slider`);
      range.addEventListener('input', () => {
        const step = Number(range.step);
        const v = Math.round(Number(range.value) / step) * step;
        row.text = `${res.name} = ${parseFloat(v.toPrecision(6))}`;
        this.els.get(row.id).input.value = row.text;
        this.update({ skip: row }); // don't rebuild this slider mid-drag
        this.onChange();
      });
      return el('div', { class: 'row-slider' }, [el('span', {}, InkMath.format(min)), range, el('span', {}, InkMath.format(max))]);
    }

    // ---------- graph controls & settings ----------

    _buildControls() {
      const ctl = el('div', { class: 'graph-ctl' });
      const btn = (name, title, icon, fn) => {
        const b = el('button', { title, html: InkIcons.svg(icon, 18), onclick: fn });
        b.dataset.graph = name;
        return b;
      };
      this.settingsBtn = btn('settings', 'Graph settings', 'wrench', () => this.toggleSettings());
      ctl.append(
        this.settingsBtn,
        el('div', { class: 'ctl-gap' }),
        btn('in', 'Zoom in', 'plus', () => this.graph.zoom(1.5)),
        btn('out', 'Zoom out', 'minus', () => this.graph.zoom(1 / 1.5)),
        btn('home', 'Default view (double-click graph)', 'home', () => this.graph.home())
      );

      const check = (key, label) => {
        const box = el('input', { type: 'checkbox', onchange: (e) => this._set({ [key]: e.target.checked }) });
        box.dataset.key = key;
        return el('label', { class: 'gs-check' }, [box, label]);
      };
      const numInput = (key) => {
        const i = el('input', { class: 'gs-num', spellcheck: false });
        i.dataset.key = key;
        const apply = () => this._applyRange();
        i.addEventListener('change', apply);
        i.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            apply();
            i.blur();
          }
        });
        return i;
      };
      const seg = (key, options) =>
        el(
          'div',
          { class: 'gs-seg' },
          options.map(([value, label]) => {
            const b = el('button', { onclick: () => this._set({ [key]: value }) }, label);
            b.dataset.value = value;
            b.dataset.key = key;
            return b;
          })
        );
      const labelInput = (key, ph) => {
        const i = el('input', { class: 'gs-text', placeholder: ph, maxLength: 24 });
        i.dataset.key = key;
        i.addEventListener('input', () => this._set({ [key]: i.value }));
        return i;
      };

      this.panel = el('div', { class: 'graph-settings', hidden: true, role: 'dialog' }, [
        el('div', { class: 'gs-title' }, 'Graph settings'),
        seg('angle', [['rad', 'Radians'], ['deg', 'Degrees']]),
        el('div', { class: 'gs-grid' }, [check('grid', 'Grid'), check('axisNumbers', 'Axis numbers'), check('minor', 'Minor gridlines'), check('xAxis', 'X-axis'), el('span'), check('yAxis', 'Y-axis')]),
        el('div', { class: 'gs-sec' }, 'View'),
        el('div', { class: 'gs-range' }, [numInput('xmin'), el('span', { class: 'gs-var' }, '≤ x ≤'), numInput('xmax')]),
        el('div', { class: 'gs-range' }, [numInput('ymin'), el('span', { class: 'gs-var' }, '≤ y ≤'), numInput('ymax')]),
        el('div', { class: 'gs-row' }, [
          el('button', { class: 'chip', onclick: () => this._squareUp(), title: 'Make one unit the same size on both axes' }, 'Square grid'),
          el('button', { class: 'chip', onclick: () => this.graph.home() }, 'Default view'),
        ]),
        el('div', { class: 'gs-sec' }, 'Axis labels'),
        el('div', { class: 'gs-row' }, [labelInput('xLabel', 'x-axis, e.g. “time”'), labelInput('yLabel', 'y-axis')]),
        el('div', { class: 'gs-sec' }, 'Points of interest'),
        el('p', { class: 'gs-help' }, 'Zeros, intersections, maxima/minima and y-intercepts. Click a gray dot to pin its coordinates.'),
        seg('poi', [['all', 'All curves'], ['selected', 'Selected'], ['off', 'Off']]),
      ]);
      this.graphEl.append(ctl, this.panel);

      document.addEventListener('pointerdown', (e) => {
        if (!this.panel.hidden && !this.panel.contains(e.target) && !this.settingsBtn.contains(e.target)) this.toggleSettings(false);
      });
      this.panel.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') this.toggleSettings(false);
      });
    }

    toggleSettings(open = this.panel.hidden) {
      this.panel.hidden = !open;
      this.settingsBtn.classList.toggle('on', open);
      if (open) this._syncSettings();
    }

    _set(patch) {
      Object.assign(this.settings, patch);
      this.graph.setOptions(this.settings);
      if ('angle' in patch) this.update();
      this._syncSettings();
      this.onChange();
    }

    _syncSettings() {
      for (const b of this.panel.querySelectorAll('.gs-seg button')) b.classList.toggle('on', this.settings[b.dataset.key] === b.dataset.value);
      for (const c of this.panel.querySelectorAll('.gs-check input')) c.checked = !!this.settings[c.dataset.key];
      for (const t of this.panel.querySelectorAll('.gs-text')) if (document.activeElement !== t) t.value = this.settings[t.dataset.key] || '';
      this._syncRangeInputs();
    }

    _syncRangeInputs() {
      if (!this.panel || this.panel.hidden) return;
      const b = this.graph.bounds();
      for (const i of this.panel.querySelectorAll('.gs-num')) if (document.activeElement !== i) i.value = parseFloat(b[i.dataset.key].toPrecision(5));
    }

    _applyRange() {
      const vals = {};
      for (const i of this.panel.querySelectorAll('.gs-num')) {
        const v = InkMath.quick(i.value) ?? Number(i.value);
        vals[i.dataset.key] = v;
        i.classList.toggle('bad', !Number.isFinite(v));
      }
      const ok = vals.xmax > vals.xmin && vals.ymax > vals.ymin;
      for (const i of this.panel.querySelectorAll('.gs-num')) if (!ok) i.classList.add('bad');
      if (ok && this.graph.setBounds(vals)) this._syncRangeInputs();
    }

    _squareUp() {
      const v = this.graph.view;
      const s = Math.sqrt(v.sx * v.sy);
      this.graph.setView({ ...v, sx: s, sy: s });
      this._syncRangeInputs();
      this.onChange();
    }
  }

  globalThis.CalcEditor = CalcEditor;
})();
