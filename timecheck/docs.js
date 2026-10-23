// The guide page: theme, contents highlighting, a tutorial that ticks itself
// off from your real data, and live "try it" boxes backed by lib/planner.js.
(async () => {
  'use strict';

  const P = InkPlan;
  const K = P.K;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  let settings = await P.getSettings();

  function applyTheme() {
    const dark = settings.theme === 'dark' || (settings.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    InkPalettes.apply(document.documentElement, settings.palette || InkPalettes.DEFAULT, dark);
  }
  applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

  for (const n of $$('[data-icon]')) n.insertAdjacentHTML('afterbegin', InkIcons.svg(n.dataset.icon, 18));
  $('#version').textContent = `v${chrome.runtime.getManifest().version}`;

  // ---------- contents: highlight the section in view, collapsible on phones ----------

  const links = new Map($$('#nav a').map((a) => [a.getAttribute('href').slice(1), a]));
  const spy = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        for (const a of links.values()) a.classList.remove('on');
        const a = links.get(e.target.id);
        if (a) a.classList.add('on');
      }
    },
    { rootMargin: '-20% 0px -70% 0px' }
  );
  $$('.d-sec').forEach((s) => spy.observe(s));

  const menu = $('#menuBtn');
  menu.addEventListener('click', () => {
    const open = document.body.classList.toggle('nav-open');
    menu.setAttribute('aria-expanded', String(open));
  });
  $('#nav').addEventListener('click', (e) => {
    if (e.target.closest('a')) {
      document.body.classList.remove('nav-open');
      menu.setAttribute('aria-expanded', 'false');
    }
  });

  // ---------- tutorial: each step checks your real data ----------

  const STEP_CHECKS = {
    open: (d) => !!(d[K.meta] && d[K.meta].plannerOpened),
    blocks: (d, s) => Object.values(s.blocks.schedule || {}).some((l) => l && l.length),
    anchor: (d) => !!(d[K.meta] && d[K.meta].letterConfirmed),
    tasks: (d) => (d[K.tasks] || []).some((t) => !t.someday),
    focus: (d) => (d[K.sessions] || []).length > 0 || !!d[K.focus],
    gate: (d) => Object.values(d[K.journal] || {}).some((day) => day.some((e) => e.kind === 'pass')),
    onitry: (d, s) => s.onitry.enabled && !!s.onitry.code && !!(d[K.onitry] && d[K.onitry].paired),
    eod: (d) => Object.keys(d[K.eod] || {}).length > 0,
    review: (d) => Object.values(d[K.reviews] || {}).some((r) => r.text),
  };

  async function renderTutorial() {
    const d = await chrome.storage.local.get(Object.values(K));
    settings = await P.getSettings();
    const steps = $$('#tutorialSteps > li');
    let done = 0;
    for (const li of steps) {
      const ok = !!(STEP_CHECKS[li.dataset.step] || (() => false))(d, settings);
      li.classList.toggle('done', ok);
      if (ok) done++;
    }
    const next = steps.find((li) => !li.classList.contains('done'));
    steps.forEach((li) => li.classList.toggle('next', li === next));
    $('#tutBar').style.width = `${Math.round((done / steps.length) * 100)}%`;
    $('#tutCount').textContent = done === steps.length ? 'All done. Nice.' : `${done} of ${steps.length} done`;
  }

  // ---------- try-it boxes ----------

  function describeQuick(line) {
    const r = P.parseQuick(line, { courses: settings.courses, blocks: settings.blocks });
    const out = [];
    const pill = (label, value, cls = '') => {
      const p = el('span', `pill ${cls}`);
      p.append(el('small', null, label), el('b', null, value));
      return p;
    };
    out.push(pill('title', r.title || '—'));
    if (r.course) {
      const c = pill('subject', r.course);
      c.style.setProperty('--c', P.courseColor(settings.courses, r.course));
      c.classList.add('course');
      out.push(c);
    }
    out.push(pill('type', r.someday ? 'free-time idea' : r.kind === 'test' ? 'test' : r.kind === 'due' ? 'homework' : 'to-do', r.kind === 'test' ? 'test' : ''));
    if (r.due) {
      const letter = P.blockLetter(r.due, settings.blocks);
      const rel = P.relDay(r.due);
      const extra = [/\d/.test(rel) ? '' : P.fromKey(r.due).toLocaleDateString([], { month: 'short', day: 'numeric' }), letter ? `${letter} day` : ''].filter(Boolean).join(', ');
      out.push(pill('due', extra ? `${rel} (${extra})` : rel));
    } else if (r.plan) out.push(pill('list', 'today'));
    if (r.estimate) out.push(pill('estimate', P.fmtMinutes(r.estimate)));
    return out;
  }

  function wireQuick(inputId, outId) {
    const input = $(inputId);
    const out = $(outId);
    const run = () => {
      out.textContent = '';
      if (input.value.trim()) out.append(...describeQuick(input.value));
    };
    input.addEventListener('input', run);
    run();
  }
  wireQuick('#tryQuick', '#tryQuickOut');
  wireQuick('#tryQuick2', '#tryQuick2Out');

  const letterDate = $('#letterDate');
  letterDate.value = P.dateKey();
  function renderLetter() {
    const out = $('#letterOut');
    out.textContent = '';
    const k = letterDate.value;
    if (!k) return;
    const b = settings.blocks;
    const info = P.dayInfo(k, b);
    const head = el('div', 'letter-line');
    const name = P.fromKey(k).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
    if (!b.enabled) head.textContent = `${name}: block days are off.`;
    else if (b.skip.includes(k)) head.textContent = `${name}: no school (break). The rotation is paused.`;
    else if (info.letter) {
      head.append(`${name}: `);
      head.append(el('b', 'letter', `${info.letter} day`));
    } else head.textContent = `${name}: ${info.school ? 'school, no letter' : 'no school'}.`;
    out.append(head);
    if (info.blocks.length) {
      const list = el('div', 'mini-blocks');
      for (const blk of info.blocks) list.append(el('span', P.isFreeBlock(blk) ? 'free' : '', `${blk.start} ${blk.label}`));
      out.append(list);
    } else if (b.enabled && (info.letter || info.school)) {
      const a = el('a', null, 'Add class blocks for this day →');
      a.href = 'today.html#blocks';
      out.append(a);
    }
  }
  letterDate.addEventListener('input', renderLetter);
  $('#letterOk').addEventListener('click', async () => {
    await P.store.update(K.meta, {}, (m) => ({ ...m, letterConfirmed: Date.now() }));
  });

  async function renderGateNow() {
    const d = await chrome.storage.local.get([K.focus, K.tasks, K.meta]);
    const gs = P.guardState(settings, d[K.focus] || null, d[K.tasks] || [], new Date(), (d[K.meta] || {}).escalatedUntil || 0);
    const WHY = {
      off: 'the gate is set to Off',
      focus: 'a focus block is running',
      onitry: 'Onitry caught you off task during a focus block',
      always: 'the gate is set to Always',
      urgent: `${gs.urgent} thing${gs.urgent === 1 ? ' is' : 's are'} due by tomorrow and it’s work hours`,
      'free block': `${gs.urgent} thing${gs.urgent === 1 ? ' is' : 's are'} due by tomorrow and you’re in a free block`,
      'no focus block': 'it’s set to Focus only and no block is running',
      'outside work hours': 'something’s due, but it’s outside your work hours',
      'nothing urgent': 'nothing is due by tomorrow',
    };
    const out = $('#gateNow');
    out.textContent = '';
    const line = el('div', `gate-line ${gs.active ? 'up' : 'down'}`);
    line.append(el('b', null, gs.active ? '🛡 Up' : 'Down'), ` because ${WHY[gs.reason] || gs.reason}. Mode: ${settings.guardMode}.`);
    out.append(line, el('div', 'gate-sites', `Gated: ${settings.sites.join(', ')}`));
  }

  async function refresh() {
    settings = await P.getSettings();
    applyTheme();
    await renderTutorial();
    renderLetter();
    await renderGateNow();
    $('#tryQuick').dispatchEvent(new Event('input'));
    $('#tryQuick2').dispatchEvent(new Event('input'));
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && Object.keys(changes).some((k) => k.startsWith('pl:'))) refresh();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
  });
  await refresh();
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
})();
