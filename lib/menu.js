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
        if (api.closeChild) api.closeChild(false);
        box.remove();
        if (current === api) current = null;
        if (refocus && anchor && anchor.focus && document.contains(anchor)) anchor.focus({ preventScroll: true });
        if (onClose) onClose();
      },
    };
    const onDown = (e) => {
      const inside = api.contains ? api.contains(e.target) : box.contains(e.target);
      if (!inside && !(anchor && anchor.contains && anchor.contains(e.target))) api.close(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation(); // don't also close a dialog underneath
        if (api.closeChild && api.closeChild(true)) return; // Esc closes an open submenu first
        api.close();
      } else if (e.key === 'Tab') api.close(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', api.close);
    window.addEventListener('blur', api.close);

    build(box, api.close, api);

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

  // A list of items: { label, onSelect, hint, icon, disabled, danger, checked, color, sub: [items] } or { sep: true }.
  // An item with `sub` opens a second list beside it (hover, click or →); ← or Esc closes just that one.
  function open({ anchor, items, align = 'start', onClose = null, label = '' }) {
    return panel({
      anchor,
      align,
      onClose,
      label,
      className: 'tc-list',
      build(box, done, api) {
        const host = box.parentNode;
        let child = null; // the open submenu: { box, owner }

        const closeChild = (refocus = false) => {
          if (!child) return;
          const { box: cb, owner } = child;
          child = null;
          cb.remove();
          owner.classList.remove('open');
          owner.setAttribute('aria-expanded', 'false');
          if (refocus) owner.focus({ preventScroll: true });
        };
        api.closeChild = (refocus) => {
          const had = !!child;
          closeChild(refocus);
          return had;
        };
        api.contains = (node) => box.contains(node) || (child && child.box.contains(node));

        const fill = (list, entries, isSub) => {
          list.setAttribute('role', 'menu');
          const rows = [];
          for (const it of entries) {
            if (!it) continue;
            if (it.sep) {
              const sp = document.createElement('div');
              sp.className = 'tc-sep';
              sp.setAttribute('role', 'separator');
              list.append(sp);
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
            if (it.icon && globalThis.InkIcons) {
              const ic = document.createElement('span');
              ic.className = 'tc-icon';
              ic.innerHTML = InkIcons.svg(it.icon, 16);
              b.append(ic);
            }
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
            if (it.sub) {
              b.classList.add('has-sub');
              b.setAttribute('aria-haspopup', 'menu');
              b.setAttribute('aria-expanded', 'false');
              const caret = document.createElement('span');
              caret.className = 'tc-sub-caret';
              caret.textContent = '›';
              b.append(caret);
              b.addEventListener('click', () => openChild(b, it.sub, true));
              let timer = 0;
              b.addEventListener('pointerenter', () => {
                clearTimeout(timer);
                if (!b.disabled) timer = setTimeout(() => openChild(b, it.sub, false), 140);
              });
              b.addEventListener('pointerleave', () => clearTimeout(timer));
            } else {
              b.addEventListener('click', () => {
                done();
                if (it.onSelect) it.onSelect();
              });
              // Moving onto a plain item in the parent list closes the open submenu.
              if (!isSub) b.addEventListener('pointerenter', () => closeChild());
            }
            list.append(b);
            if (!b.disabled) rows.push(b);
          }
          const move = (i) => {
            if (rows.length) rows[(i + rows.length) % rows.length].focus();
          };
          list.addEventListener('keydown', (e) => {
            const i = rows.indexOf(document.activeElement);
            const cur = rows[i];
            if (e.key === 'ArrowDown') move(i + 1);
            else if (e.key === 'ArrowUp') move(i < 0 ? -1 : i - 1);
            else if (e.key === 'Home') move(0);
            else if (e.key === 'End') move(-1);
            else if (e.key === 'ArrowRight' && cur && cur.classList.contains('has-sub')) cur.click();
            else if (e.key === 'ArrowLeft' && isSub) closeChild(true);
            else return;
            e.preventDefault();
            e.stopPropagation();
          });
          return rows;
        };

        const place = (el, anchorRect) => {
          const vw = document.documentElement.clientWidth;
          const vh = document.documentElement.clientHeight;
          const hostBox = host === document.body ? { left: 0, top: 0 } : host.getBoundingClientRect();
          const w = el.offsetWidth;
          const h = el.offsetHeight;
          let left = anchorRect.right - 2;
          if (left + w > vw - 8) left = Math.max(8, anchorRect.left - w + 2);
          let top = anchorRect.top - 6;
          if (top + h > vh - 8) top = Math.max(8, vh - h - 8);
          el.style.left = `${left - hostBox.left}px`;
          el.style.top = `${top - hostBox.top}px`;
        };

        function openChild(owner, entries, focus) {
          if (child && child.owner === owner) {
            if (focus) child.box.querySelector('.tc-item:not(:disabled)')?.focus();
            return;
          }
          closeChild();
          const cb = document.createElement('div');
          cb.className = 'tc-menu tc-list tc-sub';
          cb.tabIndex = -1;
          host.append(cb);
          const subRows = fill(cb, entries, true);
          owner.classList.add('open');
          owner.setAttribute('aria-expanded', 'true');
          place(cb, owner.getBoundingClientRect());
          child = { box: cb, owner };
          if (focus) subRows[0]?.focus({ preventScroll: true });
        }

        const rows = fill(box, items, false);
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
