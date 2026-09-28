// Founder-only appearance registry and record validation (design contract PC001).
// Cosmetic choices are stable IDs resolved through a registry; saves carry choices, not meshes.
// Same validation style as content-validation.mjs: plain-object checks, TypeError on the first defect, input never mutated.

const ID_PATTERN = /^founder\.(body|face|morph|hair|dye|module|outfit|voice|pose|signature|preset)\.[a-z0-9_]{1,40}$/;
const ASSET_NAME = /^[A-Z][A-Za-z0-9_]{2,63}$/;
const SHAPE_KEY = /^LK_[a-z_]{2,40}$/;
const NPC_IDS = ['elias', 'mara', 'owen', 'tessa', 'arin', 'mira', 'kael', 'seren', 'rowan', 'evelyn'];
const SLOTS = ['upper', 'lower', 'feet', 'hands', 'outer', 'accessory'];
const REQUIRED_SLOTS = ['upper', 'lower', 'feet'];
const COVERAGE = ['torso', 'arms', 'legs', 'feet', 'hands', 'head'];
const REGIONS = ['jaw', 'cheek', 'nose', 'brow', 'eye', 'lip'];
const VOICE_STATUS = ['unrecorded', 'sample', 'recorded'];
const RECORD_FIELDS = ['appearanceSchema', 'presetRevision', 'bodyFamilyId', 'facePresetId', 'morphWeights', 'hairId', 'dyeIds', 'outfitSlotIds', 'voiceSetId', 'portraitPoseId', 'signatureId'];
const GROUPS = ['bodyFamilies', 'faces', 'morphs', 'hair', 'dyes', 'modules', 'outfits', 'voiceSets', 'portraitPoses', 'signatures', 'presets'];
const MAX_REVISION = 1000000;

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
  const { min, max, integer = false } = range;
  if (!Number.isFinite(value) || (integer && !Number.isSafeInteger(value)) || value < min || value > max) fail(path, `expected ${integer ? 'integer' : 'number'} in ${min}..${max}`);
}

function text(value, path, limit = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) fail(path, `expected 1..${limit} characters`);
}

function boolean(value, path) {
  if (typeof value !== 'boolean') fail(path, 'expected boolean');
}

function identifier(value, kind, path) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) fail(path, 'invalid cosmetic identifier');
  const [, group, name] = value.split('.');
  if (group !== kind) fail(path, `expected a ${kind} identifier`);
  if (NPC_IDS.some(npc => name === npc || name.startsWith(`${npc}_`) || name.endsWith(`_${npc}`))) fail(path, 'cosmetic identifiers cannot target an authored companion');
}

function oneOf(value, allowed, path) {
  if (!allowed.includes(value)) fail(path, `expected one of ${allowed.join(', ')}`);
}

function stringList(value, allowed, path, limits = { min: 0, max: 16 }) {
  if (!Array.isArray(value) || value.length < limits.min || value.length > limits.max) fail(path, 'invalid list size');
  if (new Set(value).size !== value.length) fail(path, 'duplicate entry');
  for (const entry of value) if (allowed && !allowed.includes(entry)) fail(path, `unknown entry ${entry}`);
}

function collection(value, kind, path, limits) {
  if (!Array.isArray(value) || value.length < limits.min || value.length > limits.max) fail(path, `expected ${limits.min}..${limits.max} entries`);
  const byId = new Map();
  for (let index = 0; index < value.length; index++) {
    record(value[index], `${path}[${index}]`);
    identifier(value[index].id, kind, `${path}[${index}].id`);
    if (byId.has(value[index].id)) fail(path, `duplicate ID ${value[index].id}`);
    byId.set(value[index].id, value[index]);
  }
  return byId;
}

function reference(value, kind, byId, path) {
  identifier(value, kind, path);
  if (!byId.has(value)) fail(path, `unknown reference ${value}`);
  return byId.get(value);
}

function index(registry) {
  const context = {};
  for (const group of GROUPS) context[group] = new Map(registry[group].map(entry => [entry.id, entry]));
  return context;
}

function channelsFor(hair, modules) {
  return new Set([...hair.dyeChannels, ...modules.flatMap(module => module.dyeChannels)]);
}

function chosenModules(slots, modules, path) {
  record(slots, path);
  const chosen = Object.entries(slots).map(([slot, moduleId]) => {
    oneOf(slot, SLOTS, `${path}.${slot}`);
    const module = reference(moduleId, 'module', modules, `${path}.${slot}`);
    if (module.slot !== slot) fail(`${path}.${slot}`, `module ${moduleId} belongs to slot ${module.slot}`);
    return module;
  });
  for (const slot of REQUIRED_SLOTS) if (!Object.hasOwn(slots, slot)) fail(path, `missing required slot ${slot}`);
  for (const module of chosen) for (const other of chosen) {
    if (module !== other && module.conflictsWith.includes(other.id)) fail(path, `${module.id} conflicts with ${other.id}`);
  }
  return chosen;
}

/** Validate one complete founder appearance record against an already validated registry. Returns the same object. */
export function validateAppearanceRecord(candidate, registry, path = 'appearance') {
  const context = registry.__index ?? index(registry);
  fields(candidate, { required: RECORD_FIELDS }, path);
  if (candidate.appearanceSchema !== registry.appearanceSchema) fail(`${path}.appearanceSchema`, `expected ${registry.appearanceSchema}`);
  number(candidate.presetRevision, { min: 0, max: MAX_REVISION, integer: true }, `${path}.presetRevision`);
  const family = reference(candidate.bodyFamilyId, 'body', context.bodyFamilies, `${path}.bodyFamilyId`);
  const face = reference(candidate.facePresetId, 'face', context.faces, `${path}.facePresetId`);
  if (face.bodyFamilyId !== family.id) fail(`${path}.facePresetId`, 'face belongs to a different body family');
  record(candidate.morphWeights, `${path}.morphWeights`);
  for (const key of Object.keys(candidate.morphWeights)) if (!family.morphIds.includes(key)) fail(`${path}.morphWeights`, `morph ${key} is not supported by this body family`);
  for (const morphId of family.morphIds) {
    if (!Object.hasOwn(candidate.morphWeights, morphId)) fail(`${path}.morphWeights`, `missing ${morphId}`);
    const morph = context.morphs.get(morphId);
    number(candidate.morphWeights[morphId], { min: morph.min, max: morph.max }, `${path}.morphWeights.${morphId}`);
  }
  const hair = reference(candidate.hairId, 'hair', context.hair, `${path}.hairId`);
  const chosen = chosenModules(candidate.outfitSlotIds, context.modules, `${path}.outfitSlotIds`);
  const channels = channelsFor(hair, chosen);
  record(candidate.dyeIds, `${path}.dyeIds`);
  for (const [channel, dyeId] of Object.entries(candidate.dyeIds)) {
    if (!channels.has(channel)) fail(`${path}.dyeIds`, `channel ${channel} is not exposed by the chosen hair or modules`);
    reference(dyeId, 'dye', context.dyes, `${path}.dyeIds.${channel}`);
  }
  for (const channel of channels) if (!Object.hasOwn(candidate.dyeIds, channel)) fail(`${path}.dyeIds`, `missing dye for channel ${channel}`);
  reference(candidate.voiceSetId, 'voice', context.voiceSets, `${path}.voiceSetId`);
  reference(candidate.portraitPoseId, 'pose', context.portraitPoses, `${path}.portraitPoseId`);
  reference(candidate.signatureId, 'signature', context.signatures, `${path}.signatureId`);
  return candidate;
}

/** Validate the complete registry without mutating it. Returns the same object. */
export function validateAppearanceRegistry(registry) {
  fields(registry, { required: ['appearanceSchema', 'owner', 'skeleton', ...GROUPS], optional: ['notes'] }, 'registry');
  if (typeof registry.appearanceSchema !== 'string' || !/^A\d{3}$/.test(registry.appearanceSchema)) fail('registry.appearanceSchema', 'expected an appearance schema version such as A001');
  if (registry.owner !== 'founder') fail('registry.owner', 'only the founding five-star player receives the creator');
  text(registry.skeleton, 'registry.skeleton', 64);
  if (Object.hasOwn(registry, 'notes')) text(registry.notes, 'registry.notes', 1000);
  const context = {
    bodyFamilies: collection(registry.bodyFamilies, 'body', 'bodyFamilies', { min: 1, max: 8 }),
    faces: collection(registry.faces, 'face', 'faces', { min: 1, max: 64 }),
    morphs: collection(registry.morphs, 'morph', 'morphs', { min: 1, max: 64 }),
    hair: collection(registry.hair, 'hair', 'hair', { min: 1, max: 64 }),
    dyes: collection(registry.dyes, 'dye', 'dyes', { min: 1, max: 128 }),
    modules: collection(registry.modules, 'module', 'modules', { min: 3, max: 128 }),
    outfits: collection(registry.outfits, 'outfit', 'outfits', { min: 1, max: 64 }),
    voiceSets: collection(registry.voiceSets, 'voice', 'voiceSets', { min: 1, max: 32 }),
    portraitPoses: collection(registry.portraitPoses, 'pose', 'portraitPoses', { min: 1, max: 32 }),
    signatures: collection(registry.signatures, 'signature', 'signatures', { min: 1, max: 32 }),
    presets: collection(registry.presets, 'preset', 'presets', { min: 3, max: 64 })
  };
  for (const morph of registry.morphs) {
    const path = `morph:${morph.id}`;
    fields(morph, { required: ['id', 'label', 'region', 'min', 'max', 'default', 'shapeKey'], optional: ['corrective'] }, path);
    text(morph.label, `${path}.label`);
    oneOf(morph.region, REGIONS, `${path}.region`);
    number(morph.min, { min: -1, max: 0 }, `${path}.min`);
    number(morph.max, { min: 0, max: 1 }, `${path}.max`);
    if (morph.min >= morph.max) fail(path, 'min must be below max');
    number(morph.default, { min: morph.min, max: morph.max }, `${path}.default`);
    if (typeof morph.shapeKey !== 'string' || !SHAPE_KEY.test(morph.shapeKey)) fail(`${path}.shapeKey`, 'expected an LK_ shape key name');
    if (Object.hasOwn(morph, 'corrective')) text(morph.corrective, `${path}.corrective`);
  }
  for (const family of registry.bodyFamilies) {
    const path = `body:${family.id}`;
    fields(family, { required: ['id', 'label', 'heightMetres', 'defaultFaceId', 'morphIds'] }, path);
    text(family.label, `${path}.label`);
    fields(family.heightMetres, { required: ['min', 'max'] }, `${path}.heightMetres`);
    number(family.heightMetres.min, { min: 1.4, max: 2.2 }, `${path}.heightMetres.min`);
    number(family.heightMetres.max, { min: family.heightMetres.min, max: 2.2 }, `${path}.heightMetres.max`);
    stringList(family.morphIds, [...context.morphs.keys()], `${path}.morphIds`, { min: 1, max: 64 });
    const face = reference(family.defaultFaceId, 'face', context.faces, `${path}.defaultFaceId`);
    if (face.bodyFamilyId !== family.id) fail(`${path}.defaultFaceId`, 'default face belongs to another family');
  }
  for (const face of registry.faces) {
    const path = `face:${face.id}`;
    fields(face, { required: ['id', 'label', 'bodyFamilyId', 'appeal'] }, path);
    text(face.label, `${path}.label`);
    text(face.appeal, `${path}.appeal`);
    reference(face.bodyFamilyId, 'body', context.bodyFamilies, `${path}.bodyFamilyId`);
  }
  for (const hair of registry.hair) {
    const path = `hair:${hair.id}`;
    fields(hair, { required: ['id', 'label', 'hatCompatible', 'dyeChannels', 'assetName'] }, path);
    text(hair.label, `${path}.label`);
    boolean(hair.hatCompatible, `${path}.hatCompatible`);
    stringList(hair.dyeChannels, null, `${path}.dyeChannels`, { min: 1, max: 4 });
    if (typeof hair.assetName !== 'string' || !ASSET_NAME.test(hair.assetName)) fail(`${path}.assetName`, 'expected an asset name, not a path');
  }
  for (const dye of registry.dyes) {
    const path = `dye:${dye.id}`;
    fields(dye, { required: ['id', 'label', 'rgb'] }, path);
    text(dye.label, `${path}.label`);
    if (!Array.isArray(dye.rgb) || dye.rgb.length !== 3) fail(`${path}.rgb`, 'expected three channels');
    for (let channel = 0; channel < 3; channel++) number(dye.rgb[channel], { min: 0, max: 1 }, `${path}.rgb[${channel}]`);
  }
  for (const module of registry.modules) {
    const path = `module:${module.id}`;
    fields(module, { required: ['id', 'label', 'slot', 'coverage', 'dyeChannels', 'conflictsWith', 'assetName'] }, path);
    text(module.label, `${path}.label`);
    oneOf(module.slot, SLOTS, `${path}.slot`);
    stringList(module.coverage, COVERAGE, `${path}.coverage`, { min: 1, max: 6 });
    stringList(module.dyeChannels, null, `${path}.dyeChannels`, { min: 0, max: 4 });
    stringList(module.conflictsWith, [...context.modules.keys()], `${path}.conflictsWith`, { min: 0, max: 32 });
    if (module.conflictsWith.includes(module.id)) fail(`${path}.conflictsWith`, 'module cannot conflict with itself');
    for (const other of module.conflictsWith) if (!context.modules.get(other).conflictsWith.includes(module.id)) fail(`${path}.conflictsWith`, `conflict with ${other} must be declared on both modules`);
    if (typeof module.assetName !== 'string' || !ASSET_NAME.test(module.assetName)) fail(`${path}.assetName`, 'expected an asset name, not a path');
  }
  const channelOwners = new Map();
  for (const entry of [...registry.hair, ...registry.modules]) for (const channel of entry.dyeChannels) {
    if (typeof channel !== 'string' || !/^[a-z_]{2,32}$/.test(channel)) fail(`${entry.id}.dyeChannels`, 'invalid dye channel name');
    const owners = channelOwners.get(channel) ?? [];
    for (const other of owners) {
      // Alternatives in one slot may retain the same colors; equipped pieces must not alias channels.
      const sameSlot = (entry.slot ?? 'hair') === (other.slot ?? 'hair');
      const conflicting = entry.conflictsWith?.includes(other.id) || other.conflictsWith?.includes(entry.id);
      if (!sameSlot && !conflicting) fail(`${entry.id}.dyeChannels`, `dye channel ${channel} is also declared by compatible item ${other.id}`);
    }
    channelOwners.set(channel, [...owners, entry]);
  }
  for (const outfit of registry.outfits) {
    const path = `outfit:${outfit.id}`;
    fields(outfit, { required: ['id', 'label', 'slots'] }, path);
    text(outfit.label, `${path}.label`);
    chosenModules(outfit.slots, context.modules, `${path}.slots`);
  }
  for (const voice of registry.voiceSets) {
    const path = `voice:${voice.id}`;
    fields(voice, { required: ['id', 'label', 'status', 'sampleCount'] }, path);
    text(voice.label, `${path}.label`);
    oneOf(voice.status, VOICE_STATUS, `${path}.status`);
    number(voice.sampleCount, { min: 0, max: 1000, integer: true }, `${path}.sampleCount`);
    if (voice.status === 'unrecorded' && voice.sampleCount !== 0) fail(path, 'unrecorded voice sets cannot claim samples');
  }
  for (const pose of registry.portraitPoses) {
    fields(pose, { required: ['id', 'label', 'temperament'] }, `pose:${pose.id}`);
    text(pose.label, `pose:${pose.id}.label`);
    text(pose.temperament, `pose:${pose.id}.temperament`);
  }
  for (const signature of registry.signatures) {
    const path = `signature:${signature.id}`;
    fields(signature, { required: ['id', 'label', 'effectFamily', 'accentDyeId'] }, path);
    text(signature.label, `${path}.label`);
    text(signature.effectFamily, `${path}.effectFamily`, 32);
    reference(signature.accentDyeId, 'dye', context.dyes, `${path}.accentDyeId`);
  }
  const familiesWithPreset = new Set();
  for (const preset of registry.presets) {
    const path = `preset:${preset.id}`;
    fields(preset, { required: ['id', 'label', 'appeal', 'record'] }, path);
    text(preset.label, `${path}.label`);
    stringList(preset.appeal, null, `${path}.appeal`, { min: 1, max: 2 });
    for (const entry of preset.appeal) text(entry, `${path}.appeal`, 40);
    validateAppearanceRecord(preset.record, { ...registry, __index: context }, `${path}.record`);
    familiesWithPreset.add(preset.record.bodyFamilyId);
  }
  for (const family of registry.bodyFamilies) if (!familiesWithPreset.has(family.id)) fail(`body:${family.id}`, 'every body family needs at least one finished preset');
  return registry;
}

/** Copy a preset's record so a player can start from a finished look without touching a slider. */
export function recordFromPreset(presetId, registry) {
  const preset = registry.presets.find(entry => entry.id === presetId);
  if (!preset) fail('preset', `unknown preset ${presetId}`);
  return structuredClone(preset.record);
}

function fallbackPreset(candidate, registry) {
  // Nearest finished look: most matching stable choices wins; ties keep registry order. Garbage scores 0 and lands on the first preset.
  const source = candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate : {};
  const upper = source.outfitSlotIds && typeof source.outfitSlotIds === 'object' && !Array.isArray(source.outfitSlotIds) ? source.outfitSlotIds.upper : undefined;
  const score = preset => ['bodyFamilyId', 'facePresetId', 'hairId', 'voiceSetId', 'portraitPoseId', 'signatureId'].filter(field => preset.record[field] === source[field]).length + (preset.record.outfitSlotIds.upper === upper ? 1 : 0);
  return registry.presets.reduce((best, preset) => (score(preset) > score(best) ? preset : best), registry.presets[0]);
}

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireRepairData(value, path = 'appearance', ancestors = new Set()) {
  if (value === null || ['undefined', 'string', 'number', 'boolean'].includes(typeof value)) return;
  if (typeof value !== 'object') fail(path, 'repair requires plain data, not executable or non-cloneable values');
  if (ancestors.has(value)) fail(path, 'repair requires acyclic data');
  if (!Array.isArray(value)) record(value, path);
  ancestors.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail(path, 'repair requires enumerable data fields');
    requireRepairData(descriptor.value, `${path}.${key}`, ancestors);
  }
  ancestors.delete(value);
}

function requireSupportedMigration(source, targetSchema) {
  if (!Object.hasOwn(source, 'appearanceSchema')) return;
  if (source.appearanceSchema === targetSchema) return;
  // A000 is the explicitly supported draft of A001; its ID fields retain their meaning.
  if (source.appearanceSchema === 'A000' && targetSchema === 'A001') return;
  fail('appearance.appearanceSchema', 'unsupported appearance schema; preserve the original save and use a compatible version');
}

/**
 * Repair plain data against an already validated registry without discarding the original.
 * Only A000 -> A001 is a supported version migration; unknown versions throw without mutation.
 * A missing schema is recoverable damaged data. Accessors, cycles and non-data values are rejected.
 * Unknown cosmetics fall back visibly to a compatible preset; every substitution is listed for the UI.
 */
export function repairAppearanceRecord(candidate, registry) {
  requireRepairData(candidate);
  const source = plain(candidate) ? candidate : {};
  requireSupportedMigration(source, registry.appearanceSchema);
  const context = index(registry);
  const substitutions = [];
  const preset = fallbackPreset(source, registry);
  const base = structuredClone(preset.record);
  const anyDye = registry.dyes[0].id;
  const note = (field, from, to, reason) => substitutions.push({ field, from: from === undefined ? null : structuredClone(from), to: to === undefined ? null : structuredClone(to), reason });
  if (source !== candidate) note('record', candidate, preset.id, 'record was not a plain object');
  for (const key of Object.keys(source)) if (!RECORD_FIELDS.includes(key)) note(key, source[key], undefined, 'unsupported field removed');
  let repaired = structuredClone(base);
  const fillDyes = (target) => {
    const channels = channelsFor(context.hair.get(target.hairId), Object.values(target.outfitSlotIds).map(id => context.modules.get(id)));
    const dyes = {};
    for (const channel of channels) dyes[channel] = Object.hasOwn(target.dyeIds, channel) && context.dyes.has(target.dyeIds[channel]) ? target.dyeIds[channel] : (Object.hasOwn(base.dyeIds, channel) ? base.dyeIds[channel] : anyDye);
    target.dyeIds = dyes;
  };
  const tryField = (field, apply) => {
    if (!Object.hasOwn(source, field)) { note(field, undefined, repaired[field], 'missing'); return; }
    const trial = structuredClone(repaired);
    try { apply(trial); fillDyes(trial); validateAppearanceRecord(trial, registry); repaired = trial; }
    catch (error) { note(field, source[field], repaired[field], error.message); }
  };
  tryField('bodyFamilyId', trial => {
    trial.bodyFamilyId = source.bodyFamilyId;
    const family = context.bodyFamilies.get(source.bodyFamilyId);
    if (!family) throw new TypeError('unknown body family');
    trial.facePresetId = family.defaultFaceId;
    trial.morphWeights = Object.fromEntries(family.morphIds.map(id => [id, context.morphs.get(id).default]));
  });
  tryField('facePresetId', trial => { trial.facePresetId = source.facePresetId; });
  const family = context.bodyFamilies.get(repaired.bodyFamilyId);
  if (plain(source.morphWeights)) {
    const weights = {};
    for (const morphId of family.morphIds) {
      const morph = context.morphs.get(morphId);
      const value = Object.hasOwn(source.morphWeights, morphId) ? source.morphWeights[morphId] : undefined;
      if (typeof value === 'number' && Number.isFinite(value)) {
        weights[morphId] = Math.min(morph.max, Math.max(morph.min, value));
        if (weights[morphId] !== value) note(`morphWeights.${morphId}`, value, weights[morphId], 'clamped to the supported range');
      } else {
        weights[morphId] = morph.default;
        note(`morphWeights.${morphId}`, value, morph.default, value === undefined ? 'missing' : 'not a finite number');
      }
    }
    for (const key of Object.keys(source.morphWeights)) if (!family.morphIds.includes(key)) note(`morphWeights.${key}`, source.morphWeights[key], undefined, 'morph not supported by this body family');
    repaired.morphWeights = weights;
  } else note('morphWeights', source.morphWeights, repaired.morphWeights, 'missing or malformed');
  tryField('hairId', trial => { trial.hairId = source.hairId; });
  tryField('outfitSlotIds', trial => { trial.outfitSlotIds = structuredClone(source.outfitSlotIds); });
  // Dyes depend on the accepted hair and modules: keep valid choices per channel, fill the rest from the preset.
  const wantedDyes = plain(source.dyeIds) ? source.dyeIds : {};
  const target = { hairId: repaired.hairId, outfitSlotIds: repaired.outfitSlotIds, dyeIds: wantedDyes };
  fillDyes(target);
  for (const [channel, dyeId] of Object.entries(target.dyeIds)) if (wantedDyes[channel] !== dyeId) note(`dyeIds.${channel}`, wantedDyes[channel], dyeId, wantedDyes[channel] === undefined ? 'missing' : 'unknown dye');
  for (const channel of Object.keys(wantedDyes)) if (!Object.hasOwn(target.dyeIds, channel)) note(`dyeIds.${channel}`, wantedDyes[channel], undefined, 'channel not supported by the chosen appearance');
  if (Object.hasOwn(source, 'dyeIds') && !plain(source.dyeIds)) note('dyeIds', source.dyeIds, target.dyeIds, 'malformed dye choices');
  repaired.dyeIds = target.dyeIds;
  tryField('voiceSetId', trial => { trial.voiceSetId = source.voiceSetId; });
  tryField('portraitPoseId', trial => { trial.portraitPoseId = source.portraitPoseId; });
  tryField('signatureId', trial => { trial.signatureId = source.signatureId; });
  if (Number.isSafeInteger(source.presetRevision) && source.presetRevision >= 0 && source.presetRevision <= MAX_REVISION) repaired.presetRevision = source.presetRevision;
  else note('presetRevision', source.presetRevision, repaired.presetRevision, 'missing or invalid');
  repaired.appearanceSchema = registry.appearanceSchema;
  if (source.appearanceSchema !== registry.appearanceSchema) note('appearanceSchema', source.appearanceSchema, registry.appearanceSchema, Object.hasOwn(source, 'appearanceSchema') ? 'migrated supported A000 draft to A001' : 'missing schema recovered');
  validateAppearanceRecord(repaired, registry);
  return { record: repaired, substitutions, fallbackPresetId: preset.id, original: candidate };
}
