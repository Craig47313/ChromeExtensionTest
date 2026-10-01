// On-page annotator. Injected on demand (toolbar command, context menu, or the
// side panel). Running it again while active closes it.
(() => {
  'use strict';
  if (window.__inkwellAnnotator) {
    window.__inkwellAnnotator.close();
    return;
  }

  const STORAGE_KEY = 'annot:' + location.href.split('#')[0];
  const TOOLS = [
    ['select', 'Select (V) · drag to move, corner to resize, Delete to remove'],
    ['pen', 'Pen (P)'],
    ['highlighter', 'Highlighter (H)'],
    ['line', 'Line (L)'],
    ['arrow', 'Arrow (A)'],
    ['rect', 'Rectangle (R)'],
    ['ellipse', 'Ellipse (O)'],
    ['text', 'Text (T)'],
    ['eraser', 'Eraser (E)'],
  ];
  const COLORS = ['#e03131', '#f08c00', '#fcc419', '#2f9e44', '#1971c2', '#7048e8', '#1e1e2e', '#ffffff'];
  const SIZE_SETS = { pen: [2, 4, 8], highlighter: [10, 18, 30], eraser: [12, 24, 48] };
  const icon = (name, size = 18) => InkIcons.svg(name, size);

  const CSS = `
    :host { all: initial; }
    .layer { position: fixed; inset: 0; pointer-events: auto; }
    .layer.pass { pointer-events: none; }
    canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
    .bar {
      position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%);
      display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 6px;
      width: max-content; max-width: calc(100vw - 24px); padding: 6px 8px; box-sizing: border-box;
      background: rgba(27, 27, 32, 0.96); color: #e8e8ee; border-radius: 14px;
      box-shadow: 0 12px 40px rgba(0,0,0,.35), 0 0 0 1px rgba(255,255,255,.07);
      font: 13px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      pointer-events: auto; user-select: none; -webkit-user-select: none;
    }
    .group { display: flex; align-items: center; gap: 2px; }
    .btn {
      all: unset; box-sizing: border-box; width: 32px; height: 32px; display: grid; place-items: center;
      border-radius: 9px; cursor: pointer; color: #c4c4cf;
    }
    .btn:hover { background: rgba(255,255,255,.09); color: #fff; }
    .btn.active { background: var(--accent, #2ea043); color: var(--accent-contrast, #fff); }
    .btn.del { color: #ff8787; }
    .btn.del:hover { background: rgba(255,107,107,.18); color: #ffa8a8; }
    .btn[hidden] { display: none; }
    .btn:disabled { opacity: .35; cursor: default; background: none; }
    .btn svg { display: block; }
    .sep { width: 1px; height: 22px; background: rgba(255,255,255,.13); margin: 0 2px; }
    .swatch {
      all: unset; box-sizing: border-box; width: 18px; height: 18px; margin: 0 2px; border-radius: 50%;
      background: var(--c); cursor: pointer; box-shadow: inset 0 0 0 1px rgba(255,255,255,.3);
    }
    .swatch.active { box-shadow: 0 0 0 2px #1b1b20, 0 0 0 4px #fff; }
    .size span { display: block; width: var(--d); height: var(--d); border-radius: 50%; background: currentColor; }
    .grip { display: grid; place-items: center; width: 18px; height: 32px; color: #77778a; cursor: grab; }
    .grip:active { cursor: grabbing; }
    .toast {
      position: fixed; left: 50%; top: 18px; transform: translate(-50%, -8px); opacity: 0;
      background: rgba(27, 27, 32, 0.96); color: #fff; padding: 9px 14px; border-radius: 10px;
      font: 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      box-shadow: 0 8px 30px rgba(0,0,0,.3); transition: opacity .2s, transform .2s; pointer-events: none;
    }
    .toast.show { opacity: 1; transform: translate(-50%, 0); }
  `;

  const host = document.createElement('inkwell-annotator');
  host.style.cssText =
    'all: initial !important; position: fixed !important; inset: 0 !important; z-index: 2147483647 !important; pointer-events: none !important; display: block !important;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>${CSS}</style>
    <div class="layer"><canvas></canvas></div>
    <div class="bar" role="toolbar" aria-label="Inkwell drawing tools">
      <div class="grip" title="Drag to move">${icon('grip', 16)}</div>
      <div class="group">${TOOLS.map(([t, label]) => `<button class="btn tool" data-tool="${t}" title="${label}" aria-label="${label}">${icon(t)}</button>`).join('')}</div>
      <div class="sep"></div>
      <div class="group">${COLORS.map((c) => `<button class="swatch" data-color="${c}" style="--c:${c}" title="${c}" aria-label="Color ${c}"></button>`).join('')}</div>
      <div class="sep"></div>
      <div class="group">${[0, 1, 2].map((i) => `<button class="btn size" data-size="${i}" title="${['Thin', 'Medium', 'Thick'][i]}"><span style="--d:${4 + i * 4}px"></span></button>`).join('')}</div>
      <div class="sep"></div>
      <div class="group">
        <button class="btn" data-act="undo" title="Undo (Ctrl+Z)">${icon('undo')}</button>
        <button class="btn" data-act="redo" title="Redo (Ctrl+Shift+Z)">${icon('redo')}</button>
        <button class="btn del" data-act="delete" title="Delete selected (Delete)">${icon('trash')}</button>
        <button class="btn" data-act="clear" title="Clear all drawings">${icon('clear-canvas')}</button>
        <button class="btn" data-act="pass" title="Click-through: interact with the page">${icon('pointer-click')}</button>
        <button class="btn" data-act="save" title="Save screenshot to Inkwell">${icon('camera')}</button>
        <button class="btn" data-act="close" title="Close (Esc)">${icon('x')}</button>
      </div>
    </div>
    <div class="toast" role="status"></div>`;
  document.documentElement.appendChild(host);

  // Match the toolbar accent to the palette chosen in Inkwell (dark variant).
  try {
    chrome.storage.local.get('settings').then(({ settings }) => {
      const v = InkPalettes.vars((settings && settings.palette) || InkPalettes.DEFAULT, true);
      host.style.setProperty('--accent', v.accent);
      host.style.setProperty('--accent-contrast', v['accent-contrast']);
    });
  } catch (_) {
    /* extension context gone */
  }

  const layer = root.querySelector('.layer');
  const canvas = root.querySelector('canvas');
  const bar = root.querySelector('.bar');
  const toastEl = root.querySelector('.toast');
  let passthrough = false;
  let saveTimer = 0;
  let toastTimer = 0;

  const ink = new InkCanvas(canvas, {
    pan: false,
    tools: TOOLS.map(([t]) => t),
    inkColor: '#1e1e2e',
    styles: { pen: { color: '#e03131', size: 4 } },
    onChange: persist,
    onHistoryChange: syncUI,
    onToolChange: syncUI,
    onStyleChange: syncUI,
    onSelectionChange: syncUI,
  });

  // World coordinates are document coordinates: drawings stick to the page.
  const syncScroll = () => ink.setView(-window.scrollX, -window.scrollY, 1);
  syncScroll();
  window.addEventListener('scroll', syncScroll, { passive: true });

  try {
    chrome.storage.local.get(STORAGE_KEY).then((data) => {
      const saved = data[STORAGE_KEY];
      if (saved && Array.isArray(saved.shapes) && !ink.shapes.length) {
        ink.load({ shapes: saved.shapes }, { keepView: true });
        syncScroll();
      }
    });
  } catch (_) {
    /* extension context gone */
  }

  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        if (ink.shapes.length) {
          chrome.storage.local.set({ [STORAGE_KEY]: { shapes: ink.shapes, title: document.title, updated: Date.now() } });
        } else {
          chrome.storage.local.remove(STORAGE_KEY);
        }
      } catch (_) {
        /* extension was reloaded; nothing to save to */
      }
    }, 400);
  }

  function syncUI() {
    const group = ink.styleGroup();
    root.querySelectorAll('.tool').forEach((b) => b.classList.toggle('active', b.dataset.tool === ink.tool));
    root.querySelectorAll('.swatch').forEach((b) => b.classList.toggle('active', group !== 'eraser' && b.dataset.color === ink.color));
    const sizes = SIZE_SETS[group];
    root.querySelectorAll('.size').forEach((b) => b.classList.toggle('active', sizes[+b.dataset.size] === ink.size));
    root.querySelector('[data-act="undo"]').disabled = !ink.canUndo;
    root.querySelector('[data-act="redo"]').disabled = !ink.canRedo;
    root.querySelector('[data-act="delete"]').hidden = !ink.selection.size;
    root.querySelector('[data-act="pass"]').classList.toggle('active', passthrough);
  }

  function toast(message) {
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3200);
  }

  function setPassthrough(on) {
    passthrough = on;
    ink.commitText();
    layer.classList.toggle('pass', on);
    syncUI();
    toast(on ? 'Click-through on — you can use the page. Toggle again to draw.' : 'Drawing mode');
  }

  async function saveScreenshot() {
    ink.commitText();
    bar.style.visibility = 'hidden';
    toastEl.classList.remove('show');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: 'inkwell:capture', title: document.title, url: location.href, dpr: window.devicePixelRatio });
    } catch (err) {
      res = { ok: false, error: err.message };
    }
    bar.style.visibility = '';
    toast(res && res.ok ? 'Saved to Inkwell ✓  Open the side panel to see it.' : `Couldn’t save: ${(res && res.error) || 'unknown error'}`);
  }

  bar.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.tool) ink.setTool(btn.dataset.tool);
    else if (btn.dataset.color) {
      if (ink.tool === 'select' && ink.recolorSelection(btn.dataset.color)) return syncUI();
      if (ink.tool === 'eraser' || ink.tool === 'select') ink.setTool('pen');
      ink.color = btn.dataset.color;
    } else if (btn.dataset.size) {
      if (ink.tool === 'text' || ink.tool === 'select') ink.setTool('pen');
      ink.size = SIZE_SETS[ink.styleGroup()][+btn.dataset.size];
    } else {
      const act = btn.dataset.act;
      if (act === 'undo') ink.undo();
      else if (act === 'redo') ink.redo();
      else if (act === 'delete') ink.deleteSelection();
      else if (act === 'clear') ink.clear();
      else if (act === 'pass') setPassthrough(!passthrough);
      else if (act === 'save') saveScreenshot();
      else if (act === 'close') close();
    }
    syncUI();
  });

  // Draggable toolbar.
  const grip = root.querySelector('.grip');
  grip.addEventListener('pointerdown', (e) => {
    const r = bar.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    grip.setPointerCapture(e.pointerId);
    const move = (ev) => {
      bar.style.transform = 'none';
      bar.style.bottom = 'auto';
      bar.style.left = `${Math.min(Math.max(0, ev.clientX - dx), window.innerWidth - r.width)}px`;
      bar.style.top = `${Math.min(Math.max(0, ev.clientY - dy), window.innerHeight - r.height)}px`;
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
  });

  function isTyping(e) {
    // Our text box lives in a closed shadow root, invisible to composedPath().
    if (ink.textEditor || (root.activeElement && root.activeElement.tagName === 'TEXTAREA')) return true;
    const t = e.composedPath()[0];
    return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''));
  }

  function onKeyDown(e) {
    if (passthrough || isTyping(e)) return;
    if (e.key === 'Escape' && !ink.selection.size) {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (ink.handleKeyDown(e)) {
      e.preventDefault();
      e.stopPropagation();
      syncUI();
    }
  }
  window.addEventListener('keydown', onKeyDown, true);

  function close() {
    clearTimeout(saveTimer);
    try {
      if (ink.shapes.length) chrome.storage.local.set({ [STORAGE_KEY]: { shapes: ink.shapes, title: document.title, updated: Date.now() } });
      else chrome.storage.local.remove(STORAGE_KEY);
    } catch (_) {
      /* ignore */
    }
    ink.destroy();
    window.removeEventListener('scroll', syncScroll);
    window.removeEventListener('keydown', onKeyDown, true);
    host.remove();
    delete window.__inkwellAnnotator;
  }

  window.__inkwellAnnotator = { close };
  syncUI();
  toast('Draw on the page · Esc to exit · annotations are kept for this page');
})();
