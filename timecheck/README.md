# Timecheck

A Chrome extension for school days. It's a planner that pushes back: quick add, focus blocks, a distraction gate, nudges, an end-of-day check-in, A/B/C/D block days, and a weekly review. It also works with **Onitry**, the desktop app that watches your screen to see whether you're on task.

**The full guide is built in:** press **?** in the planner's header (it also opens on first install). It has a self-checking tutorial, a feature overview, a deep dive into how everything works, and reference tables. The source is `docs.html`.

It's a separate extension from Inkwell (the notes app in the parent folder). They don't share anything, so you can install either or both.

## What it does

**Plan**
- **Quick add** goes straight onto the schedule and understands plain language: `econ practice 30m`, `break 10m`, `mun call at 4pm`, `calc hw due tmrw 40m`, `econ test fri`, `~ cad the claw` (the `~` sends it to the free-time list). The preview shows where it will land before you press Enter. Paste several lines to add several blocks.
- **Block days:**
  - Your A/B/C/D rotation shows next to the date and on the week view.
  - A **class blocks menu** (⚙ → Block days → Edit class blocks, or click the letter): one tab per day type, start/end/class rows that fill in their own times, copy one day to another, and breaks as date ranges.
  - Today's classes show in their own rail on the schedule.
  - Quick add understands `due next B`, `physics test D day` and `next a day`.
  - Holidays pause the rotation.
- **Schedule:** today as a calendar day view, like Google Calendar.
  - It holds what's due, what's overdue, and what you planned, with test reminders two days out.
  - Blocks run back to back from now, in order, flowing around classes (free blocks count as usable time) and anything you pinned.
  - Drag a block to pin it at a time, drag its bottom edge to resize it, click an empty spot to add something there.
  - Today's finished blocks stay on it, faded, and a red line marks now.
  - It warns you when the plan runs past your cutoff.
- **Free time list:** projects to pick from when there's "nothing" to do.

**Focus**
- **Focus blocks in succession:** press Start and the schedule runs itself; when a block ends, the next one starts (and you're asked if you finished). The bar above the schedule has **Pause / Resume**, Done, +10, Skip and Stop. Pausing also pauses Onitry and slides the rest of the day later.
- **Break blocks** (`break`, `snack`, `dinner`, `walk`…) loosen the gate, pause Onitry and tick themselves off.
- **An alarm rings when a block ends.** With nothing next, the bar turns red with **⏰ Time's up** (Done / +5 / +10 / Stop) instead of counting up; it rings again after 2 minutes and ends the block itself after 10.
- The toolbar badge counts down accurately (minutes rounded up, seconds in the last minute while the planner is open, `❚❚` paused, `END` time's up) and clears the moment nothing's running.
- **Distraction gate:** YouTube, Reddit and other sites redirect to a page that shows what's due. To get through, you write a reason (it's logged to your journal) and wait. The wait grows each time you come back. During a focus block you also have to type out a sentence, and passes are capped at 5 minutes.
- **When the gate is up:**

  | Mode | Gate is up |
  | --- | --- |
  | **Smart** (default) | During focus blocks, and in work hours or school free blocks when something is due by tomorrow |
  | **Focus** | Only during focus blocks |
  | **Always** | All the time |
  | **Off** | Never |

**Nudges**
- An idle check-in when no focus block is running.
- A "plan your afternoon" reminder.
- A **free-block** nudge with a task to start.
- A test-tomorrow reminder.
- The end-of-day check-in.
- The weekly review.

**Look back**
- **Journal:** timestamped log, daily stats, check-in streak and the last 7 days.
- **Weekly review:**
  - Shows the week in numbers: tasks done and missed per subject, focus time, Onitry's on-task %, gate passes and why, and your moods.
  - Onitry can write a short review of it. That call runs in the Onitry app on your own API key, so this extension never holds a key.

**Where it lives** (⚙ → Where it lives)
- **Side panel** (default): click the toolbar button or press Alt+Shift+P.
- **Its own pinned tab:** the toolbar button jumps to it.
- **Every new tab:** opens the planner. This asks for the optional `tabs` permission.

## Onitry integration

Onitry (repo `monitry/Monitry`) runs a small server on `127.0.0.1:47323`. The extension talks to it with a pairing code. See `BRIDGE.md` in that repo.

1. In Onitry, open ⚙ Configure, then copy the **browser planner pairing code**.
2. Here, open ⚙, then go to Onitry: tick **Connect**, paste the code and press **Test connection**.

What you get:
- **Starting a focus block starts Onitry** on that task. Onitry also gets context: the subject, when it's due, and what else is on today's list.
- **Live status** shows in the planner (on task / off task, plus what Onitry thinks you're doing).
- **Off-task escalation:** if Onitry sees you drift during a focus block, the extension:
  - revokes your passes,
  - sends open distracting tabs to the gate,
  - locks the gate for 10 minutes with no passes, even if the gate is set to Off.
- **Session stats:** each focus block records Onitry's on-task %.
- **Launch Onitry:** if Onitry isn't running when a block starts, the extension can start it. Run this once in the Monitry repo:

  ```bash
  python native_host/install.py
  ```

  Run it with the Python you use for Onitry, then restart Chrome. The extension's ID is fixed by the `key` in `manifest.json` (`dadagbofodnllhcohbhmjkdolklihcgn`), so the installer already knows it.
- **Weekly review:** Onitry writes it with Claude, using Onitry's own API key. This works in the dev and BYOK editions.


## Install (developer mode)

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick this `timecheck/` folder.
3. Pin **Timecheck**, then click it.
4. The guide opens with a tutorial. Start with **Edit class blocks**: pick a day, press **Add block** for each class, and add any breaks. You can also paste a schedule as text in the same menu:

   ```
   A
   08:00-09:20 Calc
   09:30-10:50 Free
   B
   08:00-09:20 Physics
   Other
   08:00-08:45 Calc
   ```

   `Other` is for school days without a letter (Mondays).

Requires Chrome 116 or later.

## Permissions

| Permission | Why |
| --- | --- |
| `storage`, `unlimitedStorage` | Everything is stored locally |
| `sidePanel` | The planner can live in the side panel |
| `alarms`, `notifications`, `idle` | Nudges, focus timers, checking you're at the computer |
| `offscreen` | Playing the end-of-block alarm (service workers can't play audio) |
| `declarativeNetRequest` + the gated sites | Redirect distracting sites to the gate |
| `http://127.0.0.1/*` | Talk to the Onitry app on your machine |
| `nativeMessaging` | Launch Onitry (only if you install its launcher) |
| `tabs` (optional) | Only for "every new tab", to see that a tab is a new tab |
| any site (optional) | Asked for when you add your own sites to the gate |

Nothing leaves your computer except the weekly review, which Onitry sends to Claude when you ask for it.

## Layout

```
manifest.json      MV3 manifest (the "key" pins the extension ID)
background.js      service worker entry
planner-bg.js      focus blocks, gate rules, nudges, Onitry sync/escalation/launch, weekly review
today.html/.css/.js the planner (side panel, tab or new tab) + class blocks menu
docs.html/.css/.js the built-in guide (tutorial, overview, how it works, reference)
guard.html/.css/.js the distraction gate
base.css           theme tokens, buttons, dialogs
lib/planner.js     data model, quick-add parser, block days, weekly stats (also runs in Node)
lib/onitry.js      client for Onitry's local bridge + native launcher
lib/palettes.js, lib/icons.js
tests/             node --test tests/planner.test.js
```
