import { PROJECTS, FILTERS, COURSE, ARCADE, TOOLBOX, TOOL_USES, MILESTONES, PROFILE } from './data.js';
import { SHOTS } from './shots.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;
const roomy = () => matchMedia('(min-width: 721px) and (min-height: 600px)').matches; // room to show a build's controls under it
const byId = Object.fromEntries(PROJECTS.map(p => [p.id, p]));
const buildOf = Object.fromEntries(ARCADE.map(g => [g.project, g]));
const shotsOf = id => SHOTS[id] || [];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (name, size = 18) => `<svg width="${size}" height="${size}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const newTab = '<span class="visually-hidden"> (opens in a new tab)</span>';

function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2400);
}

// ------------------------------------------------------------ top bar: theme, menu, current section

const root = document.documentElement;
const themeBtn = $('#theme-btn');
function syncTheme() {
  const dark = root.dataset.theme === 'dark';
  themeBtn.setAttribute('aria-pressed', String(dark));
  themeBtn.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
  $('meta[name="theme-color"]').content = dark ? '#121318' : '#FAF9F6';
}
function toggleTheme() {
  const dark = root.dataset.theme !== 'dark';
  if (dark) root.dataset.theme = 'dark'; else delete root.dataset.theme;
  try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch { /* private mode: the choice lasts for this visit */ }
  syncTheme();
}
themeBtn.addEventListener('click', toggleTheme);
syncTheme();

const topbar = $('#topbar');
const menuBtn = $('#menu-btn');
function setMenu(open) {
  topbar.classList.toggle('open', open);
  menuBtn.setAttribute('aria-expanded', String(open));
}
menuBtn.addEventListener('click', () => setMenu(!topbar.classList.contains('open')));
$$('#nav a').forEach(a => a.addEventListener('click', () => setMenu(false)));
document.addEventListener('pointerdown', e => { if (!topbar.contains(e.target)) setMenu(false); });
addEventListener('scroll', () => topbar.classList.toggle('scrolled', scrollY > 8), { passive: true });

const navLinks = Object.fromEntries($$('#nav a').map(a => [a.hash.slice(1), a]));
const spy = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (!e.isIntersecting) return;
    Object.values(navLinks).forEach(a => a.removeAttribute('aria-current'));
    navLinks[e.target.id]?.setAttribute('aria-current', 'true');
  });
}, { rootMargin: '-45% 0px -50% 0px' });
$$('main > section').forEach(s => spy.observe(s));

// ------------------------------------------------------------ hero

$('#fact-count').textContent = `${PROJECTS.length} projects, ${ARCADE.length} playable`;

// ------------------------------------------------------------ work

const matches = (p, f) => f === 'all' || (f === 'play' ? Boolean(p.play) : p.cats.includes(f));

function cardHTML(p) {
  const cover = shotsOf(p.id).find(s => s.kind !== 'phone') || shotsOf(p.id)[0];
  return `
  <li class="card${p.game ? ' game' : ''}" data-id="${p.id}">
    <div class="card-shot">${cover ? `<img src="${cover.sm}" alt="" loading="lazy" width="${cover.w}" height="${cover.h}">` : ''}</div>
    <div class="card-body">
      <span class="card-kicker">${esc(p.kicker)}</span>
      <h3><a href="#project/${p.id}">${esc(p.name)}</a></h3>
      <p>${esc(p.brief)}</p>
      <div class="card-foot">
        <span class="badge ${p.badge.tone}">${esc(p.badge.label)}</span>
        ${p.play ? `<span class="badge play">${icon('play', 12)}Playable here</span>` : ''}
        <span class="card-more" aria-hidden="true">Details ${icon('arrow', 16)}</span>
      </div>
    </div>
  </li>`;
}

function setFilter(f) {
  if (!FILTERS.some(x => x.id === f)) f = 'all';
  $$('#filters button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.filter === f)));
  let shown = 0;
  $$('#cards .card').forEach(card => {
    const on = matches(byId[card.dataset.id], f);
    card.hidden = !on;
    shown += on;
  });
  $('#filter-status').textContent = `Showing ${shown} ${shown === 1 ? 'project' : 'projects'}.`;
}

function renderWork() {
  $('#cards').innerHTML = PROJECTS.map(cardHTML).join('');
  $('#filters').innerHTML = FILTERS.map(f =>
    `<button type="button" data-filter="${f.id}" aria-pressed="${f.id === 'all'}">${esc(f.label)}<span class="count">${PROJECTS.filter(p => matches(p, f.id)).length}</span></button>`).join('');
  $$('#filters button').forEach(b => b.addEventListener('click', () => setFilter(b.dataset.filter)));
  $('#course').innerHTML = COURSE.map(c => `<li>${c.href
    ? `<a href="${c.href}" target="_blank" rel="noopener">${esc(c.name)}${newTab}</a>`
    : `<b>${esc(c.name)}</b>`}<span>${esc(c.what)}</span></li>`).join('');
  $('#course-count').textContent = `(${COURSE.length})`;
}

// ------------------------------------------------------------ play

// a build's picture: the screenshot whose caption starts with g.cover, else the project's first screen
function coverOf(g) {
  const shots = shotsOf(g.project);
  return (g.cover && shots.find(s => s.caption.startsWith(g.cover))) || shots.find(s => s.kind === 'screen') || shots[0];
}

function renderPlay() {
  $('#tiles').innerHTML = ARCADE.map(g => {
    const cover = coverOf(g);
    const meta = [g.needs, g.size && (/MB$/.test(g.size) ? `${g.size} download` : g.size)].filter(Boolean).join(' · ');
    return `
    <li class="tile">
      <div class="tile-shot">${cover ? `<img src="${cover.sm}" alt="" loading="lazy" width="${cover.w}" height="${cover.h}">` : ''}<span class="tile-type">${esc(g.type)}</span></div>
      <div class="tile-body">
        <h3>${esc(g.name)}</h3>
        <p>${esc(g.blurb)}</p>
        ${meta ? `<span class="tile-meta">${esc(meta)}</span>` : ''}
        <div class="tile-actions">
          <a class="btn primary sm" href="#arcade/${g.id}">${icon('play', 16)}Play<span class="visually-hidden"> ${esc(g.name)}</span></a>
          <a class="btn sm plain" href="#project/${g.project}">Details<span class="visually-hidden"> about ${esc(g.name)}</span></a>
        </div>
      </div>
    </li>`;
  }).join('');
}

// ------------------------------------------------------------ about: steps, skills, journey

const STEPS = [
  ['Direct', 'Decide what to build: requirements, UX details and priorities.'],
  ['Build with AI', 'Pair-program with Claude and Codex to implement and debug.'],
  ['Review and test', 'Check behaviour, run the tests and catch regressions early.'],
  ['Understand', 'Study the code and architecture until I can own it.'],
];

function renderAbout() {
  $('#steps').innerHTML = STEPS.map(([t, d]) => `<li><b>${t}</b><span>${d}</span></li>`).join('');

  $('#tools').innerHTML = TOOLBOX.map(row => `<div class="tool-row"><h4>${esc(row.title)}</h4>
    <div>${row.items.map(t => `<button type="button" class="tool" aria-pressed="false" data-tool="${esc(t)}">${esc(t)}</button>`).join('')}</div></div>`).join('');
  const result = $('#tool-result');
  $$('.tool').forEach(b => b.addEventListener('click', () => {
    const on = b.getAttribute('aria-pressed') !== 'true';
    $$('.tool').forEach(x => x.setAttribute('aria-pressed', 'false'));
    b.setAttribute('aria-pressed', String(on));
    result.hidden = !on;
    if (!on) return;
    const tool = b.dataset.tool;
    const uses = (TOOL_USES[tool] || []).map(id => byId[id]).filter(Boolean);
    const earlier = p => p.id === 'ai-summary' && ['Supabase', 'OpenRouter'].includes(tool) ? ' (earlier version)' : '';
    result.innerHTML = uses.length
      ? `<b>${esc(tool)}</b> is used in ${uses.length} ${uses.length === 1 ? 'project' : 'projects'}: ${uses.map(p => `<a href="#project/${p.id}">${esc(p.name)}</a>${earlier(p)}`).join(', ')}.`
      : `<b>${esc(tool)}</b> is part of my everyday workflow rather than one project.`;
  }));

  $('#timeline').innerHTML = MILESTONES.map(m => `
    <li class="${m.now ? 'now' : m.future ? 'future' : ''}">
      <span class="when">${esc(m.date)}</span>
      <div><b>${esc(m.title)}${m.now ? '<span class="here">Now</span>' : ''}</b><span>${esc(m.sub)}</span></div>
    </li>`).join('');

}

// ------------------------------------------------------------ GitHub activity
// scripts/stats.py publishes the numbers every day; the page draws them in its own style.
// If the numbers can't be read, the ready-made pictures from the same script are shown instead.

const ACTIVITY = 'https://raw.githubusercontent.com/SethyPagna/SethyPagna/output';
// each language keeps its own colour, whatever its rank that day
const LANGUAGE_SLOT = { TypeScript: 1, JavaScript: 2, Python: 3, 'C++': 4, C: 5, Java: 6, 'C#': 7, SQL: 8 };
const nf = new Intl.NumberFormat('en');
const dayOf = iso => new Date(`${iso}T00:00:00Z`);
const fmtDate = (iso, opts) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...opts }).format(dayOf(iso));

function activityPictures() {
  const body = $('#activity-body');
  body.innerHTML = `<div class="activity-pictures">
    <img src="${ACTIVITY}/stats.svg" width="1200" height="290" loading="lazy" alt="GitHub activity for the last 12 months: contributions, active days, streaks and top languages.">
    <img src="${ACTIVITY}/skyline.svg" width="1200" height="420" loading="lazy" alt="Contribution chart: the last 12 months of GitHub contributions, one bar per week.">
  </div>`;
  $$('img', body).forEach(img => img.addEventListener('error', () => {
    const p = document.createElement('p');
    p.className = 'fallback';
    p.innerHTML = `This chart is being redrawn. See <a href="${PROFILE.github}" target="_blank" rel="noopener">my GitHub profile${newTab}</a> for now.`;
    img.replaceWith(p);
  }));
}

function activityChart(d) {
  const weeks = d.weeks;
  const max = Math.max(1, ...weeks.map(w => w.count));
  // a round number at or above the busiest week, so the two gridlines read cleanly
  const unit = 10 ** Math.floor(Math.log10(max));
  const top = [1, 1.2, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10].map(k => Math.max(2, k * unit)).find(v => v >= max);
  const peak = weeks.reduce((best, w, i) => (w.count > weeks[best].count ? i : best), 0);
  const weekLabel = w => `Week of ${fmtDate(w.start, { day: 'numeric', month: 'short', year: 'numeric' })}: ${nf.format(w.count)} ${w.count === 1 ? 'contribution' : 'contributions'}`;
  let month = '', months = 0;
  const bars = weeks.map((w, i) => {
    const m = fmtDate(w.start, { month: 'short' });
    // a label where each month starts; narrow screens keep every third one
    const tick = m !== month && i > 0 && i < weeks.length - 2 ? `<span class="tick${months++ % 3 ? ' minor' : ''}">${m}</span>` : '';
    month = m;
    return `<span class="bar${w.count ? '' : ' zero'}" data-i="${i}" style="--h:${(w.count / top * 100).toFixed(2)}%">${i === peak ? `<b>${nf.format(w.count)}</b>` : ''}${tick}</span>`;
  }).join('');

  const stats = [
    ['Active days', nf.format(d.activeDays)],
    ['Current streak', `${nf.format(d.currentStreak)} ${d.currentStreak === 1 ? 'day' : 'days'}`],
    ['Longest streak', `${nf.format(d.longestStreak)} ${d.longestStreak === 1 ? 'day' : 'days'}`],
    ['Busiest day', nf.format(d.bestDay)],
  ];
  const langs = (d.languages || []).filter(l => l.share > 0);
  let spare = 0;
  const free = [1, 2, 3, 4, 5, 6, 7, 8].filter(n => !langs.some(l => LANGUAGE_SLOT[l.name] === n));
  const colour = l => l.name === 'Other' ? 'var(--series-other)' : `var(--series-${LANGUAGE_SLOT[l.name] || free[spare++ % free.length]})`;
  const tinted = langs.map(l => ({ ...l, c: colour(l), pct: `${(l.share * 100).toFixed(l.share < .1 ? 1 : 0)}%` }));

  const body = $('#activity-body');
  body.innerHTML = `
  <div class="act">
    <div class="act-top">
      <p class="act-total"><b>${nf.format(d.total)}</b><span>contributions in the last 12 months</span></p>
      <dl class="act-stats">${stats.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
    </div>
    <div class="act-chart">
      <h4 id="chart-title">Contributions per week</h4>
      <div class="plot" tabindex="0" role="group" aria-labelledby="chart-title" aria-describedby="chart-help">
        <div class="grid" aria-hidden="true"><span><i>${nf.format(top)}</i></span><span><i>${nf.format(top / 2)}</i></span><span><i>0</i></span></div>
        <div class="bars" aria-hidden="true">${bars}</div>
        <div class="tip" hidden></div>
      </div>
      <p class="visually-hidden" id="chart-help">Bar chart of ${weeks.length} weeks. The busiest was the ${weekLabel(weeks[peak]).replace('Week', 'week')}. Use the left and right arrow keys to read each week.</p>
      <p class="visually-hidden" role="status" aria-live="polite" id="chart-live"></p>
      <details class="act-table"><summary>Show the weekly numbers as a table</summary>
        <div tabindex="0" role="region" aria-label="Weekly numbers"><table><thead><tr><th scope="col">Week starting</th><th scope="col">Contributions</th></tr></thead>
        <tbody>${weeks.map(w => `<tr><td>${fmtDate(w.start, { day: 'numeric', month: 'short', year: 'numeric' })}</td><td>${nf.format(w.count)}</td></tr>`).join('')}</tbody></table></div>
      </details>
    </div>
    ${tinted.length ? `<div class="act-langs">
      <h4>Languages in my public repositories</h4>
      <div class="lang-bar" role="img" aria-label="${esc(tinted.map(l => `${l.name} ${l.pct}`).join(', '))}">${tinted.map(l => `<span style="flex-grow:${l.share};background:${l.c}"></span>`).join('')}</div>
      <ul class="lang-legend">${tinted.map(l => `<li><i style="background:${l.c}"></i>${esc(l.name)} <span>${l.pct}</span></li>`).join('')}</ul>
    </div>` : ''}
    <p class="act-foot">${nf.format(d.publicRepos)} public repositories · updated ${fmtDate(d.updated, { day: 'numeric', month: 'short', year: 'numeric' })} · <a href="${PROFILE.github}" target="_blank" rel="noopener">View my GitHub profile${newTab}</a></p>
  </div>`;

  // one tooltip for pointer and keyboard: it names the week under the pointer, or the one the arrow keys reached
  const plot = $('.plot', body), tip = $('.tip', body), barEls = $$('.bar', body);
  let at = -1;
  const show = (i, announce) => {
    barEls[at]?.classList.remove('on');
    at = i;
    if (i < 0) { tip.hidden = true; return; }
    const bar = barEls[i];
    bar.classList.add('on');
    tip.textContent = weekLabel(weeks[i]);
    tip.hidden = false;
    const box = plot.getBoundingClientRect(), b = bar.getBoundingClientRect();
    const half = tip.offsetWidth / 2;
    tip.style.left = `${Math.max(half, Math.min(box.width - half, b.left - box.left + b.width / 2))}px`;
    if (announce) $('#chart-live', body).textContent = tip.textContent;
  };
  plot.addEventListener('pointermove', e => {
    const box = $('.bars', plot).getBoundingClientRect();
    const i = Math.floor((e.clientX - box.left) / box.width * weeks.length);
    show(i >= 0 && i < weeks.length ? i : -1);
  });
  plot.addEventListener('pointerleave', () => show(-1));
  plot.addEventListener('blur', () => show(-1));
  plot.addEventListener('keydown', e => {
    const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (e.key === 'Home' || e.key === 'End' || step) e.preventDefault(); else return;
    const i = e.key === 'Home' ? 0 : e.key === 'End' ? weeks.length - 1 : at < 0 ? (step > 0 ? 0 : weeks.length - 1) : at + step;
    show(Math.max(0, Math.min(weeks.length - 1, i)), true);
  });
}

async function renderActivity() {
  try {
    const res = await fetch(`${ACTIVITY}/stats.json`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(res.status);
    const d = await res.json();
    if (!Array.isArray(d.weeks) || !d.weeks.length || !Number.isFinite(d.total)) throw new Error('unexpected data');
    activityChart(d);
  } catch {
    activityPictures();
  }
}
// drawn straight away into space the stylesheet reserves, so nothing below it moves while someone is reading or jumping to a section
renderActivity();

// ------------------------------------------------------------ contact

const copyBtn = $('#copy-email');
copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(PROFILE.email);
    $('span', copyBtn).textContent = 'Copied';
    $('use', copyBtn).setAttribute('href', '#i-check');
    toast('Email address copied');
    clearTimeout(copyBtn.t);
    copyBtn.t = setTimeout(() => { $('span', copyBtn).textContent = 'Copy address'; $('use', copyBtn).setAttribute('href', '#i-copy'); }, 2400);
  } catch {
    location.href = `mailto:${PROFILE.email}`;
  }
});

// ------------------------------------------------------------ project window
// One <dialog> shows a project's details, or runs its build. The address is the state:
// #project/<id> is the details view, #arcade/<build id> is the running build.

const pw = $('#project-window');
const zoom = $('#zoom');
const search = $('#search');
// Hold the page still behind an open window, without the layout jumping when its scrollbar goes.
function lockPage() {
  const open = pw.open || search.open;
  if (open && !root.classList.contains('modal-open')) root.style.setProperty('--scroll-gap', `${innerWidth - root.clientWidth}px`);
  root.classList.toggle('modal-open', open);
}

let view = null;        // { id, mode: 'details' | 'play', shot }
let cameByLink = false; // opening added a history entry, so closing can go back over it
let leaving = false;    // Back is on its way; a second Close click has nothing left to do

// builds that were merged into another, so old #arcade/<id> links still land somewhere
const BUILD_ALIASES = { 'worlds-within': 'living-kingdom', 'first-hearth': 'living-kingdom' };

function targetOf(hash) {
  const [kind, raw] = decodeURIComponent(hash.replace(/^#/, '')).split('/');
  if (kind === 'project' && byId[raw]) return { id: raw, mode: 'details' };
  if (kind === 'arcade' && raw) {
    const g = ARCADE.find(x => x.id === (BUILD_ALIASES[raw] || raw));
    if (g) return { id: g.project, mode: 'play' };
  }
  return null;
}

function linkHTML(l) {
  if (l.kind === 'play') return `<a class="btn primary" href="${l.href}" data-swap>${icon('play')}${esc(l.label)}</a>`;
  return `<a class="btn" href="${l.href}" target="_blank" rel="noopener">${esc(l.label)}${icon(l.kind === 'code' ? 'code' : 'out', 16)}${newTab}</a>`;
}

function detailsHTML(p) {
  const shots = shotsOf(p.id);
  const i = PROJECTS.indexOf(p);
  const prev = PROJECTS[(i - 1 + PROJECTS.length) % PROJECTS.length];
  const next = PROJECTS[(i + 1) % PROJECTS.length];
  const many = shots.length > 1;
  return `
    <div class="pw-bar">
      <h2 id="pw-title" tabindex="-1">${esc(p.name)}</h2><span class="spacer"></span>
      <button class="btn sm" type="button" data-close>Close ${icon('close', 16)}</button>
    </div>
    <div class="pw-body">
      <div class="pw-grid">
        <div class="gallery">
          <div class="gallery-main">
            ${shots.length ? `<button class="gallery-zoom" type="button" aria-label="Enlarge screenshot"><img alt=""></button>` : `<div class="no-shots">No screenshots yet</div>`}
            ${many ? `<button class="icon-btn gallery-step prev" type="button" data-step="-1" aria-label="Previous screenshot">${icon('left', 20)}</button>
            <button class="icon-btn gallery-step next" type="button" data-step="1" aria-label="Next screenshot">${icon('right', 20)}</button>` : ''}
          </div>
          <p class="gallery-caption" aria-live="polite"><b></b><span></span></p>
          ${many ? `<div class="thumbs" role="group" aria-label="Screenshots">${shots.map((s, k) => `<button type="button" data-shot="${k}" aria-label="Screenshot ${k + 1}: ${esc(s.caption)}"><img src="${s.sm}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}
        </div>
        <div class="info">
          <div class="info-top">
            <div class="info-meta"><span class="badge ${p.badge.tone}">${esc(p.badge.label)}</span><span>${esc(p.kicker)} · ${esc(p.year)}</span></div>
            <p class="tagline">${esc(p.tagline)}</p>
            <p class="about-text">${esc(p.about)}</p>
          </div>
          ${p.links.length
            ? `<div class="info-actions">${p.links.map(linkHTML).join('')}</div>`
            : '<p class="note">There is no public link yet. The screenshots come from local builds.</p>'}
          <div><h3>What it does</h3><ul class="features">${p.features.map(f => `<li>${esc(f)}</li>`).join('')}</ul></div>
          <div><h3>Built with</h3><div class="stack">${p.stack.map(s => `<span class="chip">${esc(s)}</span>`).join('')}</div></div>
          ${p.note ? `<p class="good-to-know"><b>Status: ${esc(p.status)}</b>${esc(p.note)}${p.credit ? ` <a href="${p.credit.href}" target="_blank" rel="noopener">${esc(p.credit.label)}${newTab}</a>` : ''}</p>` : ''}
        </div>
      </div>
      <nav class="pw-next" aria-label="Other projects">
        <a href="#project/${prev.id}" data-swap><small>${icon('back', 14)} Previous project</small><b>${esc(prev.name)}</b></a>
        <a href="#project/${next.id}" data-swap><small>Next project ${icon('arrow', 14)}</small><b>${esc(next.name)}</b></a>
      </nav>
    </div>`;
}

function playHTML(p, g) {
  const fullscreen = document.fullscreenEnabled
    ? `<button class="btn sm plain" type="button" data-fullscreen aria-label="Full screen">${icon('expand', 16)}<span class="label">Full screen</span></button>` : '';
  return `
    <div class="pw-bar">
      <a class="btn sm" href="#project/${p.id}" data-swap aria-label="Back to ${esc(p.name)} details">${icon('back', 16)}<span class="label">Details</span></a>
      <h2 id="pw-title" tabindex="-1">${esc(g.name)}</h2><span class="spacer"></span>
      <button class="btn sm plain" type="button" data-restart aria-label="Restart">${icon('reload', 16)}<span class="label">Restart</span></button>
      ${fullscreen}
      <a class="btn sm plain new-tab" href="${g.src}" target="_blank" rel="noopener" aria-label="Open in new tab">${icon('out', 16)}<span class="label">Open in new tab</span></a>
      <button class="btn sm" type="button" data-close aria-label="Close">${icon('close', 16)}<span class="label">Close</span></button>
    </div>
    <div class="player">
      <div class="frame"></div>
      <details class="controls"${roomy() ? ' open' : ''}><summary>Controls</summary><p>${esc(g.controls)}</p></details>
    </div>`;
}

function showShot(k) {
  const shots = shotsOf(view.id);
  if (!shots.length) return;
  view.shot = (k + shots.length) % shots.length;
  const s = shots[view.shot];
  const img = $('.gallery-zoom img', pw);
  img.src = s.src;
  img.alt = s.caption;
  $('.gallery-caption b', pw).textContent = shots.length > 1 ? `${view.shot + 1} / ${shots.length}` : '';
  $('.gallery-caption span', pw).textContent = s.caption;
  $$('.thumbs button', pw).forEach((b, j) => {
    b.setAttribute('aria-current', String(j === view.shot));
    if (j === view.shot) b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
  if (zoom.open) { const z = $('img', zoom); z.src = s.src; z.alt = s.caption; }
}

function loadBuild(g) {
  const frame = $('.frame', pw);
  const size = /MB$/.test(g.size || '') ? ` (${g.size})` : '';
  frame.innerHTML = `<iframe src="${g.src}" title="${esc(g.title)}" allow="fullscreen; gamepad; autoplay; clipboard-write" allowfullscreen></iframe>
    <div class="loading" role="status">Loading ${esc(g.name)}${size}…</div>`;
  $('iframe', frame).addEventListener('load', () => $('.loading', frame)?.remove());
}

function showProject({ id, mode }) {
  const p = byId[id];
  const g = buildOf[id];
  if (mode === 'play' && !g) mode = 'details';
  if (view?.id === id && view.mode === mode && pw.open) return;
  view = { id, mode, shot: 0 };
  pw.classList.toggle('playing', mode === 'play');
  if (mode === 'play') {
    pw.innerHTML = playHTML(p, g);
    if (g.desktop && coarse) {
      // desktop-only builds on a touch screen: say so plainly, and only download on request
      $('.frame', pw).innerHTML = `<div class="ask"><h3>${esc(g.name)} needs a keyboard and mouse</h3>
        <p>Open this page on a computer to play it. You can still load it here, but the controls will not work on a touch screen.</p>
        <button class="btn" type="button" data-restart>Load anyway${/MB$/.test(g.size || '') ? ` (${esc(g.size)})` : ''}</button></div>`;
    } else loadBuild(g);
  } else {
    pw.innerHTML = detailsHTML(p);
    showShot(0);
  }
  if (!pw.open) {
    pw.showModal();
    lockPage();
  }
  $('.pw-body', pw)?.scrollTo(0, 0);
  $('#pw-title', pw).focus({ preventScroll: true });
}

function hideProject() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (zoom.open) zoom.close();
  if (pw.open) pw.close();
  pw.innerHTML = ''; // also stops a running build
  pw.classList.remove('playing');
  lockPage();
  view = null;
  leaving = false;
}

function closeProject() {
  if (!view || leaving) return;
  if (cameByLink) {
    // step back over the entry that opening added; the hashchange that follows closes the window
    cameByLink = false; leaving = true; history.back();
    setTimeout(() => { if (leaving && view) { leaving = false; closeProject(); } }, 800); // Back went nowhere: close directly
    return;
  }
  // opened straight from a shared link: settle on the section the project belongs to
  const section = view.mode === 'play' ? '#arcade' : '#projects';
  history.replaceState(null, '', section);
  hideProject();
  $(section).scrollIntoView({ behavior: 'instant' });
}

pw.addEventListener('cancel', e => { e.preventDefault(); closeProject(); });
pw.addEventListener('close', () => { if (view) closeProject(); }); // closed by the browser itself: keep the address in step
// A click counts as "outside" only if it also started outside, so dragging to select text never closes a window.
let pressedOutside = false;
for (const d of [pw, search]) d.addEventListener('pointerdown', e => { pressedOutside = e.target === d; });
pw.addEventListener('click', e => {
  if (e.target === pw) { if (pressedOutside) closeProject(); return; } // the dimmed area around the window
  const swap = e.target.closest('a[data-swap]');
  if (swap) {
    // moving between views inside the window replaces the address, so Back still closes it
    e.preventDefault();
    history.replaceState(null, '', swap.getAttribute('href'));
    const target = targetOf(location.hash);
    if (target) showProject(target);
    return;
  }
  if (e.target.closest('[data-close]')) return closeProject();
  const step = e.target.closest('[data-step]');
  if (step) return showShot(view.shot + Number(step.dataset.step));
  const thumb = e.target.closest('[data-shot]');
  if (thumb) return showShot(Number(thumb.dataset.shot));
  if (e.target.closest('.gallery-zoom')) {
    const s = shotsOf(view.id)[view.shot];
    const z = $('img', zoom);
    z.src = s.src; z.alt = s.caption;
    zoom.showModal();
    return;
  }
  if (e.target.closest('[data-restart]')) return loadBuild(buildOf[view.id]);
  if (e.target.closest('[data-fullscreen]')) $('.frame', pw).requestFullscreen?.().catch(() => {});
});
zoom.addEventListener('click', () => zoom.close());

function route({ initial = false } = {}) {
  const target = targetOf(location.hash);
  if (target) {
    if (!pw.open) cameByLink = !initial;
    showProject(target);
    return;
  }
  if (view) hideProject();
  // section names from the earlier layout
  const old = { games: 'projects', departures: 'projects' }[location.hash.slice(1)];
  if (old) {
    if (location.hash === '#games') setFilter('games');
    history.replaceState(null, '', `#${old}`);
    $(`#${old}`).scrollIntoView({ behavior: 'instant' });
  }
}
addEventListener('hashchange', () => route());
// a link to the project that is already in the address (after a reload, say) changes nothing, so open it by hand
document.addEventListener('click', e => {
  const a = e.target.closest('a[href^="#project/"], a[href^="#arcade/"]');
  if (a && !pw.open && a.getAttribute('href') === location.hash) { e.preventDefault(); route(); }
});

// ------------------------------------------------------------ search

const input = $('#search-input');
const listEl = $('#search-list');
let items = [], sel = 0;

// From search: with a window already open, swap it in place (as the window's own links do) so Close and Back still close it.
const go = hash => {
  if (pw.open) history.replaceState(null, '', hash);
  if (location.hash === hash) route(); else location.hash = hash;
};
function searchItems() {
  return [
    ...PROJECTS.map(p => ({ title: p.name, text: p.brief, more: [p.kicker, p.tagline, ...p.cats, ...p.stack].join(' '), kind: 'Project', run: () => go(`#project/${p.id}`) })),
    ...ARCADE.map(g => ({ title: `Play ${g.name}`, text: g.type, more: 'game arcade', kind: 'Play', run: () => go(`#arcade/${g.id}`) })),
    ...$$('#nav a').map(a => ({ title: a.textContent, text: 'Go to this section', more: 'section', kind: 'Section', run: () => { if (view) hideProject(); history.replaceState(null, '', a.hash); $(a.hash).scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' }); } })),
    { title: 'Copy email address', text: PROFILE.email, more: 'contact mail', kind: 'Action', run: () => copyBtn.click() },
    { title: 'Open LinkedIn', text: 'Opens in a new tab', more: 'contact', kind: 'Link', run: () => open(PROFILE.linkedin, '_blank', 'noopener') },
    { title: 'Open GitHub', text: 'Opens in a new tab', more: 'contact code source', kind: 'Link', run: () => open(PROFILE.github, '_blank', 'noopener') },
    { title: 'Switch light or dark theme', text: 'Changes the colours of this page', more: 'mode appearance', kind: 'Action', run: toggleTheme },
  ];
}

function renderSearch() {
  // every word typed must start a word in the item; one- and two-letter words must match a whole word, so "ai" doesn't find "air"
  const escapeRe = w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const words = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean)
    .map(w => new RegExp('(^|[^a-z0-9])' + escapeRe(w) + (w.length < 3 ? '($|[^a-z0-9])' : '')));
  const hit = text => words.every(r => r.test(text.toLowerCase()));
  items = searchItems().filter(it => hit(`${it.title} ${it.text} ${it.more} ${it.kind}`));
  // a match in the name comes before a match in the description
  if (words.length) items = [...items.filter(it => hit(it.title)), ...items.filter(it => !hit(it.title))];
  sel = Math.min(sel, Math.max(0, items.length - 1));
  listEl.innerHTML = items.length
    ? items.map((it, i) => `<li role="option" id="hit-${i}" aria-selected="${i === sel}" data-i="${i}"><b>${esc(it.title)}</b><span>${esc(it.text)}</span><span class="kind">${it.kind}</span></li>`).join('')
    : '<li class="empty" role="option" aria-disabled="true" aria-selected="false">Nothing matches. Try “chess”, “shop” or “AI”.</li>';
  input.setAttribute('aria-activedescendant', items.length ? `hit-${sel}` : '');
  $(`#hit-${sel}`)?.scrollIntoView({ block: 'nearest' });
}
function moveSel(i) {
  if (!items.length) return;
  $(`#hit-${sel}`)?.setAttribute('aria-selected', 'false');
  sel = Math.max(0, Math.min(items.length - 1, i));
  const li = $(`#hit-${sel}`);
  li.setAttribute('aria-selected', 'true');
  li.scrollIntoView({ block: 'nearest' });
  input.setAttribute('aria-activedescendant', li.id);
}
function runItem(i) { const it = items[i]; if (!it) return; search.close(); it.run(); }
function openSearch() { if (search.open) return; setMenu(false); input.value = ''; sel = 0; renderSearch(); search.showModal(); lockPage(); input.focus(); }

$('#open-search').addEventListener('click', openSearch);
search.addEventListener('close', lockPage);
search.addEventListener('click', e => {
  if (e.target === search) { if (pressedOutside) search.close(); return; }
  const li = e.target.closest('li[data-i]');
  if (li) runItem(Number(li.dataset.i));
});
listEl.addEventListener('pointermove', e => { const li = e.target.closest('li[data-i]'); if (li && Number(li.dataset.i) !== sel) moveSel(Number(li.dataset.i)); });
input.addEventListener('input', () => { sel = 0; renderSearch(); });
input.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { e.preventDefault(); moveSel(sel + 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); moveSel(sel - 1); }
  else if (e.key === 'Enter') { e.preventDefault(); runItem(sel); }
});

// ------------------------------------------------------------ keys

addEventListener('keydown', e => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  if ((e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing && !view)) {
    e.preventDefault();
    search.open ? search.close() : openSearch();
    return;
  }
  if (e.key === 'Escape' && topbar.classList.contains('open')) { setMenu(false); menuBtn.focus(); return; }
  if (view?.mode === 'details' && !search.open && !typing && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    e.preventDefault();
    showShot(view.shot + (e.key === 'ArrowLeft' ? -1 : 1));
  }
});

// ------------------------------------------------------------ start

renderWork();
renderPlay();
renderAbout();
route({ initial: true });
