const MAX_DEPTH = 12;
const MAX_NODES = 100;
const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_:-]{0,95}$/;
const RESERVED_IDENTIFIERS = new Set(['constructor', 'prototype', '__proto__']);
const STRING_OPERATORS = new Set(['flag', 'resolved', 'recruited']);
const SCORE_OPERATORS = new Set(['favor', 'relationship']);

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ownDataEntries(value) {
  if (!isPlainRecord(value)) throw new TypeError('Condition nodes must be plain objects');
  return Reflect.ownKeys(value).map(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('Condition fields must be plain string-keyed data');
    }
    return [key, descriptor.value];
  });
}

function validateIdentifier(value) {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value) || RESERVED_IDENTIFIERS.has(value)) {
    throw new TypeError('Invalid condition identifier');
  }
}

function validateScore(value) {
  const entries = ownDataEntries(value);
  if (entries.length !== 2 || !Object.hasOwn(value, 'id') || !Object.hasOwn(value, 'min')) {
    throw new TypeError('Score conditions require only id and min');
  }
  validateIdentifier(value.id);
  if (!Number.isFinite(value.min) || value.min < -100 || value.min > 100) {
    throw new TypeError('Score minimum must be a number from -100 to 100');
  }
}

/** Validate a JSON condition. Returns the original condition; throws on malformed input. */
export function validateCondition(condition) {
  let nodeCount = 0;
  function visit(node, depth) {
    nodeCount += 1;
    if (depth > MAX_DEPTH || nodeCount > MAX_NODES) throw new RangeError('Condition exceeds complexity limits');
    const entries = ownDataEntries(node);
    if (entries.length !== 1) throw new TypeError('Each condition needs exactly one operator');
    const [operator, value] = entries[0];
    if (operator === 'all' || operator === 'any') {
      if (!Array.isArray(value) || value.length === 0 || value.length >= MAX_NODES) {
        throw new TypeError('all/any require 1 to 99 condition nodes');
      }
      for (const child of value) visit(child, depth + 1);
    } else if (operator === 'not') {
      visit(value, depth + 1);
    } else if (STRING_OPERATORS.has(operator)) {
      validateIdentifier(value);
    } else if (SCORE_OPERATORS.has(operator)) {
      validateScore(value);
    } else if (operator === 'turnAtLeast') {
      if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('turnAtLeast requires a nonnegative safe integer');
    } else {
      throw new TypeError(`Unknown condition operator: ${operator}`);
    }
  }
  visit(condition, 1);
  return condition;
}

function ownValue(record, key) {
  if (!isPlainRecord(record) || !Object.hasOwn(record, key)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}

function hasMarker(state, collection, marker) {
  const values = ownValue(state, collection);
  return Array.isArray(values) && values.includes(marker);
}

function scoreAtLeast(score, minimum) {
  return Number.isFinite(score) && score >= minimum;
}

function evaluateValidated(condition, state) {
  const [operator, value] = Object.entries(condition)[0];
  switch (operator) {
    case 'all': return value.every(child => evaluateValidated(child, state));
    case 'any': return value.some(child => evaluateValidated(child, state));
    case 'not': return !evaluateValidated(value, state);
    case 'flag': return hasMarker(state, 'flags', value);
    case 'resolved': return hasMarker(state, 'resolved', value);
    case 'favor': return scoreAtLeast(ownValue(ownValue(state, 'favor'), value.id), value.min);
    case 'relationship': {
      const hero = ownValue(ownValue(state, 'heroes'), value.id);
      return scoreAtLeast(ownValue(hero, 'relationship'), value.min);
    }
    case 'recruited': {
      const hero = ownValue(ownValue(state, 'heroes'), value);
      return ownValue(hero, 'recruited') === true;
    }
    case 'turnAtLeast': {
      const turn = ownValue(state, 'turn');
      return Number.isSafeInteger(turn) && turn >= value;
    }
    default: throw new TypeError(`Unknown condition operator: ${operator}`);
  }
}

/** Evaluate against a read-only state. Missing facts are false; malformed conditions throw. */
export function evaluateCondition(condition, state) {
  validateCondition(condition);
  if (!isPlainRecord(state)) throw new TypeError('Condition state must be a plain object');
  return evaluateValidated(condition, state);
}
