// Onitry Plan's dashboard. Runs in the side panel (today.html?view=panel), in its
// own tab, or as every new tab, depending on the "Where it lives" setting. All persistent logic for focus blocks, the distraction
// gate and nudges lives in the service worker (planner-bg.js); this page renders
// state from chrome.storage and sends it commands.
(() => {
  'use strict';

  const P = InkPlan;
  const K = P.K;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const VIEW = new URLSearchParams(location.search).get('view') === 'panel' ? 'panel' : 'tab';
  document.body.classList.add(`view-${VIEW}`);

  const state = {
    tasks: [],
    focus: null,
    sessions: [],
    journal: {},
    eod: {},
    passes: {},
    settings: P.DEFAULT_SETTINGS,
    onitry: null,
    reviews: {},
    weekOffset: 0,
    tab: 'today',
    editId: null,
  };

  // ---------- small helpers ----------

  const today = () => P.dateKey();
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const icon = (name, size = 16) => {
    const s = el('span', 'ic');
    s.innerHTML = InkIcons.svg(name, size);
    return s;
  };
  const qopts = (day = today()) => ({ courses: state.settings.courses, blocks: state.settings.blocks, today: day });
  const send = (msg) => chrome.runtime.sendMessage(msg).catch((e) => ({ ok: false, error: e.message }));

  let toastTimer = 0;
  function toast(message, { action, onAction, timeout = 3500 } = {}) {
    const t = $('#toast');
    t.textContent = '';
    t.append(el('span', null, message));
    if (action) {
      const b = el('button', null, action);
      b.addEventListener('click', () => {
        t.classList.remove('show');
        onAction();
      });
      t.append(b);
    }
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), timeout);
  }

  function courseChip(name) {
    if (!name) return null;
    const c = el('span', 'course', name);
    c.style.setProperty('--c', P.courseColor(state.settings.courses, name));
    return c;
  }

  function dueLabel(t) {
    if (!t.due) return null;
    const d = P.daysBetween(today(), t.due);
    const lab = el('span', 'due', t.kind === 'test' ? `${P.relDay(t.due)} test` : `due ${P.relDay(t.due).toLowerCase()}`);
    if (t.kind === 'test') lab.classList.add('test');
    if (d < 0 && !t.done) lab.classList.add('late');
    else if (d <= 1) lab.classList.add('soon');
    return lab;
  }

  // ---------- theme ----------

  function applyTheme() {
    const s = state.settings;
    const dark = s.theme === 'dark' || (s.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    InkPalettes.apply(document.documentElement, s.palette || InkPalettes.DEFAULT, dark);
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

  // ---------- load & sync ----------

  async function load() {
    const d = await chrome.storage.local.get(Object.values(K));
    state.tasks = d[K.tasks] || [];
    state.focus = d[K.focus] || null;
    state.sessions = d[K.sessions] || [];
    state.journal = d[K.journal] || {};
    state.eod = d[K.eod] || {};
    state.passes = d[K.passes] || {};
    state.escalatedUntil = (d[K.meta] || {}).escalatedUntil || 0;
    state.settings = await P.getSettings();
    state.reviews = d[K.reviews] || {};
    if (!state.onitry) state.onitry = d[K.onitry] || null;
  }

  let renderQueued = false;
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(async () => {
      renderQueued = false;
      await load();
      render();
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (Object.keys(changes).some((k) => k.startsWith('pl:'))) scheduleRender();
    if (changes[K.focus]) setTimeout(pollOnitry, 300); // Onitry status changes with the block
  });

  function render() {
    applyTheme();
    renderClock();
    renderNow();
    renderToday();
    renderWeek();
    renderSomeday();
    renderJournal();
    renderOnitryChip();
  }

  // ---------- header ----------

  function renderClock() {
    const now = new Date();
    $('#dateLine').textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    $('#timeLine').textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const letter = P.blockLetter(today(), state.settings.blocks);
    const chip = $('#letterChip');
    chip.hidden = !letter;
    chip.textContent = letter ? `${letter} day` : '';
  }

  function renderOnitryChip() {
    const chip = $('#onitryChip');
    const cfg = state.settings.onitry;
    const o = state.onitry;
    chip.className = 'onitry-chip';
    let text = 'Onitry';
    if (!cfg.enabled) {
      text = 'Connect Onitry';
      chip.classList.add('off');
    } else if (!o || !o.reachable) {
      text = 'Onitry not running';
      chip.classList.add('off');
    } else if (!o.paired) {
      text = 'Pair Onitry';
      chip.classList.add('warn');
    } else if (o.running && o.status === 'off_task') {
      text = 'Off task';
      chip.classList.add('bad');
    } else if (o.running && o.status === 'on_task') {
      text = 'On task';
      chip.classList.add('good');
    } else if (o.running) {
      text = o.paused ? 'Onitry paused' : 'Onitry watching';
      chip.classList.add('good');
    } else {
      text = 'Onitry idle';
    }
    chip.textContent = '';
    chip.append(el('span', 'dot'), el('span', null, text));
    chip.title = o && o.activity ? `Onitry: ${o.activity}` : 'Onitry connection (click for settings)';
  }

  // ---------- now card ----------

  function renderNow() {
    const card = $('#nowCard');
    card.textContent = '';
    const f = state.focus;
    card.classList.toggle('running', !!f);
    if (f) {
      const top = el('div', 'now-top');
      top.append(el('span', 'now-label', 'Focusing on'));
      const chip = courseChip(f.course);
      if (chip) top.append(chip);
      const title = el('div', 'now-title', f.title);
      const timer = el('div', 'now-timer');
      timer.id = 'focusTimer';
      const bar = el('div', 'now-bar');
      bar.append(el('span'));
      bar.id = 'focusBar';
      const o = state.onitry;
      const status = el('div', 'now-onitry');
      if (state.settings.onitry.enabled) {
        if (f.onitryPending) {
          status.textContent = 'Connecting to Onitry…';
        } else if (state.escalatedUntil > Date.now()) {
          status.classList.add('bad');
          status.textContent = `Onitry caught you off task${o && o.activity ? ` (${o.activity})` : ''}. Gate locked for ${Math.ceil((state.escalatedUntil - Date.now()) / 60000)} more min.`;
        } else if (f.onitry && o && o.running) {
          status.classList.add(o.status === 'off_task' ? 'bad' : 'good');
          status.textContent = o.status === 'off_task' ? `Onitry: off task — ${o.activity || 'get back to it'}` : `Onitry is watching${o.activity ? ` — ${o.activity}` : ''}`;
        } else if (f.onitryError) {
          status.classList.add('warn');
          status.textContent = `Onitry: ${f.onitryError}`;
        }
      }
      const actions = el('div', 'now-actions');
      const done = el('button', 'btn primary', 'Done');
      done.prepend(icon('check'));
      done.addEventListener('click', () => send({ type: 'plan:focus', action: 'stop', outcome: 'done' }));
      const more = el('button', 'btn', '+10 min');
      more.addEventListener('click', () => send({ type: 'plan:focus', action: 'extend', minutes: 10 }));
      const stop = el('button', 'btn ghost', 'Stop');
      stop.addEventListener('click', () => send({ type: 'plan:focus', action: 'stop', outcome: 'stopped' }));
      actions.append(done, more, stop);
      card.append(top, title, timer, bar, status, actions);
      tickTimer();
      return;
    }

    const open = P.todayTasks(state.tasks, today()).filter((t) => !t.done);
    const next = open[0];
    const ask = el('div', 'now-ask', 'What are you doing right now?');
    const row = el('div', 'now-start');
    const input = el('input', 'now-input');
    input.placeholder = next ? next.title : 'e.g. Physics FRQs';
    input.spellcheck = false;
    const mins = el('select', 'select now-mins');
    for (const m of [15, 25, 40, 60, 90]) {
      const o = el('option', null, `${m} min`);
      o.value = m;
      mins.append(o);
    }
    mins.value = String(next && next.estimate && [15, 25, 40, 60, 90].includes(next.estimate) ? next.estimate : state.settings.focusMinutes);
    if (![...mins.options].some((o) => o.selected)) mins.value = '40';
    const go = el('button', 'btn primary', 'Start focus');
    go.prepend(icon('sparkle'));
    const start = () => {
      const typed = input.value.trim();
      if (typed) {
        const parsed = P.parseQuick(typed, qopts());
        startFocus({ title: parsed.title, course: parsed.course }, Number(mins.value), true);
      } else if (next) startFocus(next, Number(mins.value));
      else input.focus();
    };
    go.addEventListener('click', start);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') start();
    });
    row.append(input, mins, go);
    card.append(ask, row);

    const g = P.guardState(state.settings, null, state.tasks);
    const hint = el('div', 'now-hint');
    if (g.active && g.urgent) hint.textContent = `🛡 Distraction gate is up — ${g.urgent} thing${g.urgent === 1 ? '' : 's'} due by tomorrow${g.reason === 'free block' ? ' and you’re in a free block' : ''}.`;
    else if (g.active) hint.textContent = '🛡 Distraction gate is up.';
    else if (!open.length) hint.textContent = 'Nothing on today’s list. Add something above, or pick from “nothing to do”.';
    else hint.textContent = `Next up: ${next.title}${next.estimate ? ` (${P.fmtMinutes(next.estimate)})` : ''}`;
    card.append(hint);
  }

  function tickTimer() {
    const f = state.focus;
    const t = $('#focusTimer');
    if (!f || !t) return;
    const left = f.endsAt - Date.now();
    const over = left < 0;
    const s = Math.abs(Math.round(left / 1000));
    const mm = Math.floor(s / 60);
    const ss = String(s % 60).padStart(2, '0');
    t.textContent = `${over ? '+' : ''}${mm}:${ss}`;
    t.classList.toggle('over', over);
    const total = f.endsAt - f.startedAt;
    const pct = Math.min(100, ((Date.now() - f.startedAt) / total) * 100);
    const bar = $('#focusBar span');
    if (bar) {
      bar.style.width = `${pct}%`;
      bar.parentElement.classList.toggle('over', over);
    }
    document.title = `${over ? '+' : ''}${mm}:${ss} · ${f.title}`;
  }

  async function startFocus(task, minutes, adHoc = false) {
    let taskId = task.id || null;
    if (adHoc && !taskId) {
      // Typed something new: put it on today's list so it's tracked.
      const t = P.makeTask({ title: task.title, course: task.course, plan: today(), estimate: minutes });
      await P.addTasks([t]);
      taskId = t.id;
    }
    await send({ type: 'plan:focus', action: 'start', taskId, title: task.title, course: task.course || null, minutes });
  }

  // ---------- quick add ----------

  const quick = $('#quickAdd');
  function previewQuick() {
    const lines = quick.value.split('\n').map((l) => l.trim()).filter(Boolean);
    const box = $('#quickPreview');
    box.textContent = '';
    quick.style.height = 'auto';
    quick.style.height = `${Math.min(quick.scrollHeight, 200)}px`;
    if (!lines.length) return;
    if (lines.length > 1) {
      box.append(el('span', 'pv', `Enter adds ${lines.length} tasks`));
      return;
    }
    const r = P.parseQuick(lines[0], qopts());
    const c = courseChip(r.course);
    if (c) box.append(c);
    if (r.someday) box.append(el('span', 'pv', '“nothing to do” list'));
    else if (r.due) box.append(el('span', `pv ${r.kind === 'test' ? 'test' : ''}`, `${r.kind === 'test' ? 'test' : 'due'} ${P.relDay(r.due)}`));
    else box.append(el('span', 'pv', 'today'));
    if (r.estimate) box.append(el('span', 'pv', P.fmtMinutes(r.estimate)));
  }
  quick.addEventListener('input', previewQuick);
  quick.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    const lines = quick.value.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;
    const base = Date.now();
    const tasks = lines.map((line, i) => P.makeTask({ ...P.parseQuick(line, qopts()), order: base + i }));
    await P.addTasks(tasks);
    quick.value = '';
    previewQuick();
    toast(tasks.length === 1 ? `Added “${tasks[0].title}”` : `Added ${tasks.length} tasks`, {
      action: 'Undo',
      onAction: async () => {
        const ids = new Set(tasks.map((t) => t.id));
        await P.store.update(K.tasks, [], (all) => all.filter((t) => !ids.has(t.id)));
      },
    });
  });

  // ---------- today ----------

  function taskRow(t, { slot, draggable = false, someday = false } = {}) {
    const li = el('li', 'task');
    li.dataset.id = t.id;
    if (t.done) li.classList.add('done');
    if (state.focus && state.focus.taskId === t.id) li.classList.add('active');
    if (t.due && t.due < today() && !t.done) li.classList.add('late');
    if (draggable) {
      li.draggable = true;
      li.append(el('span', 'grip', '⋮⋮'));
    }
    const box = el('input');
    box.type = 'checkbox';
    box.checked = !!t.done;
    box.title = t.done ? 'Mark not done' : 'Mark done';
    box.addEventListener('change', () => toggleDone(t, box.checked));
    li.append(box);

    const body = el('div', 'task-body');
    const title = el('span', 'task-title', t.title);
    title.addEventListener('click', () => openEdit(t.id));
    body.append(title);
    const meta = el('div', 'task-meta');
    const chip = courseChip(t.course);
    if (chip) meta.append(chip);
    const due = dueLabel(t);
    if (due) meta.append(due);
    if (t.estimate) meta.append(el('span', 'est', P.fmtMinutes(t.estimate)));
    if (slot && !t.done) meta.append(el('span', 'slot', `${P.hhmm(slot.start)}–${P.hhmm(slot.end)}`));
    if (meta.childNodes.length) body.append(meta);
    li.append(body);

    if (!t.done) {
      if (someday) {
        const toToday = el('button', 'icon-btn small', null);
        toToday.title = 'Put on today’s list';
        toToday.innerHTML = InkIcons.svg('plus', 16);
        toToday.addEventListener('click', () => P.updateTask(t.id, { plan: today() }).then(() => toast(`“${t.title}” is on today’s list`)));
        li.append(toToday);
      }
      const play = el('button', 'icon-btn small play', null);
      play.title = 'Start a focus block on this';
      play.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
      play.addEventListener('click', () => startFocus(t, t.estimate || state.settings.focusMinutes));
      li.append(play);
    }
    return li;
  }

  async function toggleDone(t, done) {
    if (done && state.focus && state.focus.taskId === t.id) {
      await send({ type: 'plan:focus', action: 'stop', outcome: 'done' });
      return;
    }
    await P.updateTask(t.id, { done: done ? Date.now() : null });
    if (done) {
      await P.log(`✓ ${t.title}`, 'done');
      toast(`Done: ${t.title}`, { action: 'Undo', onAction: () => P.updateTask(t.id, { done: null }) });
    }
  }

  function renderToday() {
    const list = P.todayTasks(state.tasks, today());
    const open = list.filter((t) => !t.done);
    const done = list.filter((t) => t.done);
    const ol = $('#todayList');
    ol.textContent = '';

    // Lay the evening out end to end from now (or from when the focus block ends).
    const now = new Date();
    let startMin = now.getHours() * 60 + now.getMinutes();
    if (state.focus) startMin = Math.max(startMin, Math.round((state.focus.endsAt - new Date().setHours(0, 0, 0, 0)) / 60000));
    // Homework time starts after the last class (free blocks count as class here).
    const info = P.dayInfo(today(), state.settings.blocks);
    if (info.blocks.length) startMin = Math.max(startMin, P.minutesOfDay(info.blocks[info.blocks.length - 1].end));
    renderBlocks(info, now);
    const queue = open.filter((t) => !(state.focus && state.focus.taskId === t.id));
    const slots = new Map(P.schedule(queue, startMin, 30).map((s) => [s.task.id, s]));
    for (const t of open) ol.append(taskRow(t, { slot: slots.get(t.id), draggable: true }));
    if (!open.length) ol.append(el('li', 'empty', done.length ? 'All done for today. 🎉 Pick something from “nothing to do”, or rest.' : 'Nothing planned yet. Type above — one task per line works too.'));

    const total = queue.reduce((sum, t) => sum + (t.estimate || 30), 0);
    const foot = $('#todayFoot');
    foot.textContent = '';
    if (queue.length) {
      const endMin = startMin + total;
      const workEnd = P.minutesOfDay(now.getDay() % 6 === 0 ? state.settings.weekendEnd : state.settings.workEnd);
      const line = el('span', null, `${P.fmtMinutes(total)} planned · done by ~${P.hhmm(endMin)}`);
      foot.append(line);
      if (endMin > workEnd) {
        foot.classList.add('warn');
        foot.append(el('span', 'over', ' — past your cutoff. Cut or move something.'));
      } else foot.classList.remove('warn');
    }

    $('#todayMeta').textContent = list.length ? `${done.length}/${list.length} done` : '';
    const doneBox = $('#doneToday');
    doneBox.hidden = !done.length;
    doneBox.querySelector('summary').textContent = `Done today (${done.length})`;
    const dl = $('#doneList');
    dl.textContent = '';
    for (const t of done) dl.append(taskRow(t));

    // Heads-up: tests in the next 3 days and anything overdue.
    const hu = $('#headsUp');
    hu.textContent = '';
    const soonTests = state.tasks.filter((t) => !t.done && t.kind === 'test' && t.due && P.daysBetween(today(), t.due) >= 0 && P.daysBetween(today(), t.due) <= 3);
    const late = P.overdue(state.tasks, today());
    for (const t of soonTests) {
      const d = el('div', 'hu test');
      d.append(el('b', null, `${P.relDay(t.due)}:`), ` ${t.title}`);
      hu.append(d);
    }
    if (late.length) {
      const d = el('div', 'hu late');
      d.append(el('b', null, `${late.length} overdue`), ` — ${late.map((t) => t.title).slice(0, 3).join(', ')}`);
      hu.append(d);
    }
  }

  function renderBlocks(info, now) {
    const strip = $('#blockStrip');
    strip.textContent = '';
    const b = state.settings.blocks;
    if (!b.enabled) return;
    if (!info.blocks.length) {
      const hasAny = Object.values(b.schedule || {}).some((l) => l && l.length);
      const onBreak = b.skip.includes(today());
      if (onBreak || !hasAny) {
        const setup = el('button', 'blk-setup', onBreak ? '🏖 No school today. The rotation is paused.' : '+ Add your class blocks');
        setup.type = 'button';
        strip.append(setup);
      }
      return;
    }
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const { current } = P.blockAt(info.blocks, nowMin);
    for (const b of info.blocks) {
      const past = P.minutesOfDay(b.end) <= nowMin;
      const cls = ['blk'];
      if (b === current) cls.push('now');
      if (past) cls.push('past');
      if (P.isFreeBlock(b)) cls.push('free');
      const item = el('div', cls.join(' '));
      const course = state.settings.courses.find((c) => c.name.toLowerCase() === b.label.toLowerCase() || (c.aliases || []).includes(b.label.toLowerCase()));
      if (course) item.style.setProperty('--c', course.color);
      item.append(el('span', 'blk-time', P.hhmm(P.minutesOfDay(b.start))), el('span', 'blk-label', b.label));
      item.title = `${b.start}–${b.end} ${b.label}`;
      strip.append(item);
    }
  }

  // Drag to reorder today's list.
  let dragId = null;
  $('#todayList').addEventListener('dragstart', (e) => {
    const li = e.target.closest('li.task');
    if (!li) return;
    dragId = li.dataset.id;
    li.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  $('#todayList').addEventListener('dragend', (e) => {
    e.target.closest('li.task')?.classList.remove('dragging');
  });
  $('#todayList').addEventListener('dragover', (e) => {
    if (!dragId) return;
    e.preventDefault();
    const over = e.target.closest('li.task');
    const dragging = $('#todayList li.dragging');
    if (!over || !dragging || over === dragging) return;
    const r = over.getBoundingClientRect();
    over.parentNode.insertBefore(dragging, e.clientY < r.top + r.height / 2 ? over : over.nextSibling);
  });
  $('#todayList').addEventListener('drop', async (e) => {
    e.preventDefault();
    const ids = $$('#todayList li.task').map((li) => li.dataset.id);
    dragId = null;
    const base = Date.now();
    await P.store.update(K.tasks, [], (all) => all.map((t) => (ids.includes(t.id) ? { ...t, order: base + ids.indexOf(t.id) } : t)));
  });

  // ---------- week ----------

  function renderWeek() {
    // A rolling 7 days from today, so "tomorrow" is always visible (even on a Sunday).
    const start = P.addDays(today(), state.weekOffset * 7);
    const grid = $('#weekGrid');
    grid.textContent = '';
    $('#weekTitle').textContent = state.weekOffset === 0 ? 'Next 7 days' : `From ${P.fromKey(start).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}`;
    for (let i = 0; i < 7; i++) {
      const k = P.addDays(start, i);
      const col = el('div', 'wk-day');
      if (k === today()) col.classList.add('is-today');
      if (k < today()) col.classList.add('past');
      const d = P.fromKey(k);
      const head = el('button', 'wk-head');
      head.title = 'Add something due this day';
      head.append(el('span', 'wk-name', d.toLocaleDateString([], { weekday: 'short' })), el('span', 'wk-num', String(d.getDate())));
      const letter = P.blockLetter(k, state.settings.blocks);
      if (letter) head.append(el('span', 'wk-letter', letter));
      head.addEventListener('click', () => {
        const tag = P.daysBetween(today(), k) === 0 ? 'today' : P.daysBetween(today(), k) === 1 ? 'tmrw' : `${d.getMonth() + 1}/${d.getDate()}`; // dates beat "next B": unambiguous
        quick.value = ` ${tag}`;
        quick.focus();
        quick.setSelectionRange(0, 0);
        previewQuick();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      col.append(head);
      const items = state.tasks.filter((t) => t.due === k).sort((a, b) => (b.kind === 'test') - (a.kind === 'test'));
      for (const t of items) {
        const it = el('button', `wk-item${t.kind === 'test' ? ' test' : ''}${t.done ? ' done' : ''}`);
        // Columns are narrow: lead with the subject, drop it from the title if repeated.
        if (t.course) {
          const c = state.settings.courses.find((x) => x.name === t.course);
          const words = [t.course, ...((c && c.aliases) || [])].map((w) => w.toLowerCase());
          const first = t.title.split(/\s+/)[0].toLowerCase();
          const rest = words.includes(first) ? t.title.split(/\s+/).slice(1).join(' ') : t.title;
          it.append(el('b', null, t.course), ` ${rest}`);
        } else it.textContent = t.title;
        it.style.setProperty('--c', P.courseColor(state.settings.courses, t.course));
        it.title = `${t.title}${t.course ? ` · ${t.course}` : ''} — click to edit`;
        it.addEventListener('click', () => openEdit(t.id));
        col.append(it);
      }
      grid.append(col);
    }

    const up = $('#upList');
    up.textContent = '';
    const items = P.upcoming(state.tasks, today(), 21);
    for (const t of items.slice(0, 12)) {
      const li = el('li', `up${t.kind === 'test' ? ' test' : ''}`);
      li.append(el('span', 'up-when', P.relDay(t.due)));
      const chip = courseChip(t.course);
      if (chip) li.append(chip);
      const title = el('span', 'up-title', t.title);
      title.addEventListener('click', () => openEdit(t.id));
      li.append(title);
      up.append(li);
    }
    if (!items.length) up.append(el('li', 'empty', 'Nothing due in the next 3 weeks. Add tests and deadlines like “chem summative 10/16”.'));
  }

  $('#weekPrev').addEventListener('click', () => {
    state.weekOffset--;
    renderWeek();
  });
  $('#weekNext').addEventListener('click', () => {
    state.weekOffset++;
    renderWeek();
  });
  $('#weekNow').addEventListener('click', () => {
    state.weekOffset = 0;
    renderWeek();
  });

  // ---------- someday ----------

  function renderSomeday() {
    const ol = $('#somedayList');
    ol.textContent = '';
    const items = state.tasks.filter((t) => t.someday && !t.done).sort((a, b) => a.order - b.order);
    for (const t of items) ol.append(taskRow(t, { someday: true }));
    if (!items.length) ol.append(el('li', 'empty', 'Add projects you want to chip away at in free time.'));
  }

  $('#somedayAdd').addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    const v = e.target.value.trim();
    if (!v) return;
    const r = P.parseQuick(v, qopts());
    await P.addTasks([P.makeTask({ ...r, someday: true, plan: null, due: null, kind: 'todo' })]);
    e.target.value = '';
  });

  // ---------- journal ----------

  const KIND_ICON = { log: '✎', focus: '▶', done: '✓', pass: '🔓', eod: '🌙', nudge: '🔔', system: '·' };

  function dayStats(k) {
    const start = P.fromKey(k).getTime();
    const end = start + P.DAY;
    const sessions = state.sessions.filter((s) => s.end >= start && s.end < end);
    const focusMin = sessions.reduce((sum, s) => sum + s.minutes, 0);
    const withOnitry = sessions.filter((s) => s.onitry && s.onitry.onPct != null);
    const onPct = withOnitry.length ? Math.round(withOnitry.reduce((sum, s) => sum + s.onitry.onPct * s.minutes, 0) / Math.max(1, withOnitry.reduce((sum, s) => sum + s.minutes, 0))) : null;
    const doneCount = state.tasks.filter((t) => t.done && t.done >= start && t.done < end).length;
    const passes = (state.journal[k] || []).filter((e) => e.kind === 'pass').length;
    return { focusMin, onPct, doneCount, passes, sessions: sessions.length };
  }

  function renderJournal() {
    const k = today();
    const st = dayStats(k);
    const stats = $('#stats');
    stats.textContent = '';
    const stat = (n, label, cls = '') => {
      const s = el('div', `stat ${cls}`);
      s.append(el('b', null, n), el('span', null, label));
      return s;
    };
    stats.append(stat(P.fmtMinutes(st.focusMin), 'focused'), stat(String(st.doneCount), 'done'));
    if (st.onPct != null) stats.append(stat(`${st.onPct}%`, 'on task (Onitry)', st.onPct < 70 ? 'warn' : 'good'));
    stats.append(stat(String(st.passes), st.passes === 1 ? 'gate pass' : 'gate passes', st.passes > 2 ? 'warn' : ''));

    // Streak = consecutive days with an EOD check-in.
    let streak = 0;
    for (let d = state.eod[k] ? k : P.addDays(k, -1); state.eod[d]; d = P.addDays(d, -1)) streak++;
    $('#streak').textContent = streak ? `🌙 ${streak}-day check-in streak` : '';

    renderEod();
    renderReview();

    const list = $('#journalList');
    list.textContent = '';
    const entries = (state.journal[k] || []).slice().reverse();
    for (const e of entries) list.append(entryRow(e));
    if (!entries.length) list.append(el('li', 'empty', 'Nothing logged today. Write what’s going on — it helps you notice patterns.'));

    const hist = $('#history');
    hist.textContent = '';
    for (let i = 1; i <= 7; i++) {
      const day = P.addDays(k, -i);
      const es = state.journal[day] || [];
      const eod = state.eod[day];
      if (!es.length && !eod) continue;
      const s = dayStats(day);
      const det = el('details', 'hist-day');
      const sum = el('summary');
      sum.append(el('b', null, P.relDay(day, k)), el('span', 'hist-meta', ` ${P.fmtMinutes(s.focusMin)} focused · ${s.doneCount} done${eod ? ` · ${'★'.repeat(eod.rating || 0)}` : ''}`));
      det.append(sum);
      const ol = el('ol', 'journal-list');
      for (const e of es.slice().reverse()) ol.append(entryRow(e));
      det.append(ol);
      hist.append(det);
    }
  }

  // ---------- weekly review ----------

  const reviewWeekStart = () => P.weekStart(P.addDays(today(), -1)); // Sunday reviews the week ending today
  let reviewBusy = false;

  function renderReview() {
    const box = $('#reviewCard');
    const week = reviewWeekStart();
    const saved = state.reviews[week];
    const st = P.weekStats({ tasks: state.tasks, sessions: state.sessions, journal: state.journal, eod: state.eod, settings: state.settings }, week);
    const wasOpen = box.querySelector('details') ? box.querySelector('details').open : location.hash.includes('review') || new Date().getDay() === Number(state.settings.weeklyReviewDay);
    box.textContent = '';
    const det = el('details', 'rv');
    det.open = wasOpen;
    const sum = el('summary');
    const label = P.fromKey(week).toLocaleDateString([], { month: 'short', day: 'numeric' });
    sum.append(el('b', null, 'Weekly review'), el('span', 'hist-meta', ` week of ${label}`));
    det.append(sum);

    const t = st.totals;
    const grid = el('div', 'rv-stats');
    const cell = (n, lab) => {
      const c = el('div', 'rv-stat');
      c.append(el('b', null, n), el('span', null, lab));
      return c;
    };
    grid.append(cell(String(t.tasksDone), 'done'), cell(P.fmtMinutes(t.focusMinutes), `in ${t.focusBlocks} block${t.focusBlocks === 1 ? '' : 's'}`));
    if (t.onitryOnTaskPct != null) grid.append(cell(`${t.onitryOnTaskPct}%`, 'on task'));
    grid.append(cell(String(t.gatePasses), 'gate passes'));
    if (t.avgRating != null) grid.append(cell(MOODS[Math.round(t.avgRating) - 1] || '·', `avg of ${t.checkIns} check-in${t.checkIns === 1 ? '' : 's'}`));
    det.append(grid);

    const subj = Object.entries(st.bySubject).sort((a, b) => b[1].done - a[1].done);
    if (subj.length) {
      const row = el('div', 'rv-subjects');
      for (const [name, v] of subj) {
        const c = courseChip(name) || el('span', 'course', name);
        c.textContent = `${name} ${v.done}${v.missed ? ` · ${v.missed} missed` : ''}`;
        row.append(c);
      }
      det.append(row);
    }
    const sites = Object.entries(st.passSites).sort((a, b) => b[1] - a[1]);
    if (sites.length) det.append(el('div', 'rv-line', `Unlocked most: ${sites.slice(0, 3).map(([site, n]) => `${site} ×${n}`).join(', ')}`));
    if (st.missed.length) det.append(el('div', 'rv-line warn', `Missed: ${st.missed.slice(0, 4).map((x) => x.title).join(', ')}`));

    if (saved && saved.text) {
      const out = el('div', 'rv-text');
      renderMarkdown(out, saved.text);
      det.append(out, el('div', 'rv-meta', `Written by Onitry ${P.relDay(P.dateKey(new Date(saved.at))).toLowerCase()} at ${P.fmtTime(saved.at)}`));
    } else if (saved && saved.error) det.append(el('div', 'rv-line warn', saved.error));

    const btn = el('button', 'btn primary', reviewBusy ? 'Onitry is writing…' : saved && saved.text ? 'Rewrite review' : 'Write my review with Onitry');
    btn.prepend(icon('sparkle'));
    btn.disabled = reviewBusy;
    btn.addEventListener('click', async () => {
      reviewBusy = true;
      renderReview();
      const res = await send({ type: 'plan:review', week });
      reviewBusy = false;
      if (res && !res.ok) toast(res.error || 'Review failed');
      await load();
      renderReview();
    });
    const actions = el('div', 'rv-actions');
    actions.append(btn);
    det.append(actions);
    box.append(det);
  }

  // Tiny Markdown → DOM (headings, bullets, **bold**). Text nodes only, no innerHTML.
  function renderMarkdown(root, md) {
    let list = null;
    const inline = (parent, text) => {
      text.split(/(\*\*[^*]+\*\*)/g).forEach((part) => {
        if (/^\*\*[^*]+\*\*$/.test(part)) parent.append(el('b', null, part.slice(2, -2)));
        else if (part) parent.append(document.createTextNode(part));
      });
    };
    for (const raw of md.split('\n')) {
      const line = raw.trim();
      if (!line) {
        list = null;
        continue;
      }
      const bullet = line.match(/^[-*•]\s+(.*)$/) || line.match(/^\d+[.)]\s+(.*)$/);
      if (bullet) {
        if (!list) root.append((list = el('ul')));
        const li = el('li');
        inline(li, bullet[1]);
        list.append(li);
        continue;
      }
      list = null;
      const head = line.match(/^#{1,4}\s+(.*)$/);
      const n = el(head ? 'h4' : 'p');
      inline(n, head ? head[1] : line);
      root.append(n);
    }
  }

  function entryRow(e) {
    const li = el('li', `entry ${e.kind}`);
    li.append(el('span', 'e-time', P.fmtTime(e.t)), el('span', 'e-kind', KIND_ICON[e.kind] || '·'), el('span', 'e-text', e.text));
    return li;
  }

  $('#logInput').addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    const v = e.target.value.trim();
    if (!v) return;
    await P.log(v, 'log');
    e.target.value = '';
  });

  const DERAILS = ['YouTube', 'Phone', 'Tired', 'Sick', 'Too much at once', 'Didn’t know what to do', 'Friends', 'Gaming'];
  const MOODS = ['😫', '😕', '😐', '🙂', '🔥'];

  function renderEod() {
    const box = $('#eodCard');
    box.textContent = '';
    const k = today();
    const done = state.eod[k];
    const hour = new Date().getHours();
    const eodMin = P.minutesOfDay(state.settings.eodTime);
    const nowMin = hour * 60 + new Date().getMinutes();
    if (done) {
      box.className = 'eod saved';
      box.append(el('div', 'eod-title', `🌙 Checked in · ${MOODS[(done.rating || 3) - 1]}`));
      if (done.tomorrow) box.append(el('div', 'eod-line', `Tomorrow starts with: ${done.tomorrow}`));
      return;
    }
    if (nowMin < eodMin - 120 && !location.hash.includes('eod')) {
      box.className = 'eod hidden';
      return;
    }
    box.className = 'eod';
    box.append(el('div', 'eod-title', 'End-of-day check-in'));
    const s = dayStats(k);
    box.append(el('div', 'eod-line', `Today: ${P.fmtMinutes(s.focusMin)} focused, ${s.doneCount} done${s.passes ? `, ${s.passes} gate pass${s.passes === 1 ? '' : 'es'}` : ''}.`));

    let rating = 0;
    const moods = el('div', 'moods');
    MOODS.forEach((m, i) => {
      const b = el('button', 'mood', m);
      b.type = 'button';
      b.title = ['Rough', 'Meh', 'OK', 'Good', 'Great'][i];
      b.addEventListener('click', () => {
        rating = i + 1;
        $$('.mood', moods).forEach((x, j) => x.classList.toggle('on', j === i));
      });
      moods.append(b);
    });
    box.append(el('div', 'eod-q', 'How did today go?'), moods);

    const chosen = new Set();
    const chips = el('div', 'derails');
    for (const d of DERAILS) {
      const b = el('button', 'chip', d);
      b.type = 'button';
      b.addEventListener('click', () => {
        if (chosen.has(d)) chosen.delete(d);
        else chosen.add(d);
        b.classList.toggle('primary', chosen.has(d));
      });
      chips.append(b);
    }
    box.append(el('div', 'eod-q', 'What got in the way?'), chips);

    const tomorrow = el('input', 'eod-input');
    tomorrow.placeholder = 'Tomorrow I’ll start with… (becomes a task)';
    const note = el('textarea', 'eod-input');
    note.rows = 2;
    note.placeholder = 'Anything else? (optional)';
    const save = el('button', 'btn primary', 'Save check-in');
    save.addEventListener('click', async () => {
      const entry = { rating: rating || 3, derails: [...chosen], tomorrow: tomorrow.value.trim(), note: note.value.trim(), at: Date.now() };
      await P.store.update(K.eod, {}, (all) => ({ ...all, [k]: entry }));
      const parts = [`${MOODS[entry.rating - 1]} EOD`];
      if (entry.derails.length) parts.push(`derailed by ${entry.derails.join(', ').toLowerCase()}`);
      if (entry.note) parts.push(entry.note);
      await P.log(parts.join(' — '), 'eod');
      if (entry.tomorrow) {
        const r = P.parseQuick(entry.tomorrow, qopts(P.addDays(k, 1)));
        await P.addTasks([P.makeTask({ ...r, order: 0 })]);
      }
      toast('Checked in. Sleep well 🌙');
    });
    box.append(el('div', 'eod-q', 'First thing tomorrow'), tomorrow, note, save);
  }

  // ---------- task editing ----------

  function openEdit(id) {
    const t = state.tasks.find((x) => x.id === id);
    if (!t) return;
    state.editId = id;
    const f = $('#taskForm');
    f.title.value = t.title;
    const sel = f.course;
    sel.textContent = '';
    sel.append(new Option('—', ''));
    for (const c of state.settings.courses) sel.append(new Option(c.name, c.name));
    if (t.course && !state.settings.courses.some((c) => c.name === t.course)) sel.append(new Option(t.course, t.course));
    sel.value = t.course || '';
    f.kind.value = t.kind;
    f.due.value = t.due || '';
    f.estimate.value = t.estimate || '';
    f.today.checked = !!t.plan && t.plan <= today();
    f.someday.checked = !!t.someday;
    $('#taskDialog').showModal();
  }

  $('#taskDialog').addEventListener('close', async () => {
    const action = $('#taskDialog').returnValue;
    const id = state.editId;
    state.editId = null;
    if (!id) return;
    if (action === 'delete') {
      const t = state.tasks.find((x) => x.id === id);
      await P.removeTask(id);
      toast('Deleted', { action: 'Undo', onAction: () => P.addTasks([t]) });
      return;
    }
    if (action !== 'save') return;
    const f = $('#taskForm');
    await P.updateTask(id, {
      title: f.title.value.trim() || 'Untitled',
      course: f.course.value || null,
      kind: f.kind.value,
      due: f.due.value || null,
      estimate: Number(f.estimate.value) || null,
      plan: f.today.checked ? today() : null,
      someday: f.someday.checked,
    });
  });

  // ---------- class blocks editor ----------

  const WD_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const blocksDraft = { schedule: {}, skip: [], key: null, letters: [] };
  const toMin = (t) => (t ? P.minutesOfDay(t) : null);
  const toHHMM = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

  // Letters come from the open settings form if it's showing (it may have unsaved edits).
  function editorLetters() {
    return $('#settingsDialog').open ? parseLetters($('#settingsForm').blocksLetters.value) : state.settings.blocks.letters;
  }

  function dayKeys() {
    return [...blocksDraft.letters, 'Other'];
  }

  function keyLabel(k) {
    if (k !== 'Other') return `${k} day`;
    const b = state.settings.blocks;
    const plain = b.schoolDays.filter((d) => !b.days.includes(d)).map((d) => WD_SHORT[d]);
    return plain.length ? `No letter (${plain.join(', ')})` : 'No letter';
  }

  function openBlocksEditor(key) {
    const b = state.settings.blocks;
    blocksDraft.schedule = JSON.parse(JSON.stringify(b.schedule || {}));
    blocksDraft.skip = [...(b.skip || [])];
    blocksDraft.letters = editorLetters();
    const todayLetter = P.blockLetter(today(), b);
    blocksDraft.key = key || todayLetter || dayKeys().find((k) => (blocksDraft.schedule[k] || []).length) || blocksDraft.letters[0];
    const from = $('#bdFrom');
    from.value = today();
    $('#bdTo').value = P.addDays(today(), (5 - P.fromKey(today()).getDay() + 7) % 7); // through Friday
    $('#bdLabels').textContent = '';
    for (const name of [...state.settings.courses.map((c) => c.name), 'Free', 'Study', 'Lunch', 'Advisory', 'Break']) $('#bdLabels').append(new Option(name));
    $('#bdText').value = P.formatSchedule(blocksDraft.schedule, blocksDraft.letters);
    $('#bdWarn').textContent = '';
    renderBlocksEditor();
    $('#blocksDialog').showModal();
  }

  function renderBlocksEditor() {
    const tabs = $('#bdTabs');
    tabs.textContent = '';
    for (const k of dayKeys()) {
      const n = (blocksDraft.schedule[k] || []).length;
      const t = el('button', `bd-tab${k === blocksDraft.key ? ' on' : ''}`);
      t.type = 'button';
      t.setAttribute('role', 'tab');
      t.setAttribute('aria-selected', String(k === blocksDraft.key));
      t.dataset.key = k;
      t.append(el('span', null, k === 'Other' ? 'No letter' : k), el('small', null, n ? `${n}` : '–'));
      t.title = keyLabel(k);
      t.addEventListener('click', () => {
        blocksDraft.key = k;
        renderBlocksEditor();
      });
      tabs.append(t);
    }

    const copy = $('#bdCopy');
    copy.textContent = '';
    copy.append(new Option('—', ''));
    for (const k of dayKeys()) if (k !== blocksDraft.key && (blocksDraft.schedule[k] || []).length) copy.append(new Option(keyLabel(k), k));
    copy.disabled = copy.options.length < 2;

    const rows = $('#bdRows');
    rows.textContent = '';
    const list = blocksDraft.schedule[blocksDraft.key] || [];
    list.forEach((blk, i) => rows.append(blockRow(blk, i)));
    $('#bdEmpty').hidden = list.length > 0;
    $('#bdEmpty').textContent = `No blocks yet for ${keyLabel(blocksDraft.key)}.`;
    renderBreaks();
    validateBlocks(false);
  }

  function blockRow(blk, i) {
    const li = el('li', 'bd-row');
    const start = el('input', 'bd-start');
    start.type = 'time';
    start.value = blk.start || '';
    start.setAttribute('aria-label', 'Starts');
    const end = el('input', 'bd-end');
    end.type = 'time';
    end.value = blk.end || '';
    end.setAttribute('aria-label', 'Ends');
    const label = el('input', 'bd-label');
    label.value = blk.label || '';
    label.placeholder = 'Class';
    label.setAttribute('list', 'bdLabels');
    label.setAttribute('aria-label', 'Class');
    label.maxLength = 60;
    styleBlockRow(li, blk);
    const del = el('button', 'icon-btn small danger');
    del.type = 'button';
    del.title = 'Remove block';
    del.innerHTML = InkIcons.svg('x', 15);
    del.addEventListener('click', () => {
      blocksDraft.schedule[blocksDraft.key].splice(i, 1);
      renderBlocksEditor();
    });
    const sync = () => {
      Object.assign(blocksDraft.schedule[blocksDraft.key][i], { start: start.value, end: end.value, label: label.value.trim() });
      validateBlocks(false);
    };
    for (const inp of [start, end, label]) inp.addEventListener('input', sync);
    // Update in place: re-rendering here would swap out a tab mid-click.
    label.addEventListener('input', () => {
      styleBlockRow(li, blocksDraft.schedule[blocksDraft.key][i]);
      updateTabCounts();
    });
    li.append(start, end, label, del);
    return li;
  }

  function styleBlockRow(li, blk) {
    const course = state.settings.courses.find((c) => c.name.toLowerCase() === String(blk.label || '').toLowerCase() || (c.aliases || []).includes(String(blk.label || '').toLowerCase()));
    if (course) li.style.setProperty('--c', course.color);
    else li.style.removeProperty('--c');
    li.classList.toggle('free', P.isFreeBlock(blk));
  }

  function updateTabCounts() {
    for (const t of $$('#bdTabs .bd-tab')) {
      const n = (blocksDraft.schedule[t.dataset.key] || []).filter((b) => b.label || b.start || b.end).length;
      t.querySelector('small').textContent = n ? `${n}` : '–';
    }
  }

  $('#bdAdd').addEventListener('click', () => {
    const list = (blocksDraft.schedule[blocksDraft.key] = blocksDraft.schedule[blocksDraft.key] || []);
    const last = list[list.length - 1];
    let start = 8 * 60;
    let len = 80;
    if (last && last.end) {
      const prev = list[list.length - 2];
      const gap = prev && prev.end && last.start ? Math.max(0, toMin(last.start) - toMin(prev.end)) : 10;
      start = toMin(last.end) + gap;
      if (last.start) len = Math.max(5, toMin(last.end) - toMin(last.start));
    }
    list.push({ start: toHHMM(start), end: toHHMM(Math.min(start + len, 23 * 60 + 59)), label: '' });
    renderBlocksEditor();
    const labels = $$('#bdRows .bd-label');
    labels[labels.length - 1].focus();
  });

  $('#bdCopy').addEventListener('change', (e) => {
    const from = e.target.value;
    if (!from) return;
    blocksDraft.schedule[blocksDraft.key] = JSON.parse(JSON.stringify(blocksDraft.schedule[from] || []));
    renderBlocksEditor();
    toast(`Copied ${keyLabel(from)} → ${keyLabel(blocksDraft.key)}`);
  });

  $('#bdClear').addEventListener('click', () => {
    const before = blocksDraft.schedule[blocksDraft.key] || [];
    if (!before.length) return;
    blocksDraft.schedule[blocksDraft.key] = [];
    renderBlocksEditor();
    const key = blocksDraft.key;
    toast(`Cleared ${keyLabel(key)}`, {
      action: 'Undo',
      onAction: () => {
        blocksDraft.schedule[key] = before;
        renderBlocksEditor();
      },
    });
  });

  function renderBreaks() {
    const box = $('#bdBreaks');
    box.textContent = '';
    const ranges = P.dateRanges(blocksDraft.skip).filter(([, to]) => to >= P.addDays(today(), -30));
    const fmt = (k) => P.fromKey(k).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    for (const [from, to] of ranges) {
      const chip = el('span', 'bd-break');
      chip.append(el('span', null, from === to ? fmt(from) : `${fmt(from)} – ${fmt(to)}`));
      if (from <= today() && today() <= to) chip.classList.add('now');
      const x = el('button', null, '×');
      x.type = 'button';
      x.title = 'Remove';
      x.addEventListener('click', () => {
        const drop = new Set(P.expandRange(from, to));
        blocksDraft.skip = blocksDraft.skip.filter((d) => !drop.has(d));
        renderBreaks();
      });
      chip.append(x);
      box.append(chip);
    }
    if (!ranges.length) box.append(el('span', 'set-help', 'No breaks coming up.'));
  }

  $('#bdAddBreak').addEventListener('click', () => {
    const from = $('#bdFrom').value;
    if (!from) return;
    blocksDraft.skip = [...new Set([...blocksDraft.skip, ...P.expandRange(from, $('#bdTo').value)])].sort();
    renderBreaks();
  });

  $('#bdImport').addEventListener('click', () => {
    const parsed = P.parseSchedule($('#bdText').value);
    if (!Object.keys(parsed).length) {
      $('#bdWarn').textContent = 'Couldn’t find any blocks. Start each day with its letter on its own line.';
      return;
    }
    blocksDraft.schedule = parsed;
    blocksDraft.key = Object.keys(parsed)[0];
    renderBlocksEditor();
    toast('Loaded from text. Check it, then Save.');
  });

  // Returns the cleaned schedule, or null if something must be fixed first.
  function validateBlocks(final) {
    const warn = [];
    let fatal = false;
    const clean = {};
    for (const [k, list] of Object.entries(blocksDraft.schedule)) {
      const rows = (list || []).filter((b) => b.label || b.start || b.end);
      for (const b of rows) {
        if (!b.start || !b.end) {
          fatal = true;
          warn.push(`${keyLabel(k)}: “${b.label || 'a block'}” needs a start and end time.`);
        } else if (toMin(b.end) <= toMin(b.start)) {
          fatal = true;
          warn.push(`${keyLabel(k)}: “${b.label || 'a block'}” ends before it starts.`);
        }
      }
      const sorted = rows.filter((b) => b.start && b.end).sort((a, b) => toMin(a.start) - toMin(b.start));
      for (let i = 1; i < sorted.length; i++) {
        if (toMin(sorted[i].start) < toMin(sorted[i - 1].end)) warn.push(`${keyLabel(k)}: “${sorted[i - 1].label}” and “${sorted[i].label}” overlap.`);
      }
      if (sorted.length) clean[k] = sorted.map((b) => ({ start: b.start, end: b.end, label: b.label || 'Class' }));
    }
    $('#bdWarn').textContent = final || fatal ? warn.slice(0, 4).join(' ') : warn.filter((w) => w.includes('overlap')).slice(0, 2).join(' ');
    $$('#bdRows .bd-row').forEach((li, i) => {
      const b = (blocksDraft.schedule[blocksDraft.key] || [])[i];
      li.classList.toggle('bad', !!b && (b.label || b.start || b.end) && (!b.start || !b.end || toMin(b.end) <= toMin(b.start)));
    });
    return fatal ? null : clean;
  }

  $('#blocksForm').addEventListener('submit', (e) => {
    if (e.submitter && e.submitter.value === 'save' && !validateBlocks(true)) e.preventDefault();
  });

  $('#blocksDialog').addEventListener('close', async () => {
    if ($('#blocksDialog').returnValue !== 'save') return;
    const schedule = validateBlocks(true);
    if (!schedule) return;
    const blocks = { ...state.settings.blocks, schedule, skip: blocksDraft.skip, enabled: true };
    state.settings = { ...state.settings, blocks };
    await P.setSettings({ blocks });
    if ($('#settingsDialog').open) {
      $('#settingsForm').blocksEnabled.checked = true;
      renderBlocksSummary();
    }
    const n = Object.values(schedule).reduce((a, l) => a + l.length, 0);
    toast(`Saved ${n} class block${n === 1 ? '' : 's'}`);
  });

  function renderBlocksSummary() {
    const b = state.settings.blocks;
    const box = $('#blocksSummary');
    const keys = [...b.letters, 'Other'].filter((k) => (b.schedule[k] || []).length);
    const upcoming = P.dateRanges(b.skip).filter(([, to]) => to >= today());
    const parts = [keys.length ? keys.map((k) => `${k === 'Other' ? 'No letter' : k}: ${b.schedule[k].length}`).join(' · ') : 'No class blocks yet.'];
    if (upcoming.length) parts.push(`${upcoming.length} break${upcoming.length === 1 ? '' : 's'} coming up`);
    box.textContent = parts.join(' — ');
  }

  $('#editBlocksBtn').addEventListener('click', () => openBlocksEditor());
  $('#letterChip').addEventListener('click', () => openBlocksEditor());
  $('#blockStrip').addEventListener('click', (e) => {
    const blk = e.target.closest('.blk, .blk-setup');
    if (blk) openBlocksEditor();
  });

  // ---------- settings ----------

  function openSettings() {
    const s = state.settings;
    const f = $('#settingsForm');
    f.guardMode.value = s.guardMode;
    f.sites.value = s.sites.join('\n');
    f.passMinutes.value = s.passMinutes;
    for (const k of ['workStart', 'workEnd', 'weekendStart', 'weekendEnd', 'planTime', 'eodTime']) f[k].value = s[k];
    f.checkinMinutes.value = s.checkinMinutes;
    f.focusMinutes.value = s.focusMinutes;
    f.onitryEnabled.checked = s.onitry.enabled;
    f.onitryCode.value = s.onitry.code;
    f.onitryAutoStart.checked = s.onitry.autoStart;
    f.onitryAutoStop.checked = s.onitry.autoStop;
    f.courses.value = s.courses.map((c) => `${c.name}: ${(c.aliases || []).join(', ')}`).join('\n');
    for (const r of f.placement) r.checked = r.value === s.placement;
    f.theme.value = s.theme;
    f.palette.textContent = '';
    for (const [id, p] of Object.entries(InkPalettes.PALETTES)) f.palette.append(new Option(p.name, id));
    f.palette.value = s.palette;
    const b = s.blocks;
    f.blocksEnabled.checked = b.enabled;
    f.blocksAnchorDate.value = b.anchorDate || '';
    f.blocksLetters.value = b.letters.join('');
    fillLetterSelect(b.letters, b.anchorLetter);
    const days = $('#blocksDays');
    days.textContent = '';
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach((name, i) => {
      const wd = (i + 1) % 7;
      const lab = el('label', 'day-pill');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.value = String(wd);
      cb.checked = b.days.includes(wd);
      lab.append(cb, el('span', null, name));
      days.append(lab);
    });
    renderBlocksSummary();
    f.blocksFreeNudge.checked = b.freeNudge;
    f.onitryLaunch.checked = s.onitry.launch;
    f.onitryEscalate.checked = s.onitry.escalate;
    f.weeklyReviewDay.value = String(s.weeklyReviewDay);
    $('#onitryResult').textContent = '';
    $('#settingsDialog').showModal();
  }

  function parseLetters(text) {
    const letters = [...new Set(String(text || '').toUpperCase().replace(/[^A-Z]/g, ''))];
    return letters.length ? letters : P.DEFAULT_BLOCKS.letters;
  }

  function fillLetterSelect(letters, value) {
    const sel = $('#settingsForm').blocksAnchorLetter;
    sel.textContent = '';
    for (const l of letters) sel.append(new Option(`${l} day`, l));
    sel.value = letters.includes(value) ? value : letters[0];
  }
  $('#settingsForm').blocksLetters.addEventListener('input', (e) => fillLetterSelect(parseLetters(e.target.value), $('#settingsForm').blocksAnchorLetter.value));

  function cleanSites(text) {
    return [...new Set(text.split(/[\s,]+/).map((x) => x.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')).filter((x) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(x)))];
  }

  $('#settingsForm').addEventListener('submit', (e) => {
    // Request host access for newly added sites inside the click (needs a user gesture).
    if (e.submitter && e.submitter.value === 'save') {
      const added = cleanSites($('#settingsForm').sites.value).filter((d) => !state.settings.sites.includes(d));
      const wantTabs = $('#settingsForm').placement.value === 'newtab';
      const origins = added.map((d) => `*://*.${d}/*`);
      if (added.length || wantTabs) {
        chrome.permissions
          .request({ ...(origins.length ? { origins } : {}), ...(wantTabs ? { permissions: ['tabs'] } : {}) })
          .then((granted) => {
            if (wantTabs && !granted) toast('Without the “tabs” permission new tabs can’t open the planner.');
          })
          .catch(() => {});
      }
    }
  });

  $('#settingsDialog').addEventListener('close', async () => {
    if ($('#settingsDialog').returnValue !== 'save') return;
    const f = $('#settingsForm');
    const courses = f.courses.value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, i) => {
        const [name, aliases = ''] = line.split(':');
        const prev = state.settings.courses.find((c) => c.name === name.trim());
        return { name: name.trim(), aliases: aliases.split(',').map((a) => a.trim().toLowerCase()).filter(Boolean), color: prev ? prev.color : P.COLORS[i % P.COLORS.length] };
      });
    await P.setSettings({
      guardMode: f.guardMode.value,
      sites: cleanSites(f.sites.value),
      passMinutes: Number(f.passMinutes.value) || 10,
      workStart: f.workStart.value,
      workEnd: f.workEnd.value,
      weekendStart: f.weekendStart.value,
      weekendEnd: f.weekendEnd.value,
      planTime: f.planTime.value,
      eodTime: f.eodTime.value,
      checkinMinutes: Number(f.checkinMinutes.value) || 0,
      focusMinutes: Number(f.focusMinutes.value) || 40,
      courses: courses.length ? courses : P.DEFAULT_COURSES,
      placement: f.placement.value || 'panel',
      theme: f.theme.value,
      palette: f.palette.value,
      weeklyReviewDay: Number(f.weeklyReviewDay.value),
      blocks: {
        ...state.settings.blocks,
        enabled: f.blocksEnabled.checked,
        letters: parseLetters(f.blocksLetters.value),
        anchorDate: f.blocksAnchorDate.value || state.settings.blocks.anchorDate,
        anchorLetter: f.blocksAnchorLetter.value,
        days: $$('#blocksDays input:checked').map((x) => Number(x.value)),
        freeNudge: f.blocksFreeNudge.checked,
      },
      onitry: {
        ...state.settings.onitry,
        launch: f.onitryLaunch.checked,
        escalate: f.onitryEscalate.checked,
        enabled: f.onitryEnabled.checked,
        code: f.onitryCode.value.trim().toUpperCase(),
        autoStart: f.onitryAutoStart.checked,
        autoStop: f.onitryAutoStop.checked,
      },
    });
    toast('Settings saved');
    pollOnitry();
  });

  $('#onitryTest').addEventListener('click', async () => {
    const out = $('#onitryResult');
    out.className = 'onitry-result';
    out.textContent = 'Checking…';
    const cfg = { ...state.settings.onitry, code: $('#settingsForm').onitryCode.value.trim() };
    const res = await OnitryBridge.status(cfg);
    if (res.ok) {
      out.classList.add('good');
      out.textContent = `Connected ✓ ${res.running ? `— monitoring “${res.task}”` : '— Onitry is idle'}`;
    } else {
      out.classList.add('bad');
      out.textContent = res.reachable ? `${res.error}. Copy the code from Onitry → ⚙ Configure.` : `${res.error}. Press “Launch Onitry”, or open it yourself.`;
    }
  });

  $('#onitryLaunchBtn').addEventListener('click', async () => {
    const out = $('#onitryResult');
    out.className = 'onitry-result';
    out.textContent = 'Launching Onitry…';
    const res = await send({ type: 'plan:launch' });
    out.classList.add(res && res.ok ? 'good' : 'bad');
    out.textContent = res && res.ok ? (res.launched ? 'Onitry is up ✓' : 'Onitry was already running ✓') : `Couldn’t launch: ${(res && res.error) || 'unknown error'}`;
    pollOnitry();
  });

  // ---------- Onitry polling (fast while this page is visible) ----------

  async function pollOnitry() {
    if (!state.settings.onitry.enabled || document.hidden) return;
    state.onitry = { ...(await OnitryBridge.status(state.settings.onitry)), at: Date.now() };
    renderOnitryChip();
    if (state.focus) renderNow();
  }

  // ---------- navigation ----------

  function setTab(tab) {
    state.tab = tab;
    $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    document.body.dataset.tab = tab;
  }
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (b) setTab(b.dataset.tab);
  });

  $('#tabBtn').hidden = VIEW !== 'panel';
  $('#tabBtn').addEventListener('click', () => send({ type: 'plan:open-tab' }));
  $('#helpBtn').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('docs.html') }));
  $('#settingsBtn').addEventListener('click', openSettings);
  $('#onitryChip').addEventListener('click', openSettings);

  // ---------- boot ----------

  async function init() {
    for (const n of $$('[data-icon]')) n.insertAdjacentHTML('afterbegin', InkIcons.svg(n.dataset.icon, Number(n.dataset.size) || 18));
    await P.ensureSeeded();
    await load();
    applyTheme();
    setTab(/eod|journal|review/.test(location.hash) ? 'journal' : 'today');
    P.store.update(K.meta, {}, (m) => (m.plannerOpened ? m : { ...m, plannerOpened: Date.now() }));
    // Links from the guide: today.html#blocks, #settings
    if (location.hash === '#blocks') openBlocksEditor();
    else if (location.hash === '#settings') openSettings();
    render();
    previewQuick();
    if (VIEW === 'tab' && !state.focus) quick.focus();
    setInterval(tickTimer, 1000);
    setInterval(renderClock, 15000);
    setInterval(() => {
      // Keep the schedule times and "past cutoff" warnings fresh.
      if (!document.hidden) renderToday();
    }, 60000);
    pollOnitry();
    setInterval(pollOnitry, 5000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) scheduleRender();
    });
  }

  init();
})();
