// Client for the Onitry desktop app's local bridge (Monitry repo: core/bridge.py).
// Onitry listens on 127.0.0.1 only and needs the pairing code shown in
// Onitry → Settings. Every call resolves (never throws) with { ok, ... }.
(function (g) {
  'use strict';
  if (g.OnitryBridge) return;

  const DEFAULT_PORT = 47323;

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
  };
})(globalThis);
