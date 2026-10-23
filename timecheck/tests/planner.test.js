// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
require('../lib/planner.js');
const P = globalThis.InkPlan;

const TODAY = '2026-10-08'; // a Thursday
const q = (s) => P.parseQuick(s, { today: TODAY });

test('homework with weekday and estimate', () => {
  const r = q('calc hw due fri 40m');
  assert.equal(r.title, 'calc hw');
  assert.equal(r.course, 'Calc');
  assert.equal(r.kind, 'due');
  assert.equal(r.due, '2026-10-09');
  assert.equal(r.estimate, 40);
});

test('tests are recognized', () => {
  const r = q('econ test mon');
  assert.equal(r.kind, 'test');
  assert.equal(r.course, 'Econ');
  assert.equal(r.due, '2026-10-12');
});

test('same weekday means today', () => {
  assert.equal(q('lang reading thu').due, TODAY);
});

test('tomorrow and next week', () => {
  assert.equal(q('spanish quizlet tmrw').due, '2026-10-09');
  assert.equal(q('chem summative next wed').due, '2026-10-14');
});

test('month/day formats', () => {
  assert.equal(q('PSAT 10/14').due, '2026-10-14');
  assert.equal(q('UWC MUN oct 30').due, '2026-10-30');
  assert.equal(q('physics frq 2 nov').due, '2026-11-02');
});

test('undated tasks are planned for today', () => {
  const r = q('email mrs neri');
  assert.equal(r.title, 'email mrs neri');
  assert.equal(r.plan, TODAY);
  assert.equal(r.due, null);
});

test('someday items', () => {
  const r = q('~ cad the dynamic claw 1h');
  assert.equal(r.someday, true);
  assert.equal(r.course, 'CAD');
  assert.equal(r.estimate, 60);
  assert.equal(r.plan, null);
});

test('hours and minutes estimate', () => {
  assert.equal(q('physics frqs 1h30').estimate, 90);
  assert.equal(q('physics frqs 1.5h').estimate, 90);
});

test('aliases and hashtags', () => {
  assert.equal(q('bc quiz fri').course, 'Calc');
  assert.equal(q('ILS practice').course, 'Spanish');
  assert.equal(q('reprint tpu part #mate').course, 'MATE');
  assert.equal(q('reprint tpu part #mate').title, 'reprint tpu part');
});

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

test('quick add understands letter days but not the article "a"', () => {
  const o = { today: '2026-10-12', blocks: B };
  assert.equal(P.parseQuick('calc hw due next B', o).due, '2026-10-16');
  assert.equal(P.parseQuick('physics test D day', o).due, '2026-10-14');
  assert.equal(P.parseQuick('econ next a day', o).due, '2026-10-15');
  const plain = P.parseQuick('work on a project for a day', o);
  assert.equal(plain.due, null);
  assert.equal(plain.title, 'work on a project for a day');
  assert.equal(P.parseQuick('calc hw due next B', { today: '2026-10-12' }).due, null); // blocks off → no guessing
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

test('quick add reads times and breaks', () => {
  const o = { today: T22 };
  assert.equal(P.parseQuick('econ practice at 4pm 30m', o).at, '16:00');
  assert.equal(P.parseQuick('chem lab at 16:30', o).at, '16:30');
  assert.equal(P.parseQuick('physics at 4', o).at, '16:00'); // after school
  assert.equal(P.parseQuick('call at 9am', o).at, '09:00');
  assert.equal(P.parseQuick('meet at the library', o).at, null);
  const b = P.parseQuick('break', o);
  assert.equal(b.kind, 'break');
  assert.equal(b.estimate, 10);
  assert.equal(P.parseQuick('dinner 30m', o).estimate, 30);
  const tm = P.parseQuick('calc review tmrw at 5pm', o);
  assert.equal(tm.plan, '2026-10-23');
});

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

test('lanes split only overlapping events', () => {
  const ev = P.assignLanes([{ start: 0, end: 30 }, { start: 10, end: 20 }, { start: 40, end: 50 }]);
  assert.deepEqual(ev.map((e) => [e.lane, e.lanes]), [[0, 2], [1, 2], [0, 1]]);
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
