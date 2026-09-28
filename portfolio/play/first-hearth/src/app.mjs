import { availableActions, dispatch, ending, newGame, readSave, teamStrength, validateContent } from './engine.mjs';
import { evaluateCondition } from './conditions.mjs';
import { persistChronicle, restoreChronicle } from './persistence.mjs';

const app = document.querySelector('#app');
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
let content;
let state;
let location = 'stonebrook';
let tab = 'region';
let selectedHero = 'elias';
let savingBlocked = false;
let storage;
try { storage = window.localStorage; } catch { storage = null; }

function notify(message) {
  document.querySelector('#status').textContent = message;
}

function persist() {
  return persistChronicle(storage, state, { content, blocked: savingBlocked });
}

function restore() {
  const result = restoreChronicle(storage, content);
  savingBlocked = result.blocked;
  notify(result.warning);
  return result.state;
}

function header() {
  const strength = teamStrength(state, content);
  return `<header><div class="brand"><span class="sigil" aria-hidden="true">✧</span><div><p class="eyebrow">Living Kingdom</p><h1>The First Hearth</h1></div></div><div class="player"><span class="stars">★★★★★</span><strong>${escape(state.name)}</strong><small>${state.mode === 'fixed' ? 'Fixed' : 'Carried'} Origin · ${state.tier ? 'Hearth' : 'Seed'}</small></div><div class="header-actions"><button class="secondary" data-ui="export">Export save</button><button class="secondary" data-ui="import">Import</button><button class="secondary" data-ui="new">New chronicle</button></div></header>
    <section class="resource-bar" aria-label="Resources">${Object.entries(state.resources).map(([key, value]) => `<div><span><svg class="ui-icon" aria-hidden="true"><use href="assets/ui/icons.svg#${escape(key)}"></use></svg>${escape(key)}</span><strong>${value}</strong></div>`).join('')}<div class="strength"><span>Regional readiness</span><strong>${strength.total}<small> / ${content.balance.tideStrength} tide</small></strong></div><div class="safety"><span class="safe-dot"></span>Core protected</div></section>
    <nav aria-label="Views">${[['region', 'The region'], ['company', 'Your company'], ['chronicle', 'Chronicle']].map(([id, label]) => `<button data-tab="${id}" class="${tab === id ? 'active' : ''}" aria-pressed="${tab === id}">${label}</button>`).join('')}<span>YEAR 997 · MERIDIAN REACH</span></nav>`;
}

function timeline() {
  const turn = state.turn;
  return `<section class="timeline"><div><p class="eyebrow">${state.ended ? 'Chapter complete' : state.pending ? 'A decision cannot wait' : 'Make each watch matter'}</p><strong>Watch ${Math.min(turn + 1, content.balance.turns)} <span>/ ${content.balance.turns}</span></strong></div><div class="time-track"><div class="track"><i style="width:${turn / content.balance.turns * 100}%"></i></div><div class="milestones"><span>Arrival</span><span class="${turn >= content.balance.stormTurn - 2 && !state.storm ? 'warn' : ''}">Storm · after ${content.balance.stormTurn}</span><span class="${turn >= content.balance.tideTurn - 2 && !state.tide ? 'warn' : ''}">Beast tide · after ${content.balance.tideTurn}</span><span>Hearth · ${content.balance.turns}</span></div></div></section>`;
}

function regionMap() {
  const markers = content.locations.map(site => `<g class="map-node ${site.id === location ? 'selected' : ''}" data-location="${site.id}" tabindex="0" role="button" aria-label="Visit ${escape(site.name)}" transform="translate(${site.x * 7},${site.y * 4.4})"><circle class="halo" r="23"/><circle r="8"/><text y="31" text-anchor="middle">${escape(site.name)}</text></g>`).join('');
  const trees = [[63,86],[115,72],[230,70],[445,69],[563,69],[638,150],[140,201],[472,324],[562,350],[69,248],[278,364],[376,83]].map(([x,y]) => `<path d="M${x} ${y}l-11 23h7l-11 19h30l-11-19h7z"/>`).join('');
  return `<div class="map-frame"><div class="map-caption"><p class="eyebrow">A region with a memory</p><h2>The Meridian Reach</h2><p>Select a place. Only a committed action advances time.</p></div><svg viewBox="0 0 700 440" aria-label="Map of seven locations in the Meridian Reach"><defs><pattern id="grid" width="35" height="35" patternUnits="userSpaceOnUse"><path d="M35 0H0V35" fill="none" stroke="#ffffff" stroke-opacity=".025"/></pattern></defs><rect width="700" height="440" fill="url(#grid)"/><path class="river-bank" d="M275 -20C295 67 237 145 330 184S373 298 324 470"/><path class="river" d="M275 -20C295 67 237 145 330 184S373 298 324 470"/><path class="road" d="M140 136L259 251L448 246L588 330M259 251L154 330M448 246L553 123L371 101L140 136"/><g class="trees">${trees}</g><g class="mountains"><path d="M390 47l23-32 26 32m-10 4 28-40 28 40M577 195l24-34 29 34m-8 3 20-28 20 28"/></g><text x="341" y="388" class="river-label" transform="rotate(-65 341 388)">MERIDIAN RIVER</text>${markers}<g class="compass" transform="translate(632,58)"><path d="M0-17v34M-17 0h34M0-17l-4 10h8z"/><text y="-23" text-anchor="middle">N</text></g></svg><div class="map-legend"><span><i></i> Settlement & frontier</span><span>◇ Your sanctuary</span><span>⋯ Historic routes</span></div></div>`;
}

function objectives() {
  const count = Object.values(state.heroes).filter(hero => hero.recruited).length;
  const items = [[true, 'Begin as your own five-star hero'], [count > 0, 'Invite a companion — or remain independent'], [state.buildings.length > 0 || state.pacts.length > 0, 'Prepare a home or a regional agreement'], [Boolean(state.tide), 'Choose how to face the tide']];
  return `<aside class="guide"><p class="eyebrow">Your first chapter</p><h3>A home worth returning to</h3><p>There is no single correct allegiance. Every person remembers what you chose.</p><ul>${items.map(([done, text]) => `<li class="${done ? 'done' : ''}"><span>${done ? '✓' : '○'}</span>${text}</li>`).join('')}</ul><div class="guide-note"><strong>Keep it small.</strong> Build a shelter, meet someone, then prepare. Watch ${content.balance.stormTurn} brings a storm; watch ${content.balance.tideTurn} brings the tide. The garden supplies food each decision.</div><p class="muted">This is a turn-based mechanics lab. Six short recruitment routes and four encounter openings are playable. Full biographies and future systems are in the design library.</p></aside>`;
}

function previewResources(action) {
  if (action.disabled) return '';
  try {
    const projected = dispatch(state, { key: action.key, location, expectedRevision: state.revision, requestId: `preview_${state.revision}` }, content);
    return Object.keys(state.resources).map(key => ({ key, delta: projected.resources[key] - state.resources[key] })).filter(item => item.delta !== 0).map(item => `${item.delta > 0 ? '+' : '−'}${Math.abs(item.delta)} ${item.key}`).join(' · ') || 'No resource change';
  } catch { return ''; }
}

function actionsPanel() {
  const site = content.locations.find(site => site.id === location);
  const result = ending(state);
  if (result) return `<aside class="decisions ending"><p class="eyebrow">The first chronicle</p><h2>${escape(result.title)}</h2><p>${escape(result.detail)}</p><p>Read your chronicle to see the choices that led here. Try a different route: a lone guardian, a rescue company, or a coalition built on agreements.</p><button data-ui="new">Begin another chronicle</button><button class="secondary" data-ui="export">Keep this history</button></aside>`;
  const title = state.pending === 'storm' ? 'The river breaks its banks' : state.pending === 'tide' ? 'The tide reaches Greyford' : site.name;
  const description = state.pending ? 'Exterior lives and stores are at risk. Your protected Core remains safe. Choose one response; the result will become part of this region’s history.' : site.description;
  const discoveries = state.pending ? [] : content.revelations.filter(reveal => reveal.location === location && !state.resolved.includes(`revelation:${reveal.id}`) && evaluateCondition(reveal.condition, state));
  return `<aside class="decisions ${state.pending ? 'crisis' : ''}"><p class="eyebrow">${state.pending ? 'Regional crisis' : escape(site.kind)}</p><h2>${escape(title)}</h2><p>${escape(description)}</p>${discoveries.map(reveal => `<div class="discovery"><p class="eyebrow">Optional discovery</p><h3>${escape(reveal.title)}</h3><p>${escape(reveal.summary)}</p></div>`).join('')}<p class="action-help">Each choice below uses one watch. Net supplies include garden production and party rations.</p><div class="action-list">${availableActions(state, content, location).map(action => `<button class="action" data-action="${escape(action.key)}" ${action.disabled ? 'disabled' : ''}><strong>${escape(action.title)}</strong><span>${escape(action.detail)}</span><small>${escape(action.disabled || previewResources(action))}</small></button>`).join('')}</div></aside>`;
}

function regionView() {
  return `<main class="region-layout">${objectives()}<section class="map-column">${regionMap()}<div class="recent"><p class="eyebrow">The latest echo</p><p>${escape(state.journal.at(-1))}</p></div><div class="faction-strip">${content.factions.map(faction => `<div><strong>${escape(faction.name)}</strong><span>Favor ${state.favor[faction.id]}${state.pacts.includes(faction.id) ? ' · Agreement signed' : ''}</span></div>`).join('')}</div></section>${actionsPanel()}</main>`;
}

function companyView() {
  const hero = content.heroes.find(hero => hero.id === selectedHero);
  const instance = state.heroes[hero.id];
  const known = !hero.hiddenFlag || state.flags.includes(hero.hiddenFlag);
  const strength = teamStrength(state, content);
  const bonds = Object.entries(state.bonds).filter(([key]) => key.split('|').includes(hero.id));
  return `<main class="company-layout"><section><p class="eyebrow">People, not a rarity collection</p><h2>Your company</h2><p>${state.team.length} / ${content.balance.teamSize} active · ${state.teamSlots} team slots owned · one deployment supported in this lab</p><div class="roster">${content.heroes.map(entry => { const visible = !entry.hiddenFlag || state.flags.includes(entry.hiddenFlag); return `<button class="hero-card ${selectedHero === entry.id ? 'chosen' : ''}" data-hero="${entry.id}"><span class="monogram">${visible ? entry.name.split(' ').map(word => word[0]).join('') : '?'}</span><div><small>${visible ? `${entry.stars} ★ · ${escape(entry.role)}` : 'A story not yet discovered'}</small><strong>${visible ? escape(entry.name) : 'Hidden connection'}</strong><span>${state.heroes[entry.id].recruited ? state.team.includes(entry.id) ? 'In your team' : 'At the sanctuary' : entry.recruitable ? 'Can be recruited' : 'Encounter chapter'}</span></div></button>`; }).join('')}</div></section><section class="hero-detail"><p class="eyebrow">${known ? `${hero.code} · ${hero.stars} stars of potential` : 'A hidden connection'}</p><h2>${known ? escape(hero.name) : 'Follow the evidence'}</h2>${known ? `<p class="hero-role">${escape(hero.role)}</p><p>You meet a ${escape(hero.role.toLowerCase())} at ${escape(content.locations.find(site => site.id === hero.location).name)}. Listen to their account before deciding what it means.</p><blockquote>“${escape(hero.boundary)}”</blockquote><div class="social-stats"><div><span>Trust toward you</span><strong>${instance.relationship}</strong></div><div><span>Loyalty to your company</span><strong>${instance.loyalty}</strong></div></div><p class="muted">Potential changes long-term growth. It is not morality or obedience. Loyalty below 30 excludes a hero from combat readiness. Deeper history is revealed through evidence and choices.</p><h3>${instance.recruited ? 'Assignment' : 'Their next step'}</h3><p>${hero.recruitable ? escape(hero.requirementText) : 'This prototype includes an encounter choice. Full recruitment belongs to the later authored arc.'}</p>${instance.recruited ? `<button data-action="team:${hero.id}" ${state.pending || state.ended ? 'disabled' : ''}>${state.team.includes(hero.id) ? 'Rest in reserve' : 'Assign to team'}</button>` : `<button class="secondary" data-location="${hero.location}">Find them in ${escape(content.locations.find(site => site.id === hero.location).name)}</button>`}<h3>Practical specialty</h3><p>${escape(hero.specialty || "Encounter role; no deployed specialty in this chapter.")}</p><h3>What they remember</h3>${instance.memories.length ? `<ul class="memories">${instance.memories.map(memory => `<li>${escape(memory)}</li>`).join('')}</ul>` : '<p class="muted">No shared memories yet.</p>'}<h3>Shared practice</h3>${bonds.length ? bonds.map(([key, bond]) => `<p class="bond">${key.split('|').map(id => id === 'player' ? escape(state.name) : escape(content.heroes.find(entry => entry.id === id).name)).join(' & ')} <strong>${bond.synergy} / 70</strong><small>Absences: ${Object.values(bond.absences).join(' / ')}; first five free per direction.</small></p>`).join('') : '<p class="muted">Complete training or a successful encounter together to build synergy.</p>'}` : `<p>Survey the Dawn Archive or hold an inquiry at Greyford. Hidden characters are discovered through context, never a random recruitment roll.</p>`}</section><aside class="guide"><p class="eyebrow">Readiness breakdown</p><h3>${strength.total} regional readiness</h3><p>Current party power ${strength.base}<br>Coordination ×${strength.coordination.toFixed(4)}<br>Preparation +${strength.preparation}</p><p>Power includes training and willing active companions. Buildings, a fixed anchor, and aid or passage agreements add preparation.</p><p class="muted">This number resolves abstract encounters. It is not the master plan’s real-time damage formula.</p><h3>Origin</h3><p>${state.tier ? 'Hearth · expanded' : 'Seed · 20 × 20 metres'}<br>Core protected</p><ul>${state.buildings.map(id => `<li>${escape(content.buildings.find(building => building.id === id).name)}</li>`).join('') || '<li>No buildings yet</li>'}</ul></aside></main>`;
}

function chronicleView() {
  return `<main class="chronicle-layout"><section><p class="eyebrow">A history you helped write</p><h2>The first ${content.balance.turns} watches</h2><p>Memories record choices. They do not rewrite what happened before you arrived.</p><ol class="journal">${state.journal.map(entry => `<li>${escape(entry)}</li>`).join('')}</ol></section><aside class="guide"><h3>A thousand years beneath your feet</h3><p>0 · The Meridian Compact unifies the river cities.</p><p>214 · Grain uprisings leave disputed land records.</p><p>371 · The Red Blight changes medicine.</p><p>610 · Greyford becomes a fortified crossing.</p><p>842 · Restoration research hides behind charity.</p><p>973 · The Thornwater evacuation leaves competing accounts.</p><p>997 · Your chronicle begins.</p><a href="docs/world-history.md" target="_blank" rel="noopener">Read the full regional history ↗</a></aside></main>`;
}

function render() {
  const active = document.activeElement;
  const focusAttribute = ['data-action', 'data-location', 'data-tab', 'data-hero', 'data-ui'].find(attribute => app.contains(active) && active.hasAttribute(attribute));
  const focusValue = focusAttribute ? active.getAttribute(focusAttribute) : null;
  const introduction = state.turn < 3 && tab === 'region' ? '<section class="intro-bar"><strong>Your home is safe.</strong> Meet one person, or select Origin Space to build. Browsing the map costs no time. Action previews show the cost; discoveries can wait.</section>' : '';
  app.innerHTML = `${header()}${timeline()}${introduction}${tab === 'region' ? regionView() : tab === 'company' ? companyView() : chronicleView()}<footer><span>LIVING KINGDOM · MECHANICS LAB 0.1 · P001</span><span>Original stories · Local play · No account or online AI required</span></footer>`;
  if (focusAttribute) {
    const replacement = app.querySelector(`[${focusAttribute}="${CSS.escape(focusValue)}"]:not(:disabled)`);
    const target = replacement || app.querySelector('.decisions h2, main h2');
    if (target) { if (!replacement) target.tabIndex = -1; target.focus({ preventScroll: true }); }
  }
}

function exportSave() {
  const url = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `living-kingdom-watch-${state.turn}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify('Save exported. Keep this file to preserve this chronicle.');
}

app.addEventListener('click', event => {
  const button = event.target.closest('[data-action],[data-location],[data-tab],[data-hero],[data-ui]');
  if (!button) return;
  if (button.dataset.action) {
    try {
      state = dispatch(state, { key: button.dataset.action, location, requestId: crypto.randomUUID(), expectedRevision: state.revision }, content);
      const saveWarning = persist(); render(); notify(saveWarning || (state.pending ? `A ${state.pending === 'storm' ? 'storm' : 'beast tide'} needs your response.` : `Decision recorded. ${state.turn} of ${content.balance.turns} watches completed.`));
    } catch (error) { notify(error.message); }
  } else if (button.dataset.location) { location = button.dataset.location; tab = 'region'; render(); }
  else if (button.dataset.tab) { tab = button.dataset.tab; render(); }
  else if (button.dataset.hero) { selectedHero = button.dataset.hero; render(); }
  else if (button.dataset.ui === 'export') exportSave();
  else if (button.dataset.ui === 'import') document.querySelector('#import-save').click();
  else if (button.dataset.ui === 'new') document.querySelector('#new-game').showModal();
});

app.addEventListener('keydown', event => {
  if (event.target.matches('.map-node') && ['Enter', ' '].includes(event.key)) { event.preventDefault(); event.target.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
});

document.querySelector('#cancel-new').addEventListener('click', () => document.querySelector('#new-game').close());
document.querySelector('#new-form').addEventListener('submit', event => {
  event.preventDefault();
  const fields = new FormData(event.target);
  state = newGame(content, { name: fields.get('name'), mode: fields.get('mode') });
  location = 'stonebrook'; tab = 'region'; savingBlocked = false; const saveWarning = persist(); render();
  document.querySelector('#new-game').close(); notify(saveWarning || 'A new chronicle begins. Meet a companion or build your first shelter.');
});
document.querySelector('#import-save').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  try { if (file.size > 1000000) throw new Error('Save is too large'); state = readSave(await file.text(), content); savingBlocked = false; const saveWarning = persist(); render(); notify(saveWarning || 'Chronicle restored.'); }
  catch (error) { notify(`Import rejected: ${error.message}. Current chronicle unchanged.`); }
  event.target.value = '';
});

try {
  const responses = await Promise.all(['data/content.json', 'data/revelations.json'].map(url => fetch(url)));
  if (responses.some(response => !response.ok)) throw new Error('Content could not be loaded');
  const [definitions, revelations] = await Promise.all(responses.map(response => response.json()));
  content = validateContent({ ...definitions, revelations });
  state = restore(); render();
} catch (error) { app.innerHTML = `<main><h1>The chronicle could not open</h1><p>${escape(error.message)}</p><p>Launch with PLAY.cmd so the content files can be loaded locally.</p></main>`; }
