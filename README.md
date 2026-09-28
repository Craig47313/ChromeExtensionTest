# Inkwell: notes and drawing for Chrome

Inkwell is a Manifest V3 Chrome extension for writing notes and sketching. It runs in Chrome's side panel, next to the page you're reading, and it can also open in a full tab. You can clip text from websites and draw directly on top of any page.

## Features

**Rich-text notes**
- Bold, italic, underline, strikethrough, headings, bulleted/numbered lists, **checklists**, quotes, code blocks, links and dividers
- Markdown-style shortcuts: at the start of a line type `#`, `##`, `-`, `1.`, `[]`, `>` or ```` ``` ```` and then a space
- Paste or drop images. Pasted web content is cleaned of scripts and styles.
- Export a note to Markdown, or copy it as Markdown

**Drawing notes**
- Pen, highlighter, eraser, line, arrow, rectangle, ellipse, text and pan tools
- Smooth strokes. The eraser end of a stylus works as an eraser.
- Color palette and custom colors, adjustable brush sizes (each tool remembers its own)
- Infinite canvas with pan (scroll, Space+drag or the hand tool) and zoom (Ctrl+scroll)
- Plain, dotted, grid or lined paper
- Paste, drop or insert images to sketch over
- Undo/redo, export to PNG, copy as an image
- Drawings are stored as vectors, so they stay sharp at any zoom level

**Draw on any web page**
- Press **Alt+Shift+D**, right-click and choose **Draw on this page**, or use **⋯ → Draw on current page** in the panel
- Annotations stay attached to the page as you scroll, and they're saved for that URL
- Click-through mode lets you use the page without closing your drawings
- The 📷 button saves a screenshot of the page and your annotations as a new drawing note

**Clipping**
- Right-click selected text and choose **Save selection to Inkwell** to save it as a quote with a link to the source page
- **Save link to Inkwell** and **Save this page to Inkwell** save links

**Organizing**
- Instant search, pinned notes, duplicate, delete with undo
- Light, dark and system themes
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
| App | Ctrl+Alt+N / Ctrl+Alt+D | New note / new drawing |
| App | / | Search |
| Notes | Ctrl+B / I / U, Ctrl+K | Bold / italic / underline, insert link |
| Notes | Tab / Shift+Tab | Indent / outdent list items |
| Notes | Ctrl+click | Open a link |
| Drawing | P H E L A R O T M | Pen, highlighter, eraser, line, arrow, rect, ellipse, text, pan |
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
| `<all_urls>` (optional) | Requested only if you start page drawing from the panel on a tab Inkwell hasn't been invoked on |

Nothing is sent over the network. All data stays in your browser profile.

## Project layout

```
manifest.json         MV3 manifest
background.js         service worker: side panel, context menus, commands, screenshots
app.html/.css/.js     the notes app (side panel and full tab)
lib/ink-canvas.js     vector drawing engine shared by drawing notes and the page overlay
lib/store.js          chrome.storage wrapper
lib/icons.js          inline SVG icon set
content/annotate.js   on-page drawing overlay (injected on demand, isolated in a closed shadow root)
icons/                extension icons (icon.svg is the source)
```
