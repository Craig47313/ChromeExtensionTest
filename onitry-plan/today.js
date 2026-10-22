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
    renderToday();
    renderNow();
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

  // ---------- now bar: what's running, or what's next ----------

  const nowMinutes = () => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
  };

  function onitryLine(f) {
    const o = state.onitry;
    const status = el('div', 'nb-onitry');
    if (!state.settings.onitry.enabled || f.kind === 'break') return null;
    if (f.onitryPending) status.textContent = 'Connecting to Onitry…';
    else if (state.escalatedUntil > Date.now()) {
      status.classList.add('bad');
      status.textContent = `Onitry caught you off task${o && o.activity ? ` (${o.activity})` : ''}. Gate locked for ${Math.ceil((state.escalatedUntil - Date.now()) / 60000)} more min.`;
    } else if (f.pausedAt) status.textContent = 'Onitry is paused too.';
    else if (f.onitry && o && o.running) {
      status.classList.add(o.status === 'off_task' ? 'bad' : 'good');
      status.textContent = o.status === 'off_task' ? `Onitry: off task — ${o.activity || 'get back to it'}` : `Onitry is watching${o.activity ? ` — ${o.activity}` : ''}`;
    } else if (f.onitryError) {
      status.classList.add('warn');
      status.textContent = `Onitry: ${f.onitryError}`;
    } else return null;
    return status;
  }

  function actionBtn(label, iconName, cls, onClick, title) {
    const b = el('button', `btn ${cls || ''}`.trim(), label);
    if (iconName) b.prepend(icon(iconName));
    if (title) b.title = title;
    b.addEventListener('click', onClick);
    return b;
  }

  function renderNow() {
    const bar = $('#nowBar');
    bar.textContent = '';
    const f = state.focus;
    const events = layoutCache.length ? layoutCache : computeLayout();
    const nowMin = nowMinutes();
    bar.className = 'now-bar';

    if (f && (f.timeUpAt || (!f.pausedAt && f.endsAt <= Date.now()))) {
      // Time's up: no counting up, just a clear choice.
      bar.classList.add('timeup');
      const info = el('div', 'nb-info');
      const top = el('div', 'nb-top');
      top.append(el('span', 'nb-label', '⏰ Time’s up'));
      const chip = courseChip(f.course);
      if (chip) top.append(chip);
      info.append(top, el('div', 'nb-title', f.title));
      const timer = el('div', 'nb-timer is-up', 'Done?');
      timer.id = 'focusTimer';
      const actions = el('div', 'nb-actions');
      actions.append(
        actionBtn(f.kind === 'break' ? 'End break' : 'Done', 'check', 'primary', () => send({ type: 'plan:focus', action: 'done' }), state.settings.autoAdvance ? 'Done — start the next block' : 'Done'),
        actionBtn('+5 min', null, '', () => send({ type: 'plan:focus', action: 'extend', minutes: 5 })),
        actionBtn('+10 min', null, '', () => send({ type: 'plan:focus', action: 'extend', minutes: 10 })),
        actionBtn('Stop', null, 'ghost', () => send({ type: 'plan:focus', action: 'stop', outcome: 'timeup' }), 'End this block without ticking it off')
      );
      bar.append(info, timer, actions);
      const then = P.nextUp(events, nowMin);
      if (then && state.settings.autoAdvance) bar.append(el('div', 'nb-then', `Done starts: ${then.task.title}`));
      document.title = `⏰ Time’s up · ${f.title}`;
      return;
    }

    if (!f) document.title = 'Onitry Plan';
    if (f) {
      bar.classList.add(f.pausedAt ? 'paused' : f.kind === 'break' ? 'break' : 'running');
      const info = el('div', 'nb-info');
      const top = el('div', 'nb-top');
      top.append(el('span', 'nb-label', f.pausedAt ? '❚❚ Paused' : f.kind === 'break' ? 'Break' : 'Focusing'));
      const chip = courseChip(f.course);
      if (chip) top.append(chip);
      info.append(top, el('div', 'nb-title', f.title));
      const timer = el('div', 'nb-timer');
      timer.id = 'focusTimer';
      const actions = el('div', 'nb-actions');
      if (f.pausedAt) actions.append(actionBtn('Resume', 'play', 'primary', () => send({ type: 'plan:focus', action: 'resume' })));
      else actions.append(actionBtn('Pause', 'pause', '', () => send({ type: 'plan:focus', action: 'pause' }), 'Pause the timer (and Onitry)'));
      if (f.kind !== 'break') actions.append(actionBtn('Done', 'check', f.pausedAt ? '' : 'primary', () => send({ type: 'plan:focus', action: 'done' }), state.settings.autoAdvance ? 'Done — start the next block' : 'Done'));
      else actions.append(actionBtn('End break', 'check', 'primary', () => send({ type: 'plan:focus', action: 'done' })));
      actions.append(actionBtn('+10', null, 'ghost', () => send({ type: 'plan:focus', action: 'extend', minutes: 10 }), 'Add 10 minutes'));
      if (f.kind !== 'break') actions.append(actionBtn('Skip', null, 'ghost', () => send({ type: 'plan:focus', action: 'skip' }), 'Move this to the end of today and start the next block'));
      actions.append(actionBtn('Stop', null, 'ghost', () => send({ type: 'plan:focus', action: 'stop', outcome: 'stopped' }), 'End this block and stop the schedule'));
      const progress = el('div', 'nb-progress');
      progress.id = 'focusBar';
      progress.append(el('span'));
      bar.append(info, timer, actions, progress);
      const line = onitryLine(f);
      if (line) bar.append(line);
      const then = P.nextUp(events, nowMin);
      if (then) bar.append(el('div', 'nb-then', `${state.settings.autoAdvance ? 'Then' : 'Next'}: ${then.task.title} · ${P.hhmm(then.start)}`));
      tickTimer();
      return;
    }

    const next = P.nextUp(events, nowMin);
    bar.classList.add('idle');
    if (next) {
      const info = el('div', 'nb-info');
      const top = el('div', 'nb-top');
      top.append(el('span', 'nb-label', next.start - nowMin > 10 ? `Next at ${P.hhmm(next.start)}` : 'Up next'));
      const chip = courseChip(next.task.course);
      if (chip) top.append(chip);
      info.append(top, el('div', 'nb-title', next.task.title));
      const left = events.filter((e) => e.type === 'task').length;
      const actions = el('div', 'nb-actions');
      actions.append(actionBtn(left > 1 ? `Start (${left} blocks)` : 'Start', 'play', 'primary', () => startTask(next.task), state.settings.autoAdvance ? 'Runs your schedule back to back' : ''));
      bar.append(info, actions);
    } else {
      bar.append(el('div', 'nb-empty', 'Nothing scheduled. Add something above — it goes straight onto your schedule.'));
    }
    const g = P.guardState(state.settings, null, state.tasks);
    if (g.active) bar.append(el('div', 'nb-hint', `🛡 Gate is up — ${g.urgent || 'some'} thing${g.urgent === 1 ? '' : 's'} due by tomorrow${g.reason === 'free block' ? ' and you’re in a free block' : ''}.`));
  }

  let lastBadge = '';
  function tickTimer() {
    const f = state.focus;
    // While a planner page is open it keeps the badge exact to the second.
    if (!document.hidden || lastBadge) {
      const offTask = P.isFocusing(f) && state.onitry && state.onitry.running && state.onitry.status === 'off_task';
      const b = P.badgeFor(f, { offTask, seconds: true });
      if (b.text !== lastBadge) {
        lastBadge = b.text;
        chrome.action.setBadgeText({ text: b.text }).catch(() => {});
        chrome.action.setBadgeBackgroundColor({ color: b.color }).catch(() => {});
      }
    }
    const t = $('#focusTimer');
    if (!f || !t) return;
    if (!f.pausedAt && !f.timeUpAt && f.endsAt <= Date.now()) {
      renderNow(); // just ran out: switch to "Time's up" (the service worker rings)
      return;
    }
    if (f.timeUpAt) return;
    const now = f.pausedAt || Date.now();
    const left = Math.max(0, f.endsAt - now);
    const s = Math.ceil(left / 1000);
    const mm = Math.floor(s / 60);
    const ss = String(s % 60).padStart(2, '0');
    t.textContent = `${mm}:${ss}`;
    t.classList.toggle('paused', !!f.pausedAt);
    t.classList.toggle('soon', !f.pausedAt && left < 60000);
    const total = f.endsAt - f.startedAt - (f.pausedMs || 0);
    const pct = Math.min(100, ((now - f.startedAt - (f.pausedMs || 0)) / Math.max(1, total)) * 100);
    const bar = $('#focusBar span');
    if (bar) bar.style.width = `${pct}%`;
    document.title = `${f.pausedAt ? '❚❚ ' : ''}${mm}:${ss} · ${f.title}`;
  }

  function startTask(t) {
    return send({ type: 'plan:focus', action: 'start', taskId: t.id, title: t.title, course: t.course || null, minutes: P.taskMinutes(t, state.settings.focusMinutes), kind: t.kind === 'break' ? 'break' : 'focus' });
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
    if (r.kind === 'break') box.append(el('span', 'pv', 'break'));
    // Where it lands on today's schedule.
    if (r.plan === today() && !r.someday) {
      const probe = P.makeTask({ ...r, id: '__probe', order: Date.now() + 1e6 });
      const ev = P.layoutDay({ tasks: state.tasks.concat(probe), focus: state.focus, sessions: [], settings: state.settings, today: today(), now: new Date(), defaultMinutes: state.settings.focusMinutes }).find((e) => e.task && e.task.id === '__probe');
      if (ev) box.append(el('span', 'pv slot', `→ ${P.hhmm(ev.start)}–${P.hhmm(ev.end)}${r.at ? ' 📌' : ''}`));
    }
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
      play.addEventListener('click', () => startTask(t));
      li.append(play);
    }
    return li;
  }

  async function toggleDone(t, done) {
    if (done && state.focus && state.focus.taskId === t.id) {
      await send({ type: 'plan:focus', action: 'done' });
      return;
    }
    await P.updateTask(t.id, { done: done ? Date.now() : null });
    if (done) {
      await P.log(`✓ ${t.title}`, 'done');
      toast(`Done: ${t.title}`, { action: 'Undo', onAction: () => P.updateTask(t.id, { done: null }) });
    }
  }

  // ---------- today: the schedule ----------

  const PX = 1.1; // pixels per minute (66px an hour)
  const SNAP = 5;
  let layoutCache = [];
  let scrolledToNow = false;

  function computeLayout() {
    layoutCache = P.layoutDay({ tasks: state.tasks, focus: state.focus, sessions: state.sessions, settings: state.settings, today: today(), now: new Date(), defaultMinutes: state.settings.focusMinutes });
    return layoutCache;
  }

  const hm24 = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(Math.round(min) % 60).padStart(2, '0')}`;
  const snap = (min) => Math.round(min / SNAP) * SNAP;

  function renderToday() {
    const events = computeLayout();
    // Classes get their own rail; everything else shares lanes only with itself.
    P.assignLanes(events.filter((e) => e.type !== 'class'));
    const nowMin = nowMinutes();
    const list = P.todayTasks(state.tasks, today());
    const done = list.filter((t) => t.done);
    const tasksAhead = events.filter((e) => e.type === 'task');

    // Visible range: the whole day's events plus a bit of room around now.
    const starts = events.map((e) => e.start).concat(nowMin - 60);
    const ends = events.map((e) => e.end).concat(nowMin + 180);
    const startH = Math.max(0, Math.floor(Math.min(...starts) / 60));
    const endH = Math.min(24, Math.ceil(Math.max(...ends) / 60 + 0.5));
    const top = (min) => (min - startH * 60) * PX;

    const cal = $('#cal');
    const inner = $('#calInner');
    inner.textContent = '';
    inner.style.height = `${(endH - startH) * 60 * PX}px`;
    inner.dataset.start = String(startH * 60);
    inner.classList.toggle('has-classes', events.some((e) => e.type === 'class'));
    for (let h = startH; h <= endH; h++) {
      const line = el('div', 'cal-hour');
      line.style.top = `${top(h * 60)}px`;
      if (h < endH) line.append(el('span', null, P.hhmm(h * 60).replace(':00', '')));
      inner.append(line);
    }

    for (const ev of events) inner.append(eventEl(ev, top, nowMin, tasksAhead[0]));

    if (nowMin >= startH * 60 && nowMin <= endH * 60) {
      const line = el('div', 'cal-now');
      line.style.top = `${top(nowMin)}px`;
      inner.append(line);
    }
    if (!scrolledToNow && cal.clientHeight) {
      cal.scrollTop = Math.max(0, top(nowMin) - cal.clientHeight * 0.25);
      scrolledToNow = true;
    }

    // Footer: how long the plan runs.
    const foot = $('#todayFoot');
    foot.textContent = '';
    foot.classList.remove('warn');
    if (tasksAhead.length) {
      const total = tasksAhead.reduce((sum, e) => sum + (e.end - e.start), 0);
      const endMin = Math.max(...tasksAhead.map((e) => e.end));
      const workEnd = P.minutesOfDay(new Date().getDay() % 6 === 0 ? state.settings.weekendEnd : state.settings.workEnd);
      foot.append(el('span', null, `${tasksAhead.length} block${tasksAhead.length === 1 ? '' : 's'} · ${P.fmtMinutes(total)} · done by ${P.hhmm(endMin)}`));
      if (endMin > workEnd) {
        foot.classList.add('warn');
        foot.append(el('span', 'over', ' — past your cutoff. Cut or move something.'));
      }
    } else foot.append(el('span', null, done.length ? 'All done for today. 🎉' : 'Type above to add blocks. Click an empty spot on the calendar to add one at that time.'));

    $('#todayMeta').textContent = list.length ? `${done.length}/${list.length} done` : '';
    const doneBox = $('#doneToday');
    doneBox.hidden = !done.length;
    doneBox.querySelector('summary').textContent = `Done today (${done.length})`;
    const dl = $('#doneList');
    dl.textContent = '';
    for (const t of done) dl.append(taskRow(t));

    renderBlocks();

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

  function courseFor(label) {
    const l = String(label || '').toLowerCase();
    return state.settings.courses.find((c) => c.name.toLowerCase() === l || (c.aliases || []).includes(l));
  }

  function eventEl(ev, top, nowMin, firstAhead) {
    const len = ev.end - ev.start;
    const node = el('div', `ev ev-${ev.type}`);
    node.style.top = `${top(ev.start)}px`;
    node.style.height = `${Math.max(20, len * PX - 2)}px`;
    node.style.setProperty('--lane', ev.lane || 0);
    node.style.setProperty('--lanes', ev.lanes || 1);
    node.dataset.start = String(ev.start);
    if (len * PX < 44) node.classList.add('short');
    const time = el('span', 'ev-time', `${P.hhmm(ev.start)}–${P.hhmm(ev.end)}`);

    if (ev.type === 'class') {
      const c = courseFor(ev.block.label);
      if (c) node.style.setProperty('--c', c.color);
      node.classList.toggle('free', ev.free);
      node.classList.toggle('past', ev.end <= nowMin);
      node.append(el('span', 'ev-title', ev.block.label), time);
      node.title = `${ev.block.label} · ${ev.block.start}–${ev.block.end}${ev.free ? ' · free block: tasks can go here' : ''}`;
      node.addEventListener('click', () => openBlocksEditor());
      return node;
    }
    if (ev.type === 'session') {
      const s = ev.session;
      if (s.course) node.style.setProperty('--c', P.courseColor(state.settings.courses, s.course));
      node.classList.toggle('break', s.kind === 'break');
      const mark = s.outcome === 'done' ? '✓ ' : '';
      node.append(el('span', 'ev-title', `${mark}${s.title}`), el('span', 'ev-time', `${P.hhmm(ev.start)}–${P.hhmm(ev.end)}${s.onitry && s.onitry.onPct != null ? ` · ${s.onitry.onPct}% on task` : ''}`));
      node.title = `${s.title} — ${s.outcome}, ${P.fmtMinutes(s.minutes)}`;
      return node;
    }
    if (ev.type === 'focus') {
      const f = ev.focus;
      if (f.course) node.style.setProperty('--c', P.courseColor(state.settings.courses, f.course));
      node.classList.toggle('break', f.kind === 'break');
      node.classList.toggle('paused', !!f.pausedAt);
      const up = f.timeUpAt || (!f.pausedAt && f.endsAt <= Date.now());
      node.classList.toggle('timeup', !!up);
      node.append(el('span', 'ev-title', f.title), el('span', 'ev-time', up ? '⏰ Time’s up' : f.pausedAt ? 'Paused' : `Now · until ${P.hhmm(ev.end)}`));
      return node;
    }

    // A task block: draggable to pin a time, resizable to change its length.
    const t = ev.task;
    node.dataset.id = t.id;
    if (t.course) node.style.setProperty('--c', P.courseColor(state.settings.courses, t.course));
    node.classList.toggle('break', t.kind === 'break');
    node.classList.toggle('pinned', !!ev.pinned);
    node.classList.toggle('late', !!(t.due && t.due < today()));
    node.classList.toggle('next', ev === firstAhead && !state.focus);
    const head = el('div', 'ev-head');
    const box = el('input');
    box.type = 'checkbox';
    box.title = 'Mark done';
    box.addEventListener('change', () => toggleDone(t, box.checked));
    const title = el('button', 'ev-title', t.title);
    title.type = 'button';
    title.title = 'Edit';
    title.addEventListener('click', () => openEdit(t.id));
    head.append(box, title);
    const tools = el('div', 'ev-tools');
    if (ev.pinned) {
      const pin = el('button', 'ev-pin', '📌');
      pin.type = 'button';
      pin.title = `Pinned at ${P.hhmm(ev.start)}. Click to let it flow with the rest.`;
      pin.addEventListener('click', () => P.updateTask(t.id, { at: null }));
      tools.append(pin);
    }
    const play = el('button', 'ev-play');
    play.type = 'button';
    play.title = t.kind === 'break' ? 'Start this break' : 'Start this block';
    play.innerHTML = InkIcons.svg('play', 14);
    play.addEventListener('click', () => startTask(t));
    tools.append(play);
    head.append(tools);
    const meta = el('div', 'ev-meta');
    meta.append(time, el('span', 'ev-len', P.fmtMinutes(len)));
    const due = dueLabel(t);
    if (due && !node.classList.contains('short')) meta.append(due);
    node.title = `${t.title} · ${P.hhmm(ev.start)}–${P.hhmm(ev.end)} (${P.fmtMinutes(len)})${ev.pinned ? ' · pinned' : ''}\nDrag to move, drag the bottom edge to resize`;
    const grip = el('div', 'ev-resize');
    grip.title = 'Drag to change how long';
    node.append(head, meta, grip);
    node.addEventListener('pointerdown', (e) => startDrag(e, node, ev));
    return node;
  }

  // Drag a block to pin it at a time (5-minute snaps); drag its bottom edge to resize.
  function startDrag(e, node, ev) {
    if (e.button !== 0 || e.target.closest('input, .ev-tools')) return;
    const resizing = e.target.classList.contains('ev-resize');
    const y0 = e.clientY;
    const len0 = ev.end - ev.start;
    let moved = false;
    let value = null;
    const label = node.querySelector('.ev-time');
    const onMove = (m) => {
      const dy = m.clientY - y0;
      if (!moved && Math.abs(dy) < 4) return;
      if (!moved) {
        moved = true;
        node.classList.add(resizing ? 'resizing' : 'dragging');
        node.setPointerCapture(e.pointerId);
      }
      if (resizing) {
        value = Math.max(SNAP, snap(len0 + dy / PX));
        node.style.height = `${Math.max(20, value * PX - 2)}px`;
        label.textContent = `${P.hhmm(ev.start)}–${P.hhmm(ev.start + value)}`;
      } else {
        value = Math.max(0, Math.min(24 * 60 - len0, snap(ev.start + dy / PX)));
        node.style.transform = `translateY(${(value - ev.start) * PX}px)`;
        label.textContent = `${P.hhmm(value)}–${P.hhmm(value + len0)}`;
      }
    };
    const onUp = async () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (!moved) return;
      // A drag that started on the title shouldn't also count as a click (which opens edit).
      const eat = (c) => {
        c.stopPropagation();
        c.preventDefault();
      };
      window.addEventListener('click', eat, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', eat, { capture: true }), 0);
      if (value == null) return;
      if (resizing) await P.updateTask(ev.task.id, { estimate: value });
      else {
        await P.updateTask(ev.task.id, { at: hm24(value), plan: today() });
        toast(`Pinned “${ev.task.title}” at ${P.hhmm(value)}`, { action: 'Undo', onAction: () => P.updateTask(ev.task.id, { at: ev.pinned ? ev.task.at : null }) });
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  // Click an empty spot: start a quick add pinned at that time.
  $('#calInner').addEventListener('click', (e) => {
    if (e.target !== e.currentTarget && !e.target.classList.contains('cal-hour')) return;
    const r = e.currentTarget.getBoundingClientRect();
    const min = snap(Number(e.currentTarget.dataset.start) + (e.clientY - r.top) / PX);
    quick.value = ` at ${hm24(min)}`;
    quick.focus();
    quick.setSelectionRange(0, 0);
    previewQuick();
    quick.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });

  function renderBlocks() {
    const strip = $('#blockStrip');
    strip.textContent = '';
    const b = state.settings.blocks;
    if (!b.enabled || P.dayInfo(today(), b).blocks.length) return;
    const hasAny = Object.values(b.schedule || {}).some((l) => l && l.length);
    const onBreak = b.skip.includes(today());
    if (onBreak || !hasAny) {
      const setup = el('button', 'blk-setup', onBreak ? '🏖 No school today. The rotation is paused.' : '+ Add your class blocks');
      setup.type = 'button';
      strip.append(setup);
    }
  }

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
    const sessions = state.sessions.filter((s) => s.end >= start && s.end < end && s.kind !== 'break');
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
    f.autoAdvance.checked = s.autoAdvance;
    f.alarmSound.checked = s.alarmSound;
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
      autoAdvance: f.autoAdvance.checked,
      alarmSound: f.alarmSound.checked,
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

  $('#alarmTest').addEventListener('click', async () => {
    const res = await send({ type: 'plan:test-alarm' });
    if (!res || !res.ok) toast(`Couldn’t play the alarm: ${(res && res.error) || 'unknown error'}`);
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
    renderNow();
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
      if (!document.hidden) {
        renderToday();
        renderNow();
      }
    }, 60000);
    pollOnitry();
    setInterval(pollOnitry, 5000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) scheduleRender();
    });
  }

  init();
})();
