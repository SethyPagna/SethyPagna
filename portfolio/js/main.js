import { PROJECTS, CATEGORIES, COURSE, ARCADE, FLIGHTS, TOOLBOX, TOOL_USES, MILESTONES, PROFILE } from './data.js';
import { SHOTS } from './shots.js';
import { mountSkyline } from './skyline.js';
import { flapRow } from './flap.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const byId = Object.fromEntries(PROJECTS.map(p => [p.id, p]));
const shotsOf = id => SHOTS[id] || [];
const color = name => `var(--${name})`;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (name, size = 16) => `<svg width="${size}" height="${size}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2200);
}

// ------------------------------------------------------------ hero

const sky = mountSkyline($('#sky'), { reduced });
if (matchMedia('(pointer: coarse)').matches) $('.hero-hint').textContent = 'Tap the sky for fireworks';
$('#sky').addEventListener('click', e => {
  const r = e.currentTarget.getBoundingClientRect();
  sky.launch(e.clientX - r.left, e.clientY - r.top);
});

function cycleGreeting() {
  const spans = $$('.greet span');
  let i = 0;
  const step = () => {
    spans.forEach((s, k) => { s.classList.toggle('lit', k === i); s.classList.toggle('dim', k !== i); });
    i = (i + 1) % spans.length;
  };
  if (reduced) return;
  step();
  setInterval(step, 1600);
  const name = $('#name');
  setInterval(() => { name.classList.remove('glitch'); void name.offsetWidth; name.classList.add('glitch'); }, 5200);
}
cycleGreeting();

// ------------------------------------------------------------ chrome: top bar, clock, nav

const topbar = $('#topbar');
let lastY = 0;
addEventListener('scroll', () => {
  const y = scrollY;
  topbar.classList.toggle('solid', y > innerHeight * .6);
  topbar.classList.toggle('hide', y > lastY && y > innerHeight && !topbar.classList.contains('open'));
  lastY = y;
}, { passive: true });

function tickClock() {
  const t = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Hong_Kong', hour: '2-digit', minute: '2-digit' }).format(new Date());
  $('#clock').textContent = t;
}
tickClock();
setInterval(tickClock, 20000);

$('#menu-btn').addEventListener('click', () => {
  const open = topbar.classList.toggle('open');
  $('#menu-btn').setAttribute('aria-expanded', open);
});
$$('#nav a').forEach(a => a.addEventListener('click', () => { topbar.classList.remove('open'); $('#menu-btn').setAttribute('aria-expanded', 'false'); }));

const navLinks = Object.fromEntries($$('#nav a').map(a => [a.hash.slice(1), a]));
const sectionSpy = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (!e.isIntersecting) return;
    Object.values(navLinks).forEach(a => a.classList.remove('on'));
    navLinks[e.target.id]?.classList.add('on');
  });
}, { rootMargin: '-45% 0px -50% 0px' });
$$('main > section').forEach(s => sectionSpy.observe(s));

const revealer = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); revealer.unobserve(e.target); } });
}, { rootMargin: '0px 0px -8% 0px' });
const watchReveals = root => $$('.reveal:not(.in)', root).forEach(el => revealer.observe(el));

// ------------------------------------------------------------ about

$('#facts').innerHTML = [
  ['14', 'projects on this page', 'volt'],
  ['5', 'builds you can play in the page', 'cyan'],
  ['3', 'languages: Khmer, English, Mandarin', 'magenta'],
  ['1', 'app in daily use by a real shop', 'acid'],
].map(([n, t, c]) => `<div class="fact" style="--c:${color(c)}"><b>${n}</b><span>${t}</span></div>`).join('');

// ------------------------------------------------------------ departures board

function renderBoard() {
  const rows = FLIGHTS.map(id => byId[id]);
  $('#board-rows').innerHTML = rows.map((p, r) => `
    <tr tabindex="0" data-open="${p.id}" aria-label="${esc(p.name)}: ${esc(p.route)}. ${esc(p.status.label)}">
      <td class="flight"><span class="flaps" data-flap="${p.code} ${String(r + 1).padStart(2, '0')}" data-width="6"></span></td>
      <td class="dest"><span class="flaps" data-flap="${esc(p.name.replace(' + ', '+').replace(/[^A-Za-z0-9+ ]/g, ' '))}" data-width="14"></span></td>
      <td class="route-cell">${esc(p.route)}</td>
      <td class="gate">${esc(p.gate)}</td>
      <td class="status"><span class="tag" style="--c:${color(p.status.color)}">${esc(p.status.label)}</span></td>
    </tr>`).join('');
  $$('#board-rows .flaps').forEach(el => { el.textContent = el.dataset.flap; });
  let started = false;
  new IntersectionObserver(([e], obs) => {
    if (!e.isIntersecting || started) return;
    started = true; obs.disconnect();
    $$('#board-rows tr').forEach((tr, r) => {
      $$('.flaps', tr).forEach(el => flapRow(el, el.dataset.flap, { width: +el.dataset.width, delay: r * 120, reduced }));
    });
  }, { threshold: .25 }).observe($('.board'));
  $$('#board-rows tr').forEach(tr => {
    tr.addEventListener('click', () => openDossier(tr.dataset.open));
    tr.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDossier(tr.dataset.open); } });
  });
  const ticker = 'Product direction + AI pair-programming with Claude and Codex + review and testing  ///  Private projects are described at a high level  ///  Five projects playable in the arcade  ///  ';
  $('#ticker').innerHTML = `<span>${ticker}</span><span>${ticker}</span>`;
}

// ------------------------------------------------------------ project cards

function domainFor(p) {
  const live = p.links.find(l => l.kind === 'live');
  if (live) return new URL(live.href).host;
  if (p.play) return `arcade · playable build`;
  if (p.private) return 'private build · local';
  return 'github.com/SethyPagna';
}

function cardHTML(p) {
  const shots = shotsOf(p.id).filter(s => s.kind !== 'phone');
  const cover = shots[0];
  const imgs = shots.slice(0, 4).map((s, i) => `<img src="${s.sm}" alt="" ${i ? 'loading="lazy"' : 'class="on"'} width="${s.w}" height="${s.h}">`).join('');
  const actions = p.links.slice(0, 2).map(l => l.kind === 'play'
    ? `<a class="btn sm" href="${l.href}">${icon('play')}${esc(l.label)}</a>`
    : `<a class="btn sm ghost" href="${l.href}" target="_blank" rel="noopener">${esc(l.label)}${icon(l.kind === 'code' ? 'code' : 'out')}</a>`).join('');
  return `
  <article class="card reveal" style="--c:${color(p.color)}" data-cats="${p.cats.join(' ')}" data-id="${p.id}">
    <div class="shot">
      <div class="shot-bar"><i></i><i></i><i></i><span>${esc(domainFor(p))}</span><span class="tag" style="--c:${color(p.status.color)}">${esc(p.status.label)}</span></div>
      <div class="slides" data-count="${Math.min(4, shots.length)}">${imgs || `<div class="noshot">${esc(p.name)}</div>`}</div>
      <div class="scan"></div>
      ${shots.length > 1 ? `<div class="dots">${shots.slice(0, 4).map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>` : ''}
    </div>
    <div class="card-body">
      <div class="card-kicker"><span>${p.no} //</span>${esc(p.kicker)}</div>
      <h3><button class="open" data-open="${p.id}" aria-haspopup="dialog">${esc(p.name)}</button></h3>
      <p class="tagline">${esc(p.tagline)}</p>
      <p class="summary">${esc(p.summary)}</p>
      <div class="stack">${p.stack.slice(0, 5).map(s => `<span class="chip">${esc(s)}</span>`).join('')}</div>
      <div class="card-actions"><button class="btn sm" type="button" data-open="${p.id}" style="--c:${color(p.color)}">Dossier ${icon('right')}</button>${actions}</div>
    </div>
  </article>`;
}

function renderProjects() {
  const apps = PROJECTS.filter(p => !p.game);
  $('#cards-featured').innerHTML = apps.filter(p => p.featured).map(cardHTML).join('');
  $('#cards-more').innerHTML = apps.filter(p => !p.featured).map(cardHTML).join('');
  const cats = CATEGORIES.filter(c => c.id !== 'games');
  $('#filters').innerHTML = cats.map((c, i) => {
    const n = c.id === 'all' ? apps.length : apps.filter(p => p.cats.includes(c.id)).length;
    return `<button type="button" data-filter="${c.id}" aria-pressed="${i === 0}">${c.label}<span class="count">${n}</span></button>`;
  }).join('') + `<a class="filter-link" href="#games">Games ${icon('right', 12)}</a>`;
  $$('#filters button').forEach(b => b.addEventListener('click', () => {
    $$('#filters button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    const f = b.dataset.filter;
    $$('.card').forEach(card => { card.hidden = f !== 'all' && !card.dataset.cats.split(' ').includes(f); });
    $('#course').closest('details').open = f === 'team';
  }));
  $('#course').innerHTML = COURSE.map(c => `<li>${c.href ? `<a href="${c.href}" target="_blank" rel="noopener">${esc(c.name)} ${icon('out', 12)}</a>` : `<b>${esc(c.name)}</b>`}<span>${esc(c.what)}</span></li>`).join('');
  $('#course-count').textContent = COURSE.length;
  bindCards($('#projects'));
}

function bindCards(root) {
  $$('[data-open]', root).forEach(el => el.addEventListener('click', e => { e.preventDefault(); openDossier(el.dataset.open); }));
  $$('.card, .lab-card', root).forEach(card => {
    const imgs = $$('.slides img', card);
    const dots = $$('.dots i', card);
    if (imgs.length < 2) return;
    let i = 0, timer = 0;
    const show = k => { i = k; imgs.forEach((im, j) => im.classList.toggle('on', j === k)); dots.forEach((d, j) => d.classList.toggle('on', j === k)); };
    const start = () => { if (reduced || timer) return; timer = setInterval(() => show((i + 1) % imgs.length), 1300); show((i + 1) % imgs.length); };
    const stop = () => { clearInterval(timer); timer = 0; show(0); };
    card.addEventListener('pointerenter', start);
    card.addEventListener('pointerleave', stop);
    card.addEventListener('focusin', start);
    card.addEventListener('focusout', stop);
  });
}

// ------------------------------------------------------------ game dev lab

function renderLab() {
  const games = PROJECTS.filter(p => p.game);
  $('#lab').innerHTML = games.map(p => {
    const shots = shotsOf(p.id);
    const hero = shots[0];
    const strip = shots.slice(1, 5);
    const plays = p.links.filter(l => l.kind === 'play');
    const others = p.links.filter(l => l.kind !== 'play');
    return `
    <article class="lab-card reveal" style="--c:${color(p.color)}">
      <div class="lab-hero">
        ${hero ? `<img src="${hero.src}" alt="${esc(hero.caption)}" loading="lazy" width="${hero.w}" height="${hero.h}">` : ''}
        <div class="hud"></div>
        <span class="tag solid engine" style="--c:${color(p.color)}">${esc(p.stack[0])}</span>
        ${hero ? `<p class="lab-cap">${esc(hero.caption)}</p>` : ''}
      </div>
      <div class="lab-strip">${strip.map((s, k) => `<button type="button" data-zoom="${p.id}:${k + 1}" aria-label="Enlarge: ${esc(s.caption)}"><img src="${s.sm}" alt="" loading="lazy"></button>`).join('')}</div>
      <div class="lab-body">
        <div class="card-kicker"><span>${p.no} //</span>${esc(p.kicker)}<span class="tag" style="--c:${color(p.status.color)}">${esc(p.status.label)}</span></div>
        <h3>${esc(p.name)}</h3>
        <p class="tagline">${esc(p.tagline)}</p>
        <p>${esc(p.summary)}</p>
        <ul>${p.features.slice(0, 3).map(f => `<li>${esc(f)}</li>`).join('')}</ul>
        <div class="card-actions">
          ${plays.map(l => `<a class="btn sm" href="${l.href}" style="--c:${color(p.color)}">${icon('play')}${esc(l.label)}</a>`).join('')}
          <button class="btn sm ghost" type="button" data-open="${p.id}" style="--c:${color(p.color)}">Dossier ${icon('right')}</button>
          ${others.map(l => `<a class="btn sm ghost" href="${l.href}" target="_blank" rel="noopener" style="--c:var(--muted)">${esc(l.label)}${icon('code')}</a>`).join('')}
        </div>
      </div>
    </article>`;
  }).join('');
  $$('[data-zoom]', $('#lab')).forEach(b => b.addEventListener('click', () => {
    const [id, k] = b.dataset.zoom.split(':');
    const s = shotsOf(id)[+k];
    openLightbox(s.src, s.caption);
  }));
  bindCards($('#lab'));
}

// ------------------------------------------------------------ dossier

const overlay = $('#dossier-overlay');
const dossier = $('#dossier');
let current = null, lastFocus = null;

function linkButton(l, p) {
  if (l.kind === 'play') return `<a class="btn" href="${l.href}" data-close-then style="--c:${color(p.color)}">${icon('play')}${esc(l.label)}</a>`;
  return `<a class="btn ${l.kind === 'code' ? 'ghost' : ''}" href="${l.href}" target="_blank" rel="noopener" style="--c:${l.kind === 'code' ? 'var(--muted)' : color(p.color)}">${esc(l.label)}${icon(l.kind === 'code' ? 'code' : 'out')}</a>`;
}

function openDossier(id, { push = true } = {}) {
  const p = byId[id];
  if (!p) return;
  if (!current) lastFocus = document.activeElement;
  current = id;
  const shots = shotsOf(id);
  const order = PROJECTS.map(x => x.id);
  const idx = order.indexOf(id);
  const prev = byId[order[(idx - 1 + order.length) % order.length]];
  const next = byId[order[(idx + 1) % order.length]];
  const cab = ARCADE.find(a => a.project === id);
  const cabUrl = cab && (cab.src || cab.live);
  dossier.style.setProperty('--c', color(p.color));
  dossier.innerHTML = `
    <header class="dossier-head">
      <span class="code">${p.code} ${p.no}</span><h2 id="dossier-title">${esc(p.name)}</h2><span class="spacer"></span>
      <button class="icon-btn" type="button" data-nav="${prev.id}" aria-label="Previous project: ${esc(prev.name)}">${icon('left', 18)}</button>
      <button class="icon-btn" type="button" data-nav="${next.id}" aria-label="Next project: ${esc(next.name)}">${icon('right', 18)}</button>
      <button class="icon-btn" type="button" data-close aria-label="Close">${icon('close', 18)}</button>
    </header>
    <div class="dossier-grid">
      <div class="stage">
        <div class="stage-tabs">
          <button class="btn sm" type="button" data-stage="shots" aria-pressed="true">Screens <span class="count">${shots.length}</span></button>
          ${cab ? `<button class="btn sm ghost" type="button" data-stage="live" aria-pressed="false">${icon('play')}Play here</button>` : ''}
          <span class="spacer"></span>
          ${p.private ? '<span class="tag" style="--c:var(--dim)">Private source</span>' : ''}
        </div>
        <div class="stage-main" id="stage-main"></div>
        <div class="thumbs" id="thumbs">${shots.map((s, k) => `<button type="button" data-shot="${k}" aria-label="${esc(s.caption)}" aria-current="${k === 0}"><img src="${s.sm}" alt="" loading="lazy"></button>`).join('')}</div>
        <p class="caption" id="caption"></p>
      </div>
      <div class="info">
        <div>
          <span class="tag" style="--c:${color(p.status.color)}">${esc(p.status.label)}</span>
          <h2 class="big-title">${esc(p.name)}</h2>
          <p class="tagline">${esc(p.tagline)}</p>
        </div>
        <p>${esc(p.about)}</p>
        ${p.links.length ? `<div class="links">${p.links.map(l => linkButton(l, p)).join('')}</div>` : '<p class="note">Private repository: no public link yet. Screens are from local builds.</p>'}
        <div><h3>What's in it</h3><ul class="features">${p.features.map(f => `<li>${esc(f)}</li>`).join('')}</ul></div>
        <div><h3>Built with</h3><div class="stack">${p.stack.map(s => `<span class="chip" style="--c:${color(p.color)}">${esc(s)}</span>`).join('')}</div></div>
        <div class="meta-grid">
          <div><small>Type</small><b>${esc(p.kicker)}</b></div>
          <div><small>Year</small><b>${esc(p.year)}</b></div>
        </div>
        ${p.note ? `<p class="note">${esc(p.note)}${p.credit ? ` <a href="${p.credit.href}" target="_blank" rel="noopener">${esc(p.credit.label)} ↗</a>` : ''}</p>` : ''}
      </div>
    </div>
    <nav class="dossier-nav">
      <button class="btn sm ghost" type="button" data-nav="${prev.id}" style="--c:var(--muted)">${icon('left')}${esc(prev.name)}</button>
      <button class="btn sm ghost" type="button" data-nav="${next.id}" style="--c:var(--muted)">${esc(next.name)}${icon('right')}</button>
    </nav>`;
  const stageMain = $('#stage-main', dossier);
  const showShot = k => {
    const s = shots[k];
    if (!s) { stageMain.innerHTML = `<div class="noshot">${esc(p.name)}</div>`; return; }
    stageMain.innerHTML = `<img src="${s.src}" alt="${esc(s.caption)}" class="${s.kind}">`;
    $('img', stageMain).addEventListener('click', () => openLightbox(s.src, s.caption));
    $('#caption', dossier).textContent = `${k + 1} / ${shots.length} · ${s.caption}`;
    $$('#thumbs button', dossier).forEach((b, j) => b.setAttribute('aria-current', String(j === k)));
  };
  showShot(0);
  $$('#thumbs button', dossier).forEach(b => b.addEventListener('click', () => showShot(+b.dataset.shot)));
  $$('[data-stage]', dossier).forEach(b => b.addEventListener('click', () => {
    $$('[data-stage]', dossier).forEach(x => { x.setAttribute('aria-pressed', String(x === b)); x.classList.toggle('ghost', x !== b); });
    const live = b.dataset.stage === 'live';
    $('#thumbs', dossier).hidden = live;
    if (live) {
      stageMain.innerHTML = `<div class="frame-wrap"><iframe src="${cabUrl}" title="${esc(cab.title)}" allow="fullscreen; gamepad; autoplay; clipboard-write" allowfullscreen></iframe></div>
        <div class="frame-note"><span>${esc(cab.title)} · ${esc(cab.controls)}</span><a href="${cabUrl}" target="_blank" rel="noopener">Open full screen ↗</a></div>`;
      fitFrame($('iframe', stageMain), $('.frame-wrap', stageMain), cab.vw);
      $('#caption', dossier).textContent = cab.live ? 'Live app: if it stays blank, the host may be asleep. Use “Open full screen”.' : 'Running in this page. For more room, use “Open full screen” or the arcade.';
    } else showShot(0);
  }));
  $$('[data-nav]', dossier).forEach(b => b.addEventListener('click', () => openDossier(b.dataset.nav)));
  $$('[data-close]', overlay).forEach(b => b.addEventListener('click', closeDossier));
  $$('[data-close-then]', dossier).forEach(a => a.addEventListener('click', () => closeDossier({ restore: false })));
  overlay.hidden = false;
  overlay.classList.add('open');
  document.body.classList.add('locked');
  dossier.scrollTop = 0;
  dossier.focus();
  if (push) history.replaceState(null, '', `#project/${id}`);
}

function closeDossier({ restore = true } = {}) {
  if (!current) return;
  current = null;
  overlay.classList.remove('open');
  overlay.hidden = true;
  dossier.innerHTML = '';
  document.body.classList.remove('locked');
  if (location.hash.startsWith('#project/')) history.replaceState(null, '', location.pathname + location.search);
  if (restore) lastFocus?.focus?.();
}

overlay.addEventListener('keydown', e => {
  if (e.key === 'Tab') {
    const focusables = $$('button, a[href], iframe, [tabindex="0"]', dossier).filter(el => !el.closest('[hidden]'));
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});

// ------------------------------------------------------------ lightbox

const lightbox = $('#lightbox');
function openLightbox(src, alt) {
  const img = $('img', lightbox);
  img.src = src; img.alt = alt || '';
  lightbox.hidden = false; lightbox.classList.add('open');
}
lightbox.addEventListener('click', () => { lightbox.classList.remove('open'); lightbox.hidden = true; });

// ------------------------------------------------------------ arcade

let cabinet = null;
// a cabinet's picture: the shot whose caption starts with g.cover, else the project's first screen
function coverOf(g) {
  const shots = shotsOf(g.project);
  return (g.cover && shots.find(s => s.caption.startsWith(g.cover))) || shots.find(s => s.kind === 'screen') || shots[0];
}

function renderArcade() {
  const list = $('#game-list');
  list.insertAdjacentHTML('beforeend', ARCADE.map(g => {
    const p = byId[g.project];
    const cover = coverOf(g);
    return `<button type="button" data-game="${g.id}" aria-pressed="false" style="--c:${color(p.color)}">
      <span class="thumb" style="background-image:url('${cover?.sm || ''}')"></span>
      <span><span class="kind">${esc(g.kind)}</span><b>${esc(g.title)}</b><span>${esc(g.blurb.split('.')[0])}.</span></span></button>`;
  }).join(''));
  $$('[data-game]', list).forEach(b => b.addEventListener('click', () => selectGame(b.dataset.game)));
  selectGame(ARCADE[0].id, { scroll: false });
}

function gameCover(g) {
  const p = byId[g.project];
  const bg = coverOf(g)?.src || '';
  const touch = matchMedia('(pointer: coarse)').matches;
  return `<div class="screen-cover" style="background-image:url('${bg}')"><div>
    <span class="tag solid" style="--c:${color(p.color)}">${esc(g.kind)}</span>
    <h3>${esc(g.title)}</h3>
    <p>${esc(g.blurb)}</p>
    ${g.desktop && touch ? '<p class="warn">Made for keyboard and mouse: it may not respond to touch.</p>' : ''}
    <button class="btn" type="button" id="start-game" style="--c:${color(p.color)}">${icon('play')}Press start${g.size ? ` · ${g.size}` : ''}</button>
    <p class="insert">INSERT COIN</p>
  </div></div>`;
}

function selectGame(id, { scroll = true, start = false } = {}) {
  const g = ARCADE.find(x => x.id === id);
  if (!g) return;
  cabinet = g;
  const p = byId[g.project];
  $$('[data-game]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.game === id)));
  const screen = $('#screen');
  screen.style.aspectRatio = g.aspect;
  screen.innerHTML = gameCover(g);
  const url = g.src || g.live;
  $('#screen-tools').innerHTML = `
    <small>${esc(g.controls)}</small><span class="spacer"></span>
    <button class="btn sm ghost" type="button" id="game-reload" style="--c:var(--muted)">${icon('reload')}Restart</button>
    <button class="btn sm ghost" type="button" id="game-full" style="--c:var(--cyan)">${icon('expand')}Fullscreen</button>
    <a class="btn sm ghost" href="${url}" target="_blank" rel="noopener" style="--c:var(--volt)">New tab${icon('out')}</a>
    <button class="btn sm ghost" type="button" data-open="${p.id}" style="--c:${color(p.color)}">About ${esc(p.name)}</button>`;
  $('#start-game').addEventListener('click', () => startGame(g));
  $('#game-reload').addEventListener('click', () => startGame(g));
  $('#game-full').addEventListener('click', () => {
    if (!$('#screen iframe')) startGame(g);
    const el = $('#screen');
    (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
  });
  $('[data-open]', $('#screen-tools')).addEventListener('click', () => openDossier(p.id));
  if (scroll) $('#arcade').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
  if (start) startGame(g);
}

function startGame(g) {
  const screen = $('#screen');
  const url = g.src || g.live;
  screen.innerHTML = `<iframe src="${url}" title="${esc(g.title)}" allow="fullscreen; gamepad; autoplay; clipboard-write" allowfullscreen></iframe>
    <div class="booting"><span>LOADING ${esc(g.title.toUpperCase())}…</span></div>`;
  const frame = $('iframe', screen);
  frame.addEventListener('load', () => $('.booting', screen)?.remove(), { once: true });
  fitFrame(frame, screen, g.vw);
  setTimeout(() => frame.focus(), 400);
}

// Desktop-only apps get a virtual width (g.vw): the iframe renders at that width
// and is scaled down to the cabinet, so they keep their full layout.
let fitObserver = null;
function fitFrame(frame, box, vw) {
  fitObserver?.disconnect();
  if (!vw) return;
  const fit = () => {
    if (document.fullscreenElement === box) { frame.style.cssText = ''; return; }
    const k = Math.min(1, box.clientWidth / vw);
    frame.style.cssText = k < 1
      ? `width:${vw}px;height:${box.clientHeight / k}px;transform:scale(${k});transform-origin:0 0`
      : '';
  };
  fitObserver = new ResizeObserver(fit);
  fitObserver.observe(box);
  fit();
}

// ------------------------------------------------------------ build loop

const LOOP = [
  { n: '01', t: 'Direct', d: 'Decide what to build: requirements, UX details and priorities.', c: 'magenta' },
  { n: '02', t: 'Build with AI', d: 'Pair-program with Claude and Codex to implement and debug.', c: 'violet' },
  { n: '03', t: 'Review & test', d: 'Check behaviour, run the tests and catch regressions early.', c: 'cyan' },
  { n: '04', t: 'Understand', d: 'Study the code and architecture until I can own it.', c: 'acid' },
];
function renderLoop() {
  const R = 150, cx = 200, cy = 200;
  const arcs = LOOP.map((s, i) => {
    const a0 = (i / 4) * Math.PI * 2 - Math.PI / 2 + .08, a1 = ((i + 1) / 4) * Math.PI * 2 - Math.PI / 2 - .08;
    const p = a => [cx + R * Math.cos(a), cy + R * Math.sin(a)];
    const [x0, y0] = p(a0), [x1, y1] = p(a1), [lx, ly] = [cx + (R + 34) * Math.cos((a0 + a1) / 2), cy + (R + 34) * Math.sin((a0 + a1) / 2)];
    return `<g class="arc" data-step="${i}" style="--c:${color(s.c)}"><path d="M${x0} ${y0}A${R} ${R} 0 0 1 ${x1} ${y1}" fill="none" stroke="currentColor" stroke-width="10"/>
      <text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle">${s.n}</text></g>`;
  }).join('');
  $('#wheel').innerHTML = `<svg viewBox="0 0 400 400" role="img" aria-label="A four-step loop: direct, build with AI, review and test, understand, repeat">
    <circle cx="200" cy="200" r="150" fill="none" stroke="var(--line)" stroke-width="10"/>${arcs}
    <circle class="runner" r="7" fill="var(--volt)"/></svg>
    <div class="center"><div><b>LEVEL UP</b><span>EVERY FEATURE</span><span>EVERY FIX</span></div></div>`;
  $('#steps').innerHTML = LOOP.map((s, i) => `<button type="button" class="step" data-step="${i}" style="--c:${color(s.c)}"><span class="n">${s.n}</span><span><b>${s.t}</b><span>${s.d}</span></span></button>`).join('');
  let k = 0, timer = 0;
  const runner = $('.runner');
  const set = i => {
    k = i;
    $$('.step').forEach((el, j) => el.classList.toggle('on', j === i));
    $$('#wheel .arc').forEach((el, j) => el.classList.toggle('on', j === i));
    const a = ((i + .5) / 4) * Math.PI * 2 - Math.PI / 2;
    runner.setAttribute('cx', 200 + 150 * Math.cos(a)); runner.setAttribute('cy', 200 + 150 * Math.sin(a));
  };
  set(0);
  const auto = () => { if (!reduced) timer = setInterval(() => set((k + 1) % 4), 2600); };
  $$('.step').forEach(el => el.addEventListener('click', () => { clearInterval(timer); set(+el.dataset.step); }));
  new IntersectionObserver(([e]) => { clearInterval(timer); if (e.isIntersecting) auto(); }).observe($('#wheel'));
}

// ------------------------------------------------------------ toolbox

function renderTools() {
  $('#tools').innerHTML = TOOLBOX.map(row => `<div class="tool-row" style="--row-c:${color(row.color)};--c:${color(row.color)}"><h3>${esc(row.title.toUpperCase())}</h3>
    <div class="chips">${row.items.map(t => `<button type="button" class="chip" aria-pressed="false" data-tool="${esc(t)}">${esc(t)}</button>`).join('')}</div></div>`).join('');
  $$('[data-tool]').forEach(b => b.addEventListener('click', () => {
    const on = b.getAttribute('aria-pressed') !== 'true';
    $$('[data-tool]').forEach(x => x.setAttribute('aria-pressed', 'false'));
    b.setAttribute('aria-pressed', String(on));
    const uses = (TOOL_USES[b.dataset.tool] || []).map(id => byId[id]).filter(Boolean);
    const hint = $('#tool-hint');
    if (!on) { hint.textContent = 'Tap a tool to see which projects use it.'; return; }
    hint.innerHTML = uses.length
      ? `<b>${esc(b.dataset.tool)}</b> shows up in: ${uses.map(p => `<a href="#project/${p.id}" data-open="${p.id}">${esc(p.name)}</a>`).join(' · ')}`
      : `<b>${esc(b.dataset.tool)}</b>: part of my everyday workflow.`;
    $$('[data-open]', hint).forEach(a => a.addEventListener('click', e => { e.preventDefault(); openDossier(a.dataset.open); }));
  }));
}

// ------------------------------------------------------------ timeline

function renderTimeline() {
  $('#timeline').innerHTML = `<ol>${MILESTONES.map(m => `
    <li class="${m.now ? 'now' : ''} ${m.future ? 'future' : ''}" style="--c:${color(m.color)}">
      <span class="dot"></span>
      <div class="txt"><small>${m.date}</small><b>${esc(m.title)}</b><span>${esc(m.sub)}</span>${m.now ? '<br><span class="tag solid here" style="--c:var(--magenta)">You are here</span>' : ''}</div>
    </li>`).join('')}</ol>`;
  const tl = $('#timeline');
  const now = $('.now', tl);
  new IntersectionObserver(([e], obs) => { if (e.isIntersecting) { tl.scrollTo({ left: now.offsetLeft - tl.clientWidth / 2, behavior: reduced ? 'auto' : 'smooth' }); obs.disconnect(); } }).observe(tl);
}

// ------------------------------------------------------------ activity & contact

$$('.activity img').forEach(img => img.addEventListener('error', () => {
  img.replaceWith(Object.assign(document.createElement('p'), { className: 'fallback', textContent: 'GitHub activity is rebuilding. See github.com/SethyPagna.' }));
}));

$('#copy-email').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(PROFILE.email); toast('EMAIL COPIED ✓'); }
  catch { location.href = `mailto:${PROFILE.email}`; }
});

// ------------------------------------------------------------ command palette

const palette = $('#palette');
const input = $('#palette-input');
const listEl = $('#palette-list');
let items = [], sel = 0;

function paletteItems() {
  const sections = $$('#nav a').map(a => ({ label: `Go to ${a.textContent}`, k: 'section', c: 'dim', run: () => $(a.hash).scrollIntoView({ behavior: 'smooth' }) }));
  const projects = PROJECTS.map(p => ({ label: `${p.name}: ${p.tagline}`, k: 'project', c: p.color, run: () => openDossier(p.id) }));
  const games = ARCADE.map(g => ({ label: `Play ${g.title}`, k: 'arcade', c: byId[g.project].color, run: () => selectGame(g.id, { start: true }) }));
  const actions = [
    { label: 'Copy email address', k: 'action', c: 'volt', run: () => $('#copy-email').click() },
    { label: 'Open GitHub profile', k: 'link', c: 'magenta', run: () => open(PROFILE.github, '_blank', 'noopener') },
    { label: 'Open LinkedIn', k: 'link', c: 'cyan', run: () => open(PROFILE.linkedin, '_blank', 'noopener') },
    { label: 'Launch fireworks over the harbour', k: 'fun', c: 'acid', run: () => { scrollTo({ top: 0, behavior: 'smooth' }); celebrate(); } },
    { label: 'Toggle glitch mode', k: 'fun', c: 'violet', run: () => document.body.classList.toggle('glitch-mode') },
  ];
  return [...projects, ...games, ...sections, ...actions];
}

function renderPalette() {
  const q = input.value.trim().toLowerCase();
  items = paletteItems().filter(it => !q || q.split(/\s+/).every(w => it.label.toLowerCase().includes(w) || it.k.includes(w)));
  sel = Math.min(sel, Math.max(0, items.length - 1));
  listEl.innerHTML = items.length
    ? items.slice(0, 40).map((it, i) => `<li role="option" id="pal-${i}" aria-selected="${i === sel}" data-i="${i}" style="--c:${color(it.c)}"><i></i>${esc(it.label)}<span class="k">${it.k}</span></li>`).join('')
    : '<li class="empty">No match. Try “chess”, “play” or “AI”.</li>';
  input.setAttribute('aria-activedescendant', items.length ? `pal-${sel}` : '');
  $$('li[data-i]', listEl).forEach(li => {
    li.addEventListener('click', () => runItem(+li.dataset.i));
    li.addEventListener('pointermove', () => { if (sel !== +li.dataset.i) { sel = +li.dataset.i; renderPalette(); } });
  });
  $(`#pal-${sel}`)?.scrollIntoView({ block: 'nearest' });
}
function runItem(i) { const it = items[i]; if (!it) return; closePalette(); it.run(); }
function openPalette() { palette.hidden = false; palette.classList.add('open'); input.value = ''; sel = 0; renderPalette(); input.focus(); }
function closePalette() { palette.classList.remove('open'); palette.hidden = true; }
$('#open-palette').addEventListener('click', openPalette);
palette.addEventListener('click', e => { if (e.target === palette) closePalette(); });
input.addEventListener('input', () => { sel = 0; renderPalette(); });
input.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); renderPalette(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); renderPalette(); }
  else if (e.key === 'Enter') { e.preventDefault(); runItem(sel); }
});
if (!/Mac|iPhone|iPad/.test(navigator.platform)) $$('kbd').forEach(k => { if (k.textContent === '⌘K') k.textContent = 'Ctrl K'; });

// ------------------------------------------------------------ keys, easter eggs, routing

function celebrate() {
  const c = $('#sky').getBoundingClientRect();
  for (let i = 0; i < 6; i++) setTimeout(() => sky.launch(c.width * (.15 + Math.random() * .7), c.height * (.12 + Math.random() * .3)), i * 260);
}

const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
let konami = 0;
addEventListener('keydown', e => {
  const typing = /INPUT|TEXTAREA/.test(document.activeElement?.tagName);
  if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing && !current)) { e.preventDefault(); palette.hidden ? openPalette() : closePalette(); return; }
  if (e.key === 'Escape') {
    if (!palette.hidden) return closePalette();
    if (!lightbox.hidden) { lightbox.click(); return; }
    if (current) return closeDossier();
  }
  if (current && !typing && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    const order = PROJECTS.map(x => x.id), i = order.indexOf(current);
    openDossier(order[(i + (e.key === 'ArrowLeft' ? -1 : 1) + order.length) % order.length]);
    return;
  }
  konami = e.key === KONAMI[konami] ? konami + 1 : (e.key === KONAMI[0] ? 1 : 0);
  if (konami === KONAMI.length) { konami = 0; document.body.classList.toggle('glitch-mode'); celebrate(); toast('+30 LIVES · GLITCH MODE'); }
});

function route() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (h.startsWith('project/')) openDossier(h.split('/')[1], { push: false });
  else if (h.startsWith('arcade/')) { closeDossier({ restore: false }); selectGame(h.split('/')[1]); history.replaceState(null, '', '#arcade'); }
}
addEventListener('hashchange', route);

// ------------------------------------------------------------ boot

renderBoard();
renderProjects();
renderLab();
renderArcade();
renderLoop();
renderTools();
renderTimeline();
watchReveals(document);
route();
