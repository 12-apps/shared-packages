/**
 * Startup validation: every factory runs these before it returns, so a host
 * that forgot a piece of config fails when it boots, with the missing key
 * named, rather than on the first request that needed it.
 *
 * The checks read the config as `unknown` on purpose: a host written in plain
 * JavaScript, or one that casts, gets the same answer as a typed one.
 */
import {
  TENANT_COPY_SHAPE,
  type TenantCoreConfig,
  type TenantIds,
} from './config';
import { TENANT_PORT_METHODS, TENANT_TREE_PORT_METHODS, type TenantPort, type TenantTreePort } from './port';

/** Thrown at startup when the config is missing a piece or carries a bad one. */
export class TenantConfigError extends Error {
  /** The dotted path of the offending key (`ids.refusals.gone`). */
  readonly key: string;

  constructor(key: string, problem: string) {
    super(`@12-apps/tenant: config "${key}" ${problem}.`);
    this.name = 'TenantConfigError';
    this.key = key;
  }
}

type Bag = Record<string, unknown>;

function isBag(value: unknown): value is Bag {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireBag(value: unknown, key: string): Bag {
  if (value === undefined || value === null) {
    throw new TenantConfigError(key, 'is required and missing');
  }
  if (!isBag(value)) throw new TenantConfigError(key, 'must be an object');
  return value;
}

function requireString(value: unknown, key: string): string {
  if (value === undefined || value === null) {
    throw new TenantConfigError(key, 'is required and missing');
  }
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TenantConfigError(key, 'must be a non-empty string');
  }
  return value;
}

function requireDistinct(values: Record<string, string>, key: string): void {
  const seen = new Map<string, string>();
  for (const [name, value] of Object.entries(values)) {
    const first = seen.get(value);
    if (first !== undefined) {
      throw new TenantConfigError(
        `${key}.${name}`,
        `repeats the value "${value}" already given to ${key}.${first}`,
      );
    }
    seen.set(value, name);
  }
}

/** A non-empty list of distinct non-empty strings, as a set. */
function requireStatusList(value: unknown, key: string): Set<string> {
  if (value === undefined || value === null) {
    throw new TenantConfigError(key, 'is required and missing');
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new TenantConfigError(key, 'must be a non-empty array');
  }
  const seen = new Set<string>();
  value.forEach((status, index) => {
    const name = requireString(status, `${key}[${index}]`);
    if (seen.has(name)) throw new TenantConfigError(`${key}[${index}]`, `repeats "${name}"`);
    seen.add(name);
  });
  return seen;
}

function validateClosableFrom(value: unknown, known: Set<string>, named: Record<string, string>): void {
  const closable = requireStatusList(value, 'statuses.closableFrom');
  for (const name of closable) {
    if (!known.has(name)) {
      throw new TenantConfigError('statuses.closableFrom', `names "${name}", which statuses.all does not list`);
    }
    if (name === named.closing || name === named.closed) {
      throw new TenantConfigError('statuses.closableFrom', `names "${name}", a status a close cannot start from`);
    }
  }
}

function validateStatuses(value: unknown): void {
  const statuses = requireBag(value, 'statuses');
  const known = requireStatusList(statuses.all, 'statuses.all');
  const named: Record<string, string> = {};
  for (const role of ['active', 'closing', 'closed'] as const) {
    const name = requireString(statuses[role], `statuses.${role}`);
    if (!known.has(name)) {
      throw new TenantConfigError(`statuses.${role}`, `names "${name}", which statuses.all does not list`);
    }
    named[role] = name;
  }
  requireDistinct(named, 'statuses');
  validateClosableFrom(statuses.closableFrom, known, named);
}

const ID_GROUPS = {
  refusals: [
    'closing',
    'closed',
    'readOnly',
    'gone',
    'reasonTooShort',
    'nameMismatch',
    'alreadyClosing',
    'notActive',
    'closingBlocked',
    'purged',
    'notClosing',
    'exportNeedsPerson',
    'exportNotFound',
    'exportExpired',
  ],
  audit: [
    'closeScheduled',
    'closeReopened',
    'closePurged',
    'afterCloseFailed',
    'exportRequested',
    'exportDownloaded',
  ],
  notifications: ['closingScheduled', 'closingWeek', 'closingDay', 'reopened', 'exportReady'],
  permissions: ['close'],
} as const satisfies { [G in keyof TenantIds]: readonly (keyof TenantIds[G])[] };

function validateIdGroup(value: unknown, group: string, names: readonly string[]): void {
  const bag = requireBag(value, `ids.${group}`);
  const values = Object.fromEntries(
    names.map((name) => [name, requireString(bag[name], `ids.${group}.${name}`)]),
  );
  // Two acts sharing one id would be indistinguishable to whoever reads it.
  requireDistinct(values, `ids.${group}`);
}

function validateIds(value: unknown): void {
  const ids = requireBag(value, 'ids');
  for (const [group, names] of Object.entries(ID_GROUPS)) validateIdGroup(ids[group], group, names);
}

function requireSentence(value: unknown, key: string): void {
  if (value === undefined || value === null) {
    throw new TenantConfigError(key, 'is required and missing');
  }
  if (typeof value !== 'function') {
    throw new TenantConfigError(key, 'must be a function that writes the whole sentence');
  }
}

function validatePack(value: unknown, tag: string): void {
  const pack = requireBag(value, `copy.locales.${tag}`);
  for (const [copyKey, kind] of Object.entries(TENANT_COPY_SHAPE)) {
    const key = `copy.locales.${tag}.${copyKey}`;
    if (kind === 'text') requireString(pack[copyKey], key);
    else requireSentence(pack[copyKey], key);
  }
}

function validateCopy(value: unknown): void {
  const copy = requireBag(value, 'copy');
  const locales = requireBag(copy.locales, 'copy.locales');
  const tags = Object.keys(locales);
  if (tags.length === 0) {
    throw new TenantConfigError('copy.locales', 'must hold at least one locale pack');
  }
  for (const tag of tags) validatePack(locales[tag], tag);
  const fallback = requireString(copy.defaultLocale, 'copy.defaultLocale');
  if (!tags.includes(fallback)) {
    throw new TenantConfigError('copy.defaultLocale', `names "${fallback}", which copy.locales does not hold`);
  }
}

/** Validate what both halves share. Throws {@link TenantConfigError}. */
export function validateCoreConfig(config: unknown): asserts config is TenantCoreConfig {
  const bag = requireBag(config, 'config');
  validateStatuses(bag.statuses);
  validateIds(bag.ids);
  validateCopy(bag.copy);
}

/** Validate the tenant port: every member present and a function. */
export function validatePort(value: unknown): asserts value is TenantPort {
  const port = requireBag(value, 'port');
  for (const method of TENANT_PORT_METHODS) {
    if (port[method] === undefined || port[method] === null) {
      throw new TenantConfigError(`port.${method}`, 'is required and missing');
    }
    if (typeof port[method] !== 'function') {
      throw new TenantConfigError(`port.${method}`, 'must be a function');
    }
  }
}

/**
 * The tenant tree's port, when the host gives one: every member required. Left
 * out (`undefined`), there is no tree and nothing to check; anything else that
 * is not a port with all four members fails at startup, named.
 */
export function validateTreePort(value: unknown): asserts value is TenantTreePort {
  if (value === null || !isBag(value)) {
    throw new TenantConfigError('tree', 'must be the tree port object, or be left out');
  }
  for (const method of TENANT_TREE_PORT_METHODS) {
    if (value[method] === undefined || value[method] === null) {
      throw new TenantConfigError(`tree.${method}`, 'is required and missing');
    }
    if (typeof value[method] !== 'function') {
      throw new TenantConfigError(`tree.${method}`, 'must be a function');
    }
  }
}
