# Inkwell: notes and drawing for Chrome

Inkwell is a Manifest V3 Chrome extension for writing notes and sketching. It runs in Chrome's side panel, next to the page you're reading, and it can also open in a full tab. You can clip text from websites and draw directly on top of any page.

## Features

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
- Instant search, pinned notes, duplicate, and a delete button on every note (with undo)
- Light, dark and system themes, plus color palettes (⋯ → Appearance). The default palette, **Monitry**, matches the Monitry product suite; Indigo, Ocean, Rose, Amber and Graphite are also available.
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
lib/palettes.js       color palettes (Monitry default)
lib/store.js          chrome.storage wrapper
lib/icons.js          inline SVG icon set
content/annotate.js   on-page drawing overlay (injected on demand, isolated in a closed shadow root)
icons/                extension icons (icon.svg is the source)
```
