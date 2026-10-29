// Shared number stepper: a field with ▲ ▼ buttons. Arrow keys, Page Up/Down and
// the scroll wheel step it too. Built to be dropped into other pages (Timecheck's
// lengths and set times, Inkwell's crop sizes); styles live in controls.css.
(function (root) {
  'use strict';

  function create({ value = 0, min = 0, max = 100, step = 1, unit = '', label = '', format = String, parse = null, onChange = () => {} } = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'tc-step';
    const input = document.createElement('input');
    input.className = 'tc-step-val';
    input.type = 'text';
    input.inputMode = 'numeric';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('role', 'spinbutton');
    if (label) input.setAttribute('aria-label', label);
    input.setAttribute('aria-valuemin', String(min));
    input.setAttribute('aria-valuemax', String(max));
    const btns = document.createElement('span');
    btns.className = 'tc-step-btns';
    const mk = (cls, text, title) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.tabIndex = -1;
      b.className = `tc-step-btn ${cls}`;
      b.textContent = text;
      b.title = title;
      b.setAttribute('aria-label', title);
      return b;
    };
    const up = mk('tc-up', '▲', 'More');
    const down = mk('tc-down', '▼', 'Less');
    btns.append(up, down);
    wrap.append(input);
    if (unit) {
      const u = document.createElement('span');
      u.className = 'tc-step-unit';
      u.textContent = unit;
      wrap.append(u);
    }
    wrap.append(btns);

    const clamp = (v) => Math.min(max, Math.max(min, v));
    const parseText = parse || ((t) => {
      const n = parseInt(String(t).replace(/[^\d-]/g, ''), 10);
      return Number.isFinite(n) ? n : null;
    });
    let current = clamp(value);

    function paint() {
      input.value = format(current);
      input.setAttribute('aria-valuenow', String(current));
      up.disabled = current >= max;
      down.disabled = current <= min;
    }
    function set(v, { silent = false } = {}) {
      const next = clamp(Math.round(v));
      const changed = next !== current;
      current = next;
      paint();
      if (changed && !silent) onChange(current);
    }
    // Step to the next multiple of `step`, so 33 goes to 35 (or 30), not 38.
    function nudge(dir, mult = 1) {
      const s = step * mult;
      const r = current % s;
      set(dir > 0 ? current - r + s : r === 0 ? current - s : current - r);
    }
    function commit() {
      const n = parseText(input.value);
      if (n == null) paint();
      else set(n);
      paint();
    }

    up.addEventListener('click', () => nudge(1));
    down.addEventListener('click', () => nudge(-1));
    // Keep focus where it is when a button is pressed.
    btns.addEventListener('mousedown', (e) => e.preventDefault());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp') nudge(1);
      else if (e.key === 'ArrowDown') nudge(-1);
      else if (e.key === 'PageUp') nudge(1, 6);
      else if (e.key === 'PageDown') nudge(-1, 6);
      else if (e.key === 'Home') set(min);
      else if (e.key === 'End') set(max);
      else {
        if (e.key === 'Enter') commit();
        return;
      }
      e.preventDefault();
    });
    input.addEventListener('change', commit);
    input.addEventListener('blur', commit);
    // The wheel steps it while the pointer is over it (not when you're just scrolling past).
    wrap.addEventListener(
      'wheel',
      (e) => {
        if (!e.deltaY) return;
        e.preventDefault();
        nudge(e.deltaY < 0 ? 1 : -1);
      },
      { passive: false }
    );

    paint();
    return {
      el: wrap,
      input,
      get value() {
        return current;
      },
      set,
      focus: () => input.focus(),
    };
  }

  // 24-hour clock helpers for a stepper whose value is minutes since midnight.
  const clock = {
    format(min) {
      const m = ((Math.round(min) % 1440) + 1440) % 1440;
      return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    },
    parse(text) {
      const m = /^\s*(\d{1,2})(?::?(\d{2}))?\s*([ap]m?)?\s*$/i.exec(String(text));
      if (!m) return null;
      let h = Number(m[1]);
      const mm = Number(m[2] || 0);
      if (m[3]) {
        if (/^p/i.test(m[3]) && h < 12) h += 12;
        if (/^a/i.test(m[3]) && h === 12) h = 0;
      }
      return h > 23 || mm > 59 ? null : h * 60 + mm;
    },
  };

  root.TCStepper = { create, clock };
})(typeof globalThis !== 'undefined' ? globalThis : this);
