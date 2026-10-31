// Run with: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert');
require('../lib/ink-canvas.js');
const { stepLayer, alignShapes, distributeShapes, flipShape, shapeBounds, unionBounds } = globalThis.InkCanvas.ops;

const box = (x, y, w, h, extra = {}) => ({ type: 'rect', color: 'ink', size: 2, x1: x, y1: y, x2: x + w, y2: y + h, ...extra });
const b = (s) => shapeBounds(s);
const near = (a, c, tol = 1e-6) => assert.ok(Math.abs(a - c) <= tol, `${a} ≈ ${c}`);

test('layer steps move a selection one place, keeping its order', () => {
  const [a, c, d, e] = ['a', 'c', 'd', 'e'].map((n) => ({ n }));
  const stack = [a, c, d, e];
  assert.deepEqual(stepLayer(stack, new Set([c]), 1), [a, d, c, e]);
  assert.deepEqual(stepLayer(stack, new Set([c]), -1), [c, a, d, e]);
  assert.deepEqual(stepLayer(stack, new Set([e]), 1), stack); // already on top
  assert.deepEqual(stepLayer(stack, new Set([a]), -1), stack); // already at the back
  // Two together move as a block, and one that is blocked by the edge doesn't pull the other.
  assert.deepEqual(stepLayer(stack, new Set([c, d]), 1), [a, e, c, d]);
  assert.deepEqual(stepLayer(stack, new Set([a, d]), -1), [a, d, c, e]);
  assert.deepEqual(stepLayer(stack, new Set([d, e]), 1), stack);
  assert.deepEqual(stepLayer(stack, new Set([a, e]), 1), [c, a, d, e]);
  // The input is never changed.
  assert.deepEqual(stack, [a, c, d, e]);
});

test('align: six ways, against the group', () => {
  const list = [box(0, 0, 10, 10), box(50, 20, 20, 30), box(100, 60, 10, 10)];
  const lefts = alignShapes(list, 'left');
  list.forEach((s) => near(b(lefts.get(s)).minX, unionBounds(list).minX));
  const rights = alignShapes(list, 'right');
  list.forEach((s) => near(b(rights.get(s)).maxX, unionBounds(list).maxX));
  const centers = alignShapes(list, 'center');
  const cx = (unionBounds(list).minX + unionBounds(list).maxX) / 2;
  list.forEach((s) => near((b(centers.get(s)).minX + b(centers.get(s)).maxX) / 2, cx));
  const tops = alignShapes(list, 'top');
  list.forEach((s) => near(b(tops.get(s)).minY, unionBounds(list).minY));
  const bottoms = alignShapes(list, 'bottom');
  list.forEach((s) => near(b(bottoms.get(s)).maxY, unionBounds(list).maxY));
  const middles = alignShapes(list, 'middle');
  const cy = (unionBounds(list).minY + unionBounds(list).maxY) / 2;
  list.forEach((s) => near((b(middles.get(s)).minY + b(middles.get(s)).maxY) / 2, cy));
  // A shape already in place comes back as the same object (so undo has nothing to record).
  assert.equal(lefts.get(list[0]), list[0]);
  // Alignment moves along one axis only.
  near(b(lefts.get(list[1])).minY, b(list[1]).minY);
});

test('distribute: equal gaps, outer shapes stay', () => {
  const a = box(0, 0, 10, 10);
  const m = box(15, 0, 30, 10);
  const c = box(100, 0, 20, 10);
  const out = distributeShapes([c, a, m], 'h'); // order given doesn't matter
  const bs = [a, m, c].map((s) => b(out.get(s)));
  near(bs[0].minX, b(a).minX);
  near(bs[2].maxX, b(c).maxX);
  near(bs[1].minX - bs[0].maxX, bs[2].minX - bs[1].maxX);
  // Down works the same way, and two shapes have nothing to distribute.
  const col = [box(0, 0, 10, 10), box(0, 12, 10, 10), box(0, 90, 10, 10)];
  const down = distributeShapes(col, 'v');
  const ys = col.map((s) => b(down.get(s)));
  near(ys[1].minY - ys[0].maxY, ys[2].minY - ys[1].maxY);
  const two = [box(0, 0, 5, 5), box(20, 0, 5, 5)];
  assert.equal(distributeShapes(two, 'h').get(two[0]), two[0]);
});

test('flip mirrors geometry, and images remember it', () => {
  const pen = { type: 'pen', color: 'ink', size: 3, points: [[0, 0], [10, 5], [20, 0]] };
  assert.deepEqual(flipShape(pen, 'x', 10).points, [[20, 0], [10, 5], [0, 0]]);
  assert.deepEqual(flipShape(pen, 'y', 5).points, [[0, 10], [10, 5], [20, 10]]);
  const line = { type: 'arrow', color: 'ink', size: 2, x1: 0, y1: 0, x2: 10, y2: 4 };
  const l = flipShape(line, 'x', 5);
  assert.deepEqual([l.x1, l.x2, l.y1, l.y2], [10, 0, 0, 4]); // the arrow head stays on the same end, mirrored
  const img = { type: 'image', src: 'data:image/png;base64,AA', x: 0, y: 0, w: 40, h: 20 };
  const f1 = flipShape(img, 'x', 50);
  assert.deepEqual([f1.x, f1.flipX], [60, true]);
  const f2 = flipShape(f1, 'x', 50);
  assert.equal(f2.flipX, undefined); // flipping twice is no flip
  assert.equal(f2.x, 0);
  const text = { type: 'text', color: 'ink', text: 'hi', x: 10, y: 10, w: 20, h: 12, fontSize: 16 };
  const t = flipShape(text, 'x', 20);
  assert.deepEqual([t.x, t.flipX], [10, undefined]); // the box moves, the words don't mirror
  // Flipping twice about the same line restores any shape.
  for (const s of [pen, line, img, text]) assert.deepEqual(flipShape(flipShape(s, 'y', 7), 'y', 7), s);
});
