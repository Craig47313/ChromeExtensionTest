// InkPlan: data model, dates, block days and storage
// for Timecheck. Shared by the Today page, the distraction gate and the
// service worker; also loads in Node for unit tests.
(function (g) {
  'use strict';
  if (g.InkPlan) return;

  // ---------- dates ----------

  const DAY = 86400000;
  const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

  const pad = (n) => String(n).padStart(2, '0');
  const dateKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromKey = (k) => {
    const [y, m, d] = k.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const addDays = (k, n) => {
    const d = fromKey(k);
    d.setDate(d.getDate() + n);
    return dateKey(d);
  };
  const daysBetween = (a, b) => Math.round((fromKey(b) - fromKey(a)) / DAY);
  const weekStart = (k) => {
    const d = fromKey(k);
    const offset = (d.getDay() + 6) % 7; // Monday-based weeks, like the school grid
    return addDays(k, -offset);
  };

  function relDay(k, today = dateKey()) {
    if (!k) return '';
    const n = daysBetween(today, k);
    if (n === 0) return 'Today';
    if (n === 1) return 'Tomorrow';
    if (n === -1) return 'Yesterday';
    const d = fromKey(k);
    if (n > 1 && n < 7) return d.toLocaleDateString([], { weekday: 'long' });
    if (n < 0) return `${-n} days ago`;
    return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function minutesOfDay(hhmm) {
    const [h, m] = String(hhmm || '0:0').split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  }

  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function fmtMinutes(min) {
    min = Math.max(0, Math.round(min));
    if (min < 60) return `${min}m`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }

  // ---------- courses ----------

  const COLORS = ['#2f9e44', '#1971c2', '#e8590c', '#7048e8', '#c2255c', '#0c8599', '#e67700', '#5c940d', '#9c36b5', '#d6336c', '#1098ad', '#f08c00', '#495057', '#364fc7'];

  // Seeded from the subjects and projects in the journal this was built from.
  const DEFAULT_COURSES = [
    { name: 'Calc', aliases: ['calc', 'bc', 'calculus', 'math'] },
    { name: 'Lang', aliases: ['lang', 'eng', 'english'] },
    { name: 'Physics', aliases: ['physics', 'phys', 'apc'] },
    { name: 'Econ', aliases: ['econ', 'economics'] },
    { name: 'Chem', aliases: ['chem', 'chemistry'] },
    { name: 'Spanish', aliases: ['spanish', 'span', 'ils', 'espanol'] },
    { name: 'MUN', aliases: ['mun', 'reso'] },
    { name: 'FRC', aliases: ['frc', 'robotics'] },
    { name: 'MATE', aliases: ['mate', 'rov'] },
    { name: 'CV2', aliases: ['cv2', 'opencv'] },
    { name: 'Onitry', aliases: ['onitry', 'monitry'] },
    { name: 'CAD', aliases: ['cad', 'claw', 'elevator'] },
    { name: 'Kaggle', aliases: ['kaggle'] },
    { name: 'ISAK', aliases: ['isak'] },
  ].map((c, i) => ({ ...c, color: COLORS[i % COLORS.length] }));

  function courseIndex(courses) {
    const map = new Map();
    for (const c of courses) {
      map.set(c.name.toLowerCase(), c.name);
      for (const a of c.aliases || []) map.set(String(a).toLowerCase(), c.name);
    }
    return map;
  }

  function courseColor(courses, name) {
    const c = courses.find((x) => x.name === name);
    return c ? c.color : '#868e96';
  }

  // ---------- block days (A/B/C/D rotation) ----------
  // Lettered school days rotate A→B→C→D, skipping weekends, unlettered weekdays
  // (Monday at this school) and holidays. One known date + letter anchors it.

  const DEFAULT_BLOCKS = {
    enabled: true,
    letters: ['A', 'B', 'C', 'D'],
    anchorDate: '2026-10-13', // a Tuesday that was a C day
    anchorLetter: 'C',
    days: [2, 3, 4, 5], // weekdays that get a letter (0 = Sun)
    schoolDays: [1, 2, 3, 4, 5],
    skip: [], // no-school dates: the rotation pauses
    schedule: {}, // { A: [{ start: '08:00', end: '09:20', label: 'Calc' }], …, Other: […] }
    freeNudge: true,
  };

  function isLetterDay(k, b) {
    return b.days.includes(fromKey(k).getDay()) && !b.skip.includes(k);
  }

  function blockLetter(k, b) {
    if (!b || !b.enabled || !b.anchorDate || !b.letters || !b.letters.length) return null;
    if (!isLetterDay(k, b)) return null;
    const ai = b.letters.indexOf(b.anchorLetter);
    if (ai < 0 || Math.abs(daysBetween(b.anchorDate, k)) > 1000) return null;
    const dir = k >= b.anchorDate ? 1 : -1;
    let n = 0;
    for (let d = b.anchorDate; d !== k; ) {
      d = addDays(d, dir);
      if (isLetterDay(d, b)) n += dir;
    }
    // An anchor on a non-letter day names the *next* letter day.
    if (dir === 1 && !isLetterDay(b.anchorDate, b)) n -= 1;
    const L = b.letters.length;
    return b.letters[(((ai + n) % L) + L) % L];
  }

  function isSchoolDay(k, b) {
    return !!b && b.enabled && b.schoolDays.includes(fromKey(k).getDay()) && !b.skip.includes(k);
  }

  // Letter + class blocks for a date.
  function dayInfo(k, b) {
    const letter = blockLetter(k, b);
    const school = isSchoolDay(k, b);
    const key = letter || (school ? 'Other' : null);
    const blocks = ((key && b.schedule && b.schedule[key]) || []).slice().sort((x, y) => minutesOfDay(x.start) - minutesOfDay(y.start));
    return { letter, school, blocks };
  }

  const FREE_BLOCK = /\b(free|study|flex|open|unscheduled|off)\b/i;
  const isFreeBlock = (blk) => !!blk && FREE_BLOCK.test(blk.label || '');

  function blockAt(blocks, minute) {
    let current = null;
    let next = null;
    for (const blk of blocks) {
      const a = minutesOfDay(blk.start);
      const z = minutesOfDay(blk.end);
      if (minute >= a && minute < z) current = blk;
      else if (a > minute && !next) next = blk;
    }
    return { current, next };
  }

  function nextLetterDate(letter, from, b, maxDays = 60) {
    for (let i = 1; i <= maxDays; i++) {
      const d = addDays(from, i);
      if (blockLetter(d, b) === letter) return d;
    }
    return null;
  }

  // Text format for the settings box:
  //   A
  //   08:00-09:20 Calc
  //   09:30-10:50 Free
  //   Other
  //   08:00-08:45 Calc
  function parseSchedule(text) {
    const out = {};
    let cur = null;
    for (const raw of String(text || '').split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const head = line.match(/^([A-Za-z]|other|mon(?:day)?|no letter)\s*(?:day)?\s*:?\s*$/i);
      if (head) {
        cur = head[1].length === 1 ? head[1].toUpperCase() : 'Other';
        out[cur] = out[cur] || [];
        continue;
      }
      const m = line.match(/^(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})\s+(.+)$/);
      if (m && cur) out[cur].push({ start: normTime(m[1]), end: normTime(m[2]), label: m[3].trim().slice(0, 60) });
    }
    return out;
  }

  // Breaks: store every no-school date, show them as ranges.
  function expandRange(from, to, max = 200) {
    if (!from) return [];
    if (!to || to < from) to = from;
    const out = [];
    for (let d = from; d <= to && out.length < max; d = addDays(d, 1)) out.push(d);
    return out;
  }

  function dateRanges(dates) {
    const sorted = [...new Set(dates)].sort();
    const out = [];
    for (const d of sorted) {
      const last = out[out.length - 1];
      if (last && addDays(last[1], 1) === d) last[1] = d;
      else out.push([d, d]);
    }
    return out;
  }

  function normTime(t) {
    const [h, m] = t.split(':').map(Number);
    return `${pad(h)}:${pad(m)}`;
  }

  function formatSchedule(schedule, letters = DEFAULT_BLOCKS.letters) {
    const keys = [...letters, 'Other', ...Object.keys(schedule || {}).filter((k) => !letters.includes(k) && k !== 'Other')];
    return keys
      .filter((k) => schedule && schedule[k] && schedule[k].length)
      .map((k) => [k, ...schedule[k].map((x) => `${x.start}-${x.end} ${x.label}`)].join('\n'))
      .join('\n\n');
  }

  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function makeTask(fields) {
    return {
      id: newId(),
      title: '',
      course: null,
      kind: 'todo', // 'todo' | 'due' | 'test'
      due: null, // 'YYYY-MM-DD'
      plan: null, // day you intend to work on it
      estimate: null, // minutes
      someday: false, // "when there's nothing to do" list
      done: null, // timestamp
      created: Date.now(),
      order: Date.now(),
      ...fields,
    };
  }

  const isOpen = (t) => !t.done;

  // What belongs on today's list: planned for today (or carried over), due
  // today/tomorrow, or overdue. Tests show up as study items two days out.
  function todayTasks(tasks, today = dateKey()) {
    const tomorrow = addDays(today, 1);
    return tasks
      .filter((t) => {
        if (t.someday) return t.plan === today && isOpen(t);
        if (!isOpen(t)) return t.done && dateKey(new Date(t.done)) === today && (t.plan === today || (t.due && t.due <= tomorrow));
        if (t.plan && t.plan <= today) return true;
        if (t.due && t.kind !== 'test' && t.due <= tomorrow) return true;
        if (t.due && t.kind === 'test' && t.due <= addDays(today, 2)) return true;
        return false;
      })
      .sort((a, b) => !!a.done - !!b.done || a.order - b.order);
  }

  function upcoming(tasks, today = dateKey(), days = 14) {
    const end = addDays(today, days);
    return tasks.filter((t) => isOpen(t) && t.due && t.due >= today && t.due <= end).sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : (b.kind === 'test') - (a.kind === 'test')));
  }

  function overdue(tasks, today = dateKey()) {
    return tasks.filter((t) => isOpen(t) && t.due && t.due < today);
  }

  // Lay today's open tasks end to end from `startMin` (minutes since midnight).
  function schedule(list, startMin, defaultMinutes = 30, breakMinutes = 0) {
    let at = startMin;
    return list.map((t) => {
      const len = t.estimate || defaultMinutes;
      const slot = { task: t, start: at, end: at + len };
      at += len + breakMinutes;
      return slot;
    });
  }

  function hhmm(min) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setMinutes(min);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  // ---------- the day as a calendar ----------
  // Fixed things (classes, pinned tasks, the running block) keep their times;
  // everything else on today's list runs back to back from now, flowing around
  // them in list order. Minutes are minutes since midnight.

  const taskMinutes = (t, def = 30) => t.estimate || def;

  function focusEndsAt(focus, now = Date.now()) {
    return focus.pausedAt ? focus.endsAt + (now - focus.pausedAt) : focus.endsAt;
  }

  // Toolbar badge for a running block. Minutes round *up* (so "3m" means up to 3
  // minutes left); `seconds` switches the last minute to a seconds countdown.
  function badgeFor(focus, { now = Date.now(), offTask = false, seconds = false } = {}) {
    if (!focus) return { text: '', color: '#2ea043' };
    if (focus.timeUpAt) return { text: 'END', color: '#d9363e' };
    if (focus.pausedAt) return { text: '❚❚', color: '#6b6b6b' };
    if (offTask) return { text: '!', color: '#d9363e' };
    const ms = focusEndsAt(focus, now) - now;
    const color = focus.kind === 'break' ? '#1971c2' : '#2ea043';
    if (ms <= 0) return { text: 'END', color: '#d9363e' };
    if (ms < 60000) return { text: seconds ? `${Math.ceil(ms / 1000)}s` : '<1m', color: '#e8590c' };
    return { text: `${Math.ceil(ms / 60000)}m`, color };
  }

  function layoutDay({ tasks = [], focus = null, sessions = [], settings = DEFAULT_SETTINGS, today = dateKey(), now = new Date(), defaultMinutes = 30 } = {}) {
    const dayStart = fromKey(today).getTime();
    const nowMin = (now.getTime() - dayStart) / 60000;
    const toMin = (ts) => (ts - dayStart) / 60000;
    const events = [];
    const busy = [];

    for (const b of dayInfo(today, settings.blocks || DEFAULT_BLOCKS).blocks) {
      const ev = { type: 'class', start: minutesOfDay(b.start), end: minutesOfDay(b.end), block: b, free: isFreeBlock(b) };
      events.push(ev);
      if (!ev.free) busy.push(ev); // free blocks are time you can use
    }
    for (const s of sessions) {
      if (s.end < dayStart || s.end >= dayStart + DAY) continue;
      events.push({ type: 'session', start: Math.max(0, toMin(s.start)), end: toMin(s.end), session: s });
    }

    let cursor = Math.ceil(nowMin);
    if (focus) {
      const ev = { type: 'focus', start: Math.max(0, toMin(focus.startedAt)), end: Math.max(toMin(focusEndsAt(focus, now.getTime())), nowMin), focus, task: tasks.find((t) => t.id === focus.taskId) || null };
      events.push(ev);
      busy.push(ev);
      cursor = Math.max(cursor, Math.ceil(ev.end));
    }

    const open = todayTasks(tasks, today).filter((t) => !t.done && !(focus && focus.taskId === t.id));
    const flow = [];
    for (const t of open) {
      if (t.at && t.plan === today) {
        const start = minutesOfDay(t.at);
        const end = start + taskMinutes(t, defaultMinutes);
        if (end > nowMin) {
          const ev = { type: 'task', start, end, task: t, pinned: true };
          events.push(ev);
          busy.push(ev);
          continue;
        }
      }
      flow.push(t); // pinned times that already passed rejoin the flow
    }
    for (const t of flow) {
      const len = taskMinutes(t, defaultMinutes);
      let start = cursor;
      for (let i = 0; i < 100; i++) {
        const clash = busy.find((b) => start < b.end && start + len > b.start);
        if (!clash) break;
        start = Math.ceil(clash.end);
      }
      const ev = { type: 'task', start, end: start + len, task: t, pinned: false };
      events.push(ev);
      busy.push(ev);
      cursor = ev.end;
    }
    const rank = { class: 0, session: 1, focus: 2, task: 3 };
    return events.sort((a, b) => a.start - b.start || rank[a.type] - rank[b.type]);
  }

  // The first task still ahead of `nowMin` on the laid-out day.
  function nextUp(events, nowMin) {
    return events.find((e) => e.type === 'task' && e.end > nowMin) || null;
  }

  // ---------- the queue ----------
  // The queue is today's open tasks in `order`. layoutDay works out their times;
  // the rows are those tasks plus the classes that fall inside the stretch they cover.

  // Rows for the list: tasks (numbered, in time order) and class blocks between them.
  function queueRows(opts) {
    const events = layoutDay(opts);
    const now = opts.now || new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const tasks = events.filter((e) => e.type === 'task');
    const last = tasks.length ? Math.max(...tasks.map((e) => e.end)) : -1;
    let n = 0;
    return events
      .filter((e) => e.type === 'task' || (e.type === 'class' && e.end > nowMin && e.start < last))
      .map((e) => (e.type === 'task' ? { ...e, n: ++n } : e));
  }

  // Ids of the open queued tasks (the running block is not in it), in queue order.
  function queueIds(tasks, today = dateKey(), focus = null) {
    return todayTasks(tasks, today)
      .filter((t) => !t.done && !(focus && focus.taskId === t.id))
      .map((t) => t.id);
  }

  // Order values for ids in their new sequence: {id: order}.
  function orderFor(ids) {
    return Object.fromEntries(ids.map((id, i) => [id, i + 1]));
  }

  // `ids` with `id` moved to index `to` (0 = top, ids.length = bottom).
  function moveId(ids, id, to) {
    const rest = ids.filter((x) => x !== id);
    rest.splice(Math.max(0, Math.min(rest.length, to)), 0, id);
    return rest;
  }

  // An `order` that puts a new task first in the queue (it runs next), or last when the queue is empty.
  function nextOrder(tasks, today = dateKey(), focus = null) {
    const ids = new Set(queueIds(tasks, today, focus));
    const orders = tasks.filter((t) => ids.has(t.id)).map((t) => t.order);
    return orders.length ? Math.min(...orders) - 1 : Date.now();
  }

  // ---------- guard (distraction gate) ----------

  const DEFAULT_SITES = ['youtube.com', 'reddit.com', 'instagram.com', 'tiktok.com', 'x.com', 'twitter.com', 'netflix.com', 'twitch.tv', 'facebook.com'];

  const DEFAULT_SETTINGS = {
    guardMode: 'smart', // off | focus | smart | always
    sites: DEFAULT_SITES,
    workStart: '15:00', // weekdays (after school)
    workEnd: '23:30',
    weekendStart: '10:00',
    weekendEnd: '23:30',
    checkinMinutes: 30, // nudge when no focus block runs during work hours (0 = off)
    planTime: '15:30',
    eodTime: '22:00',
    focusMinutes: 40,
    autoAdvance: true, // when a block ends, start the next one on the schedule
    alarmSound: true, // ring when a block ends
    passMinutes: 10,
    courses: DEFAULT_COURSES,
    blocks: DEFAULT_BLOCKS,
    theme: 'system', // system | light | dark
    palette: 'monitry',
    placement: 'panel', // panel | tab | newtab
    weeklyReviewDay: 0, // Sunday evening nudge
    onitry: { enabled: false, code: '', autoStart: true, autoStop: true, escalate: true, launch: true, port: 47323 },
  };

  function inWorkHours(settings, now = new Date()) {
    const weekend = now.getDay() === 0 || now.getDay() === 6;
    const start = minutesOfDay(weekend ? settings.weekendStart : settings.workStart);
    const end = minutesOfDay(weekend ? settings.weekendEnd : settings.workEnd);
    const m = now.getHours() * 60 + now.getMinutes();
    return start <= end ? m >= start && m < end : m >= start || m < end;
  }

  // Inside a class block marked free/study on today's school schedule.
  function inFreeBlock(settings, now = new Date()) {
    const b = settings.blocks;
    if (!b || !b.enabled) return null;
    const { blocks } = dayInfo(dateKey(now), b);
    const { current } = blockAt(blocks, now.getHours() * 60 + now.getMinutes());
    return isFreeBlock(current) ? current : null;
  }

  function urgentTasks(tasks, today = dateKey()) {
    const tomorrow = addDays(today, 1);
    return tasks.filter((t) => isOpen(t) && !t.someday && ((t.due && t.due <= tomorrow) || (t.plan && t.plan <= today)));
  }

  // Is the gate up right now, and why? `escalatedUntil`: Onitry caught you off
  // task during a focus block, which raises the gate even in "off" mode.
  // A paused block or a break block doesn't count as focusing.
  const isFocusing = (focus) => !!focus && focus.kind !== 'break' && !focus.pausedAt;

  function guardState(settings, focus, tasks, now = new Date(), escalatedUntil = 0) {
    const mode = settings.guardMode;
    const focusing = isFocusing(focus);
    if (focusing && escalatedUntil > now.getTime()) return { active: true, reason: 'onitry', strict: true };
    if (mode === 'off') return { active: false, reason: 'off' };
    if (focusing) return { active: true, reason: 'focus', strict: true };
    if (mode === 'focus') return { active: false, reason: 'no focus block' };
    if (mode === 'always') return { active: true, reason: 'always' };
    const urgent = urgentTasks(tasks, dateKey(now));
    if (urgent.length && inWorkHours(settings, now)) return { active: true, reason: 'urgent', urgent: urgent.length };
    if (urgent.length && inFreeBlock(settings, now)) return { active: true, reason: 'free block', urgent: urgent.length };
    return { active: false, reason: urgent.length ? 'outside work hours' : 'nothing urgent' };
  }

  function domainOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '').replace(/^m\./, '');
    } catch (_) {
      return '';
    }
  }

  function matchSite(host, sites) {
    return sites.find((s) => host === s || host.endsWith(`.${s}`)) || null;
  }

  const STRICT_SENTENCES = [
    'I am choosing to leave my focus block and I know exactly what I am supposed to be doing.',
    'My future self will have to finish this work later if I take this break right now.',
    'I set this focus block for a reason and I am about to break it on purpose.',
  ];

  // ---------- weekly review ----------
  // Everything the review needs, computed locally. Sent to Onitry (which owns the
  // API key) for the AI write-up; also rendered as-is in the Journal tab.

  function weekStats({ tasks = [], sessions = [], journal = {}, eod = {}, settings = DEFAULT_SETTINGS }, start) {
    const end = addDays(start, 7);
    const t0 = fromKey(start).getTime();
    const t1 = fromKey(end).getTime();
    const inWeek = (ts) => ts >= t0 && ts < t1;
    const round = (n) => Math.round(n);

    const done = tasks.filter((t) => t.done && inWeek(t.done));
    const missed = tasks.filter((t) => !t.done && !t.someday && t.due && t.due >= start && t.due < end && t.due < dateKey());
    const bySubject = {};
    for (const t of done) {
      const c = t.course || 'Other';
      bySubject[c] = bySubject[c] || { done: 0, missed: 0 };
      bySubject[c].done++;
    }
    for (const t of missed) {
      const c = t.course || 'Other';
      bySubject[c] = bySubject[c] || { done: 0, missed: 0 };
      bySubject[c].missed++;
    }

    const ss = sessions.filter((x) => inWeek(x.end) && x.kind !== 'break');
    const focusMin = ss.reduce((a, x) => a + x.minutes, 0);
    const watched = ss.filter((x) => x.onitry && x.onitry.onPct != null);
    const watchedMin = watched.reduce((a, x) => a + x.minutes, 0);
    const onPct = watchedMin ? round(watched.reduce((a, x) => a + x.onitry.onPct * x.minutes, 0) / watchedMin) : null;

    const days = [];
    const passes = [];
    const passSites = {};
    for (let d = start; d < end; d = addDays(d, 1)) {
      const entries = journal[d] || [];
      const dayStart = fromKey(d).getTime();
      const daySessions = ss.filter((x) => x.end >= dayStart && x.end < dayStart + DAY);
      for (const e of entries.filter((x) => x.kind === 'pass')) {
        passes.push(e.text.slice(0, 160));
        const site = e.text.split(' ')[0];
        passSites[site] = (passSites[site] || 0) + 1;
      }
      const e = eod[d];
      days.push({
        date: d,
        weekday: WEEKDAYS[fromKey(d).getDay()].slice(0, 3),
        letter: blockLetter(d, settings.blocks) || undefined,
        focusMin: daySessions.reduce((a, x) => a + x.minutes, 0),
        done: done.filter((t) => t.done >= dayStart && t.done < dayStart + DAY).length,
        rating: e ? e.rating : undefined,
        derails: e && e.derails && e.derails.length ? e.derails : undefined,
        notes: entries.filter((x) => x.kind === 'log' || x.kind === 'eod').map((x) => x.text.slice(0, 200)).slice(0, 8),
      });
    }

    const ratings = days.filter((d) => d.rating).map((d) => d.rating);
    const nextWeek = tasks
      .filter((t) => !t.done && t.due && t.due >= end && t.due < addDays(end, 7))
      .sort((a, b) => (a.due < b.due ? -1 : 1))
      .map((t) => ({ title: t.title, subject: t.course || undefined, kind: t.kind, due: t.due }));

    return {
      week: start,
      totals: {
        tasksDone: done.length,
        tasksMissed: missed.length,
        focusBlocks: ss.length,
        focusMinutes: focusMin,
        finishedOnTime: ss.filter((x) => x.outcome === 'done').length,
        onitryOnTaskPct: onPct,
        gatePasses: passes.length,
        avgRating: ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null,
        checkIns: ratings.length,
      },
      bySubject,
      passSites,
      passReasons: passes.slice(0, 20),
      missed: missed.slice(0, 15).map((t) => ({ title: t.title, subject: t.course || undefined, due: t.due })),
      days,
      nextWeek: nextWeek.slice(0, 20),
    };
  }

  // ---------- backup ----------
  // Everything under "pl:" except things that only make sense live: the running
  // block, gate passes and Onitry's last status. The Onitry pairing code stays
  // out of the file (it's a secret); after restoring you paste it in again.

  const BACKUP_SKIP = new Set(['pl:focus', 'pl:passes', 'pl:onitry']);

  function makeBackup(all, { now = Date.now(), version = '' } = {}) {
    const data = {};
    for (const [k, v] of Object.entries(all)) if (k.startsWith('pl:') && !BACKUP_SKIP.has(k)) data[k] = structuredCloneSafe(v);
    if (data['pl:settings'] && data['pl:settings'].onitry) data['pl:settings'].onitry.code = '';
    return { app: 'timecheck', format: 1, version, exported: new Date(now).toISOString(), data };
  }

  // Returns { ok, data, counts } or { ok: false, error }. Accepts files from before the rename.
  function parseBackup(text) {
    let b;
    try {
      b = JSON.parse(text);
    } catch (_) {
      return { ok: false, error: 'That file isn’t a backup (it isn’t valid JSON).' };
    }
    if (!b || typeof b !== 'object' || !['timecheck', 'onitry-plan'].includes(b.app) || !b.data || typeof b.data !== 'object') {
      return { ok: false, error: 'That file isn’t a Timecheck backup.' };
    }
    const data = {};
    for (const [k, v] of Object.entries(b.data)) if (k.startsWith('pl:') && !BACKUP_SKIP.has(k) && v !== undefined) data[k] = v;
    if (!Object.keys(data).length) return { ok: false, error: 'That backup is empty.' };
    const arr = (k) => (Array.isArray(data[k]) ? data[k].length : data[k] && typeof data[k] === 'object' ? Object.keys(data[k]).length : 0);
    return { ok: true, data, counts: { tasks: arr('pl:tasks'), sessions: arr('pl:sessions'), days: arr('pl:journal'), exported: b.exported || null } };
  }

  // Replace every restorable key with the backup's; keys the backup lacks are cleared.
  async function restoreBackup(data) {
    const all = await chrome.storage.local.get(null);
    const cur = all['pl:settings'] && all['pl:settings'].onitry;
    const remove = Object.keys(all).filter((k) => k.startsWith('pl:') && !BACKUP_SKIP.has(k) && !(k in data));
    const next = { ...data };
    if (next['pl:settings'] && cur && cur.code && !(next['pl:settings'].onitry && next['pl:settings'].onitry.code)) {
      next['pl:settings'] = { ...next['pl:settings'], onitry: { ...(next['pl:settings'].onitry || {}), code: cur.code } };
    }
    if (remove.length) await chrome.storage.local.remove(remove);
    await chrome.storage.local.set(next);
    return { restored: Object.keys(next).length, cleared: remove.length };
  }

  // ---------- storage ----------

  const K = {
    tasks: 'pl:tasks',
    focus: 'pl:focus',
    sessions: 'pl:sessions',
    journal: 'pl:journal',
    eod: 'pl:eod',
    passes: 'pl:passes',
    settings: 'pl:settings',
    onitry: 'pl:onitry',
    meta: 'pl:meta',
    reviews: 'pl:reviews',
  };

  const store = {
    async get(key, fallback) {
      const d = await chrome.storage.local.get(key);
      return d[key] === undefined ? fallback : d[key];
    },
    set(key, value) {
      return chrome.storage.local.set({ [key]: value });
    },
    // Read-modify-write so two open views don't clobber each other's edits.
    async update(key, fallback, fn) {
      const cur = await store.get(key, fallback);
      const next = await fn(structuredCloneSafe(cur));
      await store.set(key, next);
      return next;
    },
  };

  function structuredCloneSafe(v) {
    return typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v));
  }

  async function getSettings() {
    const s = await store.get(K.settings, {});
    return {
      ...DEFAULT_SETTINGS,
      ...s,
      blocks: { ...DEFAULT_BLOCKS, ...(s.blocks || {}) },
      onitry: { ...DEFAULT_SETTINGS.onitry, ...(s.onitry || {}) },
    };
  }

  async function setSettings(patch) {
    return store.update(K.settings, {}, (s) => ({ ...s, ...patch }));
  }

  async function addTasks(list) {
    return store.update(K.tasks, [], (tasks) => tasks.concat(list));
  }

  async function updateTask(id, patch) {
    return store.update(K.tasks, [], (tasks) => tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  async function removeTask(id) {
    return store.update(K.tasks, [], (tasks) => tasks.filter((t) => t.id !== id));
  }

  async function log(text, kind = 'log', at = Date.now()) {
    const k = dateKey(new Date(at));
    return store.update(K.journal, {}, (j) => {
      (j[k] = j[k] || []).push({ t: at, text, kind });
      return j;
    });
  }

  // First run: seed the "nothing to do" list from the journal's recurring projects.
  async function ensureSeeded() {
    const meta = await store.get(K.meta, {});
    if (meta.seeded) return false;
    const seeds = [
      ['Finish the CV2 screen-grab project', 'CV2', 60],
      ['Work on Onitry', 'Onitry', 60],
      ['CAD the dynamic claw', 'CAD', 45],
      ['Write 2 internship cold emails', null, 30],
      ['Update personal website + CV', null, 45],
      ['Kaggle practice', 'Kaggle', 30],
    ].map(([title, course, estimate], i) => makeTask({ title, course, estimate, someday: true, order: i }));
    await store.update(K.tasks, [], (tasks) => (tasks.length ? tasks : seeds));
    await store.set(K.meta, { ...meta, seeded: Date.now() });
    return true;
  }

  g.InkPlan = {
    DAY, WEEKDAYS, COLORS, DEFAULT_COURSES, DEFAULT_SETTINGS, DEFAULT_SITES, DEFAULT_BLOCKS, STRICT_SENTENCES, K,
    dateKey, fromKey, addDays, daysBetween, weekStart, relDay, minutesOfDay, fmtTime, fmtMinutes, hhmm,
    courseIndex, courseColor, makeTask, newId, isOpen,
    todayTasks, upcoming, overdue, schedule, urgentTasks,
    inWorkHours, inFreeBlock, guardState, isFocusing,
    taskMinutes, focusEndsAt, badgeFor, layoutDay, nextUp, queueRows, queueIds, orderFor, moveId, nextOrder, domainOf, matchSite,
    blockLetter, isSchoolDay, dayInfo, expandRange, dateRanges, isFreeBlock, blockAt, nextLetterDate, parseSchedule, formatSchedule,
    weekStats,
    makeBackup, parseBackup, restoreBackup,
    store, getSettings, setSettings, addTasks, updateTask, removeTask, log, ensureSeeded,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
