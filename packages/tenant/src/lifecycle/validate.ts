/**
 * Startup validation of the lifecycle and the gates, read as `unknown` like
 * the rest of the config: every missing or bad key is named
 * (`TenantConfigError`), and nothing falls back to a value of the host's.
 */
import { TenantConfigError } from '../validate';
import { TENANT_LIFECYCLE_COPY_KEYS } from './types';

type Bag = Record<string, unknown>;

function isBag(value: unknown): value is Bag {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function present(value: unknown, key: string): void {
  if (value === undefined || value === null) throw new TenantConfigError(key, 'is required and missing');
}

function bagAt(value: unknown, key: string): Bag {
  present(value, key);
  if (!isBag(value)) throw new TenantConfigError(key, 'must be an object');
  return value;
}

function textAt(value: unknown, key: string): string {
  present(value, key);
  if (typeof value !== 'string' || value.trim() === '') throw new TenantConfigError(key, 'must be a non-empty string');
  return value;
}

function fnAt(bag: Bag, member: string, key: string): void {
  present(bag[member], key);
  if (typeof bag[member] !== 'function') throw new TenantConfigError(key, 'must be a function');
}

function positiveInt(value: unknown, key: string): number {
  present(value, key);
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new TenantConfigError(key, 'must be a whole number above 0');
  }
  return value;
}

function listAt(value: unknown, key: string): unknown[] {
  present(value, key);
  if (!Array.isArray(value)) throw new TenantConfigError(key, 'must be an array');
  return value;
}

function canonicalLocale(value: unknown, key: string): void {
  const tag = textAt(value, key);
  let canonical: string | undefined;
  try {
    canonical = Intl.getCanonicalLocales(tag)[0];
  } catch {
    canonical = undefined;
  }
  if (canonical !== tag) throw new TenantConfigError(key, `must be a canonical locale tag ("${tag}" is not)`);
}

function blockerKind(value: unknown, key: string): string {
  const bag = bagAt(value, key);
  textAt(bag.path, `${key}.path`);
  return textAt(bag.kind, `${key}.kind`);
}

function validateNumbers(lifecycle: Bag): void {
  const grace = positiveInt(lifecycle.graceDays, 'lifecycle.graceDays');
  const days = bagAt(lifecycle.reminderDays, 'lifecycle.reminderDays');
  const week = positiveInt(days.week, 'lifecycle.reminderDays.week');
  const day = positiveInt(days.day, 'lifecycle.reminderDays.day');
  if (week >= grace) throw new TenantConfigError('lifecycle.reminderDays.week', 'must be fewer days than graceDays');
  if (day >= week) throw new TenantConfigError('lifecycle.reminderDays.day', 'must be fewer days than reminderDays.week');
  positiveInt(lifecycle.minReasonLength, 'lifecycle.minReasonLength');
  canonicalLocale(lifecycle.nameLocale, 'lifecycle.nameLocale');
  positiveInt(lifecycle.sweepBatch, 'lifecycle.sweepBatch');
}

/** The lifecycle's copy extension: every key, for every tag of the base copy. */
export function validateLifecycleCopy(value: unknown, tags: readonly string[]): void {
  const locales = bagAt(bagAt(value, 'lifecycle.copy').locales, 'lifecycle.copy.locales');
  const packs = new Map(tags.map((tag) => [tag, bagAt(locales[tag], `lifecycle.copy.locales.${tag}`)]));
  const sentences = tags.flatMap((tag) => TENANT_LIFECYCLE_COPY_KEYS.map((copyKey) => [tag, copyKey] as const));
  for (const [tag, copyKey] of sentences) {
    const key = `lifecycle.copy.locales.${tag}.${copyKey}`;
    const sentence = packs.get(tag)?.[copyKey];
    present(sentence, key);
    if (typeof sentence !== 'function') throw new TenantConfigError(key, 'must be a function that writes the whole sentence');
  }
}

function validateBlockers(lifecycle: Bag, hasTree: boolean): void {
  const blockers = bagAt(lifecycle.blockers, 'lifecycle.blockers');
  const seen = new Set<string>();
  listAt(blockers.kinds, 'lifecycle.blockers.kinds').forEach((entry, index) => {
    const kind = blockerKind(entry, `lifecycle.blockers.kinds[${index}]`);
    if (seen.has(kind)) throw new TenantConfigError(`lifecycle.blockers.kinds[${index}].kind`, `repeats "${kind}"`);
    seen.add(kind);
  });
  fnAt(blockers, 'read', 'lifecycle.blockers.read');
  if (!hasTree) {
    if (lifecycle.openDescendants !== undefined) {
      throw new TenantConfigError('lifecycle.openDescendants', 'is given with no tree: only a tenant built with `tree` has descendants');
    }
    return;
  }
  const kind = blockerKind(lifecycle.openDescendants, 'lifecycle.openDescendants');
  if (seen.has(kind)) {
    throw new TenantConfigError('lifecycle.openDescendants.kind', `repeats "${kind}", already one of blockers.kinds`);
  }
}

const HOOKS = ['confirmDangerousAct', 'afterClose', 'invalidate', 'notify', 'onPurgeDue', 'audit', 'locale', 'onError'] as const;

const MIRROR = ['replaced', 'event', 'deleted'] as const;

/**
 * The lifecycle's config. `tags` are the base copy's locales (each needs the
 * lifecycle's sentences too); `hasTree` says whether the tenant has a tree.
 */
export function validateLifecycle(value: unknown, tags: readonly string[], hasTree: boolean): void {
  if (value === null || !isBag(value)) {
    throw new TenantConfigError('lifecycle', 'must be the lifecycle config object, or be left out');
  }
  validateNumbers(value);
  validateLifecycleCopy(value.copy, tags);
  const db = bagAt(value.db, 'lifecycle.db');
  fnAt(db, 'transaction', 'lifecycle.db.transaction');
  fnAt(db, 'table', 'lifecycle.db.table');
  validateBlockers(value, hasTree);
  for (const hook of HOOKS) fnAt(value, hook, `lifecycle.${hook}`);
  if (value.mirror === undefined) return;
  const mirror = bagAt(value.mirror, 'lifecycle.mirror');
  for (const member of MIRROR) fnAt(mirror, member, `lifecycle.mirror.${member}`);
}

function validateAdmin(value: unknown): void {
  const admin = bagAt(value, 'gates.admin');
  const prefix = textAt(admin.prefix, 'gates.admin.prefix');
  if (!prefix.startsWith('/') || prefix.endsWith('/')) {
    throw new TenantConfigError('gates.admin.prefix', 'must start with "/" and not end with one');
  }
  listAt(admin.closingWrites, 'gates.admin.closingWrites').forEach((path, index) => {
    const write = textAt(path, `gates.admin.closingWrites[${index}]`);
    if (!write.startsWith('/')) throw new TenantConfigError(`gates.admin.closingWrites[${index}]`, 'must start with "/"');
  });
}

function validateFamily(value: unknown, key: string): void {
  const family = bagAt(value, key);
  present(family.readsToo, `${key}.readsToo`);
  if (typeof family.readsToo !== 'boolean') throw new TenantConfigError(`${key}.readsToo`, 'must be true or false');
  for (const list of ['fixedWords', 'slugAfter'] as const) {
    listAt(family[list], `${key}.${list}`).forEach((word, index) => textAt(word, `${key}.${list}[${index}]`));
  }
}

function validatePublic(value: unknown): void {
  const pub = bagAt(value, 'gates.public');
  const prefix = textAt(pub.prefix, 'gates.public.prefix');
  if (!prefix.startsWith('/') || prefix.endsWith('/')) {
    throw new TenantConfigError('gates.public.prefix', 'must start with "/" and not end with one');
  }
  const families = bagAt(pub.families, 'gates.public.families');
  for (const [name, family] of Object.entries(families)) validateFamily(family, `gates.public.families.${name}`);
}

/** The gates' config. */
export function validateGates(value: unknown): void {
  const gates = bagAt(value, 'gates');
  validateAdmin(gates.admin);
  validatePublic(gates.public);
  for (const hook of ['lookup', 'holdsClose', 'locale'] as const) fnAt(gates, hook, `gates.${hook}`);
}
