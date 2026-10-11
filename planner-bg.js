// Planner side of the service worker: focus blocks, the distraction gate
// (declarativeNetRequest redirect to guard.html), nudges, notifications, the
// toolbar badge, and syncing with the Onitry desktop app.
// Loaded from background.js via importScripts (after lib/planner.js + lib/onitry.js).
(() => {
  'use strict';

  const P = InkPlan;
  const K = P.K;
  const GUARD_RULE_BASE = 1001; // one redirect rule per gated site: ids 1001, 1002, …
  const TICK = 'plan-tick';
  const FOCUS_END = 'plan-focus-end';
  const PASS_EXPIRE = 'plan-pass-expire';
  const TODAY_URL = () => chrome.runtime.getURL('today.html');
  let lastGuardKey = null;
  let lastOnitryStatus = null;

  const PlanBg = { focusActive: false };
  globalThis.PlanBg = PlanBg;

  // ---------- lifecycle ----------

  async function boot() {
    await P.ensureSeeded();
    chrome.alarms.create(TICK, { periodInMinutes: 1 });
    const focus = await P.store.get(K.focus, null);
    PlanBg.focusActive = !!focus;
    if (focus) chrome.alarms.create(FOCUS_END, { when: Math.max(Date.now() + 1000, focus.endsAt) });
    await syncGuard(true);
    await updateFocusBadge();
  }
  chrome.runtime.onInstalled.addListener(() => boot());
  chrome.runtime.onStartup.addListener(() => boot());
  boot();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[K.tasks] || changes[K.focus] || changes[K.settings] || changes[K.passes]) syncGuard();
  });

  // ---------- focus blocks ----------

  async function taskDetails(taskId, title) {
    const tasks = await P.store.get(K.tasks, []);
    const t = tasks.find((x) => x.id === taskId);
    const parts = [];
    if (t && t.due) parts.push(`${t.kind === 'test' ? 'test' : 'due'} ${P.relDay(t.due).toLowerCase()}`);
    if (t && t.course) parts.push(`subject: ${t.course}`);
    const others = P.urgentTasks(tasks).filter((x) => x.id !== taskId).slice(0, 4).map((x) => x.title);
    if (others.length) parts.push(`also on today's list: ${others.join('; ')}`);
    parts.push(`planned as a ${title ? 'focus block' : 'session'} in the browser planner`);
    return parts.join('. ');
  }

  async function focusStart({ taskId = null, title, course = null, minutes = 40 }) {
    const existing = await P.store.get(K.focus, null);
    if (existing) await focusStop('switched', { quiet: true });
    const settings = await P.getSettings();
    const now = Date.now();
    const focus = {
      id: P.newId(),
      taskId,
      title: String(title || 'Focus').slice(0, 200),
      course,
      startedAt: now,
      endsAt: now + minutes * 60000,
      minutes,
      onitry: false,
      onitryError: null,
    };
    if (settings.onitry.enabled && settings.onitry.autoStart) {
      const res = await OnitryBridge.startTask(settings.onitry, focus.title, await taskDetails(taskId, focus.title));
      focus.onitry = !!res.ok;
      focus.onitryError = res.ok ? null : res.error;
    }
    await P.store.set(K.focus, focus);
    PlanBg.focusActive = true;
    chrome.alarms.create(FOCUS_END, { when: focus.endsAt });
    await P.log(`Started ${P.fmtMinutes(minutes)} focus: ${focus.title}${focus.onitry ? ' (Onitry watching)' : ''}`, 'focus');
    if (taskId) await P.updateTask(taskId, { plan: P.dateKey() });
    await syncGuard(true);
    await updateFocusBadge();
    return { ok: true, focus, onitryError: focus.onitryError };
  }

  async function focusStop(outcome = 'stopped', { quiet = false } = {}) {
    const focus = await P.store.get(K.focus, null);
    if (!focus) return { ok: false };
    const settings = await P.getSettings();
    const now = Date.now();
    const minutes = Math.max(1, Math.round((now - focus.startedAt) / 60000));
    let onitry = null;
    if (focus.onitry) {
      const st = await OnitryBridge.status(settings.onitry);
      if (st.ok) {
        const total = (st.on_task_seconds || 0) + (st.off_task_seconds || 0);
        onitry = { onPct: total ? Math.round((st.on_task_seconds / total) * 100) : null, interrupts: st.interrupts || 0 };
      }
      if (settings.onitry.autoStop && outcome !== 'switched') await OnitryBridge.stop(settings.onitry);
    }
    const session = { id: focus.id, taskId: focus.taskId, title: focus.title, course: focus.course, start: focus.startedAt, end: now, minutes, planned: focus.minutes, outcome, onitry };
    await P.store.update(K.sessions, [], (all) => all.concat([session]).slice(-3000));
    if (outcome === 'done' && focus.taskId) await P.updateTask(focus.taskId, { done: now });
    await P.store.set(K.focus, null);
    PlanBg.focusActive = false;
    chrome.alarms.clear(FOCUS_END);
    chrome.notifications.clear('focus-end');
    if (!quiet) {
      const verb = outcome === 'done' ? '✓ Finished' : outcome === 'timeup' ? 'Time up on' : 'Stopped';
      const extra = onitry && onitry.onPct != null ? ` · Onitry: ${onitry.onPct}% on task` : '';
      await P.log(`${verb} ${focus.title} after ${P.fmtMinutes(minutes)}${extra}`, outcome === 'done' ? 'done' : 'focus');
    }
    await syncGuard(true);
    await updateFocusBadge();
    return { ok: true, session };
  }

  async function focusExtend(minutes = 10) {
    const focus = await P.store.get(K.focus, null);
    if (!focus) return { ok: false };
    focus.endsAt = Math.max(focus.endsAt, Date.now()) + minutes * 60000;
    await P.store.set(K.focus, focus);
    chrome.alarms.create(FOCUS_END, { when: focus.endsAt });
    chrome.notifications.clear('focus-end');
    await updateFocusBadge();
    return { ok: true, focus };
  }

  // ---------- badge ----------

  async function updateFocusBadge() {
    const focus = await P.store.get(K.focus, null);
    if (!focus) {
      await chrome.action.setBadgeText({ text: '' }).catch(() => {});
      await chrome.action.setTitle({ title: 'Open Inkwell' }).catch(() => {});
      return;
    }
    const left = Math.round((focus.endsAt - Date.now()) / 60000);
    const offTask = lastOnitryStatus && lastOnitryStatus.running && lastOnitryStatus.status === 'off_task';
    const text = offTask ? '!' : left >= 0 ? `${left}m` : `+${-left}`;
    const color = offTask ? '#d9363e' : left >= 0 ? '#2ea043' : '#e8590c';
    // Global badge, and also on the active tab so per-tab note counts don't hide it.
    await chrome.action.setBadgeBackgroundColor({ color }).catch(() => {});
    await chrome.action.setBadgeText({ text }).catch(() => {});
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
    if (tab) {
      await chrome.action.setBadgeBackgroundColor({ color, tabId: tab.id }).catch(() => {});
      await chrome.action.setBadgeText({ text, tabId: tab.id }).catch(() => {});
    }
    await chrome.action.setTitle({ title: `Focusing: ${focus.title}` }).catch(() => {});
  }

  // ---------- distraction gate ----------

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  async function activePasses() {
    const passes = await P.store.get(K.passes, {});
    const now = Date.now();
    const live = {};
    for (const [site, until] of Object.entries(passes)) if (until > now) live[site] = until;
    if (Object.keys(live).length !== Object.keys(passes).length) await P.store.set(K.passes, live);
    return live;
  }

  async function syncGuard(force = false) {
    const [settings, focus, tasks] = await Promise.all([P.getSettings(), P.store.get(K.focus, null), P.store.get(K.tasks, [])]);
    const passes = await activePasses();
    const gs = P.guardState(settings, focus, tasks);
    const sites = gs.active ? settings.sites.filter((s) => !passes[s]) : [];
    const key = JSON.stringify(sites);

    const nextExpiry = Math.min(...Object.values(passes), Infinity);
    if (Number.isFinite(nextExpiry)) chrome.alarms.create(PASS_EXPIRE, { when: nextExpiry + 500 });
    else chrome.alarms.clear(PASS_EXPIRE);

    if (!force && key === lastGuardKey) return gs;
    const turnedOn = sites.filter((s) => !(lastGuardKey ? JSON.parse(lastGuardKey) : []).includes(s));
    lastGuardKey = key;

    // One small regex per site: a single alternation of every site blows RE2's memory limit.
    const addRules = sites.map((site, i) => ({
      id: GUARD_RULE_BASE + i,
      priority: 1,
      action: { type: 'redirect', redirect: { regexSubstitution: `${chrome.runtime.getURL('guard.html')}#\\0` } },
      condition: { regexFilter: `^https?://([^/]*\\.)?${escapeRe(site)}([:/?#].*)?$`, resourceTypes: ['main_frame'] },
    }));
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    try {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: existing.filter((r) => r.id >= GUARD_RULE_BASE && r.id < GUARD_RULE_BASE + 1000).map((r) => r.id),
        addRules,
      });
    } catch (err) {
      console.error('Inkwell gate rules failed', err);
      await P.store.update(K.meta, {}, (m) => ({ ...m, guardError: String(err && err.message) }));
    }
    // Sites that just became gated: send already-open tabs to the gate too.
    if (turnedOn.length) await gateOpenTabs(turnedOn);
    return gs;
  }

  async function gateOpenTabs(sites) {
    const patterns = sites.map((s) => `*://*.${s}/*`);
    const tabs = await chrome.tabs.query({ url: patterns }).catch(() => []);
    for (const tab of tabs) {
      if (tab.url && !tab.url.startsWith(chrome.runtime.getURL(''))) {
        chrome.tabs.update(tab.id, { url: `${chrome.runtime.getURL('guard.html')}#${tab.url}` }).catch(() => {});
      }
    }
  }

  async function grantPass({ site, minutes, reason, url }) {
    const settings = await P.getSettings();
    if (!settings.sites.includes(site)) return { ok: false, error: 'not a gated site' };
    const focus = await P.store.get(K.focus, null);
    const max = focus ? 5 : 60;
    const mins = Math.max(1, Math.min(max, Number(minutes) || settings.passMinutes));
    const until = Date.now() + mins * 60000;
    await P.store.update(K.passes, {}, (p) => ({ ...p, [site]: until }));
    await P.log(`${site} for ${mins}m — “${String(reason || '').slice(0, 200)}”${focus ? ` (during focus on ${focus.title})` : ''}`, 'pass');
    await syncGuard(true);
    return { ok: true, until, url };
  }

  // ---------- nudges ----------

  async function notify(id, title, message, buttons = [], requireInteraction = false) {
    try {
      await chrome.notifications.create(id, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
        title,
        message,
        buttons: buttons.map((b) => ({ title: b })),
        requireInteraction,
        priority: 2,
      });
    } catch (err) {
      console.warn('notification failed', err);
    }
  }

  async function userActive() {
    try {
      return (await chrome.idle.queryState(120)) === 'active';
    } catch (_) {
      return true;
    }
  }

  async function tick() {
    const [settings, focus, tasks, eod, meta] = await Promise.all([
      P.getSettings(),
      P.store.get(K.focus, null),
      P.store.get(K.tasks, []),
      P.store.get(K.eod, {}),
      P.store.get(K.meta, {}),
    ]);
    const now = new Date();
    const today = P.dateKey(now);
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const m = { ...meta };
    let changed = false;

    // Onitry status (also refreshed every few seconds by any open Today page).
    if (settings.onitry.enabled) {
      lastOnitryStatus = { ...(await OnitryBridge.status(settings.onitry)), at: Date.now() };
      await P.store.set(K.onitry, lastOnitryStatus);
      // Started monitoring from the Onitry window while no browser focus block runs → mirror it.
      if (!focus && lastOnitryStatus.ok && lastOnitryStatus.running && lastOnitryStatus.task && m.lastMirroredTask !== lastOnitryStatus.task) {
        m.lastMirroredTask = lastOnitryStatus.task;
        changed = true;
        await P.log(`Onitry started monitoring: ${lastOnitryStatus.task}`, 'focus');
      }
    }

    await syncGuard();
    await updateFocusBadge();

    const working = P.inWorkHours(settings, now);
    const onitryBusy = lastOnitryStatus && lastOnitryStatus.running;
    const open = P.todayTasks(tasks, today).filter((t) => !t.done);

    // 1) Idle check-in: work hours, nothing running, you're at the computer.
    if (settings.checkinMinutes > 0 && working && !focus && !onitryBusy && Date.now() - (m.lastNudge || 0) >= settings.checkinMinutes * 60000 && (await userActive())) {
      m.lastNudge = Date.now();
      changed = true;
      const next = open[0];
      await notify(
        'checkin',
        'No focus block running',
        next ? `What are you doing right now? Next up: ${next.title}` : 'What are you doing right now? Nothing is planned — open Today and add something.',
        next ? [`▶ Start ${next.title}`.slice(0, 40), 'Snooze 30 min'] : ['Open Today', 'Snooze 30 min']
      );
      m.nudgeTaskId = next ? next.id : null;
    }

    // 2) Plan prompt: nothing on today's list by plan time.
    const planMin = P.minutesOfDay(settings.planTime);
    if (nowMin >= planMin && nowMin < planMin + 180 && m.planPrompted !== today && !open.length && working) {
      m.planPrompted = today;
      changed = true;
      await notify('plan', 'Plan your afternoon', 'Today’s list is empty. Dump everything due and what you’ll do first — it takes 2 minutes.', ['Open Today']);
    }

    // 3) EOD check-in.
    const eodMin = P.minutesOfDay(settings.eodTime);
    if (nowMin >= eodMin && m.eodPrompted !== today && !eod[today]) {
      m.eodPrompted = today;
      changed = true;
      await notify('eod', 'End-of-day check-in', 'How did today go? 1 minute: rate it, name what got in the way, set tomorrow’s first task.', ['Check in'], true);
    }

    // 4) Tests tomorrow (evening before).
    if (nowMin >= 18 * 60) {
      const tomorrow = P.addDays(today, 1);
      const reminded = m.testReminded || {};
      for (const t of tasks.filter((x) => !x.done && x.kind === 'test' && x.due === tomorrow && !reminded[x.id])) {
        reminded[t.id] = Date.now();
        changed = true;
        await notify(`test-${t.id}`, `${t.title} — tomorrow`, 'Have you studied? Start a 25-minute review block now.', ['▶ Study 25 min']);
      }
      m.testReminded = reminded;
    }

    if (changed) await P.store.set(K.meta, m);
  }

  // Handy for debugging from the service-worker console.
  Object.assign(PlanBg, { tick, syncGuard, focusStart, focusStop });

  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === TICK) tick();
    else if (alarm.name === PASS_EXPIRE) {
      const before = await P.store.get(K.passes, {});
      await syncGuard(true);
      const after = await activePasses();
      const expired = Object.keys(before).filter((s) => !after[s]);
      const settings = await P.getSettings();
      const gs = P.guardState(settings, await P.store.get(K.focus, null), await P.store.get(K.tasks, []));
      if (expired.length && gs.active) await gateOpenTabs(expired);
    } else if (alarm.name === FOCUS_END) {
      const focus = await P.store.get(K.focus, null);
      if (!focus) return;
      await notify('focus-end', `Time’s up: ${focus.title}`, `${P.fmtMinutes(focus.minutes)} block finished. Done, or need more time?`, ['✓ Done', '+10 min'], true);
      await updateFocusBadge();
    }
  });

  // ---------- notification actions ----------

  async function openToday(hash = '') {
    await chrome.tabs.create({ url: TODAY_URL() + hash });
  }

  chrome.notifications.onClicked.addListener((id) => {
    chrome.notifications.clear(id);
    openToday(id === 'eod' ? '#eod' : '');
  });

  chrome.notifications.onButtonClicked.addListener(async (id, index) => {
    chrome.notifications.clear(id);
    const settings = await P.getSettings();
    if (id === 'focus-end') {
      if (index === 0) await focusStop('done');
      else await focusExtend(10);
    } else if (id === 'checkin') {
      const meta = await P.store.get(K.meta, {});
      const tasks = await P.store.get(K.tasks, []);
      const t = tasks.find((x) => x.id === meta.nudgeTaskId);
      if (index === 0 && t) await focusStart({ taskId: t.id, title: t.title, course: t.course, minutes: t.estimate || settings.focusMinutes });
      else if (index === 0) await openToday();
      else await P.store.set(K.meta, { ...meta, lastNudge: Date.now() }); // snooze = reset the timer
    } else if (id === 'plan') await openToday();
    else if (id === 'eod') await openToday('#eod');
    else if (id.startsWith('test-')) {
      const tasks = await P.store.get(K.tasks, []);
      const t = tasks.find((x) => `test-${x.id}` === id);
      if (t) await focusStart({ taskId: t.id, title: `Study: ${t.title}`, course: t.course, minutes: 25 });
    }
  });

  // ---------- messages from pages ----------

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('plan:')) return false;
    let job;
    if (msg.type === 'plan:focus') {
      if (msg.action === 'start') job = focusStart(msg);
      else if (msg.action === 'stop') job = focusStop(msg.outcome || 'stopped');
      else if (msg.action === 'extend') job = focusExtend(msg.minutes);
    } else if (msg.type === 'plan:pass') job = grantPass(msg);
    else if (msg.type === 'plan:guard-state') job = syncGuard(true);
    if (!job) return false;
    job.then(sendResponse, (err) => sendResponse({ ok: false, error: err.message }));
    return true;
  });
})();
