// Thin wrapper around chrome.storage.local. Each note is stored under its own
// key ("note:<id>") so saving one drawing never rewrites every other note.
// Loaded by the side panel/app page and (via importScripts) the service worker.
(function (g) {
  'use strict';
  if (g.Store) return;

  const PREFIX = 'note:';

  const Store = {
    PREFIX,

    newId() {
      return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    },

    createNote(partial = {}) {
      const now = Date.now();
      return {
        id: Store.newId(),
        type: 'text', // 'text' | 'drawing'
        title: '',
        html: '',
        text: '', // plain-text copy used for search and list snippets
        drawing: null, // { v, background, shapes }
        thumb: null, // small JPEG data URL for drawings
        pinned: false,
        sourceUrl: null,
        created: now,
        updated: now,
        ...partial,
      };
    },

    async all() {
      const data = await chrome.storage.local.get(null);
      return Object.keys(data)
        .filter((k) => k.startsWith(PREFIX))
        .map((k) => data[k]);
    },

    async get(id) {
      const key = PREFIX + id;
      const data = await chrome.storage.local.get(key);
      return data[key] || null;
    },

    async put(note) {
      await chrome.storage.local.set({ [PREFIX + note.id]: note });
      return note;
    },

    async remove(id) {
      await chrome.storage.local.remove(PREFIX + id);
    },

    async getSettings() {
      const { settings } = await chrome.storage.local.get('settings');
      return { theme: 'system', ...(settings || {}) };
    },

    async setSettings(patch) {
      const next = { ...(await Store.getSettings()), ...patch };
      await chrome.storage.local.set({ settings: next });
      return next;
    },

    // Ask any open Inkwell view (side panel or tab) to open a note.
    async requestOpen(id) {
      await chrome.storage.local.set({ openRequest: { id, t: Date.now() } });
    },
  };

  g.Store = Store;
})(globalThis);
