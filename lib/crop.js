// Crop geometry shared by Inkwell's crop window (notes) and the drawing canvas.
// Rectangles are { x, y, w, h } in the pixels (or world units) of the thing being cropped.
(function (g) {
  'use strict';
  if (g.InkCrop) return;

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const MIN = 8;

  const full = (W, H) => ({ x: 0, y: 0, w: W, h: H });

  // Keep a rectangle inside W×H and at least `min` big.
  function fit(r, W, H, min = MIN) {
    const w = clamp(r.w, Math.min(min, W), W);
    const h = clamp(r.h, Math.min(min, H), H);
    return { x: clamp(r.x, 0, W - w), y: clamp(r.y, 0, H - h), w, h };
  }

  function move(r, dx, dy, W, H) {
    return { ...r, x: clamp(r.x + dx, 0, W - r.w), y: clamp(r.y + dy, 0, H - r.h) };
  }

  // Drag a handle ('n','s','e','w','ne','nw','se','sw') by (dx, dy). `ratio` (w / h) locks the shape.
  function resize(r, handle, dx, dy, { W, H, ratio = null, min = MIN }) {
    let l = r.x;
    let t = r.y;
    let rt = r.x + r.w;
    let b = r.y + r.h;
    if (handle.includes('w')) l += dx;
    if (handle.includes('e')) rt += dx;
    if (handle.includes('n')) t += dy;
    if (handle.includes('s')) b += dy;
    min = Math.min(min, W, H);
    l = clamp(l, 0, rt - min);
    rt = clamp(rt, l + min, W);
    t = clamp(t, 0, b - min);
    b = clamp(b, t + min, H);
    if (!ratio) return { x: l, y: t, w: rt - l, h: b - t };

    let w = rt - l;
    let h = b - t;
    const corner = handle.length === 2;
    const sideways = handle === 'e' || handle === 'w';
    if (corner) {
      // The opposite corner stays put; the bigger drag decides the size.
      if (Math.abs(dx) >= Math.abs(dy * ratio)) h = w / ratio;
      else w = h * ratio;
      const ax = handle.includes('w') ? r.x + r.w : r.x;
      const ay = handle.includes('n') ? r.y + r.h : r.y;
      const sx = handle.includes('w') ? -1 : 1;
      const sy = handle.includes('n') ? -1 : 1;
      const k = Math.min(1, (sx > 0 ? W - ax : ax) / w, (sy > 0 ? H - ay : ay) / h);
      w *= k;
      h *= k;
      return fit({ x: sx > 0 ? ax : ax - w, y: sy > 0 ? ay : ay - h, w, h }, W, H, min);
    }
    // An edge: the other dimension follows, around the middle of the box.
    if (sideways) {
      h = w / ratio;
      const cy = r.y + r.h / 2;
      const k = Math.min(1, (2 * Math.min(cy, H - cy)) / h);
      w *= k;
      h *= k;
      const x = handle === 'w' ? r.x + r.w - w : r.x;
      return fit({ x, y: cy - h / 2, w, h }, W, H, min);
    }
    w = h * ratio;
    const cx = r.x + r.w / 2;
    const k = Math.min(1, (2 * Math.min(cx, W - cx)) / w);
    w *= k;
    h *= k;
    const y = handle === 'n' ? r.y + r.h - h : r.y;
    return fit({ x: cx - w / 2, y, w, h }, W, H, min);
  }

  // Reshape to an aspect ratio, as large as fits inside the current box, around its middle.
  function aspect(r, ratio, W, H) {
    if (!ratio) return r;
    let w = Math.min(r.w, r.h * ratio);
    let h = w / ratio;
    if (h > r.h) {
      h = r.h;
      w = h * ratio;
    }
    return fit({ x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h }, W, H);
  }

  // Turn the image a quarter turn clockwise: the box follows.
  function rotateRect(r, W, H) {
    return { x: H - (r.y + r.h), y: r.x, w: r.h, h: r.w };
  }

  // Set one side's size (a width or height stepper); the box keeps its top left unless it would leave the image.
  function setSize(r, { w, h }, W, H, ratio = null) {
    let nw = w != null ? w : r.w;
    let nh = h != null ? h : r.h;
    if (ratio) {
      if (w != null) nh = nw / ratio;
      else nw = nh * ratio;
      const k = Math.min(1, W / nw, H / nh);
      nw *= k;
      nh *= k;
    }
    return fit({ x: r.x, y: r.y, w: Math.round(nw), h: Math.round(nh) }, W, H);
  }

  const ASPECTS = { free: null, '1:1': 1, '4:3': 4 / 3, '16:9': 16 / 9 };

  // A drawing shape's image shows only part of the picture: crop is the visible part as fractions of the whole.
  const FULL_CROP = { x: 0, y: 0, w: 1, h: 1 };
  const cropOf = (s) => s.crop || FULL_CROP;
  // Where the whole picture would sit in the drawing, given the visible part's box.
  function fullBox(s) {
    const c = cropOf(s);
    const w = s.w / c.w;
    const h = s.h / c.h;
    return { x: s.x - c.x * w, y: s.y - c.y * h, w, h };
  }
  const validCrop = (c) => !!c && [c.x, c.y, c.w, c.h].every(Number.isFinite) && c.w > 0 && c.h > 0 && c.x >= 0 && c.y >= 0 && c.x + c.w <= 1.0001 && c.y + c.h <= 1.0001;

  g.InkCrop = { full, fit, move, resize, aspect, rotateRect, setSize, ASPECTS, cropOf, fullBox, validCrop };
  if (typeof module !== 'undefined' && module.exports) module.exports = g.InkCrop;
})(typeof globalThis !== 'undefined' ? globalThis : this);
