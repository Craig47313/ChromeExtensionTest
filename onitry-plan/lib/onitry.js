// Client for the Onitry desktop app's local bridge (Monitry repo: core/bridge.py).
// Onitry listens on 127.0.0.1 only and needs the pairing code shown in
// Onitry → Settings. Every call resolves (never throws) with { ok, ... }.
(function (g) {
  'use strict';
  if (g.OnitryBridge) return;

  const DEFAULT_PORT = 47323;
  const NATIVE_HOST = 'com.onitry.host';

  async function call(cfg, method, path, body, timeoutMs = 2500) {
    const port = (cfg && cfg.port) || DEFAULT_PORT;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-Onitry-Token': (cfg && cfg.code) || '' },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) return { ok: false, reachable: true, paired: false, error: 'Pairing code not accepted' };
      if (!res.ok) return { ok: false, reachable: true, error: data.error || `HTTP ${res.status}` };
      return { reachable: true, paired: true, ...data, ok: true };
    } catch (err) {
      return { ok: false, reachable: false, error: err.name === 'AbortError' ? 'Onitry didn’t answer' : 'Onitry isn’t running' };
    } finally {
      clearTimeout(timer);
    }
  }

  g.OnitryBridge = {
    DEFAULT_PORT,
    ping: (cfg) => call(cfg, 'GET', '/v1/ping'),
    status: (cfg) => call(cfg, 'GET', '/v1/status'),
    startTask: (cfg, task, details = '') => call(cfg, 'POST', '/v1/task', { task, details }),
    stop: (cfg) => call(cfg, 'POST', '/v1/stop', {}),
    // Older Onitry builds answer 404 here; callers treat that as "no pause support".
    pause: (cfg, minutes) => call(cfg, 'POST', '/v1/pause', { minutes: Math.max(1, Math.min(240, Math.round(minutes))) }),
    resume: (cfg) => call(cfg, 'POST', '/v1/resume', {}),
    // One Claude call on Onitry's side, so allow it time.
    review: (cfg, stats) => call(cfg, 'POST', '/v1/review', { stats }, 120000),
    // Starts the Onitry app through its native-messaging host
    // (Monitry: python native_host/install.py). Resolves { ok, launched, error }.
    launch: () =>
      new Promise((resolve) => {
        if (!g.chrome || !chrome.runtime || !chrome.runtime.sendNativeMessage) return resolve({ ok: false, error: 'Native messaging unavailable' });
        try {
          chrome.runtime.sendNativeMessage(NATIVE_HOST, { cmd: 'launch' }, (res) => {
            const err = chrome.runtime.lastError;
            if (err) resolve({ ok: false, error: /not found/i.test(err.message) ? 'Launcher not installed (run python native_host/install.py in Monitry)' : err.message });
            else resolve(res || { ok: false, error: 'No answer from launcher' });
          });
        } catch (err) {
          resolve({ ok: false, error: err.message });
        }
      }),
    // Launch if needed, then wait for the bridge to come up.
    async ensureRunning(cfg, waitMs = 20000) {
      const first = await call(cfg, 'GET', '/v1/ping');
      if (first.ok) return { ok: true, launched: false };
      const res = await g.OnitryBridge.launch();
      if (!res.ok) return res;
      const until = Date.now() + waitMs;
      while (Date.now() < until) {
        await new Promise((r) => setTimeout(r, 1000));
        if ((await call(cfg, 'GET', '/v1/ping')).ok) return { ok: true, launched: true };
      }
      return { ok: false, error: 'Onitry was launched but didn’t answer yet' };
    },
  };
})(globalThis);
