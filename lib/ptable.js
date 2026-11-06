// A periodic table that floats in a corner of Inkwell. Click an element to see its numbers; click any number to copy it.
//
//   const pt = InkPTable.create({ host, state: {open, mode, corner, sel}, onChange(state), toast(msg) });
//   pt.open() / pt.close() / pt.toggle() / pt.select('Fe')
//
// States: closed, "compact" (the table and one row of quick-copy chips) and "full" (adds every property and the isotopes).
// Needs lib/elements.js (InkElements). The pure helpers are exposed as InkPTable.util for tests.
(function (root) {
  'use strict';

  const CORNERS = ['br', 'bl', 'tl', 'tr'];
  const CORNER_NAMES = { br: 'bottom right', bl: 'bottom left', tl: 'top left', tr: 'top right' };

  // Where each element sits: [row, column] on a grid of 18 columns, the main table in rows 1 to 7
  // and the lanthanides and actinides pulled out into rows 9 and 10.
  function position(z) {
    if (z === 1) return [1, 1];
    if (z === 2) return [1, 18];
    if (z <= 4) return [2, z - 2];
    if (z <= 10) return [2, z + 8];
    if (z <= 12) return [3, z - 10];
    if (z <= 18) return [3, z];
    if (z <= 36) return [4, z - 18];
    if (z <= 54) return [5, z - 36];
    if (z <= 56) return [6, z - 54];
    if (z <= 71) return [9, z - 54]; // La .. Lu, starting under column 3
    if (z <= 86) return [6, z - 68];
    if (z <= 88) return [7, z - 86];
    if (z <= 103) return [10, z - 86]; // Ac .. Lr
    return [7, z - 100];
  }

  // Half-life in seconds to a short readable form. 0 means stable, null unknown.
  function fmtHalfLife(sec) {
    if (sec === 0) return 'stable';
    if (sec == null) return '?';
    const Y = 365.25 * 86400;
    const steps = [
      [1e24 * Y, 'Yy'], [1e21 * Y, 'Zy'], [1e18 * Y, 'Ey'], [1e15 * Y, 'Py'], [1e12 * Y, 'Ty'], [1e9 * Y, 'Gy'], [1e6 * Y, 'My'], [1e3 * Y, 'ky'], [Y, 'y'],
      [86400, 'd'], [3600, 'h'], [60, 'min'], [1, 's'], [1e-3, 'ms'], [1e-6, 'µs'], [1e-9, 'ns'], [1e-12, 'ps'], [1e-15, 'fs'], [1e-18, 'as'], [1e-21, 'zs'], [1e-24, 'ys'],
    ];
    for (const [size, unit] of steps) {
      if (sec >= size * 0.9995) {
        const v = sec / size;
        return `${parseFloat(v.toPrecision(3))} ${unit}`;
      }
    }
    return `${sec} s`;
  }

  // The isotopes worth listing first: stable or naturally occurring ones, else the longest-lived few.
  function keyIsotopes(el) {
    const natural = el.iso.filter((i) => i[2] || i[3] === 0);
    if (natural.length) return natural;
    return el.iso
      .filter((i) => i[3])
      .sort((a, b) => b[3] - a[3])
      .slice(0, 5)
      .sort((a, b) => a[0] - b[0]);
  }

  // Find an element from what someone typed: a symbol, a name (or its start), or an atomic number.
  function find(list, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return null;
    if (/^\d+$/.test(q)) return list.find((e) => e.z === Number(q)) || null;
    return list.find((e) => e.s.toLowerCase() === q) || list.find((e) => e.n.toLowerCase() === q) || list.find((e) => e.n.toLowerCase().startsWith(q)) || null;
  }

  const num = (v, digits) => (v == null ? null : String(digits == null ? v : parseFloat(Number(v).toFixed(digits))));
  const celsius = (k) => (k == null ? null : parseFloat((k - 273.15).toFixed(2)));

  // What each quick-copy chip shows and copies. `copy` is the bare value, so it pastes straight into a calculator row.
  function facts(el) {
    return [
      { key: 'z', label: 'Atomic number', short: 'Z', show: String(el.z), copy: String(el.z) },
      { key: 'm', label: 'Atomic mass', short: 'Mass', show: `${num(el.m)} u`, copy: num(el.m) },
      { key: 'en', label: 'Electronegativity (Pauling)', short: 'EN', show: el.en == null ? '—' : String(el.en), copy: el.en == null ? null : String(el.en) },
      { key: 'ie', label: 'First ionization energy', short: 'IE₁', show: el.ie == null ? '—' : `${num(el.ie, 3)} eV`, copy: el.ie == null ? null : num(el.ie, 4) },
      { key: 'ea', label: 'Electron affinity', short: 'EA', show: el.ea == null ? '—' : `${num(el.ea, 3)} eV`, copy: el.ea == null ? null : num(el.ea, 4) },
      { key: 'd', label: 'Density', short: 'ρ', show: el.d == null ? '—' : `${num(el.d)} g/cm³`, copy: el.d == null ? null : num(el.d) },
      { key: 'mp', label: 'Melting point (K)', short: 'Melts', show: el.mp == null ? '—' : `${num(el.mp)} K`, copy: el.mp == null ? null : num(el.mp), alt: el.mp == null ? null : { show: `${celsius(el.mp)} °C`, copy: String(celsius(el.mp)) } },
      { key: 'bp', label: 'Boiling point (K)', short: 'Boils', show: el.bp == null ? '—' : `${num(el.bp)} K`, copy: el.bp == null ? null : num(el.bp), alt: el.bp == null ? null : { show: `${celsius(el.bp)} °C`, copy: String(celsius(el.bp)) } },
      { key: 'r', label: 'Atomic radius', short: 'Radius', show: el.r == null ? '—' : `${el.r} pm`, copy: el.r == null ? null : String(el.r) },
      { key: 'cfg', label: 'Electron configuration', short: 'Config', show: el.cfg || '—', copy: el.cfg || null },
      { key: 'ox', label: 'Oxidation states', short: 'Ox.', show: el.ox.length ? el.ox.map((o) => (o > 0 ? `+${o}` : String(o))).join(', ') : '—', copy: el.ox.length ? el.ox.map((o) => (o > 0 ? `+${o}` : String(o))).join(', ') : null },
    ];
  }

  const mostAbundantIso = (el) => el.iso.filter((i) => i[2]).sort((a, b) => b[2] - a[2])[0] || null;

  // One line with the basics, for "Copy summary".
  function summary(el) {
    const f = Object.fromEntries(facts(el).map((x) => [x.key, x]));
    const bits = [`${el.n} (${el.s})`, `Z = ${el.z}`, `M = ${num(el.m)} u`];
    if (el.en != null) bits.push(`EN = ${el.en}`);
    if (f.cfg.copy) bits.push(f.cfg.copy);
    return bits.join(', ');
  }

  const $ = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  function create({ host = document.body, state = {}, onChange = () => {}, toast = () => {} } = {}) {
    const list = root.InkElements;
    const st = { open: false, mode: 'compact', corner: 'br', sel: 'Fe', ...state };
    const byZ = new Map(list.map((e) => [e.z, e]));
    const bySym = new Map(list.map((e) => [e.s, e]));
    let showAllIso = false;

    const panel = $('div', 'ptable');
    panel.id = 'ptable';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Periodic table');

    const head = $('div', 'pt-head');
    const title = $('span', 'pt-title', 'Periodic table');
    const search = $('input', 'pt-search');
    search.type = 'search';
    search.placeholder = 'Fe, iron, 26';
    search.setAttribute('aria-label', 'Find an element');
    search.autocomplete = 'off';
    const modeBtn = $('button', 'pt-btn');
    const cornerBtn = $('button', 'pt-btn', '⇲');
    const closeBtn = $('button', 'pt-btn', '✕');
    for (const b of [modeBtn, cornerBtn, closeBtn]) b.type = 'button';
    closeBtn.title = 'Close';
    closeBtn.setAttribute('aria-label', 'Close the periodic table');
    head.append(title, search, modeBtn, cornerBtn, closeBtn);

    const grid = $('div', 'pt-grid');
    const cells = new Map();
    for (const el of list) {
      const [row, col] = position(el.z);
      const b = $('button', 'pt-cell');
      b.type = 'button';
      b.dataset.z = el.z;
      b.dataset.cat = (el.cat || '').toLowerCase().replace(/\s+/g, '-');
      b.style.gridRow = row;
      b.style.gridColumn = col;
      if (el.rad) b.classList.add('rad');
      b.append($('span', 'pt-z', String(el.z)), $('span', 'pt-sym', el.s));
      b.setAttribute('aria-label', `${el.n}, atomic number ${el.z}`);
      grid.append(b);
      cells.set(el.z, b);
    }
    // markers where the lanthanides and actinides belong
    for (const [row, label, z] of [[6, '*', 57], [7, '**', 89]]) {
      const m = $('button', 'pt-cell pt-gap', label);
      m.type = 'button';
      m.style.gridRow = row;
      m.style.gridColumn = 3;
      m.title = z === 57 ? 'Lanthanides 57–71 (the row below)' : 'Actinides 89–103 (the bottom row)';
      m.tabIndex = -1;
      m.addEventListener('click', () => select(z));
      grid.append(m);
    }

    const chips = $('div', 'pt-chips');
    const detail = $('div', 'pt-detail');
    panel.append(head, grid, chips, detail);
    host.append(panel);

    function save() {
      onChange({ ...st });
    }

    async function copy(text, what) {
      if (text == null || text === '') return;
      try {
        await navigator.clipboard.writeText(String(text));
        toast(`Copied ${what ? `${what}: ` : ''}${text}`);
      } catch (_) {
        toast('Couldn’t copy. Select the number and copy it yourself.');
      }
    }

    function chip(label, value, text, what) {
      const b = $('button', 'pt-chip');
      b.type = 'button';
      b.append($('span', 'pt-chip-l', label), $('span', 'pt-chip-v', value));
      if (text == null) b.disabled = true;
      else {
        b.title = `Copy ${what || label}`;
        b.addEventListener('click', () => copy(text, what || label));
      }
      return b;
    }

    function current() {
      return bySym.get(st.sel) || byZ.get(26);
    }

    function renderDetail() {
      const el = current();
      for (const [z, b] of cells) b.classList.toggle('sel', z === el.z);
      chips.textContent = '';
      detail.textContent = '';
      const f = facts(el);
      const get = (k) => f.find((x) => x.key === k);
      // compact: the numbers people reach for most
      const top = $('div', 'pt-name');
      top.append($('b', null, `${el.n}`), $('span', 'pt-sub', ` ${el.s} · ${el.cat || ''}`));
      chips.append(top);
      const row = $('div', 'pt-chip-row');
      for (const k of ['z', 'm', 'en']) {
        const x = get(k);
        row.append(chip(x.short, x.show, x.copy, x.label));
      }
      chips.append(row);
      if (st.mode !== 'full') return;

      // full: every property, then the isotopes
      const props = $('div', 'pt-props');
      for (const x of f) {
        if (['z', 'm', 'en'].includes(x.key)) continue;
        const r = $('div', 'pt-prop');
        r.append($('span', 'pt-prop-l', x.label.replace(' (K)', '')));
        const vals = $('span', 'pt-prop-v');
        const b = $('button', 'pt-val', x.show);
        b.type = 'button';
        if (x.copy == null) b.disabled = true;
        else {
          b.title = `Copy ${x.copy}`;
          b.addEventListener('click', () => copy(x.copy, x.label));
        }
        vals.append(b);
        if (x.alt) {
          const a = $('button', 'pt-val', x.alt.show);
          a.type = 'button';
          a.title = `Copy ${x.alt.copy}`;
          a.addEventListener('click', () => copy(x.alt.copy, x.label.replace('(K)', '(°C)')));
          vals.append(a);
        }
        r.append(vals);
        props.append(r);
      }
      const meta = $('div', 'pt-meta', `Period ${el.per} · ${el.blk}-block${el.yr ? ` · discovered ${el.yr}` : ''}`);
      const sumBtn = $('button', 'pt-link', 'Copy summary');
      sumBtn.type = 'button';
      sumBtn.addEventListener('click', () => copy(summary(el), 'summary'));
      detail.append(props, meta, sumBtn);

      // formulas that work in a calculator row, one click to copy
      const main = mostAbundantIso(el);
      const forms = [`mass(${el.s})`, ...(el.en != null ? [`EN(${el.s})`] : []), ...(main ? [`mass(${el.s}-${main[0]})`, `abundance(${el.s}-${main[0]})`] : [])];
      const calc = $('div', 'pt-calc');
      calc.append($('span', 'pt-prop-l', 'In a calculator row'));
      const cv = $('span', 'pt-prop-v');
      for (const f of forms) {
        const b = $('button', 'pt-val pt-code', f);
        b.type = 'button';
        b.title = `Copy ${f}`;
        b.addEventListener('click', () => copy(f, 'formula'));
        cv.append(b);
      }
      calc.append(cv);
      detail.append(calc);

      const shown = showAllIso ? el.iso : keyIsotopes(el);
      const head2 = $('div', 'pt-iso-head');
      head2.append($('b', null, 'Isotopes'), $('span', 'pt-sub', ` ${el.iso.length} known${shown.length < el.iso.length ? ', key ones shown' : ''}`));
      const tbl = $('div', 'pt-iso');
      const hdr = $('div', 'pt-iso-row pt-iso-h');
      for (const t of ['A', 'Mass (u)', 'Abundance', 'Half-life', 'Spin']) hdr.append($('span', null, t));
      tbl.append(hdr);
      for (const i of shown) {
        const [a, mass, ab, hl, spin] = i;
        const r = $('div', 'pt-iso-row');
        const sup = $('span', 'pt-iso-a');
        sup.append($('sup', null, String(a)), el.s);
        const mb = $('button', 'pt-val', String(mass));
        mb.title = `Copy the mass of ${el.s}-${a}`;
        mb.addEventListener('click', () => copy(String(mass), `${el.s}-${a} mass`));
        const ab_ = $('button', 'pt-val', ab ? `${ab}%` : '—');
        if (ab) {
          ab_.title = `Copy the abundance of ${el.s}-${a}`;
          ab_.addEventListener('click', () => copy(String(ab), `${el.s}-${a} abundance (%)`));
        } else ab_.disabled = true;
        const hb = $('button', 'pt-val', fmtHalfLife(hl));
        if (hl) {
          hb.title = `Copy the half-life of ${el.s}-${a}`;
          hb.addEventListener('click', () => copy(fmtHalfLife(hl), `${el.s}-${a} half-life`));
        } else hb.disabled = true;
        for (const b of [mb, ab_, hb]) b.type = 'button';
        r.append(sup, mb, ab_, hb, $('span', 'pt-iso-spin', spin == null ? '' : spin));
        tbl.append(r);
      }
      detail.append(head2, tbl);
      if (el.iso.length > keyIsotopes(el).length) {
        const more = $('button', 'pt-link', showAllIso ? 'Show key isotopes only' : `Show all ${el.iso.length}`);
        more.type = 'button';
        more.addEventListener('click', () => {
          showAllIso = !showAllIso;
          renderDetail();
        });
        detail.append(more);
      }
    }

    function applyShell() {
      panel.hidden = !st.open;
      panel.dataset.corner = st.corner;
      panel.dataset.mode = st.mode;
      modeBtn.textContent = st.mode === 'full' ? '▾' : '▸';
      modeBtn.title = st.mode === 'full' ? 'Hide the full list' : 'Show every property and the isotopes';
      modeBtn.setAttribute('aria-label', modeBtn.title);
      modeBtn.setAttribute('aria-expanded', String(st.mode === 'full'));
      cornerBtn.title = `Move to another corner (now ${CORNER_NAMES[st.corner]})`;
      cornerBtn.setAttribute('aria-label', cornerBtn.title);
    }

    function select(z, { scroll = true } = {}) {
      const el = typeof z === 'string' ? find(list, z) : byZ.get(z);
      if (!el) return false;
      st.sel = el.s;
      showAllIso = false;
      renderDetail();
      save();
      if (scroll) cells.get(el.z).scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return true;
    }

    // A small card with the basics while the pointer is over an element (compact mode has no room for more).
    grid.addEventListener('mouseover', (e) => {
      const b = e.target.closest('.pt-cell[data-z]');
      if (!b) return;
      const el = byZ.get(Number(b.dataset.z));
      b.title = `${el.n}: ${num(el.m)} u${el.en != null ? `, EN ${el.en}` : ''}`;
    });
    grid.addEventListener('click', (e) => {
      const b = e.target.closest('.pt-cell[data-z]');
      if (b) select(Number(b.dataset.z), { scroll: false });
    });
    // Arrow keys move between elements by their place in the table
    grid.addEventListener('keydown', (e) => {
      const b = e.target.closest('.pt-cell[data-z]');
      if (!b || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault();
      const [row, col] = position(Number(b.dataset.z));
      const dr = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
      const dc = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
      let best = null;
      let bestD = Infinity;
      for (const el of list) {
        const [r2, c2] = position(el.z);
        const ar = r2 - row;
        const ac = c2 - col;
        if ((dr && Math.sign(ar) !== dr) || (dc && Math.sign(ac) !== dc)) continue;
        const d = dr ? Math.abs(ar) * 10 + Math.abs(ac) : Math.abs(ac) * 10 + Math.abs(ar);
        if (d < bestD) {
          bestD = d;
          best = el;
        }
      }
      if (best) {
        cells.get(best.z).focus();
        select(best.z, { scroll: false });
      }
    });
    search.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        if (select(search.value)) search.select();
        else toast(`No element called “${search.value}”`);
      } else if (e.key === 'Escape') {
        if (search.value) search.value = '';
        else api.close();
      }
    });
    search.addEventListener('input', () => {
      const el = find(list, search.value);
      if (el && search.value.trim().length >= 2) select(el.z, { scroll: false });
    });
    modeBtn.addEventListener('click', () => {
      st.mode = st.mode === 'full' ? 'compact' : 'full';
      applyShell();
      renderDetail();
      save();
    });
    cornerBtn.addEventListener('click', () => {
      st.corner = CORNERS[(CORNERS.indexOf(st.corner) + 1) % CORNERS.length];
      applyShell();
      save();
    });
    closeBtn.addEventListener('click', () => api.close());
    panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && e.target !== search) api.close();
    });

    const api = {
      el: panel,
      get state() {
        return { ...st };
      },
      open() {
        st.open = true;
        applyShell();
        renderDetail();
        save();
      },
      close() {
        st.open = false;
        applyShell();
        save();
      },
      toggle() {
        if (st.open) api.close();
        else api.open();
      },
      select,
    };
    applyShell();
    renderDetail();
    return api;
  }

  root.InkPTable = { create, util: { position, fmtHalfLife, keyIsotopes, find, facts, summary } };
  if (typeof module !== 'undefined') module.exports = root.InkPTable;
})(typeof self !== 'undefined' ? self : globalThis);
