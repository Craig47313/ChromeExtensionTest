// Inkwell app: note list, rich-text editor and drawing editor.
// Runs in the side panel (app.html) and in a full tab (app.html?tab=1).
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const INSTANCE = Store.newId(); // tags our own writes so storage echoes are ignored
  const IS_TAB = new URLSearchParams(location.search).has('tab');
  const PALETTE = ['ink', '#e03131', '#f08c00', '#fcc419', '#2f9e44', '#1971c2', '#7048e8', '#e64980'];
  const THEMES = ['system', 'light', 'dark'];
  const THEME_ICONS = { system: 'monitor', light: 'sun', dark: 'moon' };
  const TYPE_ICONS = { text: 'note', drawing: 'brush', calc: 'function' };

  const state = {
    notes: new Map(),
    currentId: null,
    query: '',
    settings: { theme: 'system' },
    dirty: false,
    saveTimer: 0,
    saving: null,
  };

  const els = {
    app: $('#app'),
    list: $('#noteList'),
    listEmpty: $('#listEmpty'),
    search: $('#search'),
    emptyState: $('#emptyState'),
    editor: $('#editor'),
    title: $('#titleInput'),
    status: $('#saveStatus'),
    pinBtn: $('#pinBtn'),
    textPane: $('#textPane'),
    drawPane: $('#drawPane'),
    calcPane: $('#calcPane'),
    quickCalc: $('#quickCalc'),
    rich: $('#rich'),
    fmtBar: $('#fmtBar'),
    wordCount: $('#wordCount'),
    sourceLink: $('#sourceLink'),
    canvas: $('#inkCanvas'),
    canvasWrap: $('#canvasWrap'),
    swatches: $('#swatches'),
    sizeRange: $('#sizeRange'),
    sizeDot: $('#sizeDot'),
    bgSelect: $('#bgSelect'),
    zoomBtn: $('#zoomBtn'),
    themeBtn: $('#themeBtn'),
    toast: $('#toast'),
  };

  // ---------- small utilities ----------

  function hydrateIcons(root = document) {
    for (const el of $$('[data-icon]', root)) {
      if (el.dataset.hydrated) continue;
      el.dataset.hydrated = '1';
      el.insertAdjacentHTML('afterbegin', InkIcons.svg(el.dataset.icon, Number(el.dataset.size) || 18));
    }
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function formatDate(ts) {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const days = (now - d) / 86400000;
    if (days < 6) return d.toLocaleDateString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
  }

  function slugify(s) {
    return (s || 'untitled').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'untitled';
  }

  function download(filename, data, type) {
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function dataUrlToBlob(dataUrl) {
    const [head, body] = dataUrl.split(',');
    const mime = head.match(/:(.*?);/)[1];
    const bin = atob(body);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  // Downscale big images so notes stay light in storage.
  async function imageFileToDataUrl(file, maxDim = 1600) {
    const bitmap = await createImageBitmap(file);
    const k = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * k);
    canvas.height = Math.round(bitmap.height * k);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const png = file.type === 'image/png' || file.type === 'image/gif';
    const src = png ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.88);
    return { src, width: canvas.width, height: canvas.height };
  }

  let toastTimer = 0;
  function toast(message, { action, onAction, timeout = 4200 } = {}) {
    const el = els.toast;
    el.textContent = '';
    const span = document.createElement('span');
    span.textContent = message;
    el.appendChild(span);
    if (action) {
      const btn = document.createElement('button');
      btn.textContent = action;
      btn.addEventListener('click', () => {
        el.classList.remove('show');
        onAction();
      });
      el.appendChild(btn);
    }
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), timeout);
  }

  // ---------- popup menu ----------

  let openMenuEl = null;
  function closeMenu() {
    if (!openMenuEl) return;
    openMenuEl.remove();
    openMenuEl = null;
    document.removeEventListener('pointerdown', onOutsideMenu, true);
  }
  function onOutsideMenu(e) {
    if (openMenuEl && !openMenuEl.contains(e.target)) closeMenu();
  }
  function openMenu(anchor, items) {
    closeMenu();
    const menu = document.createElement('div');
    menu.className = 'menu';
    menu.setAttribute('role', 'menu');
    for (const item of items) {
      if (!item) continue;
      if (item === '-') {
        menu.appendChild(Object.assign(document.createElement('div'), { className: 'menu-sep' }));
        continue;
      }
      const btn = document.createElement('button');
      btn.className = 'menu-item' + (item.danger ? ' danger' : '');
      btn.setAttribute('role', 'menuitem');
      btn.innerHTML = InkIcons.svg(item.icon, 16);
      btn.append(item.label);
      btn.addEventListener('click', () => {
        closeMenu();
        item.run();
      });
      menu.appendChild(btn);
    }
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8));
    let top = r.bottom + 4;
    if (top + menu.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - menu.offsetHeight - 4);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    openMenuEl = menu;
    setTimeout(() => document.addEventListener('pointerdown', onOutsideMenu, true));
    menu.querySelector('button')?.focus();
  }

  // ---------- prompt dialog ----------

  function ask(label, value = '') {
    const dlg = $('#promptDialog');
    const input = $('#promptInput');
    $('#promptLabel').textContent = label;
    input.value = value;
    dlg.returnValue = '';
    return new Promise((resolve) => {
      const onKey = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          dlg.close('ok');
        }
      };
      input.addEventListener('keydown', onKey);
      dlg.addEventListener(
        'close',
        () => {
          input.removeEventListener('keydown', onKey);
          resolve(dlg.returnValue === 'ok' ? input.value.trim() : null);
        },
        { once: true }
      );
      dlg.showModal();
      input.select();
    });
  }

  // ---------- HTML sanitising & markdown ----------

  const ALLOWED_TAGS = new Set(['P', 'DIV', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'H1', 'H2', 'H3', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'CODE', 'A', 'IMG', 'HR', 'MARK', 'SUB', 'SUP']);
  const DROP_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'NOSCRIPT', 'META', 'LINK', 'TITLE', 'HEAD', 'SVG', 'MATH', 'CANVAS', 'VIDEO', 'AUDIO', 'FORM', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'BASE']);
  const BLOCKISH = /^(SECTION|ARTICLE|HEADER|FOOTER|MAIN|ASIDE|NAV|FIGURE|FIGCAPTION|TABLE|THEAD|TBODY|TFOOT|TR|DL|DT|DD|ADDRESS|DETAILS|SUMMARY|CENTER)$/;

  function cleanNode(node, doc) {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) continue;
      if (child.nodeType !== Node.ELEMENT_NODE) {
        child.remove();
        continue;
      }
      let el = child;
      let tag = el.tagName;
      if (DROP_TAGS.has(tag)) {
        el.remove();
        continue;
      }
      if (/^H[4-6]$/.test(tag) || BLOCKISH.test(tag)) {
        const repl = doc.createElement(/^H/.test(tag) ? 'H3' : 'DIV');
        repl.append(...el.childNodes);
        el.replaceWith(repl);
        el = repl;
        tag = repl.tagName;
      }
      cleanNode(el, doc);
      if (!ALLOWED_TAGS.has(tag)) {
        el.replaceWith(...el.childNodes);
        continue;
      }
      for (const attr of [...el.attributes]) {
        const name = attr.name.toLowerCase();
        const value = attr.value.trim();
        let keep = false;
        if (tag === 'A' && name === 'href') keep = /^(https?:|mailto:)/i.test(value);
        else if (tag === 'IMG' && name === 'src') keep = /^data:image\/(png|jpe?g|gif|webp);/i.test(value) || /^https:\/\//i.test(value);
        else if (name === 'class') {
          const cls = value.split(/\s+/).filter((c) => c === 'checklist' || c === 'checked');
          if (cls.length) {
            el.setAttribute('class', cls.join(' '));
            keep = true;
          }
        }
        if (!keep) el.removeAttribute(attr.name);
      }
      if (tag === 'IMG' && !el.hasAttribute('src')) el.remove();
    }
  }

  function sanitizeHtml(html) {
    const doc = new DOMParser().parseFromString(`<!doctype html><body>${html || ''}</body>`, 'text/html');
    cleanNode(doc.body, doc);
    return doc.body.innerHTML;
  }

  // execCommand can leave lists/quotes nested inside <p>, which the HTML parser
  // would split into stray empty paragraphs on reload. Unwrap such paragraphs.
  function serializeRich() {
    const clone = els.rich.cloneNode(true);
    for (const p of [...clone.querySelectorAll('p')].reverse()) {
      if (p.querySelector('p, div, ul, ol, blockquote, pre, h1, h2, h3, hr')) p.replaceWith(...p.childNodes);
    }
    return clone.innerHTML;
  }

  function toMarkdown(html) {
    const doc = new DOMParser().parseFromString(`<!doctype html><body>${html || ''}</body>`, 'text/html');
    const wrap = (s, m) => {
      const t = s.trim();
      return t ? `${m}${t}${m}` : '';
    };
    const inline = (node) => {
      let out = '';
      for (const c of node.childNodes) {
        if (c.nodeType === Node.TEXT_NODE) {
          out += c.textContent.replace(/\s+/g, ' ');
          continue;
        }
        if (c.nodeType !== Node.ELEMENT_NODE) continue;
        switch (c.tagName) {
          case 'B': case 'STRONG': out += wrap(inline(c), '**'); break;
          case 'I': case 'EM': out += wrap(inline(c), '_'); break;
          case 'S': case 'STRIKE': case 'DEL': out += wrap(inline(c), '~~'); break;
          case 'CODE': out += '`' + c.textContent + '`'; break;
          case 'A': out += `[${inline(c).trim() || c.getAttribute('href')}](${c.getAttribute('href') || ''})`; break;
          case 'BR': out += '  \n'; break;
          case 'IMG': out += /^https:/.test(c.getAttribute('src') || '') ? `![](${c.getAttribute('src')})` : '[image]'; break;
          case 'UL': case 'OL': out += '\n' + list(c, '  '); break;
          default: out += inline(c);
        }
      }
      return out;
    };
    const list = (el, indent = '') => {
      let out = '';
      let n = 1;
      const checklist = el.classList.contains('checklist');
      for (const li of el.children) {
        if (li.tagName === 'UL' || li.tagName === 'OL') {
          out += list(li, indent + '  ');
          continue;
        }
        let marker = '-';
        if (el.tagName === 'OL') marker = `${n++}.`;
        else if (checklist) marker = li.classList.contains('checked') ? '- [x]' : '- [ ]';
        const nested = [...li.children].filter((c) => c.tagName === 'UL' || c.tagName === 'OL');
        nested.forEach((c) => c.remove());
        out += `${indent}${marker} ${inline(li).trim()}\n`;
        for (const c of nested) out += list(c, indent + '  ');
      }
      return out;
    };
    const blocks = (node) => {
      let out = '';
      let para = '';
      const flush = () => {
        if (para.trim()) out += para.trim() + '\n\n';
        para = '';
      };
      for (const c of node.childNodes) {
        const tag = c.nodeType === Node.ELEMENT_NODE ? c.tagName : '';
        if (/^H[1-3]$/.test(tag)) {
          flush();
          out += `${'#'.repeat(+tag[1])} ${inline(c).trim()}\n\n`;
        } else if (tag === 'P' || tag === 'DIV') {
          flush();
          const hasBlocks = [...c.children].some((k) => /^(P|DIV|UL|OL|BLOCKQUOTE|PRE|H[1-3])$/.test(k.tagName));
          out += hasBlocks ? blocks(c) : inline(c).trim() ? inline(c).trim() + '\n\n' : '';
        } else if (tag === 'UL' || tag === 'OL') {
          flush();
          out += list(c) + '\n';
        } else if (tag === 'BLOCKQUOTE') {
          flush();
          const inner = blocks(c).trim() || inline(c).trim();
          out += inner.split('\n').map((l) => `> ${l}`.trimEnd()).join('\n') + '\n\n';
        } else if (tag === 'PRE') {
          flush();
          out += '```\n' + c.textContent.replace(/\n$/, '') + '\n```\n\n';
        } else if (tag === 'HR') {
          flush();
          out += '---\n\n';
        } else {
          para += c.nodeType === Node.ELEMENT_NODE ? inline({ childNodes: [c] }) : c.textContent.replace(/\s+/g, ' ');
        }
      }
      flush();
      return out;
    };
    return blocks(doc.body).replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  // ---------- theme ----------

  const darkQuery = matchMedia('(prefers-color-scheme: dark)');

  function applyTheme() {
    const t = state.settings.theme || 'system';
    const dark = t === 'dark' || (t === 'system' && darkQuery.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    els.themeBtn.innerHTML = InkIcons.svg(THEME_ICONS[t] || 'monitor');
    els.themeBtn.title = `Theme: ${t[0].toUpperCase()}${t.slice(1)}`;
    if (calc) calc.setDark(dark, cssVar('--paper'));
    if (ink) {
      ink.inkColor = dark ? '#ececf1' : '#1e1e2e';
      ink.paper = cssVar('--paper');
      ink.gridColor = cssVar('--grid');
      ink.requestRender();
      renderSwatches();
    }
  }
  darkQuery.addEventListener('change', applyTheme);

  els.themeBtn.addEventListener('click', async () => {
    const next = THEMES[(THEMES.indexOf(state.settings.theme) + 1) % THEMES.length];
    state.settings = await Store.setSettings({ theme: next });
    applyTheme();
  });

  // ---------- note list ----------

  function sortedNotes() {
    return [...state.notes.values()].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updated - a.updated);
  }

  function renderList() {
    const q = state.query.trim().toLowerCase();
    const all = sortedNotes();
    const notes = q ? all.filter((n) => `${n.title || ''}\n${n.text || ''}`.toLowerCase().includes(q)) : all;
    const frag = document.createDocumentFragment();

    for (const n of notes) {
      const li = document.createElement('li');
      li.className = 'note-item' + (n.id === state.currentId ? ' active' : '');
      li.dataset.id = n.id;
      li.tabIndex = 0;
      li.setAttribute('role', 'button');

      const thumb = document.createElement('div');
      thumb.className = 'note-thumb';
      if (n.type !== 'text' && n.thumb) {
        const img = document.createElement('img');
        img.src = n.thumb;
        img.alt = '';
        img.loading = 'lazy';
        thumb.appendChild(img);
      } else {
        thumb.innerHTML = InkIcons.svg(TYPE_ICONS[n.type] || 'note', 20);
      }

      const body = document.createElement('div');
      body.className = 'note-body';
      const title = document.createElement('div');
      title.className = 'note-title';
      if (n.pinned) title.insertAdjacentHTML('afterbegin', InkIcons.svg('pin', 13));
      const titleText = document.createElement('span');
      titleText.textContent = n.title || (n.type === 'text' && n.text ? n.text.slice(0, 60) : 'Untitled');
      title.appendChild(titleText);
      const snippet = document.createElement('div');
      snippet.className = 'note-snippet';
      snippet.textContent = (n.text || { drawing: 'Drawing', calc: 'Calculator' }[n.type] || 'No text yet').slice(0, 200);
      const date = document.createElement('div');
      date.className = 'note-date';
      date.textContent = formatDate(n.updated);
      body.append(title, snippet, date);

      const del = document.createElement('button');
      del.className = 'note-del';
      del.dataset.del = n.id;
      del.title = 'Delete note';
      del.setAttribute('aria-label', `Delete ${n.title || 'note'}`);
      del.innerHTML = InkIcons.svg('trash', 17);
      li.append(thumb, body, del);
      frag.appendChild(li);
    }
    els.list.replaceChildren(frag);

    els.listEmpty.hidden = notes.length > 0 || !els.quickCalc.hidden;
    els.listEmpty.textContent = all.length ? `No notes match “${state.query.trim()}”.` : 'No notes yet. Create one above!';
    renderPageContext();
  }

  els.list.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      deleteNote(del.dataset.del);
      return;
    }
    const item = e.target.closest('.note-item');
    if (item) openNote(item.dataset.id);
  });
  els.list.addEventListener('keydown', (e) => {
    const item = e.target.closest('.note-item');
    if (!item) return;
    if (e.target !== item) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      const next = item.nextElementSibling || item.previousElementSibling;
      deleteNote(item.dataset.id).then(() => next && els.list.querySelector(`[data-id="${next.dataset.id}"]`)?.focus());
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openNote(item.dataset.id);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      (e.key === 'ArrowDown' ? item.nextElementSibling : item.previousElementSibling)?.focus();
    }
  });

  els.search.addEventListener('input', () => {
    state.query = els.search.value;
    updateQuickCalc();
    renderList();
  });
  els.search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      els.search.value = '';
      state.query = '';
      updateQuickCalc();
      renderList();
    } else if (e.key === 'Enter' && !els.quickCalc.hidden) {
      e.preventDefault();
      copyQuickCalc();
    } else if (e.key === 'ArrowDown' || e.key === 'Enter') {
      const first = els.list.querySelector('.note-item');
      if (first) {
        e.preventDefault();
        e.key === 'Enter' ? openNote(first.dataset.id) : first.focus();
      }
    }
  });

  // ---------- open / create / delete ----------

  function currentNote() {
    return state.currentId ? state.notes.get(state.currentId) : null;
  }

  function isBlank(note) {
    if (!note || note.title) return false;
    if (note.type === 'drawing') return !(note.drawing && note.drawing.shapes && note.drawing.shapes.length);
    if (note.type === 'calc') return !(note.calc && note.calc.rows && note.calc.rows.some((r) => r.text.trim()));
    return !(note.text || '').trim() && !/<img/i.test(note.html || '');
  }

  // Leaving an untouched new note removes it, so the list doesn't fill with "Untitled".
  async function discardIfBlank(id) {
    const note = state.notes.get(id);
    if (note && isBlank(note) && Date.now() - note.created < 30 * 60 * 1000) {
      state.notes.delete(id);
      await Store.remove(id);
    }
  }

  async function openNote(id, { focus = false } = {}) {
    const prev = state.currentId;
    if (id === prev && !els.editor.hidden) {
      els.app.classList.add('show-editor');
      return;
    }
    await saveNow();
    const note = state.notes.get(id);
    if (!note) return;
    if (prev && prev !== id) await discardIfBlank(prev);

    state.currentId = id;
    els.app.classList.add('show-editor');
    els.emptyState.hidden = true;
    els.editor.hidden = false;
    loadEditor(note);
    setStatus('');
    renderList();

    if (focus) {
      if (note.type === 'text') placeCaretAtEnd(els.rich);
      else els.canvas.focus({ preventScroll: true }); // so tool shortcuts work right away
    }
  }

  function loadEditor(note, { keepView = false } = {}) {
    if (document.activeElement !== els.title) els.title.value = note.title || '';
    els.pinBtn.classList.toggle('on', !!note.pinned);
    els.pinBtn.title = note.pinned ? 'Unpin' : 'Pin to top';
    const isText = note.type === 'text';
    els.textPane.hidden = !isText;
    els.drawPane.hidden = note.type !== 'drawing';
    els.calcPane.hidden = note.type !== 'calc';

    if (note.type === 'calc') {
      ensureCalc();
      calc.load(note.calc);
      requestAnimationFrame(() => calc.graph.resize());
    } else if (isText) {
      els.rich.innerHTML = sanitizeHtml(note.html) || '<p><br></p>';
      updateTextMeta();
      if (note.sourceUrl) {
        els.sourceLink.hidden = false;
        els.sourceLink.href = note.sourceUrl;
        try {
          els.sourceLink.textContent = `From ${new URL(note.sourceUrl).hostname.replace(/^www\./, '')}`;
        } catch (_) {
          els.sourceLink.textContent = 'Source';
        }
        els.sourceLink.title = note.sourceUrl;
      } else {
        els.sourceLink.hidden = true;
      }
    } else {
      ensureInk();
      ink.load(note.drawing, { keepView });
      els.bgSelect.value = ink.background;
      requestAnimationFrame(() => {
        ink.resize();
        if (!keepView && ink.shapes.some((s) => s.type === 'image')) ink.zoomToFit(24);
      });
      syncDrawUI();
    }
  }

  function showEmpty() {
    state.currentId = null;
    els.editor.hidden = true;
    els.emptyState.hidden = false;
    els.app.classList.remove('show-editor');
    renderList();
  }

  async function createNote(type, extra = {}) {
    const prev = state.currentId;
    await saveNow();
    if (prev) await discardIfBlank(prev);
    const note = Store.createNote({
      type,
      html: type === 'text' ? '<p><br></p>' : '',
      drawing: type === 'drawing' ? { v: 1, background: state.settings.paper || 'dots', shapes: [] } : null,
      calc: type === 'calc' ? { v: 1, rows: [{ text: '' }] } : undefined,
      lastEditor: INSTANCE,
      ...extra,
    });
    state.notes.set(note.id, note);
    await Store.put(note);
    if (state.query) {
      state.query = '';
      els.search.value = '';
    }
    await openNote(note.id, { focus: true });
  }

  async function deleteCurrent() {
    if (state.currentId) await deleteNote(state.currentId);
  }

  async function deleteNote(id) {
    if (!state.notes.has(id)) return;
    const isCurrent = id === state.currentId;
    if (isCurrent) await saveNow();
    const snapshot = { ...state.notes.get(id) };
    state.notes.delete(id);
    await Store.remove(id);
    if (isCurrent) showEmpty();
    else renderList();
    const label = snapshot.title ? `“${snapshot.title.slice(0, 40)}” deleted` : 'Note deleted';
    toast(label, {
      action: 'Undo',
      onAction: async () => {
        state.notes.set(snapshot.id, snapshot);
        await Store.put(snapshot);
        openNote(snapshot.id);
      },
      timeout: 6000,
    });
  }

  async function duplicateCurrent() {
    await saveNow();
    const note = currentNote();
    if (!note) return;
    const copy = { ...structuredClone(note), id: Store.newId(), title: `${note.title || 'Untitled'} (copy)`, pinned: false, created: Date.now(), updated: Date.now(), lastEditor: INSTANCE };
    state.notes.set(copy.id, copy);
    await Store.put(copy);
    openNote(copy.id);
    toast('Duplicated');
  }

  async function togglePin() {
    const note = currentNote();
    if (!note) return;
    note.pinned = !note.pinned;
    note.lastEditor = INSTANCE;
    els.pinBtn.classList.toggle('on', note.pinned);
    els.pinBtn.title = note.pinned ? 'Unpin' : 'Pin to top';
    await Store.put(note);
    renderList();
  }

  // ---------- saving ----------

  function setStatus(text) {
    els.status.textContent = text;
  }

  function scheduleSave() {
    if (!state.currentId) return;
    state.dirty = true;
    setStatus('Editing…');
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(saveNow, 450);
  }

  async function saveNow() {
    clearTimeout(state.saveTimer);
    if (state.saving) await state.saving;
    if (!state.dirty) return;
    state.dirty = false;
    const note = currentNote();
    if (!note) return;
    state.saving = (async () => {
      note.title = els.title.value.trim();
      if (note.type === 'calc') {
        note.calc = calc.toJSON();
        note.text = calc.plainText();
        note.thumb = calc.rows.some((r) => r.text.trim()) ? calc.thumbnail() : null;
      } else if (note.type === 'drawing') {
        ink.commitText();
        note.drawing = ink.toJSON();
        note.text = ink.shapes.filter((s) => s.type === 'text').map((s) => s.text).join(' ');
        note.thumb = await ink.toImage({ type: 'image/jpeg', quality: 0.75, maxSize: 360, scale: 1, padding: 16 });
      } else {
        note.html = serializeRich();
        note.text = els.rich.innerText.replace(/\s+/g, ' ').trim();
      }
      note.updated = Date.now();
      note.lastEditor = INSTANCE;
      try {
        await Store.put(note);
        if (!state.dirty) setStatus('Saved');
      } catch (err) {
        console.error(err);
        state.dirty = true;
        setStatus('Not saved');
        toast(`Couldn’t save: ${err.message}`);
      }
      renderList();
    })();
    try {
      await state.saving;
    } finally {
      state.saving = null;
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveNow();
  });
  window.addEventListener('pagehide', () => saveNow());

  els.title.addEventListener('input', scheduleSave);
  els.title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || (e.key === 'ArrowDown' && !e.shiftKey)) {
      e.preventDefault();
      if (currentNote()?.type === 'text') placeCaretAtStart(els.rich);
      else els.canvas.focus();
    }
  });

  // ---------- rich text editor ----------

  document.execCommand('defaultParagraphSeparator', false, 'p');

  function exec(cmd, value = null) {
    els.rich.focus();
    document.execCommand(cmd, false, value);
  }

  function placeCaretAtEnd(el) {
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function placeCaretAtStart(el) {
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(true);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function caretElement() {
    const sel = getSelection();
    if (!sel.rangeCount) return null;
    const node = sel.anchorNode;
    const el = node && (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
    return el && els.rich.contains(el) ? el : null;
  }

  function listAtCaret() {
    const el = caretElement();
    const list = el && el.closest('ul, ol');
    return list && els.rich.contains(list) ? list : null;
  }

  function blockTag() {
    return (document.queryCommandValue('formatBlock') || '').toUpperCase();
  }

  function toggleBlock(tag) {
    exec('formatBlock', blockTag() === tag ? 'P' : tag);
  }

  function toggleChecklist() {
    let list = listAtCaret();
    if (list && list.tagName === 'UL' && list.classList.contains('checklist')) {
      exec('insertUnorderedList');
      return;
    }
    if (!list || list.tagName === 'OL') exec('insertUnorderedList');
    list = listAtCaret();
    if (list && list.tagName === 'UL') list.classList.add('checklist');
  }

  function toggleBullets() {
    const list = listAtCaret();
    if (list && list.classList.contains('checklist')) list.classList.remove('checklist');
    else exec('insertUnorderedList');
  }

  async function insertLink() {
    const sel = getSelection();
    const range = sel.rangeCount && els.rich.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
    const existing = caretElement()?.closest('a');
    const url = await ask('Link address', existing ? existing.getAttribute('href') : 'https://');
    els.rich.focus();
    if (range) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
    if (url === null) return;
    if (!url) {
      if (existing) {
        const r = document.createRange();
        r.selectNodeContents(existing);
        sel.removeAllRanges();
        sel.addRange(r);
      }
      exec('unlink');
      return;
    }
    const href = /^(https?:|mailto:)/i.test(url) ? url : `https://${url}`;
    if (!range || range.collapsed) {
      const a = document.createElement('a');
      a.href = href;
      a.textContent = url;
      exec('insertHTML', a.outerHTML + '&nbsp;');
    } else {
      exec('createLink', href);
    }
  }

  const FORMAT_ACTIONS = {
    bold: () => exec('bold'),
    italic: () => exec('italic'),
    underline: () => exec('underline'),
    strike: () => exec('strikeThrough'),
    h1: () => toggleBlock('H1'),
    h2: () => toggleBlock('H2'),
    quote: () => toggleBlock('BLOCKQUOTE'),
    code: () => toggleBlock('PRE'),
    ul: toggleBullets,
    ol: () => exec('insertOrderedList'),
    check: toggleChecklist,
    link: insertLink,
    hr: () => exec('insertHorizontalRule'),
    clear: () => {
      exec('removeFormat');
      exec('unlink');
      if (blockTag() !== 'P' && !listAtCaret()) exec('formatBlock', 'P');
    },
  };

  els.fmtBar.addEventListener('mousedown', (e) => {
    if (e.target.closest('button')) e.preventDefault(); // keep the selection in the editor
  });
  els.fmtBar.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-cmd]');
    if (!btn) return;
    await FORMAT_ACTIONS[btn.dataset.cmd]();
    scheduleSave();
    updateTextMeta();
    updateFormatState();
  });

  function updateFormatState() {
    if (els.textPane.hidden) return;
    const inEditor = !!caretElement();
    const tag = inEditor ? blockTag() : '';
    const list = inEditor ? listAtCaret() : null;
    const states = {
      bold: inEditor && document.queryCommandState('bold'),
      italic: inEditor && document.queryCommandState('italic'),
      underline: inEditor && document.queryCommandState('underline'),
      strike: inEditor && document.queryCommandState('strikeThrough'),
      h1: tag === 'H1',
      h2: tag === 'H2',
      quote: tag === 'BLOCKQUOTE',
      code: tag === 'PRE',
      ul: !!list && list.tagName === 'UL' && !list.classList.contains('checklist'),
      ol: !!list && list.tagName === 'OL',
      check: !!list && list.classList.contains('checklist'),
      link: inEditor && !!caretElement().closest('a'),
    };
    for (const btn of $$('button[data-cmd]', els.fmtBar)) btn.classList.toggle('active', !!states[btn.dataset.cmd]);
  }
  document.addEventListener('selectionchange', updateFormatState);

  function updateTextMeta() {
    const text = els.rich.innerText.trim();
    const words = text ? text.split(/\s+/).length : 0;
    els.wordCount.textContent = `${words} word${words === 1 ? '' : 's'} · ${text.length} characters`;
    const empty = !text && !els.rich.querySelector('img, hr, li');
    els.rich.classList.toggle('is-empty', empty);
  }

  // "# ", "- ", "1. ", "[] ", "> ", "``` " at the start of a line.
  const MD_SHORTCUTS = {
    '#': () => exec('formatBlock', 'H1'),
    '##': () => exec('formatBlock', 'H2'),
    '###': () => exec('formatBlock', 'H3'),
    '-': () => exec('insertUnorderedList'),
    '*': () => exec('insertUnorderedList'),
    '1.': () => exec('insertOrderedList'),
    '[]': toggleChecklist,
    '[ ]': toggleChecklist,
    '>': () => exec('formatBlock', 'BLOCKQUOTE'),
    '```': () => exec('formatBlock', 'PRE'),
  };

  function tryMarkdownShortcut() {
    const sel = getSelection();
    if (!sel.rangeCount || !sel.isCollapsed) return false;
    const el = caretElement();
    if (!el) return false;
    const block = el.closest('p, div, h1, h2, h3, li, blockquote, pre');
    if (!block || block === els.rich || !els.rich.contains(block) || block.closest('pre')) return false;
    const range = document.createRange();
    range.setStart(block, 0);
    range.setEnd(sel.anchorNode, sel.anchorOffset);
    const prefix = range.toString();
    const action = MD_SHORTCUTS[prefix];
    if (!action) return false;
    if (block.tagName === 'LI' && !prefix.startsWith('[')) return false;
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('delete');
    action();
    return true;
  }

  els.rich.addEventListener('keydown', (e) => {
    if (e.key === ' ' && !e.ctrlKey && !e.metaKey && !e.altKey && tryMarkdownShortcut()) {
      e.preventDefault();
      scheduleSave();
      updateFormatState();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      if (listAtCaret()) {
        exec(e.shiftKey ? 'outdent' : 'indent');
        const list = listAtCaret();
        if (list && list.parentElement.closest('ul.checklist')) list.classList.add('checklist');
      } else if (!e.shiftKey) {
        exec('insertText', '    ');
      }
      scheduleSave();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      insertLink().then(scheduleSave);
    }
  });

  els.rich.addEventListener('input', (e) => {
    if (!els.rich.firstElementChild && !els.rich.textContent) els.rich.innerHTML = '<p><br></p>';
    if (e.inputType === 'insertParagraph') {
      const li = caretElement()?.closest('li');
      if (li && !li.textContent.trim()) li.classList.remove('checked');
    }
    updateTextMeta();
    scheduleSave();
  });

  // Checkbox toggling and Ctrl/Cmd+click to open links.
  els.rich.addEventListener('mousedown', (e) => {
    const li = e.target.closest('ul.checklist > li');
    if (li && e.target === li && e.clientX - li.getBoundingClientRect().left < 24) {
      e.preventDefault();
      li.classList.toggle('checked');
      scheduleSave();
    }
  });
  els.rich.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (a && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      window.open(a.href, '_blank', 'noopener');
    }
  });
  els.rich.addEventListener('mouseover', (e) => {
    const a = e.target.closest('a[href]');
    if (a && !a.title) a.title = `${a.href}\nCtrl+click to open`;
  });

  els.rich.addEventListener('paste', async (e) => {
    const cd = e.clipboardData;
    const imageItem = [...cd.items].find((i) => i.kind === 'file' && i.type.startsWith('image/'));
    if (imageItem) {
      e.preventDefault();
      const { src } = await imageFileToDataUrl(imageItem.getAsFile());
      exec('insertHTML', `<img src="${src}" alt="">`);
      scheduleSave();
      return;
    }
    const html = cd.getData('text/html');
    if (html) {
      e.preventDefault();
      exec('insertHTML', sanitizeHtml(html));
    }
  });

  els.rich.addEventListener('drop', async (e) => {
    const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith('image/'));
    if (!file) return;
    e.preventDefault();
    const { src } = await imageFileToDataUrl(file);
    if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(e.clientX, e.clientY);
      if (r) {
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
      }
    }
    exec('insertHTML', `<img src="${src}" alt="">`);
    scheduleSave();
  });

  // ---------- drawing editor ----------

  let ink = null;

  function ensureInk() {
    if (ink) return ink;
    const saved = state.settings.drawStyles || {};
    ink = new InkCanvas(els.canvas, {
      paper: cssVar('--paper'),
      gridColor: cssVar('--grid'),
      styles: {
        pen: { color: 'ink', size: 4, ...saved.pen },
        highlighter: { color: '#fcc419', size: 18, ...saved.highlighter },
        eraser: { size: 24, ...saved.eraser },
      },
      onChange: scheduleSave,
      onHistoryChange: syncDrawUI,
      onSelectionChange: syncDrawUI,
      onToolChange: syncDrawUI,
      onStyleChange: () => {
        syncDrawUI();
        persistDrawStyles();
      },
      onViewChange: (v) => {
        els.zoomBtn.textContent = `${Math.round(v.scale * 100)}%`;
      },
    });
    els.canvas.tabIndex = 0;
    // Pointer handlers call preventDefault, so move focus explicitly; this keeps
    // tool shortcuts working after drawing instead of typing into the title.
    els.canvas.addEventListener('pointerdown', () => {
      if (document.activeElement !== els.canvas) els.canvas.focus({ preventScroll: true });
    });
    applyTheme();
    return ink;
  }

  let styleTimer = 0;
  function persistDrawStyles() {
    clearTimeout(styleTimer);
    styleTimer = setTimeout(async () => {
      state.settings = await Store.setSettings({ drawStyles: structuredClone(ink.styles) });
    }, 600);
  }

  function renderSwatches() {
    els.swatches.textContent = '';
    for (const c of PALETTE) {
      const b = document.createElement('button');
      b.className = 'swatch';
      b.dataset.color = c;
      b.style.setProperty('--c', c === 'ink' ? (ink ? ink.inkColor : 'var(--text)') : c);
      b.title = c === 'ink' ? 'Ink' : c;
      b.setAttribute('aria-label', c === 'ink' ? 'Ink color' : `Color ${c}`);
      els.swatches.appendChild(b);
    }
    const custom = document.createElement('label');
    custom.className = 'swatch custom';
    custom.title = 'Custom color';
    const input = document.createElement('input');
    input.type = 'color';
    input.id = 'customColor';
    input.setAttribute('aria-label', 'Custom color');
    custom.appendChild(input);
    els.swatches.appendChild(custom);
    syncDrawUI();
  }

  function syncDrawUI() {
    if (!ink) return;
    for (const b of $$('.tool', els.drawPane)) b.classList.toggle('active', b.dataset.tool === ink.tool);
    const group = ink.styleGroup();
    const color = ink.color;
    let matched = false;
    for (const b of $$('.swatch[data-color]', els.swatches)) {
      const on = group !== 'eraser' && b.dataset.color === color;
      matched = matched || on;
      b.classList.toggle('active', on);
    }
    const custom = $('.swatch.custom', els.swatches);
    if (custom) {
      custom.classList.toggle('active', group !== 'eraser' && !matched);
      custom.style.background = group !== 'eraser' && !matched && color !== 'ink' ? color : '';
    }
    els.sizeRange.value = ink.size;
    els.sizeDot.style.setProperty('--d', `${Math.max(3, Math.min(22, ink.size))}px`);
    els.sizeDot.style.setProperty('--dot', group === 'eraser' ? 'var(--muted)' : ink.resolveColor(color));
    $('[data-draw="undo"]').disabled = !ink.canUndo;
    $('[data-draw="redo"]').disabled = !ink.canRedo;
    const delSel = $('[data-draw="delete-sel"]');
    delSel.hidden = !ink.selection.size;
    delSel.lastChild.textContent = ink.selection.size > 1 ? `Delete ${ink.selection.size}` : 'Delete';
  }

  els.drawPane.addEventListener('click', async (e) => {
    const tool = e.target.closest('.tool');
    if (tool) {
      ink.setTool(tool.dataset.tool);
      return;
    }
    const swatch = e.target.closest('.swatch[data-color]');
    if (swatch) {
      if (ink.tool === 'select' && ink.recolorSelection(swatch.dataset.color)) return;
      if (ink.tool === 'eraser' || ink.tool === 'hand' || ink.tool === 'select') ink.setTool('pen');
      ink.color = swatch.dataset.color;
      return;
    }
    const act = e.target.closest('[data-draw]');
    if (!act) return;
    switch (act.dataset.draw) {
      case 'undo': ink.undo(); break;
      case 'redo': ink.redo(); break;
      case 'delete-sel':
        ink.deleteSelection();
        els.canvas.focus({ preventScroll: true });
        break;
      case 'clear':
        if (ink.shapes.length) {
          ink.clear();
          toast('Canvas cleared', { action: 'Undo', onAction: () => ink.undo() });
        }
        break;
      case 'image': $('#imageInput').click(); break;
      case 'zoom':
        if (Math.abs(ink.view.scale - 1) < 0.01 && ink.view.x === 0 && ink.view.y === 0) ink.zoomToFit();
        else ink.resetView();
        break;
    }
  });

  els.swatches.addEventListener('input', (e) => {
    if (e.target.id !== 'customColor') return;
    if (ink.tool === 'select' && ink.recolorSelection(e.target.value)) return;
    if (ink.tool === 'eraser' || ink.tool === 'hand' || ink.tool === 'select') ink.setTool('pen');
    ink.color = e.target.value;
  });

  els.sizeRange.addEventListener('input', () => {
    ink.size = Number(els.sizeRange.value);
  });

  els.bgSelect.addEventListener('change', async () => {
    ink.setBackground(els.bgSelect.value);
    state.settings = await Store.setSettings({ paper: els.bgSelect.value });
  });

  $('#imageInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const { src, width, height } = await imageFileToDataUrl(file);
    ink.addImage(src, width, height);
  });

  els.canvasWrap.addEventListener('dragover', (e) => {
    if ([...e.dataTransfer.items].some((i) => i.kind === 'file')) {
      e.preventDefault();
      els.canvasWrap.classList.add('drop');
    }
  });
  els.canvasWrap.addEventListener('dragleave', () => els.canvasWrap.classList.remove('drop'));
  els.canvasWrap.addEventListener('drop', async (e) => {
    els.canvasWrap.classList.remove('drop');
    const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'));
    if (!file) return;
    e.preventDefault();
    const r = els.canvas.getBoundingClientRect();
    const { src, width, height } = await imageFileToDataUrl(file);
    ink.addImage(src, width, height, ink.toWorld(e.clientX - r.left, e.clientY - r.top));
  });

  // ---------- calculator ----------

  let calc = null;

  function ensureCalc() {
    if (calc) return calc;
    calc = new CalcEditor({
      rowsEl: $('#calcRows'),
      canvas: $('#graphCanvas'),
      angleBtn: $('#calcAngleBtn'),
      onChange: scheduleSave,
    });
    applyTheme();
    return calc;
  }

  $('#calcAddBtn').addEventListener('click', () => calc.insertRow(calc.rows.length, ''));
  els.calcPane.addEventListener('click', (e) => {
    const b = e.target.closest('[data-graph]');
    if (!b) return;
    if (b.dataset.graph === 'in') calc.graph.zoom(1.5);
    else if (b.dataset.graph === 'out') calc.graph.zoom(1 / 1.5);
    else calc.graph.home();
  });

  // Typing math in the search box shows the answer.
  function updateQuickCalc() {
    const q = els.search.value.trim();
    const looksLikeMath = /\d/.test(q) && /[-+*/^!%()×÷√]|\b(sqrt|sin|cos|tan|log|ln|pi)\b/.test(q);
    const value = looksLikeMath ? InkMath.quick(q) : null;
    els.quickCalc.hidden = value === null;
    if (value === null) return;
    els.quickCalc.textContent = `= ${InkMath.format(value)}`;
    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = 'Enter to copy';
    els.quickCalc.appendChild(hint);
    els.quickCalc.dataset.value = String(value);
  }

  async function copyQuickCalc() {
    await navigator.clipboard.writeText(els.quickCalc.dataset.value).catch(() => {});
    toast(`Copied ${InkMath.format(Number(els.quickCalc.dataset.value))}`);
  }
  els.quickCalc.addEventListener('click', copyQuickCalc);

  // ---------- global keyboard & paste ----------

  function isEditableTarget(t) {
    return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  }

  function drawingActive() {
    return ink && currentNote()?.type === 'drawing' && !els.drawPane.hidden;
  }

  document.addEventListener('keydown', (e) => {
    if ($('#promptDialog').open) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape' && openMenuEl) {
      closeMenu();
      return;
    }
    if (mod && e.altKey && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      createNote('text');
      return;
    }
    if (mod && e.altKey && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      createNote('drawing');
      return;
    }
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveNow();
      return;
    }
    if (isEditableTarget(e.target)) return;
    if (e.key === '/' && !mod) {
      e.preventDefault();
      els.app.classList.remove('show-editor');
      els.search.focus();
      return;
    }
    if (drawingActive() && ink.handleKeyDown(e)) e.preventDefault();
  });

  document.addEventListener('keyup', (e) => {
    if (ink) ink.handleKeyUp(e);
  });

  document.addEventListener('paste', async (e) => {
    if (!drawingActive() || isEditableTarget(e.target)) return;
    const item = [...e.clipboardData.items].find((i) => i.kind === 'file' && i.type.startsWith('image/'));
    if (!item) return;
    e.preventDefault();
    const { src, width, height } = await imageFileToDataUrl(item.getAsFile());
    ink.addImage(src, width, height);
  });

  // ---------- menus ----------

  async function exportCurrent() {
    await saveNow();
    const note = currentNote();
    if (!note) return;
    const name = slugify(note.title);
    if (note.type === 'calc') {
      download(`${name}.png`, dataUrlToBlob(calc.graph.canvas.toDataURL('image/png')));
    } else if (note.type === 'drawing') {
      const url = await ink.toImage({ type: 'image/png', scale: 2 });
      if (!url) return toast('Nothing to export yet');
      download(`${name}.png`, dataUrlToBlob(url));
    } else {
      const md = (note.title ? `# ${note.title}\n\n` : '') + toMarkdown(note.html);
      download(`${name}.md`, md, 'text/markdown');
    }
  }

  async function copyCurrent() {
    await saveNow();
    const note = currentNote();
    if (!note) return;
    try {
      if (note.type === 'calc') {
        await navigator.clipboard.writeText(calc.rows.map((r) => r.text).filter((t) => t.trim()).join('\n'));
        toast('Expressions copied');
      } else if (note.type === 'drawing') {
        const url = await ink.toImage({ type: 'image/png', scale: 2 });
        if (!url) return toast('Nothing to copy yet');
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': dataUrlToBlob(url) })]);
        toast('Drawing copied as image');
      } else {
        await navigator.clipboard.writeText(toMarkdown(note.html));
        toast('Copied as Markdown');
      }
    } catch (err) {
      toast(`Couldn’t copy: ${err.message}`);
    }
  }

  $('#noteMenuBtn').addEventListener('click', (e) => {
    const note = currentNote();
    if (!note) return;
    const labels = {
      text: ['Download as Markdown', 'Copy as Markdown'],
      drawing: ['Download as PNG', 'Copy as image'],
      calc: ['Download graph as PNG', 'Copy expressions'],
    }[note.type] || ['Download', 'Copy'];
    openMenu(e.currentTarget, [
      { icon: 'download', label: labels[0], run: exportCurrent },
      { icon: 'copy', label: labels[1], run: copyCurrent },
      note.type === 'calc' && { icon: 'clear-canvas', label: 'Clear all expressions', run: () => calc.clear() },
      { icon: 'plus', label: 'Duplicate', run: duplicateCurrent },
      note.sourceUrl && { icon: 'external', label: 'Open source page', run: () => window.open(note.sourceUrl, '_blank', 'noopener') },
      page.url && pageKey(page.url) !== pageKey(note.sourceUrl) && { icon: 'link', label: 'Link to current page', run: linkCurrentToPage },
      '-',
      { icon: 'trash', label: 'Delete note', danger: true, run: deleteCurrent },
    ]);
  });

  async function annotatePage() {
    const res = await chrome.runtime.sendMessage({ type: 'inkwell:annotate' });
    if (res && res.ok) {
      toast('Drawing mode is on in your tab · press Esc there to exit');
      return;
    }
    if (res && res.canRequestAccess) {
      toast('Inkwell needs permission to draw on this page.', {
        action: 'Allow',
        onAction: async () => {
          const granted = await chrome.permissions.request({ origins: ['<all_urls>'] });
          if (granted) annotatePage();
        },
        timeout: 8000,
      });
    } else {
      toast('This page can’t be drawn on (browser pages and the Web Store are protected).');
    }
  }

  async function exportAll() {
    await saveNow();
    const notes = await Store.all();
    const payload = { app: 'inkwell', version: 1, exported: new Date().toISOString(), notes };
    download(`inkwell-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload), 'application/json');
  }

  $('#importInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const incoming = Array.isArray(data) ? data : data.notes;
      if (!Array.isArray(incoming)) throw new Error('No notes found in file');
      let count = 0;
      for (const raw of incoming) {
        if (!raw || typeof raw.id !== 'string' || !['text', 'drawing', 'calc'].includes(raw.type)) continue;
        const existing = state.notes.get(raw.id);
        if (existing && existing.updated >= (raw.updated || 0)) continue;
        const note = Store.createNote({ ...raw, html: raw.type === 'text' ? sanitizeHtml(raw.html) : '', lastEditor: INSTANCE });
        note.id = raw.id;
        state.notes.set(note.id, note);
        await Store.put(note);
        count++;
      }
      renderList();
      toast(`Imported ${count} note${count === 1 ? '' : 's'}`);
    } catch (err) {
      toast(`Import failed: ${err.message}`);
    }
  });

  $('#appMenuBtn').addEventListener('click', (e) => {
    openMenu(e.currentTarget, [
      !IS_TAB && { icon: 'pen', label: 'Draw on current page', run: annotatePage },
      !IS_TAB && { icon: 'maximize', label: 'Open in a full tab', run: () => chrome.tabs.create({ url: chrome.runtime.getURL('app.html?tab=1') }) },
      !IS_TAB && '-',
      { icon: 'download', label: 'Back up all notes (.json)', run: exportAll },
      { icon: 'upload', label: 'Restore from backup…', run: () => $('#importInput').click() },
    ]);
  });

  $('#newTextBtn').addEventListener('click', () => createNote('text'));
  $('#newDrawBtn').addEventListener('click', () => createNote('drawing'));
  $('#newCalcBtn').addEventListener('click', () => createNote('calc'));
  for (const b of $$('[data-new]')) b.addEventListener('click', () => createNote(b.dataset.new));
  els.pinBtn.addEventListener('click', togglePin);
  $('#deleteNoteBtn').addEventListener('click', deleteCurrent);
  $('#backBtn').addEventListener('click', async () => {
    const id = state.currentId;
    await saveNow();
    await discardIfBlank(id);
    showEmpty();
  });

  // ---------- cross-view sync ----------

  async function handleOpenRequest(req) {
    if (!req || Date.now() - req.t > 15000) return;
    if (!state.notes.has(req.id)) {
      const note = await Store.get(req.id);
      if (!note) return;
      state.notes.set(note.id, note);
    }
    await openNote(req.id);
    chrome.storage.local.remove('openRequest');
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    let listChanged = false;
    for (const [key, { newValue }] of Object.entries(changes)) {
      if (key.startsWith(Store.PREFIX)) {
        const id = key.slice(Store.PREFIX.length);
        listChanged = true;
        if (newValue) {
          const fromElsewhere = newValue.lastEditor !== INSTANCE;
          state.notes.set(id, newValue);
          if (id === state.currentId && fromElsewhere && !state.dirty && !state.saving) loadEditor(newValue, { keepView: true });
        } else {
          state.notes.delete(id);
          if (id === state.currentId) showEmpty();
        }
      } else if (key.startsWith('annot:')) {
        refreshPageContext();
      } else if (key === 'openRequest' && newValue) {
        handleOpenRequest(newValue);
      } else if (key === 'settings' && newValue) {
        state.settings = newValue;
        applyTheme();
      }
    }
    if (listChanged) renderList();
  });

  // ---------- notes for the current page ----------

  const page = { tabId: null, url: null, title: '', drawings: 0, canRead: false };

  function pageKey(url) {
    try {
      const u = new URL(url);
      return u.origin + u.pathname.replace(/\/$/, '') + u.search;
    } catch (_) {
      return null;
    }
  }

  function hostOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch (_) {
      return null;
    }
  }

  let refreshSeq = 0;
  async function refreshPageContext() {
    if (IS_TAB) return;
    const seq = ++refreshSeq;
    let tab = null;
    try {
      [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    } catch (_) {
      /* no tabs access */
    }
    const canRead = await chrome.permissions.contains({ permissions: ['tabs'] });
    const url = tab && tab.url && /^https?:/i.test(tab.url) ? tab.url : null;
    let drawings = 0;
    if (url) {
      const key = 'annot:' + url.split('#')[0];
      const data = await chrome.storage.local.get(key);
      drawings = (data[key] && data[key].shapes && data[key].shapes.length) || 0;
    }
    if (seq !== refreshSeq) return; // a newer refresh won
    Object.assign(page, { tabId: tab ? tab.id : null, url, title: (tab && tab.title) || '', drawings, canRead });
    renderPageContext();
  }

  function pageMatches() {
    if (!page.url) return [];
    const key = pageKey(page.url);
    const host = hostOf(page.url);
    const out = [];
    for (const n of state.notes.values()) {
      if (!n.sourceUrl) continue;
      if (pageKey(n.sourceUrl) === key) out.push({ note: n, samePage: true });
      else if (hostOf(n.sourceUrl) === host) out.push({ note: n, samePage: false });
    }
    return out.sort((a, b) => b.samePage - a.samePage || b.note.updated - a.note.updated);
  }

  function renderPageContext() {
    const box = $('#pageCtx');
    if (IS_TAB || state.query.trim()) {
      box.hidden = true;
      return;
    }
    box.textContent = '';

    if (!page.url) {
      // No URL: either a browser page, or we lack permission to read it.
      if (page.canRead || state.settings.pageCtxDismissed) {
        box.hidden = true;
        return;
      }
      box.hidden = false;
      const intro = document.createElement('div');
      intro.className = 'ctx-intro';
      intro.innerHTML = InkIcons.svg('globe', 18);
      const text = document.createElement('div');
      text.innerHTML = '<b>Notes for the site you’re on</b>See clips and drawings from the current page right here.';
      intro.appendChild(text);
      const close = document.createElement('button');
      close.className = 'icon-btn ctx-close';
      close.title = 'Dismiss';
      close.innerHTML = InkIcons.svg('x', 14);
      close.addEventListener('click', async () => {
        state.settings = await Store.setSettings({ pageCtxDismissed: true });
        renderPageContext();
      });
      intro.appendChild(close);
      const actions = document.createElement('div');
      actions.className = 'ctx-actions';
      const enable = document.createElement('button');
      enable.className = 'btn primary';
      enable.textContent = 'Turn on';
      enable.addEventListener('click', async () => {
        if (await chrome.permissions.request({ permissions: ['tabs'] })) refreshPageContext();
      });
      actions.appendChild(enable);
      box.append(intro, actions);
      return;
    }

    box.hidden = false;
    const matches = pageMatches();
    const head = document.createElement('div');
    head.className = 'ctx-head';
    head.innerHTML = InkIcons.svg('globe', 15);
    const host = document.createElement('span');
    host.className = 'ctx-host';
    host.textContent = hostOf(page.url);
    host.title = page.url;
    const count = document.createElement('span');
    count.className = 'ctx-count';
    const total = matches.length + (page.drawings ? 1 : 0);
    count.textContent = total ? `${total} saved` : '';
    head.append(host, count);
    box.appendChild(head);

    if (matches.length) {
      const ul = document.createElement('ul');
      ul.className = 'ctx-list';
      for (const { note, samePage } of matches.slice(0, 5)) {
        const li = document.createElement('li');
        li.className = 'ctx-item' + (note.id === state.currentId ? ' active' : '');
        li.tabIndex = 0;
        li.innerHTML = InkIcons.svg(TYPE_ICONS[note.type] || 'note', 14);
        const label = document.createElement('span');
        label.textContent = note.title || (note.text || 'Untitled').slice(0, 60);
        li.appendChild(label);
        if (samePage) {
          const tag = document.createElement('span');
          tag.className = 'ctx-tag';
          tag.textContent = 'This page';
          li.appendChild(tag);
        }
        li.addEventListener('click', () => openNote(note.id));
        li.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') openNote(note.id);
        });
        ul.appendChild(li);
      }
      if (matches.length > 5) {
        const more = document.createElement('li');
        more.className = 'ctx-empty';
        more.textContent = `+${matches.length - 5} more · search “${hostOf(page.url)}”`;
        ul.appendChild(more);
      }
      box.appendChild(ul);
    } else {
      const empty = document.createElement('p');
      empty.className = 'ctx-empty';
      empty.textContent = 'Nothing saved from this site yet.';
      box.appendChild(empty);
    }

    const actions = document.createElement('div');
    actions.className = 'ctx-actions';
    const add = document.createElement('button');
    add.className = 'btn';
    add.innerHTML = InkIcons.svg('note-plus', 14);
    add.append('Note for page');
    add.addEventListener('click', () =>
      createNote('text', { title: (page.title || hostOf(page.url)).slice(0, 200), sourceUrl: page.url })
    );
    const draw = document.createElement('button');
    draw.className = 'btn';
    draw.innerHTML = InkIcons.svg('pen', 14);
    draw.append(page.drawings ? `Show drawings (${page.drawings})` : 'Draw on page');
    draw.addEventListener('click', annotatePage);
    actions.append(add, draw);
    box.appendChild(actions);
  }

  async function linkCurrentToPage() {
    const note = currentNote();
    if (!note || !page.url) return;
    await saveNow();
    note.sourceUrl = page.url;
    note.lastEditor = INSTANCE;
    await Store.put(note);
    loadEditor(note, { keepView: true });
    renderList();
    toast(`Linked to ${hostOf(page.url)}`);
  }

  if (!IS_TAB) {
    chrome.tabs.onActivated.addListener(refreshPageContext);
    chrome.tabs.onUpdated.addListener((tabId, info) => {
      if (tabId === page.tabId || info.status === 'complete') refreshPageContext();
    });
    chrome.windows.onFocusChanged.addListener(refreshPageContext);
    chrome.permissions.onAdded.addListener(refreshPageContext);
    chrome.permissions.onRemoved.addListener(refreshPageContext);
  }

  // ---------- boot ----------

  async function init() {
    hydrateIcons();
    document.documentElement.classList.toggle('is-tab', IS_TAB);
    state.settings = await Store.getSettings();
    applyTheme();
    refreshPageContext();
    const notes = await Store.all();
    for (const n of notes) state.notes.set(n.id, n);
    renderList();
    const { openRequest } = await chrome.storage.local.get('openRequest');
    if (openRequest) await handleOpenRequest(openRequest);
    else if (IS_TAB || window.innerWidth > 720) {
      const first = sortedNotes()[0];
      if (first) openNote(first.id);
    }
  }

  init();
})();
