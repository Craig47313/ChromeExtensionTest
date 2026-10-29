// Date helpers shared by Timecheck and Inkwell. Dates are 'YYYY-MM-DD' keys in local time.
// Source of truth is shared/dates.js; lib/dates.js in each extension is a copy made by scripts/sync-shared.sh.
(function (g) {
  'use strict';
  if (g.InkDates) return;

  const DAY = 86400000;
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

  // "Today", "Tomorrow", "Yesterday", a weekday within the week, or a short date.
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

  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  // 45 → "45m", 80 → "1h 20m".
  function fmtMinutes(min) {
    min = Math.max(0, Math.round(min));
    if (min < 60) return `${min}m`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }

  // "2 days ago" style wording for a timestamp.
  function ago(ts, now = Date.now()) {
    const d = daysBetween(dateKey(new Date(ts)), dateKey(new Date(now)));
    if (d <= 0) return 'today';
    if (d === 1) return 'yesterday';
    if (d < 14) return `${d} days ago`;
    if (d < 60) return `${Math.floor(d / 7)} weeks ago`;
    return `${Math.floor(d / 30)} months ago`;
  }

  g.InkDates = { DAY, pad, dateKey, fromKey, addDays, daysBetween, weekStart, relDay, fmtTime, fmtMinutes, ago };
  if (typeof module !== 'undefined' && module.exports) module.exports = g.InkDates;
})(typeof globalThis !== 'undefined' ? globalThis : this);
