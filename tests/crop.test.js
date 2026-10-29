// Run with: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert');
const C = require('../lib/crop.js');

const W = 400;
const H = 300;
const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b}`);
const inside = (r) => r.x >= -1e-9 && r.y >= -1e-9 && r.x + r.w <= W + 1e-9 && r.y + r.h <= H + 1e-9 && r.w > 0 && r.h > 0;

test('move and fit keep the box inside the image', () => {
  const r = { x: 100, y: 100, w: 200, h: 100 };
  assert.deepEqual(C.move(r, -500, 500, W, H), { x: 0, y: 200, w: 200, h: 100 });
  assert.deepEqual(C.fit({ x: 350, y: -5, w: 100, h: 2 }, W, H), { x: 300, y: 0, w: 100, h: 8 });
});

test('free resize from every handle', () => {
  const r = { x: 100, y: 100, w: 200, h: 100 };
  const o = { W, H };
  assert.deepEqual(C.resize(r, 'e', 50, 0, o), { x: 100, y: 100, w: 250, h: 100 });
  assert.deepEqual(C.resize(r, 'w', 30, 0, o), { x: 130, y: 100, w: 170, h: 100 });
  assert.deepEqual(C.resize(r, 'n', 0, -40, o), { x: 100, y: 60, w: 200, h: 140 });
  assert.deepEqual(C.resize(r, 'se', 500, 500, o), { x: 100, y: 100, w: 300, h: 200 }); // stops at the image edge
  assert.deepEqual(C.resize(r, 'nw', -500, -500, o), { x: 0, y: 0, w: 300, h: 200 });
  const small = C.resize(r, 'e', -500, 0, o); // can't collapse
  assert.equal(small.w, C.fit({ x: 0, y: 0, w: 0, h: 1 }, W, H).w);
});

test('a locked ratio holds on corners and edges, inside the image', () => {
  const r = { x: 100, y: 75, w: 160, h: 90 };
  const ratio = 16 / 9;
  for (const handle of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
    for (const [dx, dy] of [[40, 10], [-60, -30], [500, 500], [-500, -500], [10, -80]]) {
      const out = C.resize(r, handle, dx, dy, { W, H, ratio });
      assert.ok(inside(out), `${handle} ${dx},${dy} → ${JSON.stringify(out)}`);
      if (out.w > 9 && out.h > 9) near(out.w / out.h, ratio, 0.02);
    }
  }
  // Dragging the corner out grows the box from its opposite corner.
  const grown = C.resize(r, 'se', 80, 0, { W, H, ratio });
  assert.deepEqual([grown.x, grown.y], [100, 75]);
  near(grown.w, 240);
  near(grown.h, 135);
});

test('aspect buttons reshape around the middle', () => {
  const r = { x: 100, y: 100, w: 200, h: 100 };
  const sq = C.aspect(r, 1, W, H);
  assert.deepEqual(sq, { x: 150, y: 100, w: 100, h: 100 });
  const wide = C.aspect({ x: 0, y: 0, w: 100, h: 100 }, 4 / 3, W, H);
  near(wide.w / wide.h, 4 / 3);
  assert.ok(wide.w <= 100 && wide.h <= 100);
  assert.equal(C.aspect(r, null, W, H), r);
});

test('rotating a quarter turn moves the box with the picture', () => {
  const r = { x: 10, y: 20, w: 100, h: 50 };
  // The image becomes H×W; the top-left corner of the box was at (10, 20) → (H - 70, 10).
  assert.deepEqual(C.rotateRect(r, W, H), { x: H - 70, y: 10, w: 50, h: 100 });
  let back = r;
  let dims = [W, H];
  for (let i = 0; i < 4; i++) {
    back = C.rotateRect(back, dims[0], dims[1]);
    dims = [dims[1], dims[0]];
  }
  assert.deepEqual(back, r);
});

test('size steppers', () => {
  const r = { x: 50, y: 50, w: 100, h: 100 };
  assert.deepEqual(C.setSize(r, { w: 200 }, W, H), { x: 50, y: 50, w: 200, h: 100 });
  assert.deepEqual(C.setSize(r, { w: 200 }, W, H, 2), { x: 50, y: 50, w: 200, h: 100 });
  const locked = C.setSize(r, { h: 150 }, W, H, 1);
  assert.deepEqual([locked.w, locked.h], [150, 150]);
  assert.ok(inside(C.setSize(r, { w: 9999 }, W, H)));
});

test('a drawing image knows where its whole picture would sit', () => {
  const s = { x: 100, y: 50, w: 100, h: 50, crop: { x: 0.25, y: 0.5, w: 0.5, h: 0.5 } };
  assert.deepEqual(C.fullBox(s), { x: 50, y: 0, w: 200, h: 100 });
  assert.deepEqual(C.fullBox({ x: 5, y: 6, w: 70, h: 80 }), { x: 5, y: 6, w: 70, h: 80 });
  assert.ok(C.validCrop(s.crop));
  assert.ok(!C.validCrop({ x: 0.8, y: 0, w: 0.5, h: 1 }));
  assert.ok(!C.validCrop({ x: 0, y: 0, w: 0, h: 1 }));
});
