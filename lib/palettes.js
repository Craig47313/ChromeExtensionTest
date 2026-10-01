// Color palettes. Each palette = a neutral set + an accent, for light and dark.
// "monitry" (default) matches the Monitry product suite: near-black grays with green.
(function () {
  'use strict';
  if (globalThis.InkPalettes) return;

  const NEUTRAL = {
    // Pure grays, from Monitry's website/app (#0c0c0c / #141414 / #1e1e1e / #2a2a2a).
    gray: {
      light: { bg: '#f5f5f5', surface: '#ffffff', 'surface-2': '#f0f0f0', border: '#e2e2e2', text: '#161616', muted: '#6b6b6b', paper: '#ffffff', grid: 'rgba(0,0,0,.09)', danger: '#cf222e' },
      dark: { bg: '#0c0c0c', surface: '#141414', 'surface-2': '#1e1e1e', border: '#2a2a2a', text: '#e8e8e8', muted: '#888888', paper: '#141414', grid: 'rgba(255,255,255,.08)', danger: '#f85149' },
    },
    // Slightly cool grays (the original Inkwell look).
    cool: {
      light: { bg: '#f5f5f8', surface: '#ffffff', 'surface-2': '#f0f0f4', border: '#e3e3ea', text: '#1d1d23', muted: '#6d6d7a', paper: '#ffffff', grid: 'rgba(20,20,40,.1)', danger: '#d9363e' },
      dark: { bg: '#121215', surface: '#1a1a1f', 'surface-2': '#24242b', border: '#2e2e37', text: '#ececf1', muted: '#9a9aa8', paper: '#1a1a1f', grid: 'rgba(255,255,255,.09)', danger: '#ff6b6b' },
    },
  };

  // accent: [light, dark]; contrast = text color on an accent background.
  const PALETTES = {
    monitry: { name: 'Monitry', neutral: 'gray', accent: ['#1f883d', '#2ea043'], contrast: ['#ffffff', '#ffffff'] },
    indigo: { name: 'Indigo', neutral: 'cool', accent: ['#5b5bd6', '#8d8cf7'], contrast: ['#ffffff', '#121215'] },
    ocean: { name: 'Ocean', neutral: 'gray', accent: ['#0969da', '#4493f8'], contrast: ['#ffffff', '#ffffff'] },
    rose: { name: 'Rose', neutral: 'gray', accent: ['#d6336c', '#f06595'], contrast: ['#ffffff', '#141414'] },
    amber: { name: 'Amber', neutral: 'gray', accent: ['#b7791f', '#e3b341'], contrast: ['#ffffff', '#141414'] },
    graphite: { name: 'Graphite', neutral: 'gray', accent: ['#2a2a2a', '#d4d4d4'], contrast: ['#ffffff', '#141414'] },
  };

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // CSS custom properties for a palette in a given mode.
  function vars(id, dark) {
    const p = PALETTES[id] || PALETTES.monitry;
    const i = dark ? 1 : 0;
    const accent = p.accent[i];
    const [r, g, b] = hexToRgb(accent);
    return {
      ...NEUTRAL[p.neutral][dark ? 'dark' : 'light'],
      accent,
      'accent-soft': `rgba(${r},${g},${b},${dark ? 0.18 : 0.12})`,
      'accent-contrast': p.contrast[i],
    };
  }

  function apply(root, id, dark) {
    for (const [k, v] of Object.entries(vars(id, dark))) root.style.setProperty(`--${k}`, v);
  }

  globalThis.InkPalettes = { PALETTES, vars, apply, DEFAULT: 'monitry' };
})();
