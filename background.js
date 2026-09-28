// Inkwell service worker: side panel wiring, context menus, keyboard commands,
// on-page annotation injection and screenshot capture.
importScripts('lib/store.js');

const ANNOTATOR_FILES = ['lib/icons.js', 'lib/ink-canvas.js', 'content/annotate.js'];

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'save-selection', title: 'Save selection to Inkwell', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'save-link', title: 'Save link to Inkwell', contexts: ['link'] });
    chrome.contextMenus.create({ id: 'save-page', title: 'Save this page to Inkwell', contexts: ['page'] });
    chrome.contextMenus.create({ id: 'annotate', title: 'Draw on this page', contexts: ['page', 'selection', 'image', 'link'] });
  });
  if (reason === 'install') await createWelcomeNote();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'annotate') {
    startAnnotating(tab);
    return;
  }
  // sidePanel.open must run synchronously inside the user gesture.
  if (tab && tab.windowId !== undefined) chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  saveClip(info, tab);
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'annotate-page') startAnnotating(tab);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return false;
  if (msg.type === 'inkwell:capture') {
    captureToNote(msg, sender).then(sendResponse, (err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (msg.type === 'inkwell:annotate') {
    chrome.tabs
      .query({ active: true, lastFocusedWindow: true })
      .then(([tab]) => startAnnotating(tab))
      .then(sendResponse, (err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  return false;
});

// ---------- badge: how many notes you have for the current site ----------
// Needs the optional "tabs" permission to read tab URLs; silently does nothing without it.

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (_) {
    return null;
  }
}

async function updateBadge(tabId, url) {
  if (tabId === undefined) return;
  let text = '';
  if (url && /^https?:/i.test(url)) {
    const data = await chrome.storage.local.get(null);
    const host = hostOf(url);
    let count = 0;
    for (const [key, value] of Object.entries(data)) {
      if (key.startsWith(Store.PREFIX) && value && value.sourceUrl && hostOf(value.sourceUrl) === host) count++;
    }
    const annot = data['annot:' + url.split('#')[0]];
    if (annot && annot.shapes && annot.shapes.length) count++;
    text = count ? String(Math.min(count, 99)) : '';
  }
  await chrome.action.setBadgeBackgroundColor({ color: '#5b5bd6', tabId }).catch(() => {});
  await chrome.action.setBadgeText({ text, tabId }).catch(() => {});
}

async function updateActiveBadge() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
  if (tab && tab.url) updateBadge(tab.id, tab.url);
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete' && tab.url) updateBadge(tabId, tab.url);
});
chrome.tabs.onActivated.addListener(updateActiveBadge);
chrome.permissions.onAdded.addListener(updateActiveBadge);

let badgeTimer = 0;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (!Object.keys(changes).some((k) => k.startsWith(Store.PREFIX) || k.startsWith('annot:'))) return;
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(updateActiveBadge, 500);
});

// ---------- helpers ----------

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function safeHref(url) {
  return /^https?:\/\//i.test(url || '') ? escapeHtml(url) : '';
}

function sourceLine(url, title) {
  const href = safeHref(url);
  const label = escapeHtml(title || url || 'source');
  return href ? `<p>— <a href="${href}">${label}</a></p>` : '';
}

async function saveClip(info, tab) {
  const pageTitle = (tab && tab.title) || info.pageUrl || 'Clipping';
  const pageUrl = info.pageUrl || (tab && tab.url) || '';
  let title = pageTitle;
  let html = '';
  let text = '';

  if (info.menuItemId === 'save-selection') {
    const sel = info.selectionText || '';
    html = `<blockquote>${escapeHtml(sel).replace(/\n/g, '<br>')}</blockquote>${sourceLine(pageUrl, pageTitle)}<p><br></p>`;
    text = `${sel} ${pageTitle}`;
  } else if (info.menuItemId === 'save-link') {
    const href = safeHref(info.linkUrl);
    const label = info.selectionText || info.linkUrl;
    title = label;
    html = `<p>${href ? `<a href="${href}">${escapeHtml(label)}</a>` : escapeHtml(label)}</p>${sourceLine(pageUrl, pageTitle)}<p><br></p>`;
    text = `${label} ${info.linkUrl}`;
  } else if (info.menuItemId === 'save-page') {
    html = `${sourceLine(pageUrl, pageTitle)}<p><br></p>`;
    text = `${pageTitle} ${pageUrl}`;
  } else {
    return;
  }

  const note = Store.createNote({ type: 'text', title: title.slice(0, 200), html, text, sourceUrl: pageUrl || null });
  await Store.put(note);
  await Store.requestOpen(note.id);
}

async function startAnnotating(tab) {
  if (!tab || tab.id === undefined) return { ok: false, error: 'No active tab.' };
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ANNOTATOR_FILES });
    return { ok: true };
  } catch (err) {
    flashBadge(tab.id);
    const hasAllSites = await chrome.permissions.contains({ origins: ['<all_urls>'] });
    return { ok: false, error: err.message, canRequestAccess: !hasAllSites };
  }
}

function flashBadge(tabId) {
  chrome.action.setBadgeBackgroundColor({ color: '#d9363e', tabId }).catch(() => {});
  chrome.action.setBadgeText({ text: '!', tabId }).catch(() => {});
  setTimeout(() => chrome.action.setBadgeText({ text: '', tabId }).catch(() => {}), 3000);
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

async function makeThumb(bitmap, max = 360) {
  const k = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * k), Math.round(bitmap.height * k));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.75 });
  return `data:image/jpeg;base64,${bytesToBase64(new Uint8Array(await blob.arrayBuffer()))}`;
}

// Screenshot the visible tab (page + annotations) into a new drawing note.
async function captureToNote(msg, sender) {
  const tab = sender.tab;
  if (!tab) return { ok: false, error: 'No tab to capture.' };
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 85 });
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const dpr = Number(msg.dpr) > 0 ? Number(msg.dpr) : 1;
  const w = Math.round((bitmap.width / dpr) * 10) / 10;
  const h = Math.round((bitmap.height / dpr) * 10) / 10;
  const thumb = await makeThumb(bitmap);
  bitmap.close();

  const title = String(msg.title || 'Page').slice(0, 180);
  const note = Store.createNote({
    type: 'drawing',
    title: `${title} (annotated)`,
    text: String(msg.url || ''),
    sourceUrl: /^https?:/i.test(msg.url || '') ? msg.url : null,
    thumb,
    drawing: { v: 1, background: 'none', shapes: [{ type: 'image', src: dataUrl, x: 0, y: 0, w, h }] },
  });
  await Store.put(note);
  await Store.requestOpen(note.id);
  return { ok: true, id: note.id };
}

async function createWelcomeNote() {
  const html = [
    '<h1>Welcome to Inkwell ✍️</h1>',
    '<p>Your notes and sketches live right in Chrome’s side panel, next to whatever you are reading.</p>',
    '<ul class="checklist">',
    '<li class="checked">Install Inkwell</li>',
    '<li>Create a note with <b>Note</b> or a sketch with <b>Drawing</b></li>',
    '<li>Highlight text on any page, right-click → <b>Save selection to Inkwell</b></li>',
    '<li>Press <b>Alt+Shift+D</b> (or right-click → <b>Draw on this page</b>) to draw on top of a website</li>',
    '</ul>',
    '<h2>Writing shortcuts</h2>',
    '<p>At the start of a line, type <code>#</code>, <code>##</code>, <code>-</code>, <code>1.</code>, <code>[]</code>, <code>&gt;</code> or <code>```</code> followed by a space. Ctrl+B / I / U work as usual, and Ctrl+click opens a link.</p>',
    '<h2>Drawing shortcuts</h2>',
    '<p><b>V</b> select · <b>P</b> pen · <b>H</b> highlighter · <b>E</b> eraser · <b>L</b> line · <b>A</b> arrow · <b>R</b> rectangle · <b>O</b> ellipse · <b>T</b> text · <b>M</b> or hold <b>Space</b> to pan · <b>Ctrl+scroll</b> to zoom · <b>[ ]</b> brush size · <b>Ctrl+Z</b> undo. With the select tool: drag to move, drag the corner to resize, <b>Delete</b> to remove, <b>Ctrl+D</b> to duplicate, click a color to recolor.</p>',
    '<p><br></p>',
  ].join('');
  const note = Store.createNote({
    type: 'text',
    title: 'Welcome to Inkwell',
    html,
    text: 'Welcome to Inkwell. Notes, sketches, clipping and drawing on web pages. Shortcuts.',
    pinned: true,
  });
  await Store.put(note);
}
