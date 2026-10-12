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
