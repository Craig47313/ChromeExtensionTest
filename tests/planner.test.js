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
