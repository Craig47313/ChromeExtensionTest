// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
require('../lib/planner.js');
const P = globalThis.InkPlan;

const TODAY = '2026-10-08'; // a Thursday

test('today list includes due tomorrow and tests within 2 days', () => {
  const tasks = [
    P.makeTask({ title: 'a', plan: TODAY }),
    P.makeTask({ title: 'b', due: '2026-10-09', kind: 'due' }),
    P.makeTask({ title: 'c', due: '2026-10-12', kind: 'due' }),
    P.makeTask({ title: 'd', due: '2026-10-10', kind: 'test' }),
    P.makeTask({ title: 'e', someday: true }),
    P.makeTask({ title: 'f', due: '2026-10-05', kind: 'due' }),
  ];
  const titles = P.todayTasks(tasks, TODAY).map((t) => t.title).sort();
  assert.deepEqual(titles, ['a', 'b', 'd', 'f']);
});

test('guard: smart mode needs urgent work and work hours', () => {
  const s = { ...P.DEFAULT_SETTINGS };
  const urgent = [P.makeTask({ title: 'x', due: TODAY, kind: 'due' })];
  const evening = new Date(2026, 9, 8, 19, 0);
  const morning = new Date(2026, 9, 8, 9, 0);
  assert.equal(P.guardState(s, null, urgent, evening).active, true);
  assert.equal(P.guardState(s, null, urgent, morning).active, false);
  assert.equal(P.guardState(s, null, [], evening).active, false);
  assert.equal(P.guardState(s, { title: 'f' }, [], morning).active, true);
  assert.equal(P.guardState({ ...s, guardMode: 'off' }, { title: 'f' }, urgent, evening).active, false);
});

test('site matching', () => {
  assert.equal(P.matchSite(P.domainOf('https://www.youtube.com/watch?v=1'), P.DEFAULT_SITES), 'youtube.com');
  assert.equal(P.matchSite(P.domainOf('https://m.youtube.com/'), P.DEFAULT_SITES), 'youtube.com');
  assert.equal(P.matchSite('notyoutube.com', P.DEFAULT_SITES), null);
});

test('schedule lays tasks end to end', () => {
  const s = P.schedule([P.makeTask({ estimate: 40 }), P.makeTask({})], 17 * 60, 30);
  assert.equal(s[0].end, 17 * 60 + 40);
  assert.equal(s[1].start, 17 * 60 + 40);
  assert.equal(s[1].end, 17 * 60 + 70);
});

// ---------- block days ----------

const B = { ...P.DEFAULT_BLOCKS, anchorDate: '2026-10-13', anchorLetter: 'C' };

test('block letters rotate on Tue–Fri and skip Mondays', () => {
  const got = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-19', '2026-10-20'].map((d) => P.blockLetter(d, B));
  assert.deepEqual(got, [null, 'C', 'D', 'A', 'B', null, 'C']);
  assert.equal(P.blockLetter('2026-10-09', B), 'B'); // works backwards too
});

test('a skipped day pauses the rotation', () => {
  const b = { ...B, skip: ['2026-10-14'] };
  assert.equal(P.blockLetter('2026-10-14', b), null);
  assert.equal(P.blockLetter('2026-10-15', b), 'D');
});

test('an anchor on a non-letter day names the next letter day', () => {
  const b = { ...B, anchorDate: '2026-10-12', anchorLetter: 'C' }; // Monday
  assert.equal(P.blockLetter('2026-10-13', b), 'C');
  assert.equal(P.blockLetter('2026-10-09', b), 'B');
});

test('schedule text round-trips and finds the current block', () => {
  const sched = P.parseSchedule('A\n8:00-9:20 Calc\n09:30 - 10:50 Free block\n\nOther:\n08:00-08:45 Calc');
  assert.deepEqual(sched.A[0], { start: '08:00', end: '09:20', label: 'Calc' });
  assert.equal(sched.Other.length, 1);
  assert.deepEqual(P.parseSchedule(P.formatSchedule(sched)), sched);
  const info = P.dayInfo('2026-10-15', { ...B, schedule: sched }); // an A day
  assert.equal(info.letter, 'A');
  const at = P.blockAt(info.blocks, 9 * 60 + 40);
  assert.equal(at.current.label, 'Free block');
  assert.ok(P.isFreeBlock(at.current));
  assert.equal(P.dayInfo('2026-10-12', { ...B, schedule: sched }).blocks[0].label, 'Calc'); // Monday → Other
});

// ---------- escalation & weekly stats ----------

test('Onitry escalation raises the gate during focus, even when off', () => {
  const now = new Date(2026, 9, 12, 16, 0);
  const s = { ...P.DEFAULT_SETTINGS, guardMode: 'off' };
  assert.equal(P.guardState(s, { title: 'x' }, [], now, now.getTime() + 60000).reason, 'onitry');
  assert.equal(P.guardState(s, { title: 'x' }, [], now, now.getTime() - 1).active, false);
  assert.equal(P.guardState(s, null, [], now, now.getTime() + 60000).active, false);
});

test('weekStats totals a week', () => {
  const start = '2026-10-05';
  const at = (d, h) => new Date(...d.split('-').map((x, i) => (i === 1 ? x - 1 : +x)), h).getTime();
  const stats = P.weekStats(
    {
      tasks: [
        P.makeTask({ title: 'calc hw', course: 'Calc', done: at('2026-10-06', 20) }),
        P.makeTask({ title: 'lang essay', course: 'Lang', kind: 'due', due: '2026-10-07' }),
        P.makeTask({ title: 'econ test', course: 'Econ', kind: 'test', due: '2026-10-14' }),
      ],
      sessions: [
        { end: at('2026-10-06', 20), minutes: 40, outcome: 'done', onitry: { onPct: 90 } },
        { end: at('2026-10-07', 21), minutes: 20, outcome: 'stopped', onitry: { onPct: 60 } },
      ],
      journal: { '2026-10-07': [{ t: 0, kind: 'pass', text: 'youtube.com for 10m — “khan video”' }] },
      eod: { '2026-10-06': { rating: 4, derails: ['Phone'] } },
      settings: { ...P.DEFAULT_SETTINGS, blocks: B },
    },
    start
  );
  assert.equal(stats.totals.tasksDone, 1);
  assert.equal(stats.totals.tasksMissed, 1);
  assert.equal(stats.totals.focusMinutes, 60);
  assert.equal(stats.totals.onitryOnTaskPct, 80);
  assert.equal(stats.passSites['youtube.com'], 1);
  assert.equal(stats.days[1].letter, 'C'); // Tue 10/6
  assert.equal(stats.nextWeek[0].title, 'econ test');
});

test('breaks expand to dates and collapse back to ranges', () => {
  const days = P.expandRange('2026-10-19', '2026-10-23');
  assert.equal(days.length, 5);
  assert.deepEqual(P.dateRanges([...days, '2026-11-26', '2026-10-21']), [['2026-10-19', '2026-10-23'], ['2026-11-26', '2026-11-26']]);
  assert.deepEqual(P.expandRange('2026-10-19', '2026-10-01'), ['2026-10-19']); // backwards "to" → one day
  const b = { ...B, skip: days };
  assert.equal(P.blockLetter('2026-10-20', b), null); // on break
  assert.equal(P.blockLetter('2026-10-27', b), P.blockLetter('2026-10-20', B)); // rotation picks up where it paused
});

// ---------- schedule ----------

const T22 = '2026-10-22'; // Thursday
const at = (h, m = 0) => new Date(2026, 9, 22, h, m);

test('layoutDay runs tasks back to back from now, around classes and pins', () => {
  const tasks = [
    P.makeTask({ title: 'econ', plan: T22, estimate: 30, order: 1 }),
    P.makeTask({ title: 'break', kind: 'break', plan: T22, estimate: 10, order: 2 }),
    P.makeTask({ title: 'physics', plan: T22, estimate: 30, order: 3 }),
    P.makeTask({ title: 'mun call', plan: T22, estimate: 20, at: '15:50', order: 4 }),
  ];
  const settings = { ...P.DEFAULT_SETTINGS, blocks: { ...B, schedule: { A: [{ start: '15:10', end: '15:30', label: 'Advisory' }] } } };
  const ev = P.layoutDay({ tasks, settings, today: T22, now: at(15, 2) }).filter((e) => e.type !== 'session');
  const byTitle = Object.fromEntries(ev.filter((e) => e.task).map((e) => [e.task.title, [e.start, e.end]]));
  // Advisory (15:10–15:30) blocks 15:02; 15:30 is too short before the pinned 15:50 call → econ after it.
  assert.deepEqual(byTitle['mun call'], [15 * 60 + 50, 16 * 60 + 10]);
  assert.deepEqual(byTitle.econ, [16 * 60 + 10, 16 * 60 + 40]);
  assert.deepEqual(byTitle.break, [16 * 60 + 40, 16 * 60 + 50]);
  assert.deepEqual(byTitle.physics, [16 * 60 + 50, 17 * 60 + 20]);
  assert.equal(P.nextUp(ev, 15 * 60 + 2).task.title, 'mun call');
});

test('layoutDay: a running (or paused) block pushes the flow back', () => {
  const tasks = [P.makeTask({ title: 'econ', plan: T22, estimate: 30 }), P.makeTask({ title: 'physics', plan: T22, estimate: 30 })];
  const focus = { taskId: tasks[0].id, startedAt: at(15, 0).getTime(), endsAt: at(15, 30).getTime() };
  let ev = P.layoutDay({ tasks, focus, today: T22, now: at(15, 10) });
  assert.deepEqual(ev.map((e) => e.type), ['focus', 'task']);
  assert.equal(ev[1].start, 15 * 60 + 30);
  // paused at 15:10, now 15:20 → block now ends 15:40, physics at 15:40
  ev = P.layoutDay({ tasks, focus: { ...focus, pausedAt: at(15, 10).getTime() }, today: T22, now: at(15, 20) });
  assert.equal(ev[1].start, 15 * 60 + 40);
});

test('paused and break blocks are not strict focus', () => {
  const now = new Date(2026, 9, 22, 16, 0);
  const s = { ...P.DEFAULT_SETTINGS, guardMode: 'focus' };
  assert.equal(P.guardState(s, { title: 'x' }, [], now).strict, true);
  assert.equal(P.guardState(s, { title: 'x', pausedAt: 1 }, [], now).active, false);
  assert.equal(P.guardState(s, { title: 'break', kind: 'break' }, [], now).active, false);
});

test('badge: minutes round up, seconds at the end, never counts over', () => {
  const now = 1_000_000;
  const f = (ms, extra = {}) => P.badgeFor({ startedAt: now - 1, endsAt: now + ms, ...extra }, { now });
  assert.equal(f(25 * 60000).text, '25m');
  assert.equal(f(24 * 60000 + 1).text, '25m');
  assert.equal(f(60000).text, '1m');
  assert.equal(f(59000).text, '<1m');
  assert.equal(P.badgeFor({ endsAt: now + 42000 }, { now, seconds: true }).text, '42s');
  assert.equal(f(-180000).text, 'END'); // no "+3"
  assert.equal(f(5000, { timeUpAt: now }).text, 'END');
  assert.equal(f(5000, { pausedAt: now }).text, '❚❚');
  assert.equal(P.badgeFor(null).text, '');
});

// ---------- backup ----------

test('backup keeps data, drops live state, and strips the pairing code', () => {
  const all = {
    'pl:tasks': [P.makeTask({ title: 'a' })],
    'pl:journal': { '2026-10-22': [{ t: 1, text: 'x', kind: 'log' }] },
    'pl:settings': { ...P.DEFAULT_SETTINGS, onitry: { ...P.DEFAULT_SETTINGS.onitry, enabled: true, code: 'SECRET-CODE' } },
    'pl:focus': { title: 'running' },
    'pl:passes': { 'youtube.com': 1 },
    'pl:onitry': { running: true },
    'ui:other': 1,
  };
  const b = P.makeBackup(all, { now: 0 });
  assert.equal(b.app, 'timecheck');
  assert.deepEqual(Object.keys(b.data).sort(), ['pl:journal', 'pl:settings', 'pl:tasks']);
  assert.equal(JSON.stringify(b).includes('SECRET-CODE'), false);
  assert.equal(all['pl:settings'].onitry.code, 'SECRET-CODE'); // the original is untouched
  const parsed = P.parseBackup(JSON.stringify(b));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.counts.tasks, 1);
  assert.equal(parsed.counts.days, 1);
});

test('parseBackup rejects what isn’t a backup and accepts the old name', () => {
  assert.equal(P.parseBackup('nope').ok, false);
  assert.equal(P.parseBackup('{"app":"inkwell","data":{"pl:tasks":[]}}').ok, false);
  assert.equal(P.parseBackup('{"app":"timecheck","data":{"other":1}}').ok, false);
  assert.equal(P.parseBackup('{"app":"onitry-plan","data":{"pl:tasks":[1],"pl:focus":{},"evil":2}}').counts.tasks, 1);
  assert.deepEqual(Object.keys(P.parseBackup('{"app":"onitry-plan","data":{"pl:tasks":[1],"pl:focus":{},"evil":2}}').data), ['pl:tasks']);
});

// ---------- the queue ----------

test('queue rows number the tasks, route around a class, and keep a set-time block at its time', () => {
  const tasks = [
    P.makeTask({ title: 'econ', plan: T22, estimate: 30, order: 1 }),
    P.makeTask({ title: 'physics', plan: T22, estimate: 30, order: 2 }),
    P.makeTask({ title: 'call', plan: T22, estimate: 20, at: '17:00', order: 3 }),
    P.makeTask({ title: 'cad', plan: T22, estimate: 30, order: 4 }),
  ];
  const settings = { ...P.DEFAULT_SETTINGS, blocks: { ...B, schedule: { A: [{ start: '15:30', end: '16:00', label: 'Advisory' }], Other: [{ start: '15:30', end: '16:00', label: 'Advisory' }] } } };
  const rows = P.queueRows({ tasks, settings, today: T22, now: at(15, 2) });
  const label = (r) => (r.type === 'class' ? `class:${r.block.label}` : r.task.title);
  // econ 15:02→15:32 would clash with the 15:30 class, so it waits until 16:00.
  assert.deepEqual(rows.map(label), ['class:Advisory', 'econ', 'physics', 'call', 'cad']);
  const t = Object.fromEntries(rows.filter((r) => r.task).map((r) => [r.task.title, [r.start, r.end, r.n]]));
  assert.deepEqual(t.econ, [16 * 60, 16 * 60 + 30, 1]);
  assert.deepEqual(t.physics, [16 * 60 + 30, 17 * 60, 2]);
  assert.deepEqual(t.call, [17 * 60, 17 * 60 + 20, 3]); // pinned
  assert.deepEqual(t.cad, [17 * 60 + 20, 17 * 60 + 50, 4]);
  // A class after the last block, or one that already ended, is not a row.
  const later = { ...settings, blocks: { ...B, schedule: { Other: [{ start: '19:00', end: '20:00', label: 'Late' }, { start: '14:00', end: '14:30', label: 'Past' }] } } };
  assert.ok(!P.queueRows({ tasks, settings: later, today: T22, now: at(15, 2) }).some((r) => r.type === 'class'));
});

test('reordering: ids move, orders renumber, "next" goes in front', () => {
  const a = P.makeTask({ title: 'a', plan: T22, order: 5 });
  const b = P.makeTask({ title: 'b', plan: T22, order: 6 });
  const c = P.makeTask({ title: 'c', plan: T22, order: 7 });
  const done = P.makeTask({ title: 'd', plan: T22, order: 1, done: at(9).getTime() });
  const tasks = [c, a, done, b];
  const ids = P.queueIds(tasks, T22);
  assert.deepEqual(ids, [a.id, b.id, c.id]);
  assert.deepEqual(P.moveId(ids, c.id, 0), [c.id, a.id, b.id]);
  assert.deepEqual(P.moveId(ids, a.id, 99), [b.id, c.id, a.id]);
  assert.deepEqual(P.orderFor([c.id, a.id]), { [c.id]: 1, [a.id]: 2 });
  assert.ok(P.nextOrder(tasks, T22) < 5);
  assert.deepEqual(P.queueIds(tasks, T22, { taskId: a.id }), [b.id, c.id]); // the running block isn't queued
});

// ---------- breaks and the off switch ----------

test('a break or the off switch opens the gate, even in strict modes', () => {
  const now = new Date(2026, 9, 22, 16, 0);
  const s = { ...P.DEFAULT_SETTINGS, guardMode: 'always' };
  assert.equal(P.guardState(s, null, [], now).active, true);
  assert.equal(P.guardState(s, { title: 'break', kind: 'break' }, [], now).active, false);
  assert.equal(P.guardState(s, { title: 'x' }, [], now, now.getTime() + 1e6).active, true); // escalated
  const off = P.guardState(s, { title: 'x' }, [], now, now.getTime() + 1e6, now.getTime() + 60000);
  assert.equal(off.active, false);
  assert.equal(off.reason, 'off switch');
  assert.equal(P.guardState(s, null, [], now, 0, now.getTime() - 1).active, true); // it ran out
});

test('break budget counts finished breaks today plus the one running', () => {
  const now = at(15, 0).getTime();
  const sessions = [
    { kind: 'break', end: at(10, 0).getTime(), minutes: 20 },
    { kind: 'focus', end: at(11, 0).getTime(), minutes: 40 },
    { kind: 'break', end: new Date(2026, 9, 21, 12, 0).getTime(), minutes: 30 }, // yesterday
  ];
  const settings = { ...P.DEFAULT_SETTINGS, breakBudget: 45 };
  assert.equal(P.breakUsed({ sessions, now }), 20);
  const focus = { kind: 'break', startedAt: at(14, 50).getTime(), endsAt: at(15, 10).getTime(), pausedMs: 0 };
  assert.equal(P.breakUsed({ sessions, focus, now }), 30); // 10 minutes into it
  let st = P.breakStatus(settings, { sessions, focus, now });
  assert.deepEqual([st.used, st.budget, st.left, st.over], [30, 45, 15, false]);
  st = P.breakStatus(settings, { sessions: sessions.concat({ kind: 'break', end: at(12).getTime(), minutes: 25 }), now });
  assert.equal(st.over, true);
  assert.equal(P.breakStatus({ ...settings, breakBudget: 0 }, { now }).over, true);
});

test('the off-switch code is stored hashed and checked', async () => {
  assert.equal(P.validCode('1234'), true);
  assert.equal(P.validCode('123'), false);
  assert.equal(P.validCode('1234567'), false);
  assert.equal(P.validCode('12a4'), false);
  const stored = await P.makeOffCode('4821');
  assert.ok(!JSON.stringify(stored).includes('4821'));
  assert.equal(await P.checkOffCode('4821', stored), true);
  assert.equal(await P.checkOffCode('4822', stored), false);
  assert.equal(await P.checkOffCode('4821', null), false);
  const again = await P.makeOffCode('4821');
  assert.notEqual(again.hash, stored.hash); // fresh salt each time
});

test('off-switch choices: 15 min, 1 hour, rest of today', () => {
  const now = at(21, 40).getTime();
  assert.deepEqual([P.offWindow('15m', now).until - now, P.offWindow('15m', now).pauseMinutes], [15 * 60000, 15]);
  assert.equal(P.offWindow('1h', now).pauseMinutes, 60);
  const day = P.offWindow('day', now);
  assert.equal(day.until, new Date(2026, 9, 23, 0, 0).getTime());
  assert.equal(day.pauseMinutes, null);
  assert.equal(P.offWindow('nope', now), null);
});

// ---------- activities ----------

const sess = (title, minutes, daysAgo, o = {}) => {
  const end = at(14, 0).getTime() - daysAgo * 86400000;
  return { id: `${title}${daysAgo}`, title, kind: 'focus', minutes, planned: minutes, start: end - minutes * 60000, end, outcome: 'done', ...o };
};

test('activity names match ignoring case and spacing; stats come from the sessions', () => {
  assert.equal(P.actKey('  CAD   the Claw '), 'cad the claw');
  const act = { id: 'a1', name: 'CAD the claw', key: 'cad the claw' };
  const sessions = [
    sess('CAD the claw', 40, 9), sess('cad the  claw', 40, 6), sess('CAD the claw', 60, 3), sess('CAD the claw', 30, 2),
    sess('CAD the claw', 45, 1, { onitry: { onPct: 80 } }), sess('CAD the claw', 45, 0, { onitry: { onPct: 60 } }), sess('Other', 99, 0),
    sess('CAD the claw', 10, 0, { kind: 'break' }),
  ];
  const st = P.activityStats(act, sessions, { now: at(15, 0).getTime() });
  assert.equal(st.blocks, 6);
  assert.equal(st.total, 40 + 40 + 60 + 30 + 45 + 45);
  assert.equal(st.usual, 45); // median of the last five: 40, 60, 30, 45, 45 → 45
  assert.equal(st.onPct, 70);
  assert.equal(st.recent.length, 6);
  assert.equal(P.activityStats(act, [], {}).usual, null);
  // A session that points at an activity by id isn't claimed by a same-named one.
  assert.equal(P.activityStats(act, [sess('CAD the claw', 30, 1, { activityId: 'other' })]).blocks, 0);
});

test('relative "last done" wording', () => {
  const now = at(15).getTime();
  assert.equal(P.ago(now, now), 'today');
  assert.equal(P.ago(now - 86400000, now), 'yesterday');
  assert.equal(P.ago(now - 2 * 86400000, now), '2 days ago');
  assert.equal(P.ago(now - 21 * 86400000, now), '3 weeks ago');
});

test('suggestions: word starts first, then recent and frequent, with homework and Free time tags', () => {
  const now = at(15).getTime();
  const acts = ['CAD the claw', 'CAD mounting brackets', 'Finish CAD lessons', 'Decade review', 'Econ practice'].map((name, i) => ({ id: `a${i}`, name, key: P.actKey(name) }));
  const sessions = [sess('CAD the claw', 40, 2), sess('CAD the claw', 40, 5), sess('CAD mounting brackets', 30, 8), sess('Finish CAD lessons', 30, 1), sess('Decade review', 20, 0), sess('Econ practice', 30, 0)];
  const tasks = [
    P.makeTask({ title: 'CAD mounting brackets', activityId: 'a1', due: '2026-10-23', kind: 'due' }),
    P.makeTask({ title: 'Finish CAD lessons', activityId: 'a2', someday: true }),
  ];
  const out = P.suggest('cad', acts, sessions, tasks, { now });
  // "Decade review" only contains "cad": it comes after the three that have a word starting with it.
  assert.deepEqual(out.map((r) => r.activity.name), ['Finish CAD lessons', 'CAD the claw', 'CAD mounting brackets', 'Decade review']);
  assert.equal(out[0].tag, 'Free time');
  assert.equal(out[2].tag, 'Due tomorrow');
  assert.equal(out[1].stats.usual, 40);
  assert.deepEqual(P.suggest('', acts, sessions, tasks, { now }), []);
  assert.deepEqual(P.suggest('zzz', acts, sessions, tasks, { now }), []);
  // An activity with no sessions and no task isn't suggested.
  assert.deepEqual(P.suggest('econ', acts, [], [], { now }), []);
});

test('first run builds activities from tasks and sessions; adding links tasks; reflections reach the Log', async () => {
  const mem = {};
  globalThis.chrome = { storage: { local: { get: async (k) => (typeof k === 'string' ? { [k]: mem[k] } : { ...mem }), set: async (o) => Object.assign(mem, o) } } };
  const K = P.K;
  mem[K.tasks] = [P.makeTask({ title: 'Calc hw', course: 'Calc' }), P.makeTask({ title: 'snack', kind: 'break' }), P.makeTask({ title: 'calc  HW' })];
  mem[K.sessions] = [sess('CAD the claw', 40, 1, { course: 'CAD' })];
  let acts = await P.syncActivities();
  assert.deepEqual(acts.map((a) => a.name).sort(), ['CAD the claw', 'Calc hw']);
  assert.equal(acts.find((a) => a.key === 'calc hw').course, 'Calc');
  assert.ok(mem[K.tasks].filter((t) => t.kind !== 'break').every((t) => t.activityId === acts.find((a) => a.key === 'calc hw').id));
  assert.equal(mem[K.tasks].find((t) => t.kind === 'break').activityId, null);
  await P.addTasks([P.makeTask({ title: 'Econ Practice' })]);
  assert.equal(mem[K.activities].length, 3);
  await P.addTasks([P.makeTask({ title: 'econ practice' })]);
  assert.equal(mem[K.activities].length, 3); // reused
  const econ = mem[K.activities].find((a) => a.key === 'econ practice');
  assert.equal(mem[K.tasks].filter((t) => t.activityId === econ.id).length, 2);
  // Renaming a task re-links it.
  const t = mem[K.tasks].find((x) => x.title === 'Econ Practice');
  await P.updateTask(t.id, { title: 'Spanish quiz' });
  assert.equal(mem[K.tasks].find((x) => x.id === t.id).activityId, mem[K.activities].find((a) => a.key === 'spanish quiz').id);
  await P.addReflection(econ.id, { text: 'Went well', minutes: 30, onPct: 90, at: at(14).getTime() });
  assert.equal(mem[K.activities].find((a) => a.id === econ.id).reflections[0].text, 'Went well');
  const entry = Object.values(mem[K.journal]).flat()[0];
  assert.deepEqual([entry.kind, entry.text, entry.act], ['reflect', 'Went well', econ.id]);
  delete globalThis.chrome;
});

// ---------- allowed pages ----------

test('allowed pages: YouTube links collapse to one video, sites and folders match tightly', () => {
  const vid = { kind: 'url', value: 'youtube.com/watch?v=dQw4w9WgXcQ', label: 'YouTube video' };
  for (const u of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5s', 'youtu.be/dQw4w9WgXcQ', 'https://m.youtube.com/shorts/dQw4w9WgXcQ', 'youtube.com/embed/dQw4w9WgXcQ']) assert.deepEqual(P.parseAllow(u), vid, u);
  assert.deepEqual(P.parseAllow('https://youtube.com/playlist?list=PLabc123xyz'), { kind: 'url', value: 'youtube.com/playlist?list=PLabc123xyz', label: 'YouTube playlist' });
  assert.deepEqual(P.parseAllow('Desmos.com'), { kind: 'site', value: 'desmos.com', label: 'desmos.com' });
  assert.deepEqual(P.parseAllow('https://www.khanacademy.org/math/algebra/'), { kind: 'url', value: 'khanacademy.org/math/algebra', label: 'khanacademy.org' });
  for (const bad of ['', 'not a url', 'localhost', 'ftp://x.com', 'javascript:alert(1)']) assert.equal(P.parseAllow(bad), null, bad);

  const allow = ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'desmos.com', 'khanacademy.org/math/algebra'].map(P.parseAllow);
  const ok = (u) => !!P.allowedBy(allow, u);
  assert.ok(ok('https://www.youtube.com/watch?v=dQw4w9WgXcQ'));
  assert.ok(ok('https://youtube.com/watch?feature=share&v=dQw4w9WgXcQ&t=3'));
  assert.ok(!ok('https://www.youtube.com/watch?v=someOtherOne'));
  assert.ok(!ok('https://www.youtube.com/watch?v=dQw4w9WgXcQextra'));
  assert.ok(!ok('https://www.youtube.com/'));
  assert.ok(ok('https://www.desmos.com/calculator') && ok('https://teacher.desmos.com/'));
  assert.ok(!ok('https://evil-desmos.com/') && !ok('https://desmos.com.evil.net/'));
  assert.ok(ok('https://khanacademy.org/math/algebra/x') && ok('https://www.khanacademy.org/math/algebra'));
  assert.ok(!ok('https://khanacademy.org/math/algebra2') && !ok('https://khanacademy.org/math'));
  assert.deepEqual(P.mergeAllow([allow[0]], [allow[0], allow[1]]).map((e) => e.value), [allow[0].value, allow[1].value]);
});

test('taskEffort adds up a task\'s sessions and weights the on-task share by minutes', () => {
  const sessions = [
    { taskId: 'a', minutes: 20, onitry: { onPct: 90 } },
    { taskId: 'a', minutes: 10, onitry: { onPct: 60 } },
    { taskId: 'a', minutes: 5, onitry: null },
    { taskId: 'b', minutes: 99, onitry: { onPct: 1 } },
    { taskId: 'a', minutes: 10, kind: 'break' },
  ];
  assert.deepEqual(P.taskEffort(sessions, 'a'), { minutes: 35, count: 3, onPct: 80 });
  assert.deepEqual(P.taskEffort(sessions, 'zzz'), { minutes: 0, count: 0, onPct: null });
});
