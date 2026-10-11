// InkPlan: data model, natural-language quick add, dates and storage for the
// "Today" planner. Shared by the Today page, the distraction gate and the
// service worker; also loads in Node for unit tests.
(function (g) {
  'use strict';
  if (g.InkPlan) return;

  // ---------- dates ----------

  const DAY = 86400000;
  const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const WD_ALIASES = {
    sun: 0, sunday: 0,
    mon: 1, monday: 1,
    tue: 2, tues: 2, tuesday: 2,
    wed: 3, weds: 3, wednesday: 3,
    thu: 4, thur: 4, thurs: 4, thursday: 4,
    fri: 5, friday: 5,
    sat: 6, saturday: 6,
  };
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

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

  // ---------- quick add ----------

  const TEST_WORDS = /\b(test|quiz|exam|summative|midterm|final|assessment|ils|psat|sat)\b/i;
  const DATE_PREPS = new Set(['due', 'on', 'by', 'for', 'before', 'this']);

  // Parse one line like "calc hw due thu 40m" or "econ test fri" or "~ cad the claw".
  function parseQuick(input, { courses = DEFAULT_COURSES, today = dateKey() } = {}) {
    let text = String(input || '').trim();
    const out = { title: '', course: null, kind: 'todo', due: null, plan: null, estimate: null, someday: false };
    if (!text) return out;

    if (/^(~|someday\b:?|later:)/i.test(text)) {
      out.someday = true;
      text = text.replace(/^(~|someday\b:?|later:)\s*/i, '');
    }

    // Estimates: 40m, 40 min, 1h, 1.5h, 1h30
    text = text.replace(/(?:^|\s)(\d+(?:\.\d+)?)\s*h(?:rs?|ours?)?\s*(\d+)\s*m?(?:in(?:s|utes?)?)?(?=\s|$)/i, (m, h, mm) => {
      out.estimate = Math.round(parseFloat(h) * 60 + parseInt(mm, 10));
      return ' ';
    });
    text = text.replace(/(?:^|\s)(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)(?=\s|$)/i, (m, n, unit) => {
      out.estimate = Math.round(parseFloat(n) * (/^h/i.test(unit) ? 60 : 1));
      return ' ';
    });

    const words = text.split(/\s+/).filter(Boolean);
    const keep = [];
    const setDue = (k) => {
      if (!out.due) out.due = k;
    };
    for (let i = 0; i < words.length; i++) {
      const raw = words[i];
      const w = raw.toLowerCase().replace(/[.,;!?]+$/, '');
      const next = (words[i + 1] || '').toLowerCase().replace(/[.,;!?]+$/, '');
      let consumed = 0;
      let date = null;

      if (w === 'today' || w === 'tonight' || w === 'tn') date = today;
      else if (['tmrw', 'tmr', 'tomorrow', 'tmw', 'tom'].includes(w)) date = addDays(today, 1);
      else if (w === 'next' && WD_ALIASES[next] !== undefined) {
        date = addDays(weekStart(addDays(today, 7)), (WD_ALIASES[next] + 6) % 7);
        consumed = 1;
      } else if (WD_ALIASES[w] !== undefined) {
        const diff = (WD_ALIASES[w] - fromKey(today).getDay() + 7) % 7;
        date = addDays(today, diff); // "fri" said on a Friday means today
      } else if (/^\d{1,2}\/\d{1,2}$/.test(w)) {
        const [mo, d] = w.split('/').map(Number);
        date = resolveMonthDay(mo, d, today);
      } else if (MONTHS.includes(w.slice(0, 3)) && /^\d{1,2}(st|nd|rd|th)?$/.test(next)) {
        date = resolveMonthDay(MONTHS.indexOf(w.slice(0, 3)) + 1, parseInt(next, 10), today);
        consumed = 1;
      } else if (/^\d{1,2}(st|nd|rd|th)?$/.test(w) && MONTHS.includes(next.slice(0, 3))) {
        date = resolveMonthDay(MONTHS.indexOf(next.slice(0, 3)) + 1, parseInt(w, 10), today);
        consumed = 1;
      } else if (w === 'in' && /^\d+$/.test(next) && /^(day|days|d)$/.test((words[i + 2] || '').toLowerCase())) {
        date = addDays(today, parseInt(next, 10));
        consumed = 2;
      }

      if (date) {
        setDue(date);
        // Drop a dangling "due"/"on"/"by" right before the date.
        if (keep.length && DATE_PREPS.has(keep[keep.length - 1].toLowerCase())) keep.pop();
        i += consumed;
        continue;
      }
      if (w === 'due' && i === words.length - 1) continue;
      keep.push(raw);
    }

    // Course: explicit #tag first, then any word matching a course or alias.
    const idx = courseIndex(courses);
    const titleWords = [];
    for (const raw of keep) {
      const w = raw.toLowerCase().replace(/[.,;:!?]+$/, '');
      if (w.startsWith('#') && w.length > 1) {
        const name = idx.get(w.slice(1));
        out.course = out.course || name || raw.slice(1);
        if (name) continue; // "#calc" → tag only
      } else if (!out.course && idx.has(w)) {
        out.course = idx.get(w);
      }
      titleWords.push(raw);
    }
    out.title = titleWords.join(' ').replace(/\s+/g, ' ').trim() || String(input).trim();

    if (TEST_WORDS.test(out.title)) out.kind = 'test';
    else if (out.due) out.kind = 'due';
    if (!out.due && !out.someday) out.plan = today; // undated things are for today
    return out;
  }

  function resolveMonthDay(mo, d, today) {
    const t = fromKey(today);
    let y = t.getFullYear();
    let k = `${y}-${pad(mo)}-${pad(d)}`;
    if (daysBetween(today, k) < -60) k = `${y + 1}-${pad(mo)}-${pad(d)}`; // "1/5" in December → next year
    return k;
  }

  // ---------- tasks & views ----------

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
    passMinutes: 10,
    courses: DEFAULT_COURSES,
    onitry: { enabled: false, code: '', autoStart: true, autoStop: true, port: 47323 },
  };

  function inWorkHours(settings, now = new Date()) {
    const weekend = now.getDay() === 0 || now.getDay() === 6;
    const start = minutesOfDay(weekend ? settings.weekendStart : settings.workStart);
    const end = minutesOfDay(weekend ? settings.weekendEnd : settings.workEnd);
    const m = now.getHours() * 60 + now.getMinutes();
    return start <= end ? m >= start && m < end : m >= start || m < end;
  }

  function urgentTasks(tasks, today = dateKey()) {
    const tomorrow = addDays(today, 1);
    return tasks.filter((t) => isOpen(t) && !t.someday && ((t.due && t.due <= tomorrow) || (t.plan && t.plan <= today)));
  }

  // Is the gate up right now, and why?
  function guardState(settings, focus, tasks, now = new Date()) {
    const mode = settings.guardMode;
    if (mode === 'off') return { active: false, reason: 'off' };
    if (focus) return { active: true, reason: 'focus', strict: true };
    if (mode === 'focus') return { active: false, reason: 'no focus block' };
    if (mode === 'always') return { active: true, reason: 'always' };
    const urgent = urgentTasks(tasks, dateKey(now));
    if (urgent.length && inWorkHours(settings, now)) return { active: true, reason: 'urgent', urgent: urgent.length };
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
    return { ...DEFAULT_SETTINGS, ...s, onitry: { ...DEFAULT_SETTINGS.onitry, ...(s.onitry || {}) } };
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
    DAY, WEEKDAYS, COLORS, DEFAULT_COURSES, DEFAULT_SETTINGS, DEFAULT_SITES, STRICT_SENTENCES, K,
    dateKey, fromKey, addDays, daysBetween, weekStart, relDay, minutesOfDay, fmtTime, fmtMinutes, hhmm,
    courseIndex, courseColor, parseQuick, makeTask, newId, isOpen,
    todayTasks, upcoming, overdue, schedule, urgentTasks,
    inWorkHours, guardState, domainOf, matchSite,
    store, getSettings, setSettings, addTasks, updateTask, removeTask, log, ensureSeeded,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
