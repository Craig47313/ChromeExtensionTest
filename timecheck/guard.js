// The distraction gate. Gated sites are redirected here (see planner-bg.js);
// the original URL is in location.hash. Getting through takes a written reason
// (logged to the journal), a wait, and during focus blocks a typed sentence.
(async () => {
  'use strict';

  const P = InkPlan;
  const K = P.K;
  const $ = (s) => document.querySelector(s);
  const target = location.hash.slice(1); // original URL, appended by the redirect rule
  const settings = await P.getSettings();
  const site = P.matchSite(P.domainOf(target), settings.sites) || P.domainOf(target) || 'this site';

  const dark = settings.theme === 'dark' || (settings.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  InkPalettes.apply(document.documentElement, settings.palette || InkPalettes.DEFAULT, dark);

  const [focus, tasks, journal, meta] = await Promise.all([P.store.get(K.focus, null), P.store.get(K.tasks, []), P.store.get(K.journal, {}), P.store.get(K.meta, {})]);
  const focusing = P.isFocusing(focus);
  const escalated = focusing && (meta.escalatedUntil || 0) > Date.now();
  const today = P.dateKey();
  const passesToday = (journal[today] || []).filter((e) => e.kind === 'pass');
  const siteVisits = passesToday.filter((e) => e.text.startsWith(site)).length;

  $('#site').textContent = site;
  document.title = `Hold up · ${site}`;

  if (focusing) {
    $('#headline').textContent = escalated ? 'Onitry saw that.' : 'Not now.';
    $('#why').textContent = escalated
      ? `You drifted off task during your focus block, so ${site} is locked for ${Math.ceil((meta.escalatedUntil - Date.now()) / 60000)} more minutes. No passes.`
      : `${site} is blocked while you focus.`;
    $('#focusBox').hidden = false;
    $('#focusTitle').textContent = focus.title;
    const tick = () => {
      const left = Math.ceil((focus.endsAt - Date.now()) / 60000);
      $('#focusLeft').textContent = focus.timeUpAt || left < 0 ? 'Time’s up. Mark it done or add a few minutes in the planner.' : `${Math.max(1, left)} min left — you can do this.`;
    };
    tick();
    setInterval(tick, 15000);
  } else {
    const urgent = P.urgentTasks(tasks, today);
    const free = P.inFreeBlock(settings);
    $('#why').textContent = urgent.length
      ? `You have ${urgent.length} thing${urgent.length === 1 ? '' : 's'} due by tomorrow${free ? `, and this is your ${free.label.toLowerCase()} block` : ''}.`
      : `${site} is on your gated list.`;
    $('#focusBtn').hidden = false;
  }

  const open = P.todayTasks(tasks, today).filter((t) => !t.done);
  if (open.length) {
    $('#dueBox').hidden = false;
    for (const t of open.slice(0, 5)) {
      const li = document.createElement('li');
      li.textContent = t.title;
      if (t.due) {
        const d = document.createElement('span');
        d.className = t.kind === 'test' ? 'g-due test' : 'g-due';
        d.textContent = t.kind === 'test' ? ` · ${P.relDay(t.due)} test` : ` · due ${P.relDay(t.due).toLowerCase()}`;
        li.appendChild(d);
      }
      $('#dueList').appendChild(li);
    }
  } else {
    const ideas = tasks.filter((t) => t.someday && !t.done);
    if (ideas.length) {
      const idea = ideas[Math.floor(Math.random() * ideas.length)];
      $('#ideaBox').hidden = false;
      $('#idea').textContent = `${idea.title}${idea.estimate ? ` (${P.fmtMinutes(idea.estimate)})` : ''}`;
    }
  }

  $('#backBtn').addEventListener('click', () => {
    location.href = 'today.html';
  });
  $('#focusBtn').addEventListener('click', async () => {
    const next = open[0];
    await chrome.runtime.sendMessage({
      type: 'plan:focus',
      action: 'start',
      taskId: next ? next.id : null,
      title: next ? next.title : 'Focus',
      course: next ? next.course : null,
      minutes: (next && next.estimate) || settings.focusMinutes,
    });
    location.href = 'today.html';
  });

  // ---------- the pass ----------

  const strict = focusing;
  const maxMinutes = strict ? 5 : 60;
  const options = strict ? [2, 5] : [5, 10, 20];
  let minutes = strict ? 5 : Math.min(settings.passMinutes, maxMinutes);
  if (!options.includes(minutes)) options.push(minutes);
  options.sort((a, b) => a - b);
  const sentence = P.STRICT_SENTENCES[Math.floor(Math.random() * P.STRICT_SENTENCES.length)];
  // The wait grows with each visit today: 10s, 20s, 30s… (max 60s).
  const waitSeconds = Math.min(60, 10 * (siteVisits + 1));

  $('#passSummary').textContent = strict ? 'Break my focus block anyway' : 'I really need this site';
  $('#passBox').hidden = escalated;
  $('#count').textContent = siteVisits ? `You’ve already let yourself into ${site} ${siteVisits} time${siteVisits === 1 ? '' : 's'} today.` : '';
  if (strict) {
    $('#sentenceWrap').hidden = false;
    $('#sentenceText').textContent = sentence;
    $('#sentence').addEventListener('paste', (e) => e.preventDefault());
  }
  for (const m of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `chip${m === minutes ? ' primary' : ''}`;
    b.textContent = `${m} min`;
    b.addEventListener('click', () => {
      minutes = m;
      for (const x of document.querySelectorAll('#mins .chip')) x.classList.toggle('primary', x === b);
    });
    $('#mins').appendChild(b);
  }

  let waitLeft = waitSeconds;
  let timer = 0;
  const btn = $('#passBtn');
  function valid() {
    const reasonOk = $('#reason').value.trim().length >= 12;
    const sentenceOk = !strict || $('#sentence').value.trim().replace(/\s+/g, ' ') === sentence;
    return reasonOk && sentenceOk;
  }
  function update() {
    btn.disabled = !(valid() && waitLeft <= 0);
    btn.textContent = waitLeft > 0 ? `Let me in (${waitLeft}s)` : `Let me in for ${minutes} min`;
  }
  $('#passBox').addEventListener('toggle', () => {
    if (!$('#passBox').open || timer) return;
    timer = setInterval(() => {
      waitLeft--;
      update();
      if (waitLeft <= 0) clearInterval(timer);
    }, 1000);
    $('#reason').focus();
  });
  $('#reason').addEventListener('input', update);
  $('#sentence').addEventListener('input', update);
  $('#mins').addEventListener('click', update);
  update();

  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    const res = await chrome.runtime.sendMessage({ type: 'plan:pass', site, minutes, reason: $('#reason').value.trim(), url: target });
    if (res && res.ok) location.replace(target || `https://${site}`);
    else $('#count').textContent = `Couldn’t open: ${(res && res.error) || 'unknown error'}`;
  });

  // ---------- today's stats ----------

  const mins = passesToday.reduce((sum, e) => sum + (parseInt((/for (\d+)m/.exec(e.text) || [])[1], 10) || 0), 0);
  $('#todayStats').textContent = passesToday.length ? `Today: ${passesToday.length} pass${passesToday.length === 1 ? '' : 'es'}, ${mins} min on gated sites.` : 'No gated-site time today. Keep it that way.';
})();
