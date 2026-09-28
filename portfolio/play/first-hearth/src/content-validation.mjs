import { validateCondition } from './conditions.mjs';

const RESOURCE_KEYS = ['food', 'wood', 'stone', 'silver'];
const ID_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const FORBIDDEN_IDS = new Set(['constructor', 'prototype', '__proto__', 'player']);
const MAX_RESOURCE = 1000000;
const FIXED_IDS = {
  locations: ['origin', 'stonebrook', 'reedcamp', 'greyford', 'archive', 'thornwater', 'capital'],
  buildings: ['shelter', 'farm', 'workshop', 'watchtower'],
  factions: ['council', 'academy', 'compact'],
  heroes: ['elias', 'mara', 'owen', 'tessa', 'arin', 'mira', 'kael', 'seren', 'rowan', 'evelyn']
};

function fail(path, message) {
  throw new TypeError(`${path}: ${message}`);
}

function record(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'expected a plain object');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(path, 'unexpected object prototype');
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail(path, 'expected enumerable data fields');
  }
}

function fields(value, specification, path) {
  record(value, path);
  const { required, optional = [] } = specification;
  for (const key of required) if (!Object.hasOwn(value, key)) fail(path, `missing ${key}`);
  for (const key of Object.keys(value)) if (!required.includes(key) && !optional.includes(key)) fail(path, `unknown field ${key}`);
}

function number(value, range, path) {
  const { min, max, integer = true } = range;
  if (!Number.isFinite(value) || (integer && !Number.isSafeInteger(value)) || value < min || value > max) fail(path, `expected ${integer ? 'integer' : 'number'} in ${min}..${max}`);
}

function text(value, path) {
  if (typeof value !== 'string' || !value.trim() || value.length > 1000) fail(path, 'expected 1..1000 characters');
}

function identifier(value, path) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value) || FORBIDDEN_IDS.has(value)) fail(path, 'invalid identifier');
}

function reference(value, ids, path) {
  identifier(value, path);
  if (!ids.has(value)) fail(path, `unknown reference ${value}`);
}

function resources(value, path) {
  fields(value, { required: [], optional: RESOURCE_KEYS }, path);
  for (const [key, amount] of Object.entries(value)) number(amount, { min: 0, max: MAX_RESOURCE }, `${path}.${key}`);
}

function entries(value, limits, path) {
  if (!Array.isArray(value) || value.length < limits.min || value.length > limits.max) fail(path, 'invalid collection size');
  const ids = new Set();
  for (let index = 0; index < value.length; index++) {
    record(value[index], `${path}[${index}]`);
    identifier(value[index].id, `${path}[${index}].id`);
    if (ids.has(value[index].id)) fail(path, `duplicate ID ${value[index].id}`);
    ids.add(value[index].id);
  }
  return ids;
}

function validateBalance(balance) {
  const numeric = ['turns', 'stormTurn', 'tideTurn', 'tideStrength', 'playerPower', 'maxTraining', 'trainingGain', 'teamSize', 'teamSlots'];
  fields(balance, { required: [...numeric, 'initialResources', 'upgradeCost'] }, 'balance');
  for (const key of numeric) number(balance[key], { min: 1, max: 10000 }, `balance.${key}`);
  number(balance.turns, { min: 4, max: 100 }, 'balance.turns');
  if (balance.stormTurn + 2 > balance.tideTurn || balance.tideTurn + 1 > balance.turns) fail('balance', 'hazards need ordered turns and separate response actions');
  if (balance.trainingGain > balance.maxTraining) fail('balance', 'training gain exceeds cap');
  if (balance.teamSize !== 5 || balance.teamSlots !== 3) fail('balance', 'prototype requires team size 5 and three owned slots');
  resources(balance.initialResources, 'balance.initialResources');
  if (RESOURCE_KEYS.some(key => !Object.hasOwn(balance.initialResources, key))) fail('balance.initialResources', 'all resource balances are required');
  resources(balance.upgradeCost, 'balance.upgradeCost');
}

function validateStoryChoice(choice, context) {
  const path = `story:${context.heroId}:${choice.id}`;
  fields(choice, { required: ['id', 'label', 'text', 'cost', 'relationship', 'loyalty', 'flag', 'memory'], optional: ['gain', 'faction', 'favor'] }, path);
  for (const key of ['label', 'text', 'memory']) text(choice[key], `${path}.${key}`);
  resources(choice.cost, `${path}.cost`);
  if (Object.hasOwn(choice, 'gain')) resources(choice.gain, `${path}.gain`);
  for (const key of ['relationship', 'loyalty']) number(choice[key], { min: -100, max: 100 }, `${path}.${key}`);
  identifier(choice.flag, `${path}.flag`);
  context.flags.add(choice.flag);
  if (Object.hasOwn(choice, 'faction') !== Object.hasOwn(choice, 'favor')) fail(path, 'faction and favor must appear together');
  if (Object.hasOwn(choice, 'faction')) {
    reference(choice.faction, context.factions, `${path}.faction`);
    number(choice.favor, { min: -100, max: 100 }, `${path}.favor`);
  }
}

function validateRecovery(recovery, context) {
  const path = `recovery:${context.hero.id}`;
  if (!context.hero.recruitable) fail(path, 'recovery requires a recruitable hero');
  fields(recovery, { required: ['label', 'cost', 'flag', 'relationship', 'loyalty', 'memory', 'detail'] }, path);
  for (const key of ['label', 'memory', 'detail']) text(recovery[key], `${path}.${key}`);
  resources(recovery.cost, `${path}.cost`);
  identifier(recovery.flag, `${path}.flag`);
  if (recovery.flag !== context.hero.requirement) fail(path, 'recovery must satisfy this hero recruitment requirement');
  for (const key of ['relationship', 'loyalty']) number(recovery[key], { min: -100, max: 100 }, `${path}.${key}`);
  context.flags.add(recovery.flag);
  context.resolved.add(path);
}

function validatePerks(perks, path) {
  const factors = ['buildWoodFactor', 'evacuationFoodFactor'];
  const additions = ['cacheFood', 'gardenFood', 'rescueTrust'];
  fields(perks, { required: [], optional: [...factors, ...additions] }, path);
  for (const [key, value] of Object.entries(perks)) {
    const range = factors.includes(key) ? { min: 0.1, max: 1, integer: false } : { min: 0, max: 100 };
    number(value, range, `${path}.${key}`);
  }
}

function validateHero(hero, context) {
  const path = `hero:${hero.id}`;
  fields(hero, { required: ['id', 'code', 'name', 'stars', 'role', 'location', 'power', 'recruitable', 'boundary', 'summary', 'choices'], optional: ['threshold', 'requirement', 'requirementText', 'hiddenFlag', 'recovery', 'perks', 'specialty'] }, path);
  for (const key of ['code', 'name', 'role', 'boundary', 'summary']) text(hero[key], `${path}.${key}`);
  if (!/^H\d{2}$/.test(hero.code)) fail(path, 'invalid dossier code');
  number(hero.stars, { min: 1, max: 5, integer: false }, `${path}.stars`);
  if (!Number.isInteger(hero.stars * 2)) fail(path, 'stars must use half-star steps');
  number(hero.power, { min: 0, max: 10000 }, `${path}.power`);
  reference(hero.location, context.locations, `${path}.location`);
  if (typeof hero.recruitable !== 'boolean') fail(path, 'recruitable must be boolean');
  if (hero.recruitable) {
    number(hero.threshold, { min: -100, max: 100 }, `${path}.threshold`);
    identifier(hero.requirement, `${path}.requirement`);
    text(hero.requirementText, `${path}.requirementText`);
  } else if (['threshold', 'requirement', 'requirementText'].some(key => Object.hasOwn(hero, key))) fail(path, 'nonrecruitable hero has recruitment fields');
  if (Object.hasOwn(hero, 'hiddenFlag')) identifier(hero.hiddenFlag, `${path}.hiddenFlag`);
  if (Object.hasOwn(hero, 'specialty')) text(hero.specialty, `${path}.specialty`);
  if (Object.hasOwn(hero, 'perks')) validatePerks(hero.perks, `${path}.perks`);
  entries(hero.choices, { min: 1, max: 3 }, `${path}.choices`);
  for (const choice of hero.choices) validateStoryChoice(choice, { heroId: hero.id, factions: context.factions, flags: context.flags });
  if (Object.hasOwn(hero, 'recovery')) validateRecovery(hero.recovery, { hero, flags: context.flags, resolved: context.resolved });
}

function validateDelta(delta, ids, path) {
  fields(delta, { required: ['id', 'delta'] }, path);
  reference(delta.id, ids, `${path}.id`);
  number(delta.delta, { min: -100, max: 100 }, `${path}.delta`);
}

function validateRevelation(reveal, context) {
  const path = `revelation:${reveal.id}`;
  fields(reveal, { required: ['id', 'title', 'location', 'condition', 'summary', 'choices'] }, path);
  for (const key of ['title', 'summary']) text(reveal[key], `${path}.${key}`);
  if (reveal.title.length + reveal.summary.length + 2 > 1000) fail(path, 'combined journal entry exceeds save limit');
  reference(reveal.location, context.locations, `${path}.location`);
  validateCondition(reveal.condition);
  entries(reveal.choices, { min: 1, max: 3 }, `${path}.choices`);
  for (const choice of reveal.choices) {
    const choicePath = `${path}:${choice.id}`;
    fields(choice, { required: ['id', 'label', 'detail', 'cost', 'flag', 'memory'], optional: ['relationship', 'favor'] }, choicePath);
    for (const key of ['label', 'detail']) text(choice[key], `${choicePath}.${key}`);
    resources(choice.cost, `${choicePath}.cost`);
    identifier(choice.flag, `${choicePath}.flag`);
    context.flags.add(choice.flag);
    fields(choice.memory, { required: ['hero', 'text'] }, `${choicePath}.memory`);
    reference(choice.memory.hero, context.heroes, `${choicePath}.memory.hero`);
    text(choice.memory.text, `${choicePath}.memory.text`);
    if (choice.label.length + choice.memory.text.length + 17 > 1000) fail(choicePath, 'combined journal response exceeds save limit');
    if (Object.hasOwn(choice, 'relationship')) validateDelta(choice.relationship, context.heroes, `${choicePath}.relationship`);
    if (Object.hasOwn(choice, 'favor')) validateDelta(choice.favor, context.factions, `${choicePath}.favor`);
  }
}

function validateConditionReferences(condition, context) {
  const [operator, value] = Object.entries(condition)[0];
  if (operator === 'all' || operator === 'any') {
    for (const child of value) validateConditionReferences(child, context);
  } else if (operator === 'not') validateConditionReferences(value, context);
  else if (operator === 'flag') reference(value, context.flags, 'condition.flag');
  else if (operator === 'resolved' && !context.resolved.has(value)) fail('condition.resolved', `unknown completion ${value}`);
  else if (operator === 'favor') reference(value.id, context.factions, 'condition.favor');
  else if (operator === 'relationship') reference(value.id, context.heroes, 'condition.relationship');
  else if (operator === 'recruited') reference(value, context.heroes, 'condition.recruited');
  else if (operator === 'turnAtLeast' && value >= context.turns) fail('condition.turnAtLeast', 'condition cannot first open after the chapter ends');
}

/** Validate the complete prototype definition boundary without changing the input. */
export function validateContent(content) {
  fields(content, { required: ['version', 'balance', 'locations', 'buildings', 'factions', 'heroes'], optional: ['revelations'] }, 'content');
  if (typeof content.version !== 'string' || !/^P\d{3}$/.test(content.version)) fail('version', 'expected a prototype balance version such as P001');
  validateBalance(content.balance);
  const context = { flags: new Set(['evidence', 'hunt_1', 'hunt_2', 'hunt_3']), resolved: new Set(), turns: content.balance.turns };
  for (const [group, fixedIds] of Object.entries(FIXED_IDS)) {
    context[group] = entries(content[group], { min: fixedIds.length, max: fixedIds.length }, group);
    if (fixedIds.some(id => !context[group].has(id))) fail(group, 'missing a built-in prototype definition');
  }
  for (const site of content.locations) {
    fields(site, { required: ['id', 'name', 'kind', 'x', 'y', 'description', 'stock'] }, `location:${site.id}`);
    for (const key of ['name', 'kind', 'description']) text(site[key], `location:${site.id}.${key}`);
    for (const key of ['x', 'y']) number(site[key], { min: 0, max: 100, integer: false }, `location:${site.id}.${key}`);
    number(site.stock, { min: 0, max: 1000 }, `location:${site.id}.stock`);
  }
  for (const building of content.buildings) {
    fields(building, { required: ['id', 'name', 'cost', 'description', 'defense'] }, `building:${building.id}`);
    for (const key of ['name', 'description']) text(building[key], `building:${building.id}.${key}`);
    resources(building.cost, `building:${building.id}.cost`);
    number(building.defense, { min: 0, max: 10000 }, `building:${building.id}.defense`);
  }
  for (const faction of content.factions) {
    fields(faction, { required: ['id', 'name', 'goal', 'pact', 'benefit'] }, `faction:${faction.id}`);
    for (const key of ['name', 'goal', 'pact', 'benefit']) text(faction[key], `faction:${faction.id}.${key}`);
  }
  for (const hero of content.heroes) {
    context.resolved.add(`story:${hero.id}`);
    validateHero(hero, context);
  }
  if (new Set(content.heroes.map(hero => hero.code)).size !== content.heroes.length) fail('heroes', 'duplicate dossier code');
  const revelations = Object.hasOwn(content, 'revelations') ? content.revelations : [];
  entries(revelations, { min: 0, max: 100 }, 'revelations');
  for (const reveal of revelations) {
    context.resolved.add(`revelation:${reveal.id}`);
    validateRevelation(reveal, context);
  }
  for (const hero of content.heroes) {
    if (hero.recruitable) reference(hero.requirement, context.flags, `hero:${hero.id}.requirement`);
    if (Object.hasOwn(hero, 'hiddenFlag')) reference(hero.hiddenFlag, context.flags, `hero:${hero.id}.hiddenFlag`);
  }
  for (const reveal of revelations) validateConditionReferences(reveal.condition, context);
  return content;
}
