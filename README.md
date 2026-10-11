# Inkwell: plan, focus, notes and drawing for Chrome

Inkwell is a Manifest V3 Chrome extension. It has two halves:

- **Today**: a deliberately pushy planner. It opens on every new tab, runs focus blocks, gates distracting sites, nudges you when nothing is running, and keeps a journal. It connects to the **Onitry** desktop app, so a focus block started in the browser starts Onitry's screen monitoring on that task.
- **Notes**: rich notes, drawings, stickies and a Desmos-style graphing calculator, in the side panel or a full tab.

## Today (planner)

Open a new tab, or the side panel, which remembers whether you last used Today or Notes.

**Plan**
- **Quick add** understands how you write: `calc hw due thu 40m`, `econ test fri`, `chem summative 10/16`, `email mrs neri`, `~ cad the claw` (the `~` sends it to the "nothing to do" list). Subjects are detected from names and aliases (`bc` → Calc, `ils` → Spanish, `#mate` → MATE).
- **Paste a brain dump**: every line becomes its own task.
- **Today list**: things planned for today, due today or tomorrow, overdue, and tests coming up in the next 2 days. Drag to reorder. Each task shows a time slot ("2:30–3:30 PM") laid out end to end from now, and the list warns when the plan runs past your cutoff.
- **Next 7 days**: a rolling week board with deadlines and tests (tests in red), plus a "Coming up" list. Click a day to add something due that day.
- **When there's "nothing" to do**: a standing list of projects (CV2, Onitry, CAD, internship emails…) so a free block has a default that isn't YouTube.

**Focus**
- **"What are you doing right now?"**: start a 15–90 minute focus block on any task, or on something you just type.
- **While a block runs**: a big timer, the toolbar badge counts down, and "Time's up" asks Done / +10 min.
- **With Onitry connected**, the block starts Onitry monitoring on that exact task, with context such as what's due and what else is on today's list. Onitry's on/off-task verdict shows in the header and the timer card, and each session records Onitry's on-task percentage.

**Distraction gate (the invasive part)**
- Gated sites (YouTube, Reddit, Instagram, TikTok, X, Netflix, Twitch, Facebook by default) are redirected to a "Hold up" page that shows what you should be doing.
- **When it's up (Smart mode, the default)**: during focus blocks, and during work hours whenever something is due by tomorrow. Other modes: focus blocks only, always, or off.
- **Getting through takes friction**:
  - A written reason, which is logged to your journal.
  - A wait that grows with each visit that day (10 s, 20 s, 30 s…).
  - During a focus block, also typing a sentence word for word (pasting is blocked). Passes are capped at 5 minutes.
- **When a pass expires**, open tabs on that site are sent back to the gate. Turning the gate on does the same to tabs already open.

**Nudges**
- **Check-in**: during work hours, if no focus block or Onitry session runs for 30 minutes and you're at the computer, you get "What are you doing right now?" with a button to start your next task.
- **Plan reminder**: "Plan your afternoon" at 3:30 PM if today's list is empty.
- **Test reminders**: the evening before a test, with a 25-minute study block button.
- **End-of-day check-in**: at 10 PM.
- All times are in ⚙ settings.

**Journal**
- Timestamped log entries (Enter to log), like your daily notes.
- Focus sessions, completed tasks and gate passes are logged automatically.
- **End-of-day check-in**: a mood rating, what got in the way (YouTube, phone, tired…), and tomorrow's first task, which becomes a real task. There's also a check-in streak.
- **Daily stats**: minutes focused, tasks done, Onitry on-task %, and gate passes. History covers the last 7 days.

### Connecting Onitry

1. Run Onitry (`python gui.py`, or the menu bar app). Onitry now runs a small local bridge on `127.0.0.1:47323`.
2. In Onitry, open **⚙ Configure** and copy the **browser planner pairing code**.
3. In Today, open ⚙ → **Onitry**: check *Connect to Onitry*, paste the code, then click **Test connection**.

The bridge only listens on 127.0.0.1. It needs the pairing code and refuses requests from regular web pages, so only the extension can drive it. Details are in `core/bridge.py` in the Monitry repo.

## Notes features

**Rich-text notes**
- Bold, italic, underline, strikethrough, headings, bulleted/numbered lists, **checklists**, quotes, code blocks, links and dividers
- Markdown-style shortcuts: at the start of a line type `#`, `##`, `-`, `1.`, `[]`, `>` or ```` ``` ```` and then a space
- Images, whether pasted, dropped or inserted, always sit on their own line, with the text continuing below
- **Inline sketches:** insert a fixed-size sketch (or a copy of one of your stickies) into a note. Double-click it to edit.
- Paste rich content: pasted web content is cleaned of scripts and styles
- Export a note to Markdown, or copy it as Markdown

**New ▾ menu:** create a Note, Drawing, Sticky or Calculator, or open Quick calc

**Stickies**
- Fixed-size drawings (wide, square, tall or banner) on colored paper, made for quick sketches
- You can insert them into any note as inline sketches

**Drawing notes**
- Pen, highlighter, eraser, line, arrow, rectangle, ellipse, text and pan tools
- Select tool: click or drag a box to select shapes, then move them, resize them from the corner handle, recolor them, duplicate them, bring them to the front or send them to the back, or delete them. Double-click text to edit it.
- Smooth strokes. The eraser end of a stylus works as an eraser.
- Color palette and custom colors, adjustable brush sizes (each tool remembers its own)
- Infinite canvas with pan (scroll, Space+drag or the hand tool) and zoom (Ctrl+scroll)
- Plain, dotted, grid or lined paper
- Paste, drop or insert images to sketch over
- Undo/redo, export to PNG, copy as an image
- Drawings are stored as vectors, so they stay sharp at any zoom level

**Calculator and graphing (Desmos-style)**
- A **Calculator** note type: a numbered list of expressions next to a live graph. Each row has an ✕ to delete it, and like Desmos there's always an empty row at the bottom for the next expression.
- **Points of interest:** gray dots mark zeros, intersections between curves, maxima/minima and y-intercepts. Hover over a dot to see its coordinates, or click it to pin them.
- **Graph settings (wrench icon):** switch radians/degrees, toggle the grid, minor gridlines, axis numbers and axes, set the exact x/y view range, add axis labels, use a square grid, and choose which points of interest to show
- **Quick calc** (the calculator icon in the header, or Ctrl+Alt+C) is a scratch calculator that isn't saved to your notes. Press **✓ Save** to keep it.
- Plain math shows its answer (`1348 - 4` = 1344). Click the answer to copy it.
- Anything with `x` is graphed: `x^2 - 3`, `y = sin(x)`, `f(x) = x^2/4`. `x = 2` draws a vertical line and `(1, 2)` plots a point.
- Variables and sliders: `a = 3` gets a slider. If you use an undefined letter, an **add slider** button appears for it.
- Define your own functions and reuse them: `g(t) = 2t` then `g(4)`
- Implicit multiplication (`2x`, `3(x+1)`, `2pi`), `|x|`, `5!`, `%`, and functions such as `sin cos tan asin acos atan sqrt cbrt ln log exp abs floor ceil round min max mod gcd lcm nCr nPr`.
- Drag to pan and scroll to zoom. Hover over a curve to see coordinates. Click a row's color dot to hide that curve, or right-click it to change the color.
- Download the graph as a PNG, or copy the expressions
- Quick math anywhere: type something like `12*4+sqrt(9)` in the search box to see the answer. Press Enter to copy it, or Ctrl+Enter to open it in Quick calc.

**Draw on any web page**
- Press **Alt+Shift+D**, right-click and choose **Draw on this page**, or use **⋯ → Draw on current page** in the panel
- Annotations stay attached to the page as you scroll, and they're saved for that URL
- Click-through mode lets you use the page without closing your drawings
- The 📷 button saves a screenshot of the page and your annotations as a new drawing note

**Notes for the page you're on**
- The side panel shows the notes and drawings you've saved from the current site, with the ones from this exact page marked
- One click creates a note linked to the current page, or shows your saved drawings on it
- The toolbar icon shows a badge with how many notes you have for the current site
- Link any existing note to the current page from the note's ⋯ menu
- Turned on with one click; it uses Chrome's optional "tabs" permission to see which page you're on

**Clipping**
- Right-click selected text and choose **Save selection to Inkwell** to save it as a quote with a link to the source page
- **Save link to Inkwell** and **Save this page to Inkwell** save links

**Organizing**
- The notes list opens and closes with a toggle button (or Ctrl+\\), and remembers your choice. In a narrow side panel it slides over the editor.
- Instant search, pinned notes, duplicate, and a delete button on every note (with undo)
- Light, dark and system themes, plus color palettes (⋯ → Appearance). The default palette, **Onitry**, matches the Onitry product suite; Indigo, Ocean, Rose, Amber and Graphite are also available.
- Full backup and restore as JSON
- The side panel and any open Inkwell tabs stay in sync

## Install (developer mode)

1. Clone this repo.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the repo folder.
4. Pin Inkwell from the puzzle-piece menu, then click its icon (or press **Alt+Shift+N**) to open the side panel.

Requires Chrome 116 or later.

## Keyboard shortcuts

| Where | Keys | Action |
| --- | --- | --- |
| Chrome | Alt+Shift+N | Open Inkwell side panel |
| Chrome | Alt+Shift+D | Draw on the current page (press again or Esc to exit) |
| App | Ctrl+Alt+N / Ctrl+Alt+D / Ctrl+Alt+C | New note / new drawing / Quick calc |
| App | / | Search |
| Notes | Ctrl+B / I / U, Ctrl+K | Bold / italic / underline, insert link |
| Notes | Tab / Shift+Tab | Indent / outdent list items |
| Notes | Ctrl+click | Open a link |
| Drawing | V P H E L A R O T M | Select, pen, highlighter, eraser, line, arrow, rect, ellipse, text, pan |
| Drawing (selection) | Delete, Ctrl+D, Ctrl+A, arrow keys (Shift for 10px) | Delete, duplicate, select all, nudge |
| Drawing (selection) | Ctrl+] / Ctrl+[ | Bring to front / send to back |
| Drawing | [ and ] | Smaller / larger brush |
| Drawing | Shift while dragging | Snap lines to 45°, make perfect squares and circles |
| Drawing | Space + drag, Ctrl+scroll | Pan, zoom |
| Drawing | Ctrl+Z / Ctrl+Shift+Z | Undo / redo |

You can change the Chrome-level shortcuts at `chrome://extensions/shortcuts`.

## Permissions

| Permission | Why |
| --- | --- |
| `storage`, `unlimitedStorage` | Notes, drawings and screenshots are saved locally in `chrome.storage.local` |
| `sidePanel` | The main UI lives in the side panel |
| `contextMenus` | Right-click clipping and "Draw on this page" |
| `activeTab`, `scripting` | Inject the drawing overlay into the current tab, but only when you ask for it |
| `alarms`, `notifications`, `idle` | Focus-block timers, check-in nudges and reminders (no nudges when you're away from the computer) |
| `declarativeNetRequest` + gated-site host access | Redirect gated sites (YouTube etc.) to the "Hold up" page. Adding a site in settings asks for access to it. |
| `http://127.0.0.1/*` | Talk to the Onitry desktop app's local bridge |
| New tab override | Today opens on every new tab, on purpose |
| `tabs` (optional) | Requested only when you turn on "Notes for the site you're on", to read the current tab's address |
| `<all_urls>` (optional) | Requested only if you start page drawing from the panel on a tab Inkwell hasn't been invoked on |

Nothing is sent over the network. All data stays in your browser profile.

## Project layout

```
manifest.json         MV3 manifest
background.js         service worker: side panel, context menus, commands, screenshots
app.html/.css/.js     the notes app (side panel and full tab)
calc.js               calculator editor (expression rows, sliders, graph settings)
lib/ink-canvas.js     vector drawing engine (free canvas + fixed-size stickies/sketches)
lib/mathlib.js        safe math parser/evaluator (no eval)
lib/graph.js          graph renderer with points of interest
lib/palettes.js       color palettes (Onitry default)
today.html/.css/.js   Today planner (new tab page + side panel view)
guard.html/.css/.js   distraction gate page
planner-bg.js         service-worker side: focus blocks, gate rules, nudges, badge, Onitry sync
lib/planner.js        planner model, quick-add parser, dates, storage
lib/onitry.js         client for the Onitry desktop bridge
tests/planner.test.js unit tests (node --test tests/planner.test.js)
lib/store.js          chrome.storage wrapper
lib/icons.js          inline SVG icon set
content/annotate.js   on-page drawing overlay (injected on demand, isolated in a closed shadow root)
icons/                extension icons (icon.svg is the source)
```
