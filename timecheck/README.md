# Timecheck

A Chrome extension for school days. It's a planner that pushes back: a queue of focus blocks, a distraction gate, nudges, an end-of-day check-in, A/B/C/D block days, and a weekly review. It also works with **Onitry**, the desktop app that watches your screen to see whether you're on task.

**The full guide is built in:** press **?** in the planner's header (it also opens on first install). It has a self-checking tutorial, a feature overview, a deep dive into how everything works, and reference tables. The source is `docs.html`.

It's a separate extension from Inkwell (the notes app in the parent folder). You can install either or both. They share code through the repository's `shared/` folder, and when both are installed they can talk to each other once you approve it.

## What it does

**Plan**
- **The queue:** one list on the main screen, with the block that's running at the top and an **add row** under the last block.
  - Each row is numbered and shows its start and end time, worked out from now in order. It holds what you added, what's due, what's overdue, with test reminders two days out.
  - Drag the handle to reorder. An inline stepper sets each block's length; the **⋮** menu (or right-click) has Edit, Start now, Move to top/bottom, Start at a set time…, Duplicate and Remove.
  - A thin grey row marks a class; the times skip past it (free blocks count as usable time). A 📌 row starts at a set time and the rest works around it.
  - The add row has a name, a length stepper, Focus/Break, a subject, and **More** (due date, start at a set time, or Free time). **Enter** adds, **Shift+Enter** adds as the next block, pasting several lines adds one block per line. Nothing you type is decoded: `40m` stays in the name.
  - It warns you when the plan runs past your cutoff. Clicking a day in Week opens the add row with that due date.
- **School schedule (block days):**
  - Your A/B/C/D rotation shows next to the date and on the week view.
  - A **class blocks menu** (⚙ → School schedule → Edit class blocks, the **School schedule ›** link under the queue, or the letter next to the date): one tab per day type, start/end/class rows that fill in their own times, copy one day to another, and breaks as date ranges.
  - Today's classes show as grey rows in the queue, and the add row's due dates include the next A/B/C/D day.
  - Holidays pause the rotation.
- **Free time list:** projects to pick from when there's "nothing" to do.

**Focus**
- **Focus blocks in succession:** press Start and the whole queue runs itself; when a block ends, the next one starts (and you're asked if you finished). The card at the top has **Pause / Resume**, Done, +5, Skip and Stop. Pausing also pauses Onitry and slides the rest of the day later.
- **Breaks:** press **Break** on the top card (with or without a block running) and pick 5 to 30 minutes, or add a Break block to the queue. Every gated site opens, Onitry pauses, and when it ends the alarm rings, the gate comes back and the next block starts if a run was going. A daily budget (45 min by default, "25 of 45 min used today") makes a break past it ask for your code.
- **Off-switch code:** set a 4 to 6 digit code in ⚙ → Breaks & off switch (stored as a salted hash). On the gate page or in ⚙, entering it turns the gate and Onitry off for 15 minutes, 1 hour or the rest of the day. Each use is logged.
- **An alarm rings when a block ends.** With nothing next, the bar turns red with **⏰ Time's up** (Done / +5 / +10 / Stop) instead of counting up; it rings again after 2 minutes and ends the block itself after 10.
- The toolbar badge counts down accurately (minutes rounded up, seconds in the last minute while the planner is open, `❚❚` paused, `END` time's up) and clears the moment nothing's running.
- **Distraction gate:** YouTube, Reddit and other sites redirect to a page that shows what's due. To get through, you write a reason (it's logged to your log) and wait. The wait grows each time you come back. During a focus block you also have to type out a sentence, and passes are capped at 5 minutes.
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
- **Log:** timestamped log, daily stats, check-in streak and the last 7 days. Notes have an **About** dropdown to tie them to an activity.
- **Activities:** Timecheck learns the things you keep doing. Typing in the add row suggests them with their usual length, when you last did them and total time; picking one fills in subject and length. Click an activity's name for its page (time this week and overall, recent sessions, your reflections).
- **Allowed pages:** during a block, allow one YouTube video or a site (Allow a page on the top card, a row's ⋮ menu, or the activity page) and it opens with no pass while everything else stays gated. Kept on the activity for next time.
- **Inkwell link:** if you also have Inkwell, Timecheck asks "Connect to Inkwell?" (top of the planner and ⚙). Then activity pages get Open in Inkwell, reflections land at the bottom of the activity's note, linked notes show a Timecheck strip with ▶ Start a block, and any note's ⋮ menu has Add to Timecheck queue.
- **Reflections:** when a focus block ends, one line asks how it went (after every block, only after Done, or never; skip any time). It's saved on the activity and in the Log.
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
lib/planner.js     data model, queue timing, activities, block days, weekly stats (also runs in Node)
lib/inkwell.js     the link to the Inkwell extension (messages, after you approve it in ⚙)
lib/dates.js, icons.js, palettes.js, stepper.js, menu.js, controls.css
                   copies of ../shared/ made by scripts/sync-shared.sh (edit shared/, not these)
lib/onitry.js      client for Onitry's local bridge + native launcher
lib/palettes.js, lib/icons.js
tests/             node --test tests/planner.test.js
```
