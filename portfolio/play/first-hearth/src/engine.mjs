import { evaluateCondition } from './conditions.mjs';
export { validateContent } from './content-validation.mjs';

const RESOURCE_KEYS = ['food', 'wood', 'stone', 'silver'];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const pairKey = (a, b) => [a, b].sort().join('|');

function validateResources(resources) {
  if (!resources || typeof resources !== 'object') throw new Error('Invalid resources');
  for (const [key, value] of Object.entries(resources)) {
    if (!RESOURCE_KEYS.includes(key) || !Number.isSafeInteger(value) || value < 0 || value > 1000000) throw new Error(`Invalid resource ${key}`);
  }
}

function teamPerk(state, content, channel, initial = 0) {
  return content.heroes.filter(hero => state.team.includes(hero.id) && state.heroes[hero.id].loyalty >= 30)
    .reduce((total, hero) => initial === 1 ? total * (hero.perks?.[channel] ?? 1) : total + (hero.perks?.[channel] ?? 0), initial);
}

export function newGame(content, options = {}) {
  const name = String(options.name || 'Alex Vale').trim().slice(0, 40) || 'Alex Vale';
  const mode = options.mode === 'mobile' ? 'mobile' : 'fixed';
  return {
    schema: 1, balance: content.version, revision: 0, turn: 0, name, mode,
    resources: { ...content.balance.initialResources }, tier: 0,
    team: ['player'], teamSlots: content.balance.teamSlots, training: 0,
    heroes: Object.fromEntries(content.heroes.map(hero => [hero.id, { relationship: 0, loyalty: 50, recruited: false, memories: [] }])),
    buildings: [], flags: [], resolved: [], pacts: [], favor: { council: 0, academy: 0, compact: 0 },
    stocks: Object.fromEntries(content.locations.map(location => [location.id, location.stock])),
    explored: [], bonds: {}, pending: null, storm: null, tide: null, ended: false,
    journal: ['Year 997. Your five-star hero awakens in a protected Origin Space.'], processed: {}
  };
}

export function teamStrength(state, content) {
  const willing = state.team.filter(id => id === 'player' || state.heroes[id].loyalty >= 30);
  const base = content.balance.playerPower + state.training + willing.filter(id => id !== 'player').reduce((sum, id) => sum + content.heroes.find(hero => hero.id === id).power, 0);
  const pairs = [];
  for (let i = 0; i < willing.length; i++) for (let j = i + 1; j < willing.length; j++) pairs.push(state.bonds[pairKey(willing[i], willing[j])]?.synergy || 0);
  const mean = pairs.length ? pairs.reduce((sum, score) => sum + score, 0) / pairs.length : 0;
  const coordination = 1 + mean * 0.0012;
  const preparation = content.buildings.filter(building => state.buildings.includes(building.id)).reduce((sum, building) => sum + building.defense, 0)
    + (state.mode === 'fixed' ? 8 : 0) + state.pacts.filter(id => ['council', 'compact'].includes(id)).length * 8;
  return { base, coordination, preparation, total: Math.round(base * coordination + preparation), willing };
}

function affordable(state, cost) {
  return Object.entries(cost).every(([key, amount]) => state.resources[key] >= amount);
}

function action(state, details) {
  const cost = details.cost || {};
  const missing = Object.entries(cost).filter(([key, amount]) => amount > state.resources[key]).map(([key, amount]) => `${amount - state.resources[key]} ${key}`).join(', ');
  return { ...details, cost, disabled: details.disabled || (affordable(state, cost) ? '' : `Not enough supplies: need ${missing} more`) };
}

export function availableActions(state, content, location) {
  if (state.ended) return [];
  if (state.pending) return eventActions(state, content);
  if (!content.locations.some(site => site.id === location)) return [];
  const actions = [];
  for (const reveal of content.revelations || []) {
    if (reveal.location !== location || state.resolved.includes(`revelation:${reveal.id}`) || !evaluateCondition(reveal.condition, state)) continue;
    for (const choice of reveal.choices) actions.push(action(state, { key: `revelation:${reveal.id}:${choice.id}`, title: `Discovery: ${choice.label}`, detail: choice.detail, cost: choice.cost, revelation: reveal.id }));
  }
  if (location === 'origin') {
    actions.push(action(state, { key: 'train', title: 'Practice together', detail: `+${content.balance.trainingGain} trained power (cap ${content.balance.maxTraining}); +1 pair synergy.`, cost: { food: 2 }, disabled: state.training >= content.balance.maxTraining ? 'Training limit reached' : '' }));
    for (const building of content.buildings) if (!state.buildings.includes(building.id)) actions.push(action(state, { key: `build:${building.id}`, title: `Build ${building.name}`, detail: building.description, cost: { ...building.cost, wood: Math.ceil(building.cost.wood * teamPerk(state, content, 'buildWoodFactor', 1)) } }));
    if (state.tier === 0) actions.push(action(state, { key: 'upgrade', title: 'Expand to Hearth', detail: 'Expand your sanctuary and complete a home milestone. This does not require sovereignty.', cost: content.balance.upgradeCost }));
    actions.push(action(state, { key: 'rest', title: 'Tend the camp', detail: 'Gain 5 food; a safe fallback when resources run low.' }));
  } else {
    actions.push(action(state, { key: `gather:${location}`, title: 'Gather a supply cache', detail: `Gain ${(state.mode === 'mobile' ? 7 : 5) + teamPerk(state, content, 'cacheFood')} food, ${state.buildings.includes('workshop') ? 14 : 10} wood, ${state.buildings.includes('workshop') ? 9 : 7} stone and 2 silver. ${state.stocks[location]} caches remain.`, disabled: state.stocks[location] ? '' : 'Local caches exhausted' }));
    if (!state.explored.includes(location)) actions.push(action(state, { key: `explore:${location}`, title: 'Survey the old routes', detail: location === 'archive' ? 'Recover archive evidence and 5 silver. Reveals Mira.' : 'Gain 5 silver and record this location in your history.' }));
    if (location === 'thornwater') {
      const strength = teamStrength(state, content);
      actions.push(action(state, { key: 'hunt', title: 'Clear a migrating beast pack', detail: strength.total >= 30 ? 'Prepared strength ≥30: gain 12 silver, 4 food and shared practice.' : 'Underprepared: retreat, lose up to 6 wood. Train or recruit first.', cost: { food: 3 }, disabled: state.flags.filter(flag => flag.startsWith('hunt_')).length >= 3 ? 'Three packs already redirected' : '' }));
    }
    for (const hero of content.heroes.filter(hero => hero.location === location && (!hero.hiddenFlag || state.flags.includes(hero.hiddenFlag)))) {
      if (!state.resolved.includes(`story:${hero.id}`)) for (const choice of hero.choices) actions.push(action(state, { key: `story:${hero.id}:${choice.id}`, title: `${hero.name}: ${choice.label}`, detail: choice.text, cost: choice.cost, hero: hero.id }));
      if (hero.recovery && state.resolved.includes(`story:${hero.id}`) && !state.resolved.includes(`recovery:${hero.id}`) && (!state.flags.includes(hero.requirement) || state.heroes[hero.id].relationship < hero.threshold)) actions.push(action(state, { key: `recovery:${hero.id}`, title: `${hero.name}: ${hero.recovery.label}`, detail: hero.recovery.detail, cost: hero.recovery.cost, hero: hero.id }));
      if (hero.recruitable && !state.heroes[hero.id].recruited) actions.push(action(state, { key: `recruit:${hero.id}`, title: `Invite ${hero.name}`, detail: hero.requirementText, hero: hero.id, disabled: state.heroes[hero.id].relationship < hero.threshold ? `Needs trust ${hero.threshold}` : !state.flags.includes(hero.requirement) ? 'Personal requirement unresolved' : '' }));
    }
  }
  if (location === 'greyford' || location === 'stonebrook' || location === 'archive') {
    const faction = content.factions.find(faction => faction.id === ({ greyford: 'compact', stonebrook: 'council', archive: 'academy' })[location]);
    if (!state.pacts.includes(faction.id)) actions.push(action(state, { key: `pact:${faction.id}`, title: `Agree: ${faction.pact}`, detail: faction.benefit, cost: { silver: 10 }, disabled: state.favor[faction.id] < -5 ? 'Favor must be at least −5' : '' }));
  }
  return actions;
}

function eventActions(state, content) {
  if (state.pending === 'storm') return [
    action(state, { key: 'storm:rescue', title: 'Shelter the stranded families', detail: `Council +10; deployed companions remember a rescue (+${7 + teamPerk(state, content, 'rescueTrust')} trust, +10 loyalty).`, cost: state.buildings.includes('shelter') ? {} : { food: 8 } }),
    action(state, { key: 'storm:reinforce', title: 'Reinforce the public granary', detail: 'Council +8; preserve regional supplies and gain 12 food.', cost: { wood: 12 } }),
    action(state, { key: 'storm:withdraw', title: 'Keep everyone inside your Core', detail: 'Your sanctuary remains intact. The exterior granary is lost; Council −5. Owen questions the decision.' })
  ];
  const strength = teamStrength(state, content);
  return [
    action(state, { key: 'tide:defend', title: 'Defend the crossing', detail: `Strength ${strength.total} versus ${content.balance.tideStrength}. ${strength.total >= content.balance.tideStrength ? 'Hold the crossing; gain 20 silver.' : 'The line will fail; retreat safely, Council −8.'}` }),
    action(state, { key: 'tide:evacuate', title: 'Evacuate through the reed routes', detail: 'Save the population; concede exposed stores. A viable peaceful outcome.', cost: { food: Math.ceil(8 * teamPerk(state, content, 'evacuationFoodFactor', 1)) } }),
    action(state, { key: 'tide:divert', title: 'Coordinate a diversion', detail: 'Use an aid or passage pact to save people and stores.', cost: { wood: 8 }, disabled: state.pacts.some(id => ['council', 'compact'].includes(id)) ? '' : 'Needs mutual aid or emergency passage' }),
    action(state, { key: 'tide:withdraw', title: 'Remain in your sanctuary', detail: 'Keep the protected Core. The crossing falls; Council −10, deployed loyalty −10.' })
  ];
}

function changeResources(state, changes, sign = 1) {
  for (const [key, amount] of Object.entries(changes || {})) state.resources[key] = Math.max(0, state.resources[key] + sign * amount);
}

function remember(state, id, text) {
  const memories = state.heroes[id].memories;
  memories.push(text);
  if (memories.length > 30) memories.shift();
}

function changeRelationship(state, id, relationship, loyalty) {
  const hero = state.heroes[id];
  hero.relationship = clamp(hero.relationship + relationship, -100, 100);
  hero.loyalty = clamp(hero.loyalty + loyalty, 0, 100);
}

function sharedActivity(state) {
  const roster = ['player', ...Object.keys(state.heroes).filter(id => state.heroes[id].recruited)];
  for (let i = 0; i < roster.length; i++) for (let j = i + 1; j < roster.length; j++) {
    const a = roster[i], b = roster[j];
    const bond = state.bonds[pairKey(a, b)] ||= { synergy: 0, floor: 0, absences: { [a]: 0, [b]: 0 } };
    if (state.team.includes(a) && state.team.includes(b)) {
      bond.synergy = Math.min(70, bond.synergy + 1);
      if (bond.synergy >= 20) bond.floor = 20;
      bond.absences[a] = 0; bond.absences[b] = 0;
    } else if (state.team.includes(a) !== state.team.includes(b)) {
      const present = state.team.includes(a) ? a : b;
      bond.absences[present] += 1;
      if (bond.absences[present] > 5) bond.synergy = Math.max(bond.floor, bond.synergy - 1);
    }
  }
}

function resolveStory(state, parts, content) {
  const hero = content.heroes.find(hero => hero.id === parts[1]);
  const choice = hero.choices.find(choice => choice.id === parts[2]);
  changeResources(state, choice.gain);
  changeRelationship(state, hero.id, choice.relationship, choice.loyalty);
  remember(state, hero.id, choice.memory);
  if (choice.faction) state.favor[choice.faction] = clamp(state.favor[choice.faction] + choice.favor, -100, 100);
  if (!state.flags.includes(choice.flag)) state.flags.push(choice.flag);
  state.resolved.push(`story:${hero.id}`);
  state.journal.push(`${hero.name}: “${choice.memory}”`);
}

function resolveCrisis(state, parts, content) {
  const [event, choice] = parts;
  state[event] = choice;
  state.pending = null;
  if (event === 'storm') {
    if (choice === 'rescue') {
      state.favor.council += 10;
      for (const id of state.team.filter(id => id !== 'player')) { changeRelationship(state, id, 7 + teamPerk(state, content, 'rescueTrust'), 10); remember(state, id, 'You opened the sanctuary during the storm.'); }
    }
    if (choice === 'reinforce') { state.favor.council += 8; changeResources(state, { food: 12 }); }
    if (choice === 'withdraw') { state.favor.council -= 5; if (state.heroes.owen.recruited) { changeRelationship(state, 'owen', -8, -12); remember(state, 'owen', 'We had shelter while families were still outside.'); } }
  } else {
    if (choice === 'defend') {
      const success = teamStrength(state, content).total >= content.balance.tideStrength;
      state.tide = success ? 'held' : 'retreated';
      state.favor.council += success ? 15 : -8;
      if (success) { changeResources(state, { silver: 20 }); sharedActivity(state); }
    }
    if (choice === 'evacuate' || choice === 'divert') state.favor.council += 10;
    if (choice === 'withdraw') { state.favor.council -= 10; for (const id of state.team.filter(id => id !== 'player')) changeRelationship(state, id, -5, -10); }
  }
  state.favor.council = clamp(state.favor.council, -100, 100);
  state.journal.push(`${event === 'storm' ? 'Storm' : 'Beast tide'} resolved: ${state[event]}. The protected Core is intact.`);
}

function resolveRevelation(state, parts, content) {
  const reveal = content.revelations.find(reveal => reveal.id === parts[1]);
  const choice = reveal.choices.find(choice => choice.id === parts[2]);
  state.resolved.push(`revelation:${reveal.id}`);
  if (!state.flags.includes(choice.flag)) state.flags.push(choice.flag);
  if (choice.relationship) changeRelationship(state, choice.relationship.id, choice.relationship.delta, 0);
  if (choice.favor) state.favor[choice.favor.id] = clamp(state.favor[choice.favor.id] + choice.favor.delta, -100, 100);
  remember(state, choice.memory.hero, choice.memory.text);
  state.journal.push(`${reveal.title}: ${reveal.summary}`);
  state.journal.push(`Your response: ${choice.label}. ${choice.memory.text}`);
}

function resolveAction(state, key, content) {
  const parts = key.split(':');
  const handlers = {
    train: () => { state.training = Math.min(content.balance.maxTraining, state.training + content.balance.trainingGain); sharedActivity(state); },
    build: () => state.buildings.push(parts[1]),
    upgrade: () => { state.tier = 1; },
    rest: () => changeResources(state, { food: 5 }),
    gather: () => { state.stocks[parts[1]] -= 1; changeResources(state, { food: (state.mode === 'mobile' ? 7 : 5) + teamPerk(state, content, 'cacheFood'), wood: state.buildings.includes('workshop') ? 14 : 10, stone: state.buildings.includes('workshop') ? 9 : 7, silver: 2 }); },
    explore: () => { state.explored.push(parts[1]); changeResources(state, { silver: 5 }); if (parts[1] === 'archive' && !state.flags.includes('evidence')) state.flags.push('evidence'); },
    story: () => resolveStory(state, parts, content),
    revelation: () => resolveRevelation(state, parts, content),
    recovery: () => {
      const recovery = content.heroes.find(hero => hero.id === parts[1]).recovery;
      if (!state.flags.includes(recovery.flag)) state.flags.push(recovery.flag);
      state.resolved.push(`recovery:${parts[1]}`);
      changeRelationship(state, parts[1], recovery.relationship, recovery.loyalty);
      remember(state, parts[1], recovery.memory);
      state.journal.push(`A later action repaired trust without erasing the earlier choice: ${recovery.memory}`);
    },
    recruit: () => { state.heroes[parts[1]].recruited = true; if (state.team.length < content.balance.teamSize) state.team.push(parts[1]); remember(state, parts[1], 'I chose to join your company.'); },
    pact: () => { state.pacts.push(parts[1]); state.favor[parts[1]] = clamp(state.favor[parts[1]] + 5, -100, 100); if (parts[1] === 'academy' && !state.flags.includes('evidence')) state.flags.push('evidence'); },
    hunt: () => { const count = state.flags.filter(flag => flag.startsWith('hunt_')).length; state.flags.push(`hunt_${count + 1}`); if (teamStrength(state, content).total >= 30) { changeResources(state, { silver: 12, food: 4 }); sharedActivity(state); } else changeResources(state, { wood: 6 }, -1); },
    storm: () => resolveCrisis(state, parts, content),
    tide: () => resolveCrisis(state, parts, content)
  };
  handlers[parts[0]]();
}

function finishTurn(state, content) {
  state.turn += 1;
  const consumption = 1 + Math.floor(state.team.length / 3);
  if (state.buildings.includes('farm')) changeResources(state, { food: 4 + teamPerk(state, content, 'gardenFood') });
  changeResources(state, { food: consumption }, -1);
  if (state.resources.food === 0) state.journal.push('Food depleted. Nobody dies in the protected Core; gather or tend camp.');
  if (state.turn === content.balance.stormTurn && !state.storm) { state.pending = 'storm'; state.journal.push('The river has broken its banks. Resolve the storm before other actions.'); }
  if (state.turn === content.balance.tideTurn && !state.tide) { state.pending = 'tide'; state.journal.push('A beast tide reaches Greyford. Choose defense, evacuation, diversion or withdrawal.'); }
  if (state.turn >= content.balance.turns && !state.pending) state.ended = true;
}

/** Apply one validated intent without mutating the input snapshot. */
export function dispatch(current, command, content) {
  if (!command || typeof command.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(command.requestId) || ['__proto__', 'constructor', 'prototype'].includes(command.requestId)) throw new Error('Invalid action identity');
  if (typeof command.key !== 'string' || command.key.length > 180) throw new Error('Invalid action key');
  const payload = JSON.stringify([command.key, command.location || null]);
  if (Object.hasOwn(current.processed, command.requestId)) {
    if (current.processed[command.requestId] !== payload) throw new Error('Action identity reused for a different intent');
    return current;
  }
  if (current.revision !== command.expectedRevision) throw new Error('State changed; review the updated action');
  if (current.ended) throw new Error('This chapter is complete. Start another chronicle to experiment.');
  if (Object.keys(current.processed).length >= 1000) throw new Error('Session command limit reached; start a new chronicle.');
  const state = structuredClone(current);
  if (command.key.startsWith('team:')) {
    if (state.pending) throw new Error('Team locked while a crisis awaits resolution');
    const id = command.key.slice(5);
    if (!state.heroes[id]?.recruited) throw new Error('Only recruited companions can be assigned');
    if (state.team.includes(id)) state.team = state.team.filter(member => member !== id);
    else { if (state.team.length >= content.balance.teamSize) throw new Error('Team is full: reserve a companion first'); state.team.push(id); }
  } else {
    const selected = availableActions(state, content, command.location).find(action => action.key === command.key);
    if (!selected || selected.disabled) throw new Error(selected?.disabled || 'Action is unavailable');
    changeResources(state, selected.cost, -1);
    state.journal.push(`Action ${state.turn + 1}: ${selected.title}.`);
    resolveAction(state, command.key, content);
    finishTurn(state, content);
  }
  state.revision += 1;
  state.processed[command.requestId] = payload;
  readSave(JSON.stringify(state), content);
  return state;
}

/** Reject incompatible or malformed saves before they reach the game UI. */
export function readSave(text, content) {
  if (typeof text !== 'string' || text.length > 1000000) throw new Error('Save is too large');
  const state = JSON.parse(text);
  const template = newGame(content);
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('Invalid save');
  if (Object.keys(template).some(key => !Object.hasOwn(state, key)) || Object.keys(state).some(key => !Object.hasOwn(template, key))) throw new Error('Unexpected save fields');
  if (state.schema !== 1 || state.balance !== content.version) throw new Error('Save version is incompatible; keep the original file');
  const integer = (value, max) => Number.isSafeInteger(value) && value >= 0 && value <= max;
  if (!integer(state.turn, content.balance.turns) || !integer(state.revision, 1000) || !integer(state.training, content.balance.maxTraining) || !integer(state.tier, 1)) throw new Error('Invalid progress');
  if (typeof state.name !== 'string' || !state.name.trim() || state.name.length > 40 || !['fixed', 'mobile'].includes(state.mode) || state.teamSlots !== 3) throw new Error('Invalid player');
  validateResources(state.resources);
  if (RESOURCE_KEYS.some(key => !Object.hasOwn(state.resources, key))) throw new Error('Missing resource');
  for (const field of ['team', 'buildings', 'flags', 'resolved', 'pacts', 'explored', 'journal']) {
    if (!Array.isArray(state[field]) || state[field].length > 300 || state[field].some(item => typeof item !== 'string' || item.length > 1000)) throw new Error(`Invalid ${field}`);
    if (field !== 'journal' && new Set(state[field]).size !== state[field].length) throw new Error(`Duplicate ${field}`);
  }
  const allowedFlags = new Set(['evidence', 'hunt_1', 'hunt_2', 'hunt_3']);
  const allowedCompletions = new Set();
  for (const hero of content.heroes) {
    allowedCompletions.add(`story:${hero.id}`);
    for (const choice of hero.choices) allowedFlags.add(choice.flag);
    if (hero.recovery) { allowedFlags.add(hero.recovery.flag); allowedCompletions.add(`recovery:${hero.id}`); }
  }
  for (const reveal of content.revelations || []) {
    allowedCompletions.add(`revelation:${reveal.id}`);
    for (const choice of reveal.choices) allowedFlags.add(choice.flag);
  }
  if (state.flags.some(flag => !allowedFlags.has(flag)) || state.resolved.some(key => !allowedCompletions.has(key))) throw new Error('Unknown story fact or completion');
  const heroIds = content.heroes.map(hero => hero.id);
  if (!state.heroes || Object.keys(state.heroes).length !== heroIds.length || Object.keys(state.heroes).some(id => !heroIds.includes(id))) throw new Error('Invalid roster');
  for (const id of heroIds) {
    const hero = state.heroes[id];
    if (!hero || !Number.isSafeInteger(hero.relationship) || Math.abs(hero.relationship) > 100 || !integer(hero.loyalty, 100) || typeof hero.recruited !== 'boolean' || !Array.isArray(hero.memories) || hero.memories.length > 30 || hero.memories.some(item => typeof item !== 'string' || item.length > 1000)) throw new Error('Invalid companion');
    if (hero.recruited && !content.heroes.find(hero => hero.id === id).recruitable) throw new Error('Unavailable recruit');
  }
  if (state.team[0] !== 'player' || state.team.length > 5 || state.team.slice(1).some(id => !state.heroes[id]?.recruited)) throw new Error('Invalid team');
  for (const [field, group] of [['buildings', 'buildings'], ['pacts', 'factions'], ['explored', 'locations']]) if (state[field].some(id => !content[group].some(entry => entry.id === id))) throw new Error(`Unknown ${field}`);
  if (!state.stocks || Object.keys(state.stocks).length !== content.locations.length || content.locations.some(site => !integer(state.stocks[site.id], site.stock))) throw new Error('Invalid node stocks');
  if (!state.favor || Object.keys(state.favor).length !== content.factions.length || content.factions.some(faction => !Number.isSafeInteger(state.favor[faction.id]) || Math.abs(state.favor[faction.id]) > 100)) throw new Error('Invalid faction favor');
  if (!state.bonds || typeof state.bonds !== 'object' || Array.isArray(state.bonds)) throw new Error('Invalid bonds');
  for (const [key, bond] of Object.entries(state.bonds)) {
    const pair = key.split('|');
    if (pair.length !== 2 || pair[0] === pair[1] || pairKey(...pair) !== key || pair.some(id => id !== 'player' && !heroIds.includes(id)) || !bond || !integer(bond.synergy, 70) || ![0, 20].includes(bond.floor) || bond.synergy < bond.floor || !bond.absences || Object.keys(bond.absences).length !== 2 || pair.some(id => !integer(bond.absences[id], 1000))) throw new Error('Invalid bond');
  }
  if (![null, 'storm', 'tide'].includes(state.pending) || ![null, 'rescue', 'reinforce', 'withdraw'].includes(state.storm) || ![null, 'held', 'retreated', 'evacuate', 'divert', 'withdraw'].includes(state.tide) || typeof state.ended !== 'boolean') throw new Error('Invalid event state');
  if (state.ended !== (state.turn === content.balance.turns && state.pending === null)) throw new Error('Inconsistent ending');
  if ((state.turn < content.balance.stormTurn && (state.storm || state.pending === 'storm')) || (state.turn > content.balance.stormTurn && !state.storm) || (state.turn === content.balance.stormTurn && state.pending !== 'storm')) throw new Error('Inconsistent storm');
  if ((state.turn < content.balance.tideTurn && (state.tide || state.pending === 'tide')) || (state.turn > content.balance.tideTurn && !state.tide) || (state.turn === content.balance.tideTurn && state.pending !== 'tide')) throw new Error('Inconsistent tide');
  if (!state.processed || typeof state.processed !== 'object' || Array.isArray(state.processed) || Object.keys(state.processed).length !== state.revision || Object.entries(state.processed).some(([id, value]) => !/^[a-zA-Z0-9_-]{1,80}$/.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id) || typeof value !== 'string' || value.length > 250)) throw new Error('Invalid action ledger');
  return state;
}

export function ending(state) {
  if (!state.ended) return null;
  const outcomes = { held: 'The crossing holds', evacuate: 'A people saved, a home to rebuild', divert: 'A coalition outlasts the tide', retreated: 'A retreat worth learning from', withdraw: 'A sanctuary in a broken region' };
  const companions = Object.values(state.heroes).filter(hero => hero.recruited).length;
  return { title: outcomes[state.tide] || 'The first chronicle closes', detail: `Your Core remains protected. Companions who chose to join: ${companions}. Regional agreements: ${state.pacts.length}. ${state.tier ? 'Your Origin has grown into a Hearth.' : 'Your small Origin is still yours to shape.'}` };
}
