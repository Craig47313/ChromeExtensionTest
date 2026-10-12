// Onitry Plan service worker. The planner logic (focus blocks, distraction gate,
// nudges, Onitry sync) lives in planner-bg.js; this file wires the toolbar
// button to wherever you chose to keep the planner.
importScripts('lib/planner.js', 'lib/onitry.js', 'planner-bg.js');
