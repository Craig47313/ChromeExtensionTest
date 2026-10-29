// Timecheck's side of the link to Inkwell (the notes extension). Inkwell's extension ID isn't fixed,
// so Inkwell introduces itself and you approve it in ⚙; after that this talks only to that ID.
(function (g) {
  'use strict';
  if (g.InkwellLink) return;

  async function call(id, msg) {
    if (!id) return null;
    try {
      return await chrome.runtime.sendMessage(id, msg);
    } catch (_) {
      return null; // not installed, or not answering
    }
  }

  g.InkwellLink = {
    call,
    // Find or create the activity's note in Inkwell and open it.
    async open(id, activity) {
      const res = await call(id, { type: 'timecheck:page', activityId: activity.id, name: activity.name });
      if (!res || !res.ok) return res;
      await call(id, { type: 'timecheck:open', noteId: res.noteId });
      return res;
    },
    // Add a dated entry to the bottom of the activity's note.
    append(id, activity, { heading, text }) {
      return call(id, { type: 'timecheck:append', activityId: activity.id, name: activity.name, heading, text });
    },
  };
})(globalThis);
