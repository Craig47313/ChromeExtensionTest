// Timecheck's service worker logic: focus blocks, the distraction gate
// (declarativeNetRequest redirect to guard.html), nudges, notifications, the
// toolbar badge, where the planner opens, and syncing with the Onitry desktop
// app (status, off-task escalation, launching it, the weekly AI review).
// Loaded from background.js via importScripts (after lib/planner.js + lib/onitry.js).
(() => {
  'use strict';

  const P = InkPlan;
  const K = P.K;
  const GUARD_RULE_BASE = 1001; // one redirect rule per gated site: ids 1001, 1002, …
  const ALLOW_RULE_BASE = 1501; // one allow rule per page you allowed for the running block
  const TICK = 'plan-tick';
  const FOCUS_END = 'plan-focus-end';
  const PASS_EXPIRE = 'plan-pass-expire';
  const OFF_END = 'plan-off-end'; // the off switch runs out
  const ONITRY_POLL = 'plan-onitry'; // every 30s during a watched focus block
  const BADGE = 'plan-badge'; // re-draws the badge when its minute count changes
  const RING_AGAIN = 'plan-ring-again';
  const TIMEUP_CLOSE = 'plan-timeup-close';
  const TIMEUP_RING_MS = 2 * 60000; // ring again if nobody answered
  const TIMEUP_CLOSE_MS = 10 * 60000; // then end the block on its own
  const ESCALATE_MINUTES = 10;
  const TODAY_URL = () => chrome.runtime.getURL('today.html');
  let lastGuardKey = null;
  let lastOnitryStatus = null;

  const PlanBg = { focusActive: false };
  globalThis.PlanBg = PlanBg;

  // ---------- lifecycle ----------

  async function boot() {
    await P.ensureSeeded();
    await P.syncActivities();
    chrome.alarms.create(TICK, { periodInMinutes: 1 });
    const focus = await P.store.get(K.focus, null);
    PlanBg.focusActive = !!focus;
    if (focus) chrome.alarms.create(FOCUS_END, { when: Math.max(Date.now() + 1000, focus.endsAt) });
    const meta = await P.store.get(K.meta, {});
    if ((meta.offUntil || 0) > Date.now()) chrome.alarms.create(OFF_END, { when: meta.offUntil + 500 });
    await applyPlacement();
    await updateOnitryPoll();
    await syncGuard(true);
    await updateFocusBadge();
  }
  chrome.runtime.onInstalled.addListener(({ reason }) => {
    boot();
    if (reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('docs.html#tutorial') });
  });
  chrome.runtime.onStartup.addListener(() => boot());
  boot();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[K.tasks] || changes[K.focus] || changes[K.settings] || changes[K.passes] || changes[K.meta]) syncGuard();
    if (changes[K.settings]) {
      const before = (changes[K.settings].oldValue || {}).placement;
      const after = (changes[K.settings].newValue || {}).placement;
      if (before !== after) applyPlacement();
    }
    if (changes[K.focus] || changes[K.settings]) updateOnitryPoll();
  });

  // ---------- where the planner lives: side panel, its own tab, or every new tab ----------

  async function applyPlacement() {
    const { placement } = await P.getSettings();
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: placement === 'panel' }).catch(() => {});
  }

  // Focus the planner tab if one is open, otherwise open one (pinned in "tab" mode).
  async function openPlannerTab(hash = '') {
    const { placement } = await P.getSettings();
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['TAB'] }).catch(() => []);
    const open = contexts.find((c) => c.tabId >= 0 && c.documentUrl && c.documentUrl.startsWith(TODAY_URL()) && !c.documentUrl.includes('view=panel'));
    if (open) {
      await chrome.tabs.update(open.tabId, { active: true, ...(hash ? { url: TODAY_URL() + hash } : {}) }).catch(() => {});
      if (open.windowId >= 0) await chrome.windows.update(open.windowId, { focused: true }).catch(() => {});
      return;
    }
    await chrome.tabs.create({ url: TODAY_URL() + hash, pinned: placement === 'tab', index: placement === 'tab' ? 0 : undefined });
  }

  // Only fires when the side panel isn't set to open on click.
  chrome.action.onClicked.addListener(() => openPlannerTab());

  // "Every new tab": swap Chrome's new tab page for the planner. Needs the optional
  // "tabs" permission to see the new tab's URL (requested when you pick this mode).
  const NEW_TAB_URLS = ['chrome://newtab/', 'chrome://new-tab-page/', 'edge://newtab/', 'brave://newtab/'];
  chrome.tabs.onCreated.addListener(async (tab) => {
    const url = tab.pendingUrl || tab.url || '';
    if (!NEW_TAB_URLS.includes(url)) return;
    const { placement } = await P.getSettings();
    if (placement === 'newtab') chrome.tabs.update(tab.id, { url: TODAY_URL() }).catch(() => {});
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

  async function focusStart({ taskId = null, title, course = null, minutes = 40, kind = null, code = null }) {
    const existing = await P.store.get(K.focus, null);
    const settings = await P.getSettings();
    const tasks = await P.store.get(K.tasks, []);
    const task = tasks.find((t) => t.id === taskId);
    const isBreak = (kind || (task && task.kind)) === 'break';
    const meta = await P.store.get(K.meta, {});
    const offNow = (meta.offUntil || 0) > Date.now();
    if (isBreak) minutes = Math.max(1, Math.min(240, Math.round(minutes || 10)));
    // Past the day's break budget a break needs the off-switch code (when one is set).
    if (isBreak && settings.offCode && !(existing && existing.kind === 'break')) {
      const bs = await breakBudget(settings, existing);
      if (bs.over && !(await P.checkOffCode(code, settings.offCode))) return { ok: false, error: 'budget', used: bs.used, budget: bs.budget, wrong: !!code };
    }
    if (existing) await focusStop('switched', { quiet: true, keepOnitry: true });
    const now = Date.now();
    const focus = {
      id: P.newId(),
      taskId,
      title: String(title || (isBreak ? 'Break' : 'Focus')).slice(0, 200),
      course,
      activityId: !isBreak && task ? task.activityId || null : null,
      allow: isBreak ? [] : await allowFor(task),
      kind: isBreak ? 'break' : 'focus',
      startedAt: now,
      endsAt: now + minutes * 60000,
      minutes,
      pausedAt: null,
      pausedMs: 0,
      onitry: false,
      onitryPending: !isBreak && !offNow && settings.onitry.enabled && settings.onitry.autoStart,
      onitryError: null,
      // A break you take on the spot hands back to the queue only if a run was going; a queued break is part of the run.
      runAfter: isBreak ? (taskId ? true : !!existing) : true,
      carryOnitry: isBreak && !!(existing && (existing.onitry || existing.carryOnitry)),
    };
    await P.store.set(K.focus, focus);
    PlanBg.focusActive = true;
    chrome.alarms.create(FOCUS_END, { when: focus.endsAt });
    await P.log(isBreak ? `${P.fmtMinutes(minutes)} break` : `Started ${P.fmtMinutes(minutes)} focus: ${focus.title}`, 'focus', Date.now(), focus.activityId);
    // A break pauses Onitry so it doesn't flag you for stepping away.
    if (isBreak && settings.onitry.enabled && !offNow) OnitryBridge.pause(settings.onitry, minutes);
    if (taskId) await P.updateTask(taskId, { plan: P.dateKey() });
    await syncGuard(true);
    await updateFocusBadge();
    // Hooking up Onitry can take a while if it has to be launched first, so it
    // happens after the block has started and updates the stored focus when done.
    if (focus.onitryPending) connectOnitry(focus.id, settings);
    return { ok: true, focus };
  }

  // Pages allowed for a block: what's kept on its activity.
  async function allowFor(task) {
    if (!task || !task.activityId) return [];
    const acts = await P.store.get(K.activities, []);
    const a = acts.find((x) => x.id === task.activityId);
    return a && a.allow ? a.allow.slice() : [];
  }

  async function connectOnitry(focusId, settings) {
    const details = await taskDetails((await P.store.get(K.focus, {})).taskId, 'focus');
    const current = await P.store.get(K.focus, null);
    if (!current || current.id !== focusId) return;
    let res = await OnitryBridge.startTask(settings.onitry, current.title, details);
    if (!res.ok && !res.reachable && settings.onitry.launch) {
      const up = await OnitryBridge.ensureRunning(settings.onitry);
      res = up.ok ? await OnitryBridge.startTask(settings.onitry, current.title, details) : { ok: false, error: up.error };
      if (up.ok && up.launched) await P.log('Launched Onitry', 'system');
    }
    const latest = await P.store.get(K.focus, null);
    if (!latest || latest.id !== focusId) return; // block ended while we were connecting
    await P.store.set(K.focus, { ...latest, onitry: !!res.ok, onitryPending: false, onitryError: res.ok ? null : res.error });
    if (res.ok) {
      OnitryBridge.resume(settings.onitry); // in case it was paused by a break or the Pause button
      await P.log(`Onitry is watching: ${latest.title}`, 'focus');
    }
  }

  // After a focus block, ask one line about how it went (setting: every block, only after Done, never).
  async function askReflection(session, settings, outcome) {
    if (session.kind === 'break' || settings.reflect === 'never') return;
    if (outcome === 'switched' || outcome === 'skipped') return;
    if (settings.reflect === 'done' && outcome !== 'done') return;
    let id = session.activityId;
    if (!id) {
      const acts = await P.syncActivities();
      const hit = acts.find((a) => a.key === P.actKey(session.title));
      id = hit ? hit.id : null;
    }
    if (!id) return;
    await P.store.update(K.meta, {}, (m) => ({ ...m, pendingReflection: { sessionId: session.id, activityId: id, title: session.title, minutes: session.minutes, onPct: session.onitry ? session.onitry.onPct : null, at: Date.now() } }));
  }

  async function focusStop(outcome = 'stopped', { quiet = false, keepOnitry = false } = {}) {
    const focus = await P.store.get(K.focus, null);
    if (!focus) return { ok: false };
    const settings = await P.getSettings();
    const now = Date.now();
    clearTimeUpAlarms();
    // A block nobody answered ends when its time ran out, not 10 minutes later.
    const end = outcome === 'timeup' && focus.timeUpAt ? focus.timeUpAt : now;
    const pausedMs = (focus.pausedMs || 0) + (focus.pausedAt ? end - focus.pausedAt : 0);
    const minutes = Math.max(1, Math.round((end - focus.startedAt - pausedMs) / 60000));
    let onitry = null;
    if (focus.onitry || focus.carryOnitry) {
      const st = await OnitryBridge.status(settings.onitry);
      if (st.ok) {
        const total = (st.on_task_seconds || 0) + (st.off_task_seconds || 0);
        onitry = { onPct: total ? Math.round((st.on_task_seconds / total) * 100) : null, interrupts: st.interrupts || 0 };
      }
      if (settings.onitry.autoStop && !keepOnitry) await OnitryBridge.stop(settings.onitry);
    }
    const session = { id: focus.id, taskId: focus.taskId, activityId: focus.activityId || null, title: focus.title, course: focus.course, kind: focus.kind || 'focus', start: focus.startedAt, end, minutes, planned: focus.minutes, outcome, onitry };
    await P.store.update(K.sessions, [], (all) => all.concat([session]).slice(-3000));
    if ((outcome === 'done' || (focus.kind === 'break' && outcome === 'timeup')) && focus.taskId) await P.updateTask(focus.taskId, { done: now });
    await P.store.set(K.focus, null);
    await P.store.update(K.meta, {}, (m) => ({ ...m, escalatedUntil: 0 }));
    PlanBg.focusActive = false;
    chrome.alarms.clear(FOCUS_END);
    chrome.notifications.clear('focus-end');
    if (!quiet && focus.kind === 'break') await P.log(`Break over (${P.fmtMinutes(minutes)})`, 'focus');
    else if (!quiet) {
      const verb = outcome === 'done' ? '✓ Finished' : outcome === 'timeup' ? 'Time up on' : outcome === 'skipped' ? 'Skipped' : 'Stopped';
      const extra = onitry && onitry.onPct != null ? ` · Onitry: ${onitry.onPct}% on task` : '';
      await P.log(`${verb} ${focus.title} after ${P.fmtMinutes(minutes)}${extra}`, outcome === 'done' ? 'done' : 'focus', Date.now(), focus.activityId);
      await askReflection(session, settings, outcome);
    }
    await syncGuard(true);
    await updateFocusBadge();
    return { ok: true, session };
  }

  async function focusPause() {
    const focus = await P.store.get(K.focus, null);
    if (!focus || focus.pausedAt) return { ok: false };
    const settings = await P.getSettings();
    focus.pausedAt = Date.now();
    await P.store.set(K.focus, focus);
    chrome.alarms.clear(FOCUS_END);
    chrome.notifications.clear('focus-end');
    if (focus.onitry && settings.onitry.enabled) OnitryBridge.pause(settings.onitry, 60);
    await P.log(`Paused ${focus.title}`, 'focus');
    await syncGuard(true);
    await updateFocusBadge();
    return { ok: true, focus };
  }

  async function focusResume() {
    const focus = await P.store.get(K.focus, null);
    if (!focus || !focus.pausedAt) return { ok: false };
    const settings = await P.getSettings();
    const paused = Date.now() - focus.pausedAt;
    focus.endsAt += paused;
    focus.pausedMs = (focus.pausedMs || 0) + paused;
    focus.pausedAt = null;
    await P.store.set(K.focus, focus);
    chrome.alarms.create(FOCUS_END, { when: Math.max(Date.now() + 1000, focus.endsAt) });
    if (focus.onitry && settings.onitry.enabled) OnitryBridge.resume(settings.onitry);
    await P.log(`Resumed ${focus.title} after ${P.fmtMinutes(paused / 60000)}`, 'focus');
    await syncGuard(true);
    await updateFocusBadge();
    return { ok: true, focus };
  }

  // ---------- running the schedule back to back ----------

  // The next block on today's schedule that should start now (not one pinned for later).
  async function breakBudget(settings, focus = null) {
    const sessions = await P.store.get(K.sessions, []);
    return P.breakStatus(settings, { sessions, focus });
  }

  // The off-switch code turns the gate off and pauses (or stops) Onitry for a while.
  async function offSwitch({ code, choice }) {
    const settings = await P.getSettings();
    if (choice === 'cancel') {
      await P.store.update(K.meta, {}, (m) => ({ ...m, offUntil: 0 }));
      chrome.alarms.clear(OFF_END);
      await syncGuard(true);
      await P.log('Off switch ended early', 'system');
      return { ok: true };
    }
    if (!settings.offCode) return { ok: false, error: 'nocode' };
    if (!(await P.checkOffCode(code, settings.offCode))) return { ok: false, error: 'wrong' };
    const win = P.offWindow(choice);
    if (!win) return { ok: false, error: 'choice' };
    await P.store.update(K.meta, {}, (m) => ({ ...m, offUntil: win.until, escalatedUntil: 0 }));
    await P.store.set(K.passes, {});
    chrome.alarms.create(OFF_END, { when: win.until });
    if (settings.onitry.enabled) {
      if (win.pauseMinutes) OnitryBridge.pause(settings.onitry, win.pauseMinutes);
      else OnitryBridge.stop(settings.onitry);
    }
    await P.log(`Off switch: ${win.label.toLowerCase()}, ${P.fmtTime(Date.now())}`, 'system');
    await syncGuard(true);
    return { ok: true, until: win.until };
  }

  async function nextScheduled(excludeId = null) {
    const [tasks, settings, sessions] = await Promise.all([P.store.get(K.tasks, []), P.getSettings(), P.store.get(K.sessions, [])]);
    const now = new Date();
    // With the break budget spent, a queued break doesn't start by itself (you can still start it with the code),
    // and the time it would have taken goes to the next block.
    const skipBreaks = !!settings.offCode && P.breakStatus(settings, { sessions }).over;
    const events = P.layoutDay({ tasks: tasks.filter((t) => t.id !== excludeId && !(skipBreaks && t.kind === 'break')), settings, sessions, now, defaultMinutes: settings.focusMinutes });
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const next = P.nextUp(events, nowMin);
    if (!next || next.start - nowMin > 10) return null;
    return next.task;
  }

  async function startTask(t, settings) {
    return focusStart({ taskId: t.id, title: t.title, course: t.course, minutes: P.taskMinutes(t, settings.focusMinutes), kind: t.kind === 'break' ? 'break' : 'focus' });
  }

  // outcome: 'done' (you finished it), 'timeup' (the timer ran out), 'skipped' (move it to the end).
  async function advance(outcome) {
    const focus = await P.store.get(K.focus, null);
    if (!focus) return { ok: false };
    const settings = await P.getSettings();
    if (outcome === 'skipped' && focus.taskId) await P.updateTask(focus.taskId, { order: Date.now(), at: null });
    const finished = outcome === 'done' || focus.kind === 'break';
    await focusStop(finished ? 'done' : outcome, { keepOnitry: true });
    // Unfinished work flows back in later; what comes next is always something else.
    const next = await nextScheduled(focus.taskId);
    if (!next) {
      if (focus.onitry && settings.onitry.autoStop) await OnitryBridge.stop(settings.onitry);
      return { ok: true, next: null };
    }
    await startTask(next, settings);
    return { ok: true, next };
  }

  async function focusExtend(minutes = 10) {
    const focus = await P.store.get(K.focus, null);
    if (!focus) return { ok: false };
    focus.endsAt = Math.max(focus.endsAt, Date.now()) + minutes * 60000;
    focus.timeUpAt = null;
    await P.store.set(K.focus, focus);
    chrome.alarms.create(FOCUS_END, { when: focus.endsAt });
    clearTimeUpAlarms();
    chrome.notifications.clear('focus-end');
    await updateFocusBadge();
    return { ok: true, focus };
  }

  // ---------- badge ----------

  // Older versions also wrote a per-tab copy of the badge, which never got cleared
  // and left a stale "1m" on that tab. Per-tab text can be reset to the global one;
  // per-tab color can't, so every tab gets the current color whenever it changes.
  let tabsCleaned = false;
  let lastColor = null;

  async function updateFocusBadge() {
    const focus = await P.store.get(K.focus, null);
    const offTask = P.isFocusing(focus) && lastOnitryStatus && lastOnitryStatus.running && lastOnitryStatus.status === 'off_task';
    const b = P.badgeFor(focus, { offTask });
    const tabs = !tabsCleaned || b.color !== lastColor ? await chrome.tabs.query({}).catch(() => []) : [];
    if (!tabsCleaned) {
      tabsCleaned = true;
      for (const t of tabs) await chrome.action.setBadgeText({ tabId: t.id, text: null }).catch(() => {});
    }
    if (b.color !== lastColor) {
      lastColor = b.color;
      await chrome.action.setBadgeBackgroundColor({ color: b.color }).catch(() => {});
      for (const t of tabs) await chrome.action.setBadgeBackgroundColor({ tabId: t.id, color: b.color }).catch(() => {});
    }
    await chrome.action.setBadgeText({ text: b.text }).catch(() => {});
    if (!focus) {
      await chrome.action.setTitle({ title: 'Timecheck' }).catch(() => {});
      chrome.alarms.clear(BADGE);
      return;
    }
    const state = focus.timeUpAt ? 'Time’s up' : focus.pausedAt ? 'Paused' : focus.kind === 'break' ? 'Break' : 'Focusing';
    await chrome.action.setTitle({ title: `${state}: ${focus.title}` }).catch(() => {});
    // Re-draw exactly when the minute count changes (open planner pages also update it every second).
    const now = Date.now();
    const ms = P.focusEndsAt(focus, now) - now;
    if (focus.pausedAt || focus.timeUpAt || ms <= 60000) chrome.alarms.clear(BADGE);
    else chrome.alarms.create(BADGE, { when: P.focusEndsAt(focus, now) - (Math.ceil(ms / 60000) - 1) * 60000 + 50 });
  }

  // ---------- the alarm ----------

  // Service workers can't play sound, so a hidden offscreen page does it.
  async function ringAlarm(repeats = 3, { force = false } = {}) {
    const settings = await P.getSettings();
    if (!settings.alarmSound && !force) return { ok: false, off: true };
    try {
      const open = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
      if (!open.length) await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['AUDIO_PLAYBACK'], justification: 'Ring when a focus block ends' });
      for (let i = 0; i < 3; i++) {
        try {
          return await chrome.runtime.sendMessage({ type: 'alarm:play', repeats });
        } catch (err) {
          await new Promise((r) => setTimeout(r, 150)); // page still loading
        }
      }
      return { ok: false, error: 'alarm page didn’t answer' };
    } catch (err) {
      console.warn('Timecheck alarm failed', err);
      return { ok: false, error: err.message };
    }
  }

  // No next block (or back to back is off): ring, show "Time's up", wait for an answer.
  async function timeUp(focus) {
    await P.store.set(K.focus, { ...focus, timeUpAt: Date.now() });
    chrome.alarms.create(RING_AGAIN, { when: Date.now() + TIMEUP_RING_MS });
    chrome.alarms.create(TIMEUP_CLOSE, { when: Date.now() + TIMEUP_CLOSE_MS });
    await updateFocusBadge();
    ringAlarm(3);
    await notify('focus-end', `⏰ Time’s up: ${focus.title}`, `${P.fmtMinutes(focus.minutes)} done. Finished, or a few more minutes?`, ['✓ Done', '+5 min'], true);
  }

  function clearTimeUpAlarms() {
    chrome.alarms.clear(RING_AGAIN);
    chrome.alarms.clear(TIMEUP_CLOSE);
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

  // Gate updates run one at a time: overlapping ones each read the old rules and
  // then both tried to add rule 1001 ("does not have a unique ID").
  let guardChain = Promise.resolve();
  function syncGuard(force = false) {
    const run = guardChain.then(() => syncGuardNow(force));
    guardChain = run.catch(() => {});
    return run;
  }

  async function syncGuardNow(force = false) {
    const [settings, focus, tasks, meta] = await Promise.all([P.getSettings(), P.store.get(K.focus, null), P.store.get(K.tasks, []), P.store.get(K.meta, {})]);
    const passes = await activePasses();
    const gs = P.guardState(settings, focus, tasks, new Date(), meta.escalatedUntil || 0, meta.offUntil || 0);
    const sites = gs.active ? settings.sites.filter((s) => !passes[s]) : [];
    // Pages allowed for the running block get through even when their site is gated.
    const allow = gs.active && focus && !focus.pausedAt ? focus.allow || [] : [];
    const key = JSON.stringify([sites, allow.map((e) => e.value)]);

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
    const allowRules = sites.length
      ? allow.map((e, i) => ({
          id: ALLOW_RULE_BASE + i,
          priority: 2, // beats the redirect
          action: { type: 'allow' },
          condition: { regexFilter: P.allowRegex(e), resourceTypes: ['main_frame'] },
        }))
      : [];
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    try {
      await chrome.declarativeNetRequest.updateDynamicRules({
        // Also remove the ids we're about to add, so this can never collide.
        removeRuleIds: [...new Set([...existing.filter((r) => r.id >= GUARD_RULE_BASE && r.id < GUARD_RULE_BASE + 1000).map((r) => r.id), ...addRules.map((r) => r.id), ...allowRules.map((r) => r.id)])],
        addRules: addRules.concat(allowRules),
      });
      const meta = await P.store.get(K.meta, {});
      if (meta.guardError) await P.store.set(K.meta, { ...meta, guardError: null });
    } catch (err) {
      lastGuardKey = null; // try again next time
      console.error('Timecheck gate rules failed', err);
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

  async function grantPass({ site, minutes, reason, url, allowPage = false }) {
    const settings = await P.getSettings();
    if (!settings.sites.includes(site)) return { ok: false, error: 'not a gated site' };
    const focus = await P.store.get(K.focus, null);
    const meta = await P.store.get(K.meta, {});
    if (P.isFocusing(focus) && (meta.escalatedUntil || 0) > Date.now()) return { ok: false, error: 'Onitry caught you off task. No passes for a few minutes.' };
    const max = P.isFocusing(focus) ? 5 : 60;
    const mins = Math.max(1, Math.min(max, Number(minutes) || settings.passMinutes));
    const until = Date.now() + mins * 60000;
    await P.store.update(K.passes, {}, (p) => ({ ...p, [site]: until }));
    // "Keep this page allowed for the block": same reason, wait and typed sentence as the pass itself.
    const entry = allowPage && P.isFocusing(focus) ? P.parseAllow(url) : null;
    if (entry) {
      await P.store.update(K.focus, null, (f) => (f ? { ...f, allow: P.mergeAllow(f.allow, [entry]) } : f));
      await P.log(`Allowed ${entry.value} for ${focus.title}`, 'system', Date.now(), focus.activityId);
    }
    await P.log(`${site} for ${mins}m — “${String(reason || '').slice(0, 200)}”${P.isFocusing(focus) ? ` (during focus on ${focus.title})` : ''}`, 'pass');
    await syncGuard(true);
    return { ok: true, until, url };
  }

  // ---------- Onitry: fast polling and off-task escalation ----------

  async function updateOnitryPoll() {
    const [settings, focus] = await Promise.all([P.getSettings(), P.store.get(K.focus, null)]);
    if (settings.onitry.enabled && focus) chrome.alarms.create(ONITRY_POLL, { periodInMinutes: 0.5 });
    else chrome.alarms.clear(ONITRY_POLL);
  }

  async function checkOnitry() {
    const [settings, focus] = await Promise.all([P.getSettings(), P.store.get(K.focus, null)]);
    if (!settings.onitry.enabled) return;
    lastOnitryStatus = { ...(await OnitryBridge.status(settings.onitry)), at: Date.now() };
    await P.store.set(K.onitry, lastOnitryStatus);
    const off = ((await P.store.get(K.meta, {})).offUntil || 0) > Date.now();
    if (!off && P.isFocusing(focus) && settings.onitry.escalate && lastOnitryStatus.ok && lastOnitryStatus.running && lastOnitryStatus.status === 'off_task') await escalate(focus, lastOnitryStatus);
    await updateFocusBadge();
  }

  // Onitry says you drifted during a focus block: revoke passes, gate every
  // distracting site (even with the gate "off") and refuse passes for a while.
  async function escalate(focus, st) {
    const meta = await P.store.get(K.meta, {});
    const now = Date.now();
    const wasEscalated = (meta.escalatedUntil || 0) > now;
    await P.store.set(K.meta, { ...meta, escalatedUntil: now + ESCALATE_MINUTES * 60000 });
    if (wasEscalated) return; // just extend it
    await P.store.set(K.passes, {});
    lastGuardKey = null; // treat every site as newly gated so open tabs get sent to the gate
    await syncGuard(true);
    await P.log(`Onitry: off task during ${focus.title}${st.activity ? ` (${st.activity})` : ''} — gate locked ${ESCALATE_MINUTES}m`, 'nudge');
    await notify('escalate', 'Onitry caught you off task', `Back to “${focus.title}”. Distracting sites are locked for ${ESCALATE_MINUTES} minutes.`, ['Open planner'], true);
  }

  // ---------- weekly review ----------

  async function runReview(week) {
    const start = week || P.weekStart(P.addDays(P.dateKey(), -1)); // Sunday counts as the week just ending
    const [settings, tasks, sessions, journal, eod] = await Promise.all([
      P.getSettings(),
      P.store.get(K.tasks, []),
      P.store.get(K.sessions, []),
      P.store.get(K.journal, {}),
      P.store.get(K.eod, {}),
    ]);
    const stats = P.weekStats({ tasks, sessions, journal, eod, settings }, start);
    const entry = { week: start, stats, at: Date.now(), text: null, error: null };
    if (!settings.onitry.enabled) entry.error = 'Connect Onitry in settings to get an AI review.';
    else {
      const res = await OnitryBridge.review(settings.onitry, stats);
      if (res.ok) Object.assign(entry, { text: res.text, model: res.model });
      else entry.error = res.reachable ? res.error : 'Onitry isn’t running. Open it and try again.';
    }
    await P.store.update(K.reviews, {}, (all) => ({ ...all, [start]: entry }));
    if (entry.text) await P.log('Weekly review written by Onitry', 'system');
    return { ok: !entry.error, ...entry };
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
      await checkOnitry();
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

    // 1b) A paused block that's been sitting for 15 minutes.
    if (focus && focus.pausedAt && Date.now() - focus.pausedAt >= 15 * 60000 && m.pauseNudged !== focus.id) {
      m.pauseNudged = focus.id;
      changed = true;
      await notify('paused', `Still paused: ${focus.title}`, `Paused for ${P.fmtMinutes((Date.now() - focus.pausedAt) / 60000)}. Back to it?`, ['▶ Resume', 'End block']);
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

    // 5) Free block at school: suggest the top thing instead of scrolling.
    const free = settings.blocks.freeNudge && !focus ? P.inFreeBlock(settings, now) : null;
    if (free && m.freeNudged !== `${today} ${free.start}`) {
      m.freeNudged = `${today} ${free.start}`;
      changed = true;
      const pick = open[0] || tasks.find((t) => t.someday && !t.done);
      const left = P.minutesOfDay(free.end) - nowMin;
      m.freeTaskId = pick ? pick.id : null;
      m.freeMinutes = Math.max(10, left - 5);
      await notify('free', `${free.label} — ${P.fmtMinutes(left)} left`, pick ? `Use it: ${pick.title}` : 'Nothing planned. Open the planner and pick something.', pick ? [`▶ Start (${P.fmtMinutes(m.freeMinutes)})`, 'Not now'] : ['Open planner']);
    }

    // 6) Weekly review, on the review day from an hour before the EOD check-in.
    const reviewWeek = P.weekStart(P.addDays(today, -1));
    if (now.getDay() === settings.weeklyReviewDay && nowMin >= eodMin - 60 && m.reviewPrompted !== reviewWeek) {
      m.reviewPrompted = reviewWeek;
      changed = true;
      await notify('review', 'Weekly review', 'Your week in numbers is ready. Take 5 minutes to look back and plan next week.', ['Open review']);
    }

    // Merge, but never write back escalatedUntil: checkOnitry() may have just set it.
    delete m.escalatedUntil;
    if (changed) await P.store.update(K.meta, {}, (cur) => ({ ...cur, ...m }));
  }

  // Handy for debugging from the service-worker console.
  Object.assign(PlanBg, { ringAlarm, updateFocusBadge, tick, syncGuard, focusStart, focusStop, focusPause, focusResume, advance, nextScheduled, grantPass, checkOnitry, runReview, openPlannerTab });

  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === TICK) tick();
    else if (alarm.name === ONITRY_POLL) checkOnitry();
    else if (alarm.name === PASS_EXPIRE) {
      const before = await P.store.get(K.passes, {});
      await syncGuard(true);
      const after = await activePasses();
      const expired = Object.keys(before).filter((s) => !after[s]);
      const settings = await P.getSettings();
      const meta = await P.store.get(K.meta, {});
      const gs = P.guardState(settings, await P.store.get(K.focus, null), await P.store.get(K.tasks, []), new Date(), meta.escalatedUntil || 0, meta.offUntil || 0);
      if (expired.length && gs.active) await gateOpenTabs(expired);
    } else if (alarm.name === OFF_END) {
      await syncGuard(true);
      await P.log('Off switch over: the gate is back', 'system');
    } else if (alarm.name === FOCUS_END) {
      const focus = await P.store.get(K.focus, null);
      if (!focus || focus.pausedAt || focus.timeUpAt || Date.now() < focus.endsAt - 1000) return;
      const settings = await P.getSettings();
      if (focus.kind === 'break') {
        // A break ends by itself: the gate closes again, then the next block starts if a run was going.
        const after = settings.autoAdvance && focus.runAfter !== false ? await nextScheduled(focus.taskId) : null;
        if (after) {
          await P.store.update(K.meta, {}, (m) => ({ ...m, advancedFrom: null }));
          await advance('timeup');
          ringAlarm(2);
          await notify('advance', 'Break’s over', `Now: ${after.title}${after.kind === 'break' ? '' : ` (${P.fmtMinutes(P.taskMinutes(after, settings.focusMinutes))})`}.`, ['❚❚ Pause'], false);
        } else {
          await focusStop('done');
          ringAlarm(3);
          await notify('break-end', 'Break’s over', 'The gate is back up. Back to it when you’re ready.', ['Open planner'], false);
        }
        await updateFocusBadge();
        return;
      }
      const next = settings.autoAdvance ? await nextScheduled(focus.taskId) : null;
      if (next && next.id !== focus.taskId) {
        // Back to back: close this block and start the next one right away.
        await P.store.update(K.meta, {}, (m) => ({ ...m, advancedFrom: focus.kind === 'break' ? null : focus.taskId }));
        await advance('timeup');
        const head = focus.kind === 'break' ? 'Break’s over' : `Time’s up: ${focus.title}`;
        const body = `Now: ${next.title}${next.kind === 'break' ? '' : ` (${P.fmtMinutes(P.taskMinutes(next, settings.focusMinutes))})`}.${focus.kind === 'break' ? '' : ' Did you finish?'}`;
        ringAlarm(2);
        await notify('advance', head, body, focus.kind === 'break' ? ['❚❚ Pause'] : [`✓ Finished ${focus.title}`.slice(0, 40), '❚❚ Pause'], false);
      } else await timeUp(focus);
      await updateFocusBadge();
    } else if (alarm.name === BADGE) {
      await updateFocusBadge();
    } else if (alarm.name === RING_AGAIN) {
      const focus = await P.store.get(K.focus, null);
      if (!focus || !focus.timeUpAt) return;
      ringAlarm(2);
      await notify('focus-end', `⏰ Still time’s up: ${focus.title}`, 'Finished, or a few more minutes? The block ends by itself soon.', ['✓ Done', '+5 min'], true);
    } else if (alarm.name === TIMEUP_CLOSE) {
      const focus = await P.store.get(K.focus, null);
      if (!focus || !focus.timeUpAt) return;
      chrome.notifications.clear('focus-end');
      await focusStop('timeup');
      await P.log('Block ended after time ran out (no answer)', 'focus');
    }
  });

  // ---------- notification actions ----------

  const openToday = (hash = '') => openPlannerTab(hash);
  const HASH_FOR = { eod: '#eod', review: '#review' };

  chrome.notifications.onClicked.addListener((id) => {
    chrome.notifications.clear(id);
    openToday(HASH_FOR[id] || '');
  });

  chrome.notifications.onButtonClicked.addListener(async (id, index) => {
    chrome.notifications.clear(id);
    const settings = await P.getSettings();
    if (id === 'focus-end') {
      if (index === 0) await (settings.autoAdvance ? advance('done') : focusStop('done'));
      else await focusExtend(5);
    } else if (id === 'checkin') {
      const meta = await P.store.get(K.meta, {});
      const tasks = await P.store.get(K.tasks, []);
      const t = tasks.find((x) => x.id === meta.nudgeTaskId);
      if (index === 0 && t) await focusStart({ taskId: t.id, title: t.title, course: t.course, minutes: t.estimate || settings.focusMinutes });
      else if (index === 0) await openToday();
      else await P.store.set(K.meta, { ...meta, lastNudge: Date.now() }); // snooze = reset the timer
    } else if (id === 'advance') {
      const meta = await P.store.get(K.meta, {});
      const buttons = meta.advancedFrom ? ['done', 'pause'] : ['pause'];
      if (buttons[index] === 'done' && meta.advancedFrom) {
        await P.updateTask(meta.advancedFrom, { done: Date.now() });
        await P.log('✓ Marked done from the notification', 'done');
      } else if (buttons[index] === 'pause') await focusPause();
    } else if (id === 'paused') {
      if (index === 0) await focusResume();
      else await focusStop('stopped');
    } else if (id === 'plan' || id === 'escalate' || id === 'break-end') await openToday();
    else if (id === 'eod') await openToday('#eod');
    else if (id === 'review') await openToday('#review');
    else if (id === 'free') {
      const meta = await P.store.get(K.meta, {});
      const tasks = await P.store.get(K.tasks, []);
      const t = tasks.find((x) => x.id === meta.freeTaskId);
      if (index === 0 && t) await focusStart({ taskId: t.id, title: t.title, course: t.course, minutes: meta.freeMinutes || settings.focusMinutes });
      else if (index === 0) await openToday();
    }
    else if (id.startsWith('test-')) {
      const tasks = await P.store.get(K.tasks, []);
      const t = tasks.find((x) => `test-${x.id}` === id);
      if (t) await focusStart({ taskId: t.id, title: `Study: ${t.title}`, course: t.course, minutes: 25 });
    }
  });

  // ---------- Inkwell (the notes extension) ----------
  // Inkwell says hello first, because only Timecheck's ID is fixed. You approve it in ⚙; after that
  // only that ID is answered. Anything from any other extension is ignored.

  async function handleInkwell(msg, sender) {
    const settings = await P.getSettings();
    const connected = !!settings.inkwell.id && settings.inkwell.id === sender.id;
    if (msg.type === 'inkwell:hello') {
      if (connected) return { ok: true, connected: true };
      const meta = await P.store.get(K.meta, {});
      if (!(meta.inkwellIgnored || []).includes(sender.id)) await P.store.set(K.meta, { ...meta, inkwellPending: { id: sender.id, at: Date.now() } });
      return { ok: true, connected: false };
    }
    if (!connected) return { ok: false, error: 'not connected' };
    if (msg.type === 'inkwell:ping') return { ok: true, connected: true };

    const acts = await P.store.get(K.activities, []);
    if (msg.type === 'inkwell:stats') {
      const a = acts.find((x) => x.id === msg.activityId);
      if (!a) return { ok: false, error: 'no such activity' };
      const st = P.activityStats(a, await P.store.get(K.sessions, []));
      return { ok: true, name: a.name, blocks: st.blocks, total: st.total, week: st.week, usual: st.usual, last: st.last, lastAgo: st.last ? P.ago(st.last) : null };
    }
    if (msg.type === 'inkwell:add-block') {
      const byId = msg.activityId ? acts.find((x) => x.id === msg.activityId) : null;
      const title = String(byId ? byId.name : msg.title || '').trim().slice(0, 200);
      if (!title) return { ok: false, error: 'no title' };
      const known = byId || acts.find((x) => x.key === P.actKey(title)) || null;
      const minutes = (known && P.activityStats(known, await P.store.get(K.sessions, [])).usual) || settings.focusMinutes;
      const task = P.makeTask({ title, course: known ? known.course : null, plan: P.dateKey(), estimate: minutes, order: Date.now() });
      await P.addTasks([task]);
      const after = (await P.store.get(K.activities, [])).find((x) => x.key === P.actKey(title)) || null;
      if (msg.start) await focusStart({ taskId: task.id, title, course: task.course, minutes });
      return { ok: true, activityId: after ? after.id : null, name: title, taskId: task.id };
    }
    return { ok: false, error: 'unknown message' };
  }

  chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('inkwell:') || !sender.id) return false;
    handleInkwell(msg, sender).then(sendResponse, (err) => sendResponse({ ok: false, error: err.message }));
    return true;
  });

  // ---------- messages from pages ----------

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('plan:')) return false;
    let job;
    if (msg.type === 'plan:focus') {
      if (msg.action === 'start') job = focusStart(msg);
      else if (msg.action === 'stop') job = focusStop(msg.outcome || 'stopped');
      else if (msg.action === 'extend') job = focusExtend(msg.minutes);
      else if (msg.action === 'pause') job = focusPause();
      else if (msg.action === 'resume') job = focusResume();
      else if (msg.action === 'done') job = Promise.all([P.getSettings(), P.store.get(K.focus, null)]).then(([s, f]) => (s.autoAdvance && !(f && f.kind === 'break' && f.runAfter === false) ? advance('done') : focusStop('done')));
      else if (msg.action === 'skip') job = advance('skipped');
    } else if (msg.type === 'plan:offswitch') job = offSwitch(msg);
    else if (msg.type === 'plan:pass') job = grantPass(msg);
    else if (msg.type === 'plan:guard-state') job = syncGuard(true);
    else if (msg.type === 'plan:review') job = runReview(msg.week);
    else if (msg.type === 'plan:test-alarm') job = ringAlarm(1, { force: true });
    else if (msg.type === 'plan:launch') job = P.getSettings().then((s) => OnitryBridge.ensureRunning(s.onitry));
    else if (msg.type === 'plan:open-tab') job = openPlannerTab(msg.hash || '').then(() => ({ ok: true }));
    if (!job) return false;
    job.then(sendResponse, (err) => sendResponse({ ok: false, error: err.message }));
    return true;
  });
})();
