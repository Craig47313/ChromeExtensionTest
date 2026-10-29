// Timecheck's dashboard. Runs in the side panel (today.html?view=panel), in its
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
    activities: [],
    reflection: null,
    inkwellPending: null,
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

  const actById = (id) => state.activities.find((a) => a.id === id) || null;
  const actByName = (name) => state.activities.find((a) => a.key === P.actKey(name)) || null;
  const actOfTask = (t) => (t.kind === 'break' ? null : actById(t.activityId) || actByName(t.title));

  // A name that opens its activity page (or plain text when it isn't an activity).
  function nameEl(cls, text, act) {
    if (!act) return el('div', cls, text);
    const b = el('button', `${cls} name-link`, text);
    b.type = 'button';
    b.title = 'Open its page';
    b.addEventListener('click', () => openActivity(act.id));
    return b;
  }

  // Click a task's name: its activity page, or the editor for breaks.
  function openTaskName(t) {
    const a = actOfTask(t);
    if (a) openActivity(a.id);
    else openEdit(t.id);
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
    state.offUntil = (d[K.meta] || {}).offUntil || 0;
    state.settings = await P.getSettings();
    state.reviews = d[K.reviews] || {};
    state.activities = d[K.activities] || [];
    state.reflection = (d[K.meta] || {}).pendingReflection || null;
    state.inkwellPending = (d[K.meta] || {}).inkwellPending || null;
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
    renderAddRow();
    renderNow();
    renderReflect();
    renderInkwell();
    if (openActId) renderActivity();
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
      info.append(top, nameEl('nb-title', f.title, f.kind === 'break' ? null : actById(f.activityId) || actByName(f.title)));
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
      const offT = offHint();
      if (offT) bar.append(offT);
      document.title = `⏰ Time’s up · ${f.title}`;
      return;
    }

    if (!f) document.title = 'Timecheck';
    if (f) {
      bar.classList.add(f.pausedAt ? 'paused' : f.kind === 'break' ? 'break' : 'running');
      const info = el('div', 'nb-info');
      const top = el('div', 'nb-top');
      top.append(el('span', 'nb-label', f.pausedAt ? '❚❚ Paused' : f.kind === 'break' ? 'Break' : 'Focusing'));
      const chip = courseChip(f.course);
      if (chip) top.append(chip);
      info.append(top, nameEl('nb-title', f.title, f.kind === 'break' ? null : actById(f.activityId) || actByName(f.title)));
      const timer = el('div', 'nb-timer');
      timer.id = 'focusTimer';
      const actions = el('div', 'nb-actions');
      if (f.pausedAt) actions.append(actionBtn('Resume', 'play', 'primary', () => send({ type: 'plan:focus', action: 'resume' })));
      else actions.append(actionBtn('Pause', 'pause', '', () => send({ type: 'plan:focus', action: 'pause' }), 'Pause the timer (and Onitry)'));
      if (f.kind !== 'break') actions.append(actionBtn('Done', 'check', f.pausedAt ? '' : 'primary', () => send({ type: 'plan:focus', action: 'done' }), state.settings.autoAdvance ? 'Done — start the next block' : 'Done'));
      else actions.append(actionBtn('End break', 'check', 'primary', () => send({ type: 'plan:focus', action: 'done' })));
      actions.append(actionBtn('+5', null, 'ghost', () => send({ type: 'plan:focus', action: 'extend', minutes: 5 }), 'Add 5 minutes'));
      if (f.kind !== 'break') actions.append(actionBtn('Skip', null, 'ghost', () => send({ type: 'plan:focus', action: 'skip' }), 'Move this to the end of today and start the next block'));
      actions.append(actionBtn('Stop', null, 'ghost', () => send({ type: 'plan:focus', action: 'stop', outcome: 'stopped' }), 'End this block and stop the schedule'));
      if (f.kind !== 'break') {
        const brk = actionBtn('Break', null, 'ghost', () => breakPanel(brk), 'Take a break: gated sites open and Onitry pauses');
        actions.append(brk);
      }
      const progress = el('div', 'nb-progress');
      progress.id = 'focusBar';
      progress.append(el('span'));
      bar.append(info, timer, actions, progress);
      const line = onitryLine(f);
      if (line) bar.append(line);
      if (f.kind !== 'break') {
        const n = allowList(f.activityId).length;
        const hint = el('div', 'nb-hint nb-off');
        hint.append(el('span', null, n ? `🔗 ${n} page${n === 1 ? '' : 's'} allowed through the gate.` : 'Need a video or site for this?'));
        const b = el('button', null, n ? 'Manage' : 'Allow a page');
        b.type = 'button';
        b.addEventListener('click', () => allowPanel(b, f.activityId));
        hint.append(b);
        bar.append(hint);
      }
      const offH = offHint();
      if (offH) bar.append(offH);
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
      info.append(top, nameEl('nb-title', next.task.title, actOfTask(next.task)));
      const left = events.filter((e) => e.type === 'task').length; // the whole queue runs from one Start
      const actions = el('div', 'nb-actions');
      actions.append(actionBtn(left > 1 ? `Start (${left} blocks)` : 'Start', 'play', 'primary', () => startTask(next.task), state.settings.autoAdvance ? 'Runs your queue back to back' : ''));
      const brk = actionBtn('Break', null, '', () => breakPanel(brk), 'Take a break: gated sites open and Onitry pauses');
      actions.append(brk);
      bar.append(info, actions);
    } else {
      bar.append(el('div', 'nb-empty', 'Nothing queued. Add a block below, then press Start.'));
      const brk = actionBtn('Break', null, '', () => breakPanel(brk), 'Take a break: gated sites open and Onitry pauses');
      const row = el('div', 'nb-actions');
      row.append(brk);
      bar.append(row);
    }
    const offIdle = offHint();
    if (offIdle) bar.append(offIdle);
    const g = P.guardState(state.settings, null, state.tasks, new Date(), 0, state.offUntil);
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

  // Start a block. A break past the day's budget comes back as error 'budget' and asks for the off-switch code.
  async function startTask(t) {
    const msg = { type: 'plan:focus', action: 'start', taskId: t.id, title: t.title, course: t.course || null, minutes: P.taskMinutes(t, state.settings.focusMinutes), kind: t.kind === 'break' ? 'break' : 'focus' };
    const res = await send(msg);
    if (res && res.error === 'budget') {
      const a = document.activeElement;
      breakPanel(a && a !== document.body && document.contains(a) ? a : $('#nowBar'), { task: t });
    }
    return res;
  }

  function breakUsage() {
    return P.breakStatus(state.settings, { sessions: state.sessions, focus: state.focus });
  }

  // The Break button: a length (5 to 30 min), today's budget, and the code once the budget is spent.
  function breakPanel(anchor, { task = null } = {}) {
    TCMenu.panel({
      anchor,
      align: 'end',
      label: 'Take a break',
      build(box, done) {
        box.classList.add('tc-form');
        const bs = breakUsage();
        const needCode = !!state.settings.offCode && bs.over;
        box.append(el('div', 'tc-title', task ? `Start “${task.title}”` : 'Take a break'));
        let stepper = null;
        if (!task) {
          stepper = TCStepper.create({ value: 10, min: 5, max: 30, step: 5, unit: 'min', label: 'Break length' });
          box.append(stepper.el);
        }
        box.append(el('div', needCode ? 'tc-note warn' : 'tc-note', `${bs.used} of ${bs.budget} min used today${bs.over ? ': the budget is spent.' : '.'}`));
        if (!state.settings.offCode && bs.over) box.append(el('div', 'tc-note', 'Set an off-switch code in ⚙ to make the budget a limit.'));
        box.append(el('div', 'tc-note', 'Gated sites open and Onitry pauses until it ends.'));
        if (!task && state.focus && state.focus.kind !== 'break') box.append(el('div', 'tc-note', `“${state.focus.title}” stops and goes back in the queue.`));
        let code = null;
        if (needCode) {
          code = el('input', 'tc-code');
          code.type = 'password';
          code.inputMode = 'numeric';
          code.maxLength = 6;
          code.autocomplete = 'off';
          code.placeholder = 'Off-switch code';
          code.setAttribute('aria-label', 'Off-switch code');
          box.append(code);
        }
        const err = el('div', 'tc-error');
        err.setAttribute('role', 'alert');
        const go = el('button', 'btn primary', 'Start break');
        go.type = 'button';
        go.addEventListener('click', async () => {
          err.textContent = '';
          const res = task
            ? await send({ type: 'plan:focus', action: 'start', taskId: task.id, title: task.title, course: task.course || null, minutes: P.taskMinutes(task, state.settings.focusMinutes), kind: 'break', code: code ? code.value : null })
            : await send({ type: 'plan:focus', action: 'start', title: 'Break', kind: 'break', minutes: stepper.value, code: code ? code.value : null });
          if (res && res.ok) done();
          else if (res && res.error === 'budget') {
            err.textContent = res.wrong ? 'That code isn’t right.' : 'Enter your off-switch code to take this break.';
            if (code) code.focus();
          } else err.textContent = (res && res.error) || 'Couldn’t start the break.';
        });
        box.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.target.closest('button')) go.click();
        });
        box.append(err, go);
        queueMicrotask(() => (code || stepper ? (code || stepper).focus() : go.focus()));
      },
    });
  }

  // "Gate off until 3:40 PM · Turn back on" while the off switch is in use.
  function offHint() {
    if (!(state.offUntil > Date.now())) return null;
    const d = el('div', 'nb-hint nb-off');
    d.append(el('span', null, `🔓 Gate and Onitry are off until ${P.fmtTime(state.offUntil)}.`));
    const b = el('button', null, 'Turn back on');
    b.type = 'button';
    b.addEventListener('click', () => send({ type: 'plan:offswitch', choice: 'cancel' }));
    d.append(b);
    return d;
  }

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
    title.addEventListener('click', () => openTaskName(t));
    title.title = 'Open its page';
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
      const edit = el('button', 'icon-btn small', null);
      edit.title = 'Edit';
      edit.innerHTML = InkIcons.svg('pen', 15);
      edit.addEventListener('click', () => openEdit(t.id));
      li.append(edit);
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

  // ---------- today: the queue ----------

  let layoutCache = [];

  function computeLayout() {
    layoutCache = P.layoutDay({ tasks: state.tasks, focus: state.focus, sessions: state.sessions, settings: state.settings, today: today(), now: new Date(), defaultMinutes: state.settings.focusMinutes });
    return layoutCache;
  }

  const hm24 = (min) => TCStepper.clock.format(min);
  const SET_TIME_STEP = 5;

  // Task rows in the order they are on screen (classes are not in the queue).
  const queueTaskIds = () => $$('#queue .q-task').map((li) => li.dataset.id);

  async function writeOrder(ids) {
    const orders = P.orderFor(ids);
    await P.store.update(K.tasks, [], (all) => all.map((t) => (orders[t.id] != null ? { ...t, order: orders[t.id] } : t)));
  }

  function moveRow(id, to) {
    return writeOrder(P.moveId(queueTaskIds(), id, to));
  }

  async function removeWithUndo(t) {
    await P.removeTask(t.id);
    toast(`Removed “${t.title}”`, { action: 'Undo', onAction: () => P.addTasks([t]) });
  }

  async function duplicateTask(t) {
    const ids = P.queueIds(state.tasks, today(), state.focus);
    const nextId = ids[ids.indexOf(t.id) + 1];
    const next = state.tasks.find((x) => x.id === nextId);
    const order = next ? (t.order + next.order) / 2 : t.order + 1;
    await P.addTasks([P.makeTask({ ...t, id: undefined, order, at: null, done: null, created: Date.now() })]);
    toast(`Duplicated “${t.title}”`);
  }

  // "Start at a set time…": a small panel with an hh:mm stepper.
  function openSetTime(anchor, t, ev) {
    TCMenu.panel({
      anchor,
      align: 'end',
      label: 'Start at a set time',
      build(box, done) {
        box.classList.add('tc-form');
        box.append(el('div', 'tc-title', 'Start at a set time'));
        const stepper = TCStepper.create({ value: ev ? Math.round(ev.start / SET_TIME_STEP) * SET_TIME_STEP : 9 * 60, min: 0, max: 23 * 60 + 55, step: SET_TIME_STEP, format: TCStepper.clock.format, parse: TCStepper.clock.parse, label: 'Start time (hh:mm)' });
        const row = el('div', 'tc-row');
        const set = el('button', 'btn primary', 'Set');
        set.type = 'button';
        set.addEventListener('click', async () => {
          done();
          await P.updateTask(t.id, { at: hm24(stepper.value), plan: today() });
          toast(`“${t.title}” starts at ${P.hhmm(stepper.value)}`);
        });
        row.append(stepper.el, set);
        if (t.at) {
          const clear = el('button', 'btn', 'Let it flow');
          clear.type = 'button';
          clear.addEventListener('click', () => {
            done();
            P.updateTask(t.id, { at: null });
          });
          row.append(clear);
        }
        box.append(row);
        stepper.input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') set.click();
        });
        queueMicrotask(() => stepper.focus());
      },
    });
  }

  function rowMenu(anchor, t, ev) {
    const ids = queueTaskIds();
    const i = ids.indexOf(t.id);
    TCMenu.open({
      anchor,
      align: 'end',
      label: `${t.title} options`,
      items: [
        { label: 'Edit', onSelect: () => openEdit(t.id) },
        { label: 'Start now', onSelect: () => startTask(t) },
        { sep: true },
        { label: 'Move to top', disabled: i <= 0, onSelect: () => moveRow(t.id, 0) },
        { label: 'Move to bottom', disabled: i < 0 || i === ids.length - 1, onSelect: () => moveRow(t.id, ids.length) },
        { label: 'Start at a set time…', onSelect: () => openSetTime(anchor, t, ev) },
        ...(t.kind === 'break' ? [] : [{ label: 'Allowed pages…', onSelect: () => allowPanel(anchor.focus ? anchor : $('#queue'), (actOfTask(t) || {}).id || null) }]),
        { sep: true },
        { label: 'Duplicate', onSelect: () => duplicateTask(t) },
        { label: 'Remove', danger: true, onSelect: () => removeWithUndo(t) },
      ],
    });
  }

  // Drag a row by its handle (or press ↑ ↓ on the handle) to change its place in the queue.
  function startRowDrag(e, li) {
    if (e.button !== 0) return;
    e.preventDefault();
    const grip = e.currentTarget;
    grip.setPointerCapture(e.pointerId);
    const rows = $$('#queue .q-task').filter((r) => r !== li);
    const y0 = e.clientY;
    const mid = (r) => {
      const b = r.getBoundingClientRect();
      return b.top + b.height / 2;
    };
    const home = mid(li);
    const mids = rows.map(mid);
    let to = rows.length ? queueTaskIds().indexOf(li.dataset.id) : 0;
    li.classList.add('dragging');
    const mark = () => {
      rows.forEach((r, i) => {
        r.classList.toggle('drop-before', i === to);
        r.classList.toggle('drop-after', to === rows.length && i === rows.length - 1);
      });
    };
    const onMove = (m) => {
      const dy = m.clientY - y0;
      li.style.transform = `translateY(${dy}px)`;
      to = mids.filter((y) => y < home + dy).length;
      mark();
    };
    const onUp = async (u) => {
      grip.removeEventListener('pointermove', onMove);
      grip.removeEventListener('pointerup', onUp);
      grip.removeEventListener('pointercancel', onUp);
      li.classList.remove('dragging');
      li.style.transform = '';
      rows.forEach((r) => r.classList.remove('drop-before', 'drop-after'));
      if (u.type === 'pointercancel' || Math.abs(u.clientY - y0) < 4) return;
      await moveRow(li.dataset.id, to);
    };
    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', onUp);
    grip.addEventListener('pointercancel', onUp);
  }

  // Writes of the inline length stepper are batched so wheel-scrolling doesn't redraw the list on every tick.
  const lengthWrites = new Map();
  function setLength(id, minutes) {
    clearTimeout(lengthWrites.get(id));
    lengthWrites.set(
      id,
      setTimeout(() => {
        lengthWrites.delete(id);
        P.updateTask(id, { estimate: minutes });
      }, 350)
    );
  }

  function queueRow(ev, nextId) {
    const t = ev.task;
    const li = el('li', 'q-row q-task');
    li.dataset.id = t.id;
    if (t.course) li.style.setProperty('--c', P.courseColor(state.settings.courses, t.course));
    li.classList.toggle('break', t.kind === 'break');
    li.classList.toggle('pinned', !!ev.pinned);
    li.classList.toggle('late', !!(t.due && t.due < today()));
    li.classList.toggle('next', t.id === nextId && !state.focus);

    const grip = el('button', 'q-grip', '⋮⋮');
    grip.type = 'button';
    grip.title = 'Drag to reorder (or press ↑ ↓)';
    grip.setAttribute('aria-label', `Reorder ${t.title}`);
    grip.addEventListener('pointerdown', (e) => startRowDrag(e, li));
    grip.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const ids = queueTaskIds();
      const i = ids.indexOf(t.id);
      const to = i + (e.key === 'ArrowUp' ? -1 : 1);
      if (to >= 0 && to < ids.length) moveRow(t.id, to);
    });
    li.append(grip, el('span', 'q-num', String(ev.n)));

    const body = el('div', 'q-body');
    const title = el('button', 'q-title', t.title);
    title.type = 'button';
    title.title = t.kind === 'break' ? 'Edit' : 'Open its page';
    title.addEventListener('click', () => openTaskName(t));
    const meta = el('div', 'q-meta');
    meta.append(el('span', 'q-time', `${P.hhmm(ev.start)}–${P.hhmm(ev.end)}`));
    if (ev.pinned) {
      const pin = el('span', 'q-pin', '📌');
      pin.title = `Starts at ${P.hhmm(ev.start)}`;
      meta.append(pin);
    }
    const chip = courseChip(t.course);
    if (chip) meta.append(chip);
    const due = dueLabel(t);
    if (due) meta.append(due);
    if (t.kind === 'break') meta.append(el('span', 'q-kind', 'break'));
    body.append(title, meta);

    const len = TCStepper.create({ value: P.taskMinutes(t, state.settings.focusMinutes), min: 5, max: 240, step: 5, unit: 'min', label: `Length of ${t.title}`, onChange: (v) => setLength(t.id, v) });
    len.el.classList.add('q-step');
    const more = el('button', 'icon-btn small q-more', '⋮');
    more.type = 'button';
    more.title = 'More';
    more.setAttribute('aria-label', `Options for ${t.title}`);
    more.setAttribute('aria-haspopup', 'menu');
    more.addEventListener('click', () => rowMenu(more, t, ev));
    li.append(body, len.el, more);
    li.addEventListener('contextmenu', (e) => {
      if (e.target.closest('input')) return;
      e.preventDefault();
      rowMenu({ x: e.clientX, y: e.clientY }, t, ev);
    });
    return li;
  }

  function classRow(ev) {
    const li = el('li', 'q-class');
    const c = state.settings.courses.find((x) => x.name.toLowerCase() === String(ev.block.label || '').toLowerCase());
    if (c) li.style.setProperty('--c', c.color);
    li.classList.toggle('free', ev.free);
    li.textContent = `${ev.block.label} · ${P.hhmm(ev.start)}–${P.hhmm(ev.end)} · ${ev.free ? 'free block' : 'class'}`;
    li.title = ev.free ? 'Free block: tasks can go here' : 'Class: the queue skips past it';
    return li;
  }

  function renderToday() {
    const events = computeLayout();
    const rows = P.queueRows({ tasks: state.tasks, focus: state.focus, sessions: [], settings: state.settings, today: today(), now: new Date(), defaultMinutes: state.settings.focusMinutes });
    const tasksAhead = rows.filter((r) => r.type === 'task');
    const list = P.todayTasks(state.tasks, today());
    const done = list.filter((t) => t.done);

    // The length steppers redraw with the list; keep focus in the one being used.
    const active = document.activeElement;
    const focusId = active && active.closest && active.closest('#queue .q-step') ? active.closest('.q-row').dataset.id : null;
    const queue = $('#queue');
    queue.textContent = '';
    const nextId = (P.nextUp(events, nowMinutes()) || { task: {} }).task.id;
    for (const r of rows) queue.append(r.type === 'class' ? classRow(r) : queueRow(r, nextId));
    if (focusId) {
      const input = $(`#queue .q-row[data-id="${CSS.escape(focusId)}"] .tc-step-val`);
      if (input) input.focus();
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
    } else foot.append(el('span', null, done.length ? 'All done for today. 🎉' : 'Nothing queued yet. Add your first block below.'));

    $('#todayMeta').textContent = list.length ? `${done.length}/${list.length} done` : '';
    const doneBox = $('#doneToday');
    doneBox.hidden = !done.length;
    doneBox.querySelector('summary').textContent = `Done today (${done.length})`;
    const dl = $('#doneList');
    dl.textContent = '';
    for (const t of done) dl.append(taskRow(t));

    // Heads-up: tests in the next 3 days, anything overdue, and a school break.
    const hu = $('#headsUp');
    hu.textContent = '';
    const b = state.settings.blocks;
    if (b.enabled && b.skip.includes(today())) hu.append(el('div', 'hu', '🏖 No school today. The rotation is paused.'));
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

  $('#schoolLink').addEventListener('click', () => openBlocksEditor());

  // ---------- the add row (under the list) ----------

  const add = { due: null, at: null, free: false, reuse: null };
  const defaultLen = () => (typeDrop.value === 'break' ? 10 : state.settings.focusMinutes);
  let lastDefault = 30;
  const lenStep = TCStepper.create({ value: 30, min: 5, max: 240, step: 5, unit: 'min', label: 'Length' });
  $('#arLen').append(lenStep.el);
  const typeDrop = TCMenu.dropdown({
    options: [{ value: 'focus', label: 'Focus' }, { value: 'break', label: 'Break' }],
    value: 'focus',
    label: 'Type',
    onChange: () => {
      // Swap between the focus and break defaults unless the length was set by hand.
      if (lenStep.value === lastDefault) lenStep.set(defaultLen(), { silent: true });
      lastDefault = defaultLen();
    },
  });
  $('#arType').append(typeDrop.el);
  const subjectDrop = TCMenu.dropdown({ options: [{ value: '', label: 'No subject' }], value: '', label: 'Subject', extra: [{ label: 'Add subject…', onSelect: () => openSettings('courses') }] });
  $('#arSubject').append(subjectDrop.el);

  function subjectOptions() {
    return [{ value: '', label: 'No subject' }, ...state.settings.courses.map((c) => ({ value: c.name, label: c.name, color: c.color }))];
  }

  function renderAddRow() {
    const cur = subjectDrop.value;
    subjectDrop.set(state.settings.courses.some((c) => c.name === cur) ? cur : '', subjectOptions());
    if (lenStep.value === lastDefault && document.activeElement !== lenStep.input) lenStep.set(defaultLen(), { silent: true });
    lastDefault = defaultLen();
    const tags = $('#arTags');
    tags.textContent = '';
    const tag = (text, clear) => {
      const b = el('button', 'ar-tag', `${text} ✕`);
      b.type = 'button';
      b.title = 'Remove';
      b.addEventListener('click', () => {
        clear();
        renderAddRow();
      });
      tags.append(b);
    };
    if (add.free) tag('Free time', () => (add.free = false));
    if (add.due) tag(`Due ${P.relDay(add.due)}`, () => (add.due = null));
    if (add.at) tag(`Starts ${P.hhmm(add.at)}`, () => (add.at = null));
    $('#arMore').firstChild.textContent = add.free || add.due || add.at ? 'More •' : 'More';
  }

  // Due date choices: today, tomorrow, the next A/B/C/D day (when the rotation is on), or a date.
  function dueChoices() {
    const out = [{ value: '', label: 'No due date' }, { value: today(), label: 'Today' }, { value: P.addDays(today(), 1), label: 'Tomorrow' }];
    const b = state.settings.blocks;
    if (b.enabled) {
      for (const L of b.letters) {
        const d = P.nextLetterDate(L, P.addDays(today(), 1), b);
        if (d) out.push({ value: d, label: `Next ${L} day · ${P.fromKey(d).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}` });
      }
    }
    return out;
  }

  function openMore() {
    const btn = $('#arMore');
    btn.setAttribute('aria-expanded', 'true');
    TCMenu.panel({
      anchor: btn,
      label: 'More options',
      onClose: () => btn.setAttribute('aria-expanded', 'false'),
      build(box) {
        box.classList.add('tc-form');
        const sec = (title) => box.append(el('div', 'tc-title', title));

        sec('Due date');
        const choices = dueChoices();
        const sel = el('select', 'tc-select');
        for (const c of choices) sel.append(new Option(c.label, c.value));
        const date = el('input', 'tc-date');
        date.type = 'date';
        date.setAttribute('aria-label', 'Pick a date');
        const matches = choices.find((c) => c.value === (add.due || ''));
        sel.value = matches ? matches.value : '';
        date.value = add.due && !matches ? add.due : '';
        sel.addEventListener('change', () => {
          add.due = sel.value || null;
          date.value = '';
          if (add.due) add.free = false;
          renderAddRow();
        });
        date.addEventListener('change', () => {
          add.due = date.value || null;
          if (add.due) add.free = false;
          sel.value = '';
          renderAddRow();
        });
        box.append(el('div', 'tc-row'));
        box.lastChild.append(sel, date);

        sec('Start at a set time');
        const row = el('div', 'tc-row');
        const stepper = TCStepper.create({ value: add.at ? P.minutesOfDay(add.at) : 16 * 60, min: 0, max: 23 * 60 + 55, step: SET_TIME_STEP, format: TCStepper.clock.format, parse: TCStepper.clock.parse, label: 'Start time (hh:mm)', onChange: () => useTime() });
        const useTime = () => {
          add.at = hm24(stepper.value);
          add.free = false;
          renderAddRow();
        };
        const setBtn = el('button', 'btn', add.at ? 'Update' : 'Set');
        setBtn.type = 'button';
        setBtn.addEventListener('click', () => {
          useTime();
          setBtn.textContent = 'Update';
        });
        row.append(stepper.el, setBtn);
        box.append(row);

        sec('Or');
        const free = el('label', 'tc-check');
        const cb = el('input');
        cb.type = 'checkbox';
        cb.checked = add.free;
        cb.addEventListener('change', () => {
          add.free = cb.checked;
          if (add.free) {
            add.due = null;
            add.at = null;
            sel.value = '';
            date.value = '';
          }
          renderAddRow();
        });
        free.append(cb, el('span', null, 'Put in Free time instead of today’s queue'));
        box.append(free);
      },
    });
  }
  $('#arMore').addEventListener('click', () => {
    if ($('#arMore').getAttribute('aria-expanded') === 'true') TCMenu.close();
    else openMore();
  });

  function newBlock(title, order) {
    const kind = typeDrop.value === 'break' ? 'break' : add.due ? 'due' : 'todo';
    return P.makeTask({
      title,
      course: subjectDrop.value || null,
      kind,
      due: add.free ? null : add.due,
      plan: add.free ? null : add.due && !add.at ? null : add.due || today(),
      at: add.free ? null : add.at,
      someday: add.free,
      estimate: lenStep.value,
      order,
    });
  }

  async function addBlocks(titles, asNext) {
    if (!titles.length) return;
    // A suggestion that is already a task (homework due later, a Free time project): put that one in the queue.
    const reuse = add.reuse && titles.length === 1 ? state.tasks.find((t) => t.id === add.reuse && !t.done) : null;
    if (reuse && P.actKey(reuse.title) === P.actKey(titles[0])) {
      const order = asNext ? P.nextOrder(state.tasks, today(), state.focus) : Date.now();
      const patch = { plan: today(), someday: false, estimate: lenStep.value, course: subjectDrop.value || reuse.course || null, at: add.at || null, order };
      $('#arName').value = ''; // cleared before the write finishes, so a quick next entry isn't wiped
      Object.assign(add, { due: null, at: null, free: false, reuse: null });
      renderAddRow();
      await P.updateTask(reuse.id, patch);
      toast(`“${reuse.title}” is in today’s queue`);
      return;
    }
    add.reuse = null;
    const first = asNext ? P.nextOrder(state.tasks, today(), state.focus) - titles.length : Date.now();
    const tasks = titles.map((title, i) => newBlock(title, first + i));
    $('#arName').value = ''; // cleared before the write finishes, so a quick next entry isn't wiped
    Object.assign(add, { due: null, at: null, free: false, reuse: null });
    renderAddRow();
    await P.addTasks(tasks);
    const later = tasks.length === 1 && tasks[0].due && tasks[0].due > P.addDays(today(), 1);
    toast(tasks.length > 1 ? `Added ${tasks.length} blocks` : later ? `Added “${tasks[0].title}” for ${P.relDay(tasks[0].due)}. Find it in Week.` : `Added “${tasks[0].title}”`, {
      action: 'Undo',
      onAction: async () => {
        const ids = new Set(tasks.map((t) => t.id));
        await P.store.update(K.tasks, [], (all) => all.filter((t) => !ids.has(t.id)));
      },
    });
  }

  function submitAdd(asNext) {
    const title = $('#arName').value.trim();
    if (!title) {
      $('#arName').focus();
      return;
    }
    return addBlocks([title], asNext);
  }
  $('#arAdd').addEventListener('click', (e) => submitAdd(e.shiftKey));
  $('#addRow').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.closest('.tc-drop, button, .tc-menu')) return;
    e.preventDefault();
    submitAdd(e.shiftKey);
  });
  // Pasting several lines adds one block per line. The text is never read for times or dates.
  $('#arName').addEventListener('paste', (e) => {
    const lines = (e.clipboardData.getData('text') || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) return;
    e.preventDefault();
    addBlocks(lines, false);
  });

  // Open the add row, optionally with a due date already set (clicking a day in Week).
  function openAddRow({ due = null } = {}) {
    setTab('today');
    if (due) {
      add.due = due;
      add.free = false;
      renderAddRow();
    }
    $('#arName').focus();
    $('#addRow').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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
      head.addEventListener('click', () => openAddRow({ due: k }));
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
    await P.addTasks([P.makeTask({ title: v, someday: true })]);
    e.target.value = '';
  });

  // ---------- journal ----------

  const KIND_ICON = { reflect: '💭', log: '✎', focus: '▶', done: '✓', pass: '🔓', eod: '🌙', nudge: '🔔', system: '·' };

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

    renderAbout();
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
    const text = el('span', 'e-text', e.text);
    const a = e.act ? actById(e.act) : null;
    if (a && !e.text.includes(a.name)) text.append(actLink(a));
    li.append(el('span', 'e-time', P.fmtTime(e.t)), el('span', 'e-kind', KIND_ICON[e.kind] || '·'), text);
    return li;
  }

  function actLink(a) {
    const b = el('button', 'e-act', a.name);
    b.type = 'button';
    b.title = 'Open its page';
    b.addEventListener('click', () => openActivity(a.id));
    return b;
  }

  // Which activity a note is about: a dropdown above the box.
  const aboutDrop = TCMenu.dropdown({ options: [{ value: '', label: 'Nothing in particular' }], value: '', label: 'About' });
  $('#logAbout').append(aboutDrop.el);
  function renderAbout() {
    const recent = new Map();
    for (const s of state.sessions) if (s.activityId) recent.set(s.activityId, Math.max(recent.get(s.activityId) || 0, s.end));
    const acts = state.activities.slice().sort((a, b) => (recent.get(b.id) || b.created || 0) - (recent.get(a.id) || a.created || 0)).slice(0, 60);
    const cur = acts.some((a) => a.id === aboutDrop.value) ? aboutDrop.value : '';
    aboutDrop.set(cur, [{ value: '', label: 'Nothing in particular' }, ...acts.map((a) => ({ value: a.id, label: a.name, color: a.course ? P.courseColor(state.settings.courses, a.course) : null }))]);
  }

  $('#logInput').addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    const v = e.target.value.trim();
    if (!v) return;
    await P.log(v, 'log', Date.now(), aboutDrop.value || null);
    e.target.value = '';
    aboutDrop.set('');
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
        await P.addTasks([P.makeTask({ title: entry.tomorrow, plan: P.addDays(k, 1), order: 0 })]);
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

  // ---------- off-switch code (in settings) ----------

  const offMsg = (text, bad = false) => {
    const m = $('#offMsg');
    m.textContent = text;
    m.classList.toggle('bad', bad);
  };

  function renderOffSettings() {
    const has = !!state.settings.offCode;
    $('#offOldWrap').hidden = !has;
    $('#offOld').value = '';
    $('#offNew').value = '';
    $('#offUse').value = '';
    $('#offSet').textContent = has ? 'Change code' : 'Set code';
    $('#offRemove').hidden = !has;
    $('#offUse').disabled = !has;
    const bs = breakUsage();
    $('#breakUsage').textContent = `${bs.used} of ${bs.budget} min used today.${has ? '' : ' Set a code to make the budget a limit.'}`;
    const box = $('#offChoices');
    box.textContent = '';
    for (const c of P.OFF_CHOICES) {
      const b = el('button', 'btn', c.label);
      b.type = 'button';
      b.disabled = !has;
      b.addEventListener('click', async () => {
        const res = await send({ type: 'plan:offswitch', code: $('#offUse').value, choice: c.id });
        if (res && res.ok) {
          await load();
          $('#offUse').value = '';
          offMsg(`Off until ${P.fmtTime(res.until)}.`);
          renderOffStatus();
        } else offMsg(res && res.error === 'wrong' ? 'That code isn’t right.' : 'Couldn’t turn it off.', true);
      });
      box.append(b);
    }
    renderOffStatus();
    offMsg('');
  }

  function renderOffStatus() {
    const on = state.offUntil > Date.now();
    const box = $('#offStatus');
    box.textContent = on ? `Gate and Onitry are off until ${P.fmtTime(state.offUntil)}. ` : state.settings.offCode ? 'Enter your code, then pick how long.' : 'Set a code first.';
    if (on) {
      const b = el('button', 'chip', 'Turn back on');
      b.type = 'button';
      b.addEventListener('click', async () => {
        await send({ type: 'plan:offswitch', choice: 'cancel' });
        await load();
        renderOffStatus();
      });
      box.append(b);
    }
  }

  $('#offSet').addEventListener('click', async () => {
    const stored = state.settings.offCode;
    const next = $('#offNew').value.trim();
    if (!P.validCode(next)) return offMsg('The code is 4 to 6 digits.', true);
    if (stored && !(await P.checkOffCode($('#offOld').value.trim(), stored))) return offMsg('The current code isn’t right.', true);
    await P.setSettings({ offCode: await P.makeOffCode(next) });
    await load();
    renderOffSettings();
    offMsg(stored ? 'Code changed.' : 'Code set.');
  });
  $('#offRemove').addEventListener('click', async () => {
    if (!(await P.checkOffCode($('#offOld').value.trim(), state.settings.offCode))) return offMsg('Enter the current code to remove it.', true);
    await P.setSettings({ offCode: null });
    await load();
    renderOffSettings();
    offMsg('Code removed.');
  });
  // Enter in a code box shouldn't save and close the whole settings dialog.
  for (const id of ['#offOld', '#offNew', '#offUse']) $(id).addEventListener('keydown', (e) => e.key === 'Enter' && e.preventDefault());

  // ---------- allowed pages (let a video or site through the gate while a block runs) ----------

  const liveFocusFor = (activityId) => (state.focus && state.focus.kind !== 'break' && (!activityId || state.focus.activityId === activityId) ? state.focus : null);

  // What is allowed for an activity: its kept list, plus anything added to the block that's running.
  function allowList(activityId) {
    const a = actById(activityId);
    const live = liveFocusFor(activityId);
    return P.mergeAllow(a ? a.allow : [], live ? live.allow : []);
  }

  async function addAllow(input, { activityId, remember }) {
    const entry = P.parseAllow(input);
    if (!entry) return 'That doesn’t look like a web address. Paste a YouTube link or a site like desmos.com.';
    const live = liveFocusFor(activityId);
    if (live) await P.store.update(K.focus, null, (f) => (f ? { ...f, allow: P.mergeAllow(f.allow, [entry]) } : f));
    if (activityId && (remember || !live)) await P.setActivityAllow(activityId, (list) => P.mergeAllow(list, [entry]));
    if (live) await P.log(`Allowed ${entry.value} for ${live.title}`, 'system', Date.now(), live.activityId);
    return null;
  }

  async function removeAllow(value, activityId) {
    const live = liveFocusFor(activityId);
    if (live) await P.store.update(K.focus, null, (f) => (f ? { ...f, allow: (f.allow || []).filter((e) => e.value !== value) } : f));
    if (activityId) await P.setActivityAllow(activityId, (list) => list.filter((e) => e.value !== value));
  }

  // The editor: a box to paste an address, and the list of what is allowed. `after` runs once something changed.
  function allowEditor(box, { activityId, after = () => {} }) {
    box.textContent = '';
    const live = liveFocusFor(activityId);
    const row = el('div', 'tc-row');
    const input = el('input', 'tc-url');
    input.type = 'text';
    input.placeholder = 'Paste a YouTube link or a site';
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.setAttribute('aria-label', 'Address to allow');
    const addBtn = el('button', 'btn', 'Allow');
    addBtn.type = 'button';
    row.append(input, addBtn);
    const err = el('div', 'tc-error');
    err.setAttribute('role', 'alert');
    let remember = null;
    if (live && activityId) {
      const lab = el('label', 'tc-check');
      remember = el('input');
      remember.type = 'checkbox';
      remember.checked = true;
      lab.append(remember, el('span', null, 'Keep it for this activity next time'));
      box.append(row, lab, err);
    } else box.append(row, err);
    const go = async () => {
      const msg = await addAllow(input.value, { activityId, remember: remember ? remember.checked : true });
      if (msg) {
        err.textContent = msg;
        return;
      }
      input.value = '';
      await load();
      after();
    };
    addBtn.addEventListener('click', go);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        go();
      }
    });
    const list = el('ul', 'tc-allow');
    for (const e of allowList(activityId)) {
      const li = el('li');
      const name = el('span', 'tc-allow-name');
      name.append(el('b', null, e.kind === 'site' ? e.value : e.label), el('span', 'tc-allow-val', e.kind === 'site' ? 'whole site' : e.value));
      const x = el('button', 'icon-btn small', '✕');
      x.type = 'button';
      x.title = 'Remove';
      x.setAttribute('aria-label', `Remove ${e.value}`);
      x.addEventListener('click', async () => {
        await removeAllow(e.value, activityId);
        await load();
        after();
      });
      li.append(name, x);
      list.append(li);
    }
    if (!list.children.length) list.append(el('li', 'empty', 'Nothing allowed yet.'));
    box.append(list);
    const wide = allowList(activityId).filter((e) => e.kind === 'site' && state.settings.sites.some((g) => e.value === g || e.value.endsWith(`.${g}`)));
    if (wide.length) box.append(el('div', 'tc-note warn', `${wide.map((e) => e.value).join(', ')} is a gated site: allowing all of it opens every page on it. A single video link is safer.`));
    return input;
  }

  function allowPanel(anchor, activityId) {
    const a = actById(activityId);
    TCMenu.panel({
      anchor,
      align: 'end',
      label: 'Allowed pages',
      build(box) {
        box.classList.add('tc-form');
        box.append(el('div', 'tc-title', a ? `Allowed pages · ${a.name}` : 'Allowed pages'));
        box.append(el('div', 'tc-note', 'These get through the gate while this block runs. Everything else stays gated.'));
        const holder = el('div', 'tc-allow-box');
        box.append(holder);
        const draw = () => allowEditor(holder, { activityId, after: draw });
        const input = draw();
        queueMicrotask(() => input.focus());
      },
    });
  }

  // ---------- Inkwell link ----------

  const inkwellId = () => state.settings.inkwell.id;

  const clearPending = () => P.store.update(K.meta, {}, (m) => ({ ...m, inkwellPending: null }));
  async function connectInkwell() {
    const p = state.inkwellPending;
    if (!p) return;
    await P.setSettings({ inkwell: { id: p.id } });
    await clearPending();
    toast('Connected to Inkwell');
  }
  async function ignoreInkwell() {
    const p = state.inkwellPending;
    if (!p) return;
    await P.store.update(K.meta, {}, (m) => ({ ...m, inkwellPending: null, inkwellIgnored: [...(m.inkwellIgnored || []), p.id] }));
  }
  async function disconnectInkwell() {
    await P.setSettings({ inkwell: { id: null } });
    await P.store.update(K.meta, {}, (m) => ({ ...m, inkwellIgnored: [] }));
  }

  function renderInkwell() {
    const asking = !!state.inkwellPending && state.inkwellPending.id !== inkwellId();
    const bar = $('#connectBar');
    if (!asking) {
      bar.hidden = true;
      bar.textContent = '';
    } else if (bar.hidden) {
      bar.hidden = false;
      bar.textContent = '';
      bar.append(el('span', null, 'Inkwell, your notes extension, wants to connect to Timecheck. Connect to Inkwell?'));
      const yes = el('button', 'btn primary', 'Connect');
      yes.type = 'button';
      yes.addEventListener('click', connectInkwell);
      const no = el('button', 'btn ghost', 'Not now');
      no.type = 'button';
      no.addEventListener('click', ignoreInkwell);
      bar.append(yes, no);
    }
    // ⚙ → Inkwell
    const help = $('#inkHelp');
    const btns = $('#inkBtns');
    btns.textContent = '';
    if (inkwellId()) {
      help.textContent = 'Connected to Inkwell. Activity pages get Open in Inkwell, reflections are added to the activity’s note, and Inkwell can add blocks to your queue. Only that extension is answered.';
      const b = el('button', 'btn', 'Disconnect');
      b.type = 'button';
      b.addEventListener('click', disconnectInkwell);
      btns.append(b);
    } else if (asking) {
      help.textContent = 'Inkwell wants to connect. Connect to Inkwell? Only the extension you approve can talk to Timecheck.';
      const yes = el('button', 'btn primary', 'Connect');
      yes.type = 'button';
      yes.addEventListener('click', connectInkwell);
      const no = el('button', 'btn', 'Not now');
      no.type = 'button';
      no.addEventListener('click', ignoreInkwell);
      btns.append(yes, no);
    } else help.textContent = 'Not connected. If Inkwell is installed, open it (or reload it) and it will ask to connect.';
    $('#actInk').hidden = !inkwellId();
  }

  // A reflection also goes to the bottom of the activity's Inkwell note.
  async function sendToInkwell(activityId, { text, minutes, onPct, at = Date.now() }) {
    const a = actById(activityId);
    if (!a || !inkwellId()) return;
    const day = P.fromKey(P.dateKey(new Date(at))).toLocaleDateString([], { month: 'short', day: 'numeric' });
    const heading = [day, minutes ? `${minutes} min` : null, onPct != null ? `${onPct}% on task` : null].filter(Boolean).join(' · ');
    await InkwellLink.append(inkwellId(), a, { heading, text });
  }

  $('#actInkBtn').addEventListener('click', async () => {
    const a = actById(openActId);
    if (!a) return;
    const res = await InkwellLink.open(inkwellId(), a);
    if (!res || !res.ok) toast('Inkwell isn’t answering. Is it installed and enabled?');
  });

  // ---------- activity page ----------

  let openActId = null;

  function openActivity(id) {
    if (!actById(id)) return;
    openActId = id;
    renderActivity();
    $('#activityDialog').showModal();
  }

  function renderActivity() {
    const a = actById(openActId);
    if (!a) return;
    const st = P.activityStats(a, state.sessions);
    $('#actName').textContent = a.name;
    const cc = $('#actCourse');
    cc.textContent = '';
    const chip = courseChip(a.course);
    if (chip) cc.append(chip);
    const stats = $('#actStats');
    stats.textContent = '';
    const cell = (n, label) => {
      const c = el('div', 'stat');
      c.append(el('b', null, n), el('span', null, label));
      return c;
    };
    stats.append(cell(P.fmtMinutes(st.week), 'this week'), cell(P.fmtMinutes(st.total), 'all time'), cell(String(st.blocks), st.blocks === 1 ? 'block' : 'blocks'));
    if (st.onPct != null) stats.append(cell(`${st.onPct}%`, 'on task (Onitry)'));
    if (st.usual) stats.append(cell(P.fmtMinutes(st.usual), 'usual length'));
    if (st.last) stats.append(cell(P.ago(st.last), 'last done'));

    // Reflections plus the Log notes written about it, newest first.
    const notes = (a.reflections || []).map((r) => ({ at: r.at, text: r.text, meta: [r.minutes ? P.fmtMinutes(r.minutes) : null, r.onPct != null ? `${r.onPct}% on task` : null].filter(Boolean).join(' · ') }));
    for (const day of Object.values(state.journal)) for (const e of day) if (e.act === a.id && e.kind === 'log') notes.push({ at: e.t, text: e.text, meta: 'note' });
    notes.sort((x, y) => y.at - x.at);
    const nl = $('#actNotes');
    nl.textContent = '';
    for (const n of notes) {
      const li = el('li', 'act-note');
      li.append(el('div', 'act-text', n.text));
      const day = P.relDay(P.dateKey(new Date(n.at)));
      li.append(el('div', 'act-meta', [day, P.fmtTime(n.at), n.meta].filter(Boolean).join(' · ')));
      nl.append(li);
    }
    if (!notes.length) nl.append(el('li', 'empty', 'Nothing written yet. A line after each block builds up here.'));

    allowEditor($('#actAllow'), { activityId: a.id, after: renderActivity });
    const sl = $('#actSessions');
    sl.textContent = '';
    for (const x of st.recent) {
      const li = el('li', 'act-sess');
      const outcome = { done: 'done', timeup: 'time up', stopped: 'stopped', switched: 'switched', skipped: 'skipped' }[x.outcome] || x.outcome;
      li.append(el('span', 'act-when', `${P.relDay(P.dateKey(new Date(x.end)))} ${P.fmtTime(x.end)}`), el('b', null, P.fmtMinutes(x.minutes)), el('span', 'act-meta', [outcome, x.onitry && x.onitry.onPct != null ? `${x.onitry.onPct}% on task` : null].filter(Boolean).join(' · ')));
      sl.append(li);
    }
    if (!st.recent.length) sl.append(el('li', 'empty', 'No finished blocks yet.'));
  }

  $('#actClose').addEventListener('click', () => $('#activityDialog').close());
  $('#activityDialog').addEventListener('close', () => (openActId = null));
  $('#actNote').addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    const text = e.target.value.trim();
    if (!text || !openActId) return;
    await P.addReflection(openActId, { text });
    sendToInkwell(openActId, { text });
    e.target.value = '';
    await load();
    renderActivity();
  });

  // ---------- "How did it go?" after a block ----------

  function renderReflect() {
    const bar = $('#reflectBar');
    const r = state.reflection;
    if (!r) {
      bar.hidden = true;
      bar.textContent = '';
      bar.dataset.sid = '';
      return;
    }
    if (bar.dataset.sid === r.sessionId && !bar.hidden) return; // keep what's being typed
    bar.dataset.sid = r.sessionId;
    bar.hidden = false;
    bar.textContent = '';
    const act = actById(r.activityId);
    const q = el('div', 'rf-q');
    q.append('How did ', el('b', null, act ? act.name : r.title), ' go?');
    const detail = [r.minutes ? P.fmtMinutes(r.minutes) : null, r.onPct != null ? `${r.onPct}% on task` : null].filter(Boolean).join(' · ');
    if (detail) q.append(el('span', 'rf-meta', ` ${detail}`));
    const input = el('input', 'rf-input');
    input.placeholder = 'One line. Enter to save.';
    input.maxLength = 500;
    input.setAttribute('aria-label', 'How did it go?');
    const clear = () => P.store.update(K.meta, {}, (m) => ({ ...m, pendingReflection: null }));
    const save = el('button', 'btn primary', 'Save');
    save.type = 'button';
    const skip = el('button', 'btn ghost', 'Skip');
    skip.type = 'button';
    const doSave = async () => {
      const text = input.value.trim();
      if (!text) return input.focus();
      await P.addReflection(r.activityId, { text, minutes: r.minutes, onPct: r.onPct, sessionId: r.sessionId });
      sendToInkwell(r.activityId, { text, minutes: r.minutes, onPct: r.onPct });
      await clear();
    };
    save.addEventListener('click', doSave);
    skip.addEventListener('click', clear);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doSave();
      } else if (e.key === 'Escape') clear();
    });
    const row = el('div', 'rf-row');
    row.append(input, save, skip);
    bar.append(q, row);
  }

  // ---------- add row: suggestions as you type ----------

  let suggestions = [];
  let suggIndex = -1;
  const suggBox = $('#arSugg');

  function closeSuggestions() {
    suggestions = [];
    suggIndex = -1;
    suggBox.hidden = true;
    suggBox.textContent = '';
  }

  function updateSuggestions() {
    const q = $('#arName').value;
    suggestions = P.suggest(q, state.activities, state.sessions, state.tasks);
    suggIndex = -1;
    suggBox.textContent = '';
    suggBox.hidden = !suggestions.length;
    suggestions.forEach((r, i) => {
      const li = el('li', 'sg');
      li.setAttribute('role', 'option');
      li.dataset.i = String(i);
      const dot = el('i', 'tc-dot');
      dot.style.background = r.activity.course ? P.courseColor(state.settings.courses, r.activity.course) : 'var(--muted)';
      const body = el('div', 'sg-body');
      const top = el('div', 'sg-top');
      top.append(el('b', 'sg-name', r.activity.name));
      if (r.tag) top.append(el('span', 'sg-tag', r.tag));
      const bits = [r.stats.usual ? P.fmtMinutes(r.stats.usual) : null, r.stats.last ? `last ${P.ago(r.stats.last)}` : null, r.stats.total ? `${P.fmtMinutes(r.stats.total)} total` : null].filter(Boolean);
      body.append(top);
      if (bits.length) body.append(el('div', 'sg-meta', bits.join(' · ')));
      li.append(dot, body);
      li.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the name field
      li.addEventListener('click', () => pickSuggestion(i));
      suggBox.append(li);
    });
  }

  function markSuggestion() {
    $$('#arSugg .sg').forEach((li, i) => {
      li.classList.toggle('on', i === suggIndex);
      li.setAttribute('aria-selected', String(i === suggIndex));
    });
  }

  // Picking fills the name, subject and usual length; Add then puts it in the queue.
  function pickSuggestion(i) {
    const r = suggestions[i];
    if (!r) return;
    $('#arName').value = r.activity.name;
    subjectDrop.set(state.settings.courses.some((c) => c.name === r.activity.course) ? r.activity.course : '', subjectOptions());
    lenStep.set(r.stats.usual || (r.task && r.task.estimate) || defaultLen(), { silent: true });
    add.reuse = r.task && !P.queueIds(state.tasks, today(), state.focus).includes(r.task.id) ? r.task.id : null;
    closeSuggestions();
    $('#arName').focus();
  }

  $('#arName').addEventListener('input', updateSuggestions);
  $('#arName').addEventListener('blur', () => setTimeout(closeSuggestions, 120));
  $('#arName').addEventListener('keydown', (e) => {
    if (!suggestions.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      suggIndex = (suggIndex + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length + 1) % (suggestions.length + 1);
      if (suggIndex === suggestions.length) suggIndex = -1;
      markSuggestion();
    } else if (e.key === 'Enter' && suggIndex >= 0) {
      e.preventDefault();
      e.stopPropagation();
      pickSuggestion(suggIndex);
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      closeSuggestions();
    }
  }, true);

  // ---------- settings ----------

  function openSettings(focus) {
    const s = state.settings;
    const f = $('#settingsForm');
    f.guardMode.value = s.guardMode;
    f.sites.value = s.sites.join('\n');
    f.passMinutes.value = s.passMinutes;
    for (const k of ['workStart', 'workEnd', 'weekendStart', 'weekendEnd', 'planTime', 'eodTime']) f[k].value = s[k];
    f.checkinMinutes.value = s.checkinMinutes;
    f.focusMinutes.value = s.focusMinutes;
    f.autoAdvance.checked = s.autoAdvance;
    f.breakBudget.value = s.breakBudget;
    f.reflect.value = s.reflect;
    renderOffSettings();
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
    if (focus === 'courses') f.courses.focus();
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

  // ---------- backup & restore ----------

  $('#exportBtn').addEventListener('click', async () => {
    const all = await chrome.storage.local.get(null);
    const backup = P.makeBackup(all, { version: chrome.runtime.getManifest().version });
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 1)], { type: 'application/json' }));
    const a = el('a');
    a.href = url;
    a.download = `timecheck-backup-${today()}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast(`Exported ${(backup.data['pl:tasks'] || []).length} tasks and ${Object.keys(backup.data['pl:journal'] || {}).length} days of log`);
  });

  $('#importBtn').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const res = P.parseBackup(await file.text());
    if (!res.ok) return toast(res.error);
    const c = res.counts;
    const when = c.exported ? ` from ${new Date(c.exported).toLocaleString()}` : '';
    if (!confirm(`Restore this backup${when}?\n\n${c.tasks} tasks, ${c.sessions} focus sessions, ${c.days} days of log.\n\nThis replaces everything currently in Timecheck.`)) return;
    const out = await P.restoreBackup(res.data);
    $('#settingsDialog').close('cancel');
    await load();
    render();
    toast(`Restored ${out.restored} items`);
  });

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
      breakBudget: Math.max(0, Math.min(240, Number(f.breakBudget.value) || 0)),
      reflect: f.reflect.value,
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
    await P.syncActivities();
    await load();
    applyTheme();
    setTab(/eod|journal|log|review/.test(location.hash) ? 'journal' : 'today');
    P.store.update(K.meta, {}, (m) => (m.plannerOpened ? m : { ...m, plannerOpened: Date.now() }));
    // Links from the guide: today.html#blocks, #settings
    if (location.hash === '#blocks') openBlocksEditor();
    else if (location.hash === '#settings') openSettings();
    render();
    if (VIEW === 'tab' && !state.focus) $('#arName').focus();
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
