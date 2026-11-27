/**
 * Startup validation of the data export's config, read as `unknown` like the
 * rest of the package's: every missing or bad key is named
 * (`TenantConfigError`), and nothing falls back to a value of the host's.
 */
import { TenantConfigError } from '../validate';
import { TENANT_EXPORT_COPY_KEYS } from './types';

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

function nameAt(value: unknown, key: string): string | null {
  present(value, key);
  if (typeof value === 'function') return null;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TenantConfigError(key, 'must be a non-empty string, or a function that writes it');
  }
  return value;
}

const KINDS = new Set(['file', 'rows', 'files']);

/** One section: its kind, its name (a fixed one is answered, to check for repeats) and its readers. */
function validateSection(value: unknown, key: string): string | null {
  const section = bagAt(value, key);
  present(section.kind, `${key}.kind`);
  if (typeof section.kind !== 'string' || !KINDS.has(section.kind)) {
    throw new TenantConfigError(`${key}.kind`, 'must be "file", "rows" or "files"');
  }
  if (section.kind === 'files') {
    fnAt(section, 'files', `${key}.files`);
    return null;
  }
  const name = nameAt(section.name, `${key}.name`);
  if (section.kind === 'file') {
    fnAt(section, 'data', `${key}.data`);
    return name;
  }
  fnAt(section, 'header', `${key}.header`);
  fnAt(section, 'pages', `${key}.pages`);
  return name;
}

function validateSections(value: unknown): void {
  present(value, 'export.sections');
  if (!Array.isArray(value)) throw new TenantConfigError('export.sections', 'must be an array');
  if (value.length === 0) throw new TenantConfigError('export.sections', 'must name at least one section');
  const seen = new Map<string, number>();
  value.forEach((entry, index) => {
    const name = validateSection(entry, `export.sections[${index}]`);
    if (name === null) return;
    const first = seen.get(name);
    if (first !== undefined) {
      throw new TenantConfigError(`export.sections[${index}].name`, `repeats "${name}", already export.sections[${first}]`);
    }
    seen.set(name, index);
  });
}

function validateLimits(value: unknown): void {
  const limits = bagAt(value, 'export.limits');
  positiveInt(limits.linkDays, 'export.limits.linkDays');
  positiveInt(limits.maxAttempts, 'export.limits.maxAttempts');
  const stale = positiveInt(limits.staleAfterMs, 'export.limits.staleAfterMs');
  const beat = positiveInt(limits.beatEveryMs, 'export.limits.beatEveryMs');
  if (beat >= stale) throw new TenantConfigError('export.limits.beatEveryMs', 'must be shorter than staleAfterMs');
  positiveInt(limits.sweepBatch, 'export.limits.sweepBatch');
}

/** The export's sentences: every key, for every tag of the base copy. */
function validateCopy(value: unknown, tags: readonly string[]): void {
  const locales = bagAt(bagAt(value, 'export.copy').locales, 'export.copy.locales');
  for (const tag of tags) {
    const pack = bagAt(locales[tag], `export.copy.locales.${tag}`);
    for (const copyKey of TENANT_EXPORT_COPY_KEYS) {
      const key = `export.copy.locales.${tag}.${copyKey}`;
      present(pack[copyKey], key);
      if (typeof pack[copyKey] !== 'function') throw new TenantConfigError(key, 'must be a function that writes the whole name');
    }
  }
}

const ARCHIVES = ['key', 'putStream', 'presign', 'delete', 'deleteTenant'] as const;
const HOOKS = ['archiveLocale', 'authorize', 'enqueueBuild', 'notify', 'audit'] as const;
const MIRROR = ['created', 'updated', 'deleted'] as const;

/** The export's config. `tags` are the base copy's locales (each needs the export's sentences too). */
export function validateExport(value: unknown, tags: readonly string[]): void {
  const config = bagAt(value, 'export');
  const db = bagAt(config.db, 'export.db');
  for (const member of ['transaction', 'table', 'isUniqueViolation'] as const) fnAt(db, member, `export.db.${member}`);
  validateSections(config.sections);
  const archives = bagAt(config.archives, 'export.archives');
  for (const member of ARCHIVES) fnAt(archives, member, `export.archives.${member}`);
  validateLimits(config.limits);
  validateCopy(config.copy, tags);
  for (const hook of HOOKS) fnAt(config, hook, `export.${hook}`);
  if (config.mirror === undefined) return;
  const mirror = bagAt(config.mirror, 'export.mirror');
  for (const member of MIRROR) fnAt(mirror, member, `export.mirror.${member}`);
}

/** The lifecycle pieces the export reuses: the closing table (the link's cap), the request locale and `onError`. */
export function validateExportLifecycle(value: unknown): void {
  const lifecycle = bagAt(value, 'lifecycle');
  for (const hook of ['locale', 'onError'] as const) fnAt(lifecycle, hook, `lifecycle.${hook}`);
  fnAt(bagAt(lifecycle.db, 'lifecycle.db'), 'table', 'lifecycle.db.table');
}
