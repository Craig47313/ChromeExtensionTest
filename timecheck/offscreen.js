// Plays the end-of-block alarm. The service worker can't play audio, so it opens
// this hidden page (chrome.offscreen) and sends it {type: 'alarm:play'}.
(() => {
  'use strict';

  let ctx = null;
  let stopAt = 0;

  // A bright three-note chime: A5, C#6, E6, each with a soft attack and long tail.
  function chime(at, gain = 0.32) {
    [880, 1108.73, 1318.51].forEach((freq, i) => {
      const t = at + i * 0.16;
      const osc = ctx.createOscillator();
      const amp = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(gain, t + 0.015);
      amp.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
      osc.connect(amp).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 1.2);
    });
  }

  async function play({ repeats = 3, volume = 1 } = {}) {
    ctx = ctx || new AudioContext();
    if (ctx.state === 'suspended') await ctx.resume();
    const start = ctx.currentTime + 0.05;
    for (let i = 0; i < repeats; i++) chime(start + i * 1.4, 0.32 * volume);
    stopAt = Date.now() + repeats * 1400 + 1200;
    return { ok: ctx.state === 'running', state: ctx.state, ms: stopAt - Date.now() };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== 'alarm:play') return false;
    play(msg).then(sendResponse, (err) => sendResponse({ ok: false, error: err.message }));
    return true;
  });
})();
