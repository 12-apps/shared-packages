/**
 * Startup validation: every factory runs these before it returns, so a host
 * that forgot a piece of config fails when it boots, with the missing key
 * named, rather than on the first request that needed it.
 *
 * The checks read the config as `unknown` on purpose: a host written in plain
 * JavaScript, or one that casts, gets the same answer as a typed one.
 */
import {
  TENANT_COPY_KEYS,
  type TenantCoreConfig,
  type TenantIds,
} from './config';
import { TENANT_PORT_METHODS, type TenantPort } from './port';

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

function validateStatuses(value: unknown): void {
  const statuses = requireBag(value, 'statuses');
  const all = statuses.all;
  if (all === undefined || all === null) {
    throw new TenantConfigError('statuses.all', 'is required and missing');
  }
  if (!Array.isArray(all) || all.length === 0) {
    throw new TenantConfigError('statuses.all', 'must be a non-empty array');
  }
  const known = new Set<string>();
  all.forEach((status, index) => {
    const name = requireString(status, `statuses.all[${index}]`);
    if (known.has(name)) {
      throw new TenantConfigError(`statuses.all[${index}]`, `repeats "${name}"`);
    }
    known.add(name);
  });
  const named: Record<string, string> = {};
  for (const role of ['active', 'closing', 'closed'] as const) {
    const name = requireString(statuses[role], `statuses.${role}`);
    if (!known.has(name)) {
      throw new TenantConfigError(`statuses.${role}`, `names "${name}", which statuses.all does not list`);
    }
    named[role] = name;
  }
  requireDistinct(named, 'statuses');
}

const ID_GROUPS = {
  refusals: ['closing', 'closed', 'readOnly', 'gone'],
  audit: [
    'closeScheduled',
    'closeReopened',
    'closePurged',
    'afterCloseFailed',
    'exportRequested',
    'exportDownloaded',
  ],
  notifications: ['closingScheduled', 'closingWeek', 'closingDay', 'exportReady'],
  permissions: ['close'],
} as const satisfies { [G in keyof TenantIds]: readonly (keyof TenantIds[G])[] };

function validateIds(value: unknown): void {
  const ids = requireBag(value, 'ids');
  for (const [group, names] of Object.entries(ID_GROUPS)) {
    const bag = requireBag(ids[group], `ids.${group}`);
    const values: Record<string, string> = {};
    for (const name of names) values[name] = requireString(bag[name], `ids.${group}.${name}`);
    // Two acts sharing one id would be indistinguishable to whoever reads it.
    requireDistinct(values, `ids.${group}`);
  }
}

function validateCopy(value: unknown): void {
  const copy = requireBag(value, 'copy');
  const locales = requireBag(copy.locales, 'copy.locales');
  const tags = Object.keys(locales);
  if (tags.length === 0) {
    throw new TenantConfigError('copy.locales', 'must hold at least one locale pack');
  }
  for (const tag of tags) {
    const pack = requireBag(locales[tag], `copy.locales.${tag}`);
    for (const copyKey of TENANT_COPY_KEYS) requireString(pack[copyKey], `copy.locales.${tag}.${copyKey}`);
  }
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
