// Shared popup menus: a dropdown button, a ⋮ / right-click menu, and a free-form
// panel. Opens under its anchor, moves with ↑ ↓ Home End, picks with Enter, closes
// on Esc, Tab or a click outside. Styles live in controls.css.
(function (root) {
  'use strict';

  let current = null;

  function close() {
    if (current) current.close();
  }

  // A floating panel. `build(panel, close)` fills it. Anchor is an element or a {x, y} point.
  function panel({ anchor, build, align = 'start', className = '', onClose = null, label = '' }) {
    close();
    const box = document.createElement('div');
    box.className = `tc-menu ${className}`.trim();
    box.tabIndex = -1;
    if (label) box.setAttribute('aria-label', label);
    const host = (anchor && anchor.closest && anchor.closest('dialog')) || document.body; // dialogs sit in the top layer
    host.append(box);

    let closed = false;
    const api = {
      el: box,
      close(refocus = true) {
        if (closed) return;
        closed = true;
        document.removeEventListener('pointerdown', onDown, true);
        document.removeEventListener('keydown', onKey, true);
        window.removeEventListener('resize', api.close);
        window.removeEventListener('blur', api.close);
        box.remove();
        if (current === api) current = null;
        if (refocus && anchor && anchor.focus && document.contains(anchor)) anchor.focus({ preventScroll: true });
        if (onClose) onClose();
      },
    };
    const onDown = (e) => {
      if (!box.contains(e.target) && !(anchor && anchor.contains && anchor.contains(e.target))) api.close(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation(); // don't also close a dialog underneath
        api.close();
      } else if (e.key === 'Tab') api.close(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', api.close);
    window.addEventListener('blur', api.close);

    build(box, api.close);

    // Place: under the anchor (flipped above when it would run off), kept inside the window.
    const r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y, width: 0 };
    const hostBox = host === document.body ? { left: 0, top: 0 } : host.getBoundingClientRect();
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    let left = align === 'end' ? r.right - w : r.left;
    left = Math.max(8, Math.min(left, vw - w - 8));
    let top = r.bottom + 4;
    if (top + h > vh - 8) top = Math.max(8, r.top - h - 4);
    box.style.left = `${left - hostBox.left}px`;
    box.style.top = `${top - hostBox.top}px`;

    current = api;
    return api;
  }

  // A list of items: { label, onSelect, hint, disabled, danger, checked, color } or { sep: true }.
  function open({ anchor, items, align = 'start', onClose = null, label = '' }) {
    return panel({
      anchor,
      align,
      onClose,
      label,
      className: 'tc-list',
      build(box, done) {
        box.setAttribute('role', 'menu');
        const rows = [];
        for (const it of items) {
          if (it.sep) {
            const s = document.createElement('div');
            s.className = 'tc-sep';
            s.setAttribute('role', 'separator');
            box.append(s);
            continue;
          }
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'tc-item';
          b.setAttribute('role', it.checked != null ? 'menuitemradio' : 'menuitem');
          if (it.checked != null) b.setAttribute('aria-checked', String(!!it.checked));
          if (it.danger) b.classList.add('danger');
          b.disabled = !!it.disabled;
          b.tabIndex = -1;
          if (it.color) {
            const dot = document.createElement('i');
            dot.className = 'tc-dot';
            dot.style.background = it.color;
            b.append(dot);
          } else if (it.checked != null) {
            const tick = document.createElement('i');
            tick.className = 'tc-tick';
            tick.textContent = it.checked ? '✓' : '';
            b.append(tick);
          }
          const t = document.createElement('span');
          t.className = 'tc-label';
          t.textContent = it.label;
          b.append(t);
          if (it.hint) {
            const hnt = document.createElement('span');
            hnt.className = 'tc-hint';
            hnt.textContent = it.hint;
            b.append(hnt);
          }
          b.addEventListener('click', () => {
            done();
            if (it.onSelect) it.onSelect();
          });
          box.append(b);
          if (!b.disabled) rows.push(b);
        }
        const move = (i) => {
          if (!rows.length) return;
          rows[(i + rows.length) % rows.length].focus();
        };
        box.addEventListener('keydown', (e) => {
          const i = rows.indexOf(document.activeElement);
          if (e.key === 'ArrowDown') move(i + 1);
          else if (e.key === 'ArrowUp') move(i < 0 ? -1 : i - 1);
          else if (e.key === 'Home') move(0);
          else if (e.key === 'End') move(-1);
          else return;
          e.preventDefault();
        });
        // Focus the checked row, else the first one.
        queueMicrotask(() => (rows.find((b) => b.getAttribute('aria-checked') === 'true') || rows[0] || box).focus({ preventScroll: true }));
      },
    });
  }

  // A button that shows its value and opens a list: options [{ value, label, color }],
  // extra [{ label, onSelect }] are action rows after a divider (e.g. "Add subject…").
  function dropdown({ options, value, onChange = () => {}, extra = [], label = '', className = '' }) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `tc-drop ${className}`.trim();
    btn.setAttribute('aria-haspopup', 'menu');
    if (label) btn.setAttribute('aria-label', label);
    let opts = options;
    let cur = value;
    const paint = () => {
      btn.textContent = '';
      const o = opts.find((x) => x.value === cur) || opts[0];
      if (o && o.color) {
        const dot = document.createElement('i');
        dot.className = 'tc-dot';
        dot.style.background = o.color;
        btn.append(dot);
      }
      const t = document.createElement('span');
      t.className = 'tc-label';
      t.textContent = o ? o.label : '';
      const caret = document.createElement('span');
      caret.className = 'tc-caret';
      caret.textContent = '▾';
      btn.append(t, caret);
    };
    const show = () => {
      btn.setAttribute('aria-expanded', 'true');
      open({
        anchor: btn,
        label,
        onClose: () => btn.setAttribute('aria-expanded', 'false'),
        items: [
          ...opts.map((o) => ({
            label: o.label,
            color: o.color,
            checked: o.value === cur,
            onSelect: () => {
              cur = o.value;
              paint();
              onChange(cur);
            },
          })),
          ...(extra.length ? [{ sep: true }, ...extra] : []),
        ],
      });
    };
    btn.addEventListener('click', show);
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        show();
      }
    });
    paint();
    return {
      el: btn,
      get value() {
        return cur;
      },
      set(v, newOptions) {
        if (newOptions) opts = newOptions;
        cur = v;
        paint();
      },
    };
  }

  // Right-click menu on an element: getItems(event) returns the items (or null for the browser's own menu).
  function attachContext(target, getItems) {
    target.addEventListener('contextmenu', (e) => {
      const items = getItems(e);
      if (!items) return;
      e.preventDefault();
      open({ anchor: { x: e.clientX, y: e.clientY }, items });
    });
  }

  root.TCMenu = { open, panel, dropdown, attachContext, close };
})(typeof globalThis !== 'undefined' ? globalThis : this);
