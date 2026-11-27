import { describe, expect, it } from 'vitest';

import { createTenantExport, type TenantExportConfig } from '../export';
import { TenantConfigError } from '../server';
import { exportHost } from './export-fixtures';

/**
 * Every required piece of the export's config fails at boot, by name, when it
 * is missing: the package never adopts a value of its own.
 */

type Bag = Record<string, unknown>;

/** A deep copy of the config (functions kept) with the dotted `path` deleted. */
function without(config: unknown, dotted: string): unknown {
  const copy = copyOf(config);
  const parts = dotted.split('.');
  const last = parts.pop() as string;
  const parent = parts.reduce<Bag>((bag, part) => bag[part] as Bag, copy as Bag);
  delete parent[last];
  return copy;
}

function copyOf(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(copyOf);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, copyOf(child)]));
}

const REQUIRED = [
  'db',
  'db.transaction',
  'db.table',
  'db.isUniqueViolation',
  'sections',
  'sections.0.kind',
  'sections.0.name',
  'sections.0.data',
  'sections.1.header',
  'sections.1.pages',
  'archives',
  'archives.key',
  'archives.putStream',
  'archives.presign',
  'archives.delete',
  'archives.deleteTenant',
  'limits',
  'limits.linkDays',
  'limits.maxAttempts',
  'limits.staleAfterMs',
  'limits.beatEveryMs',
  'limits.sweepBatch',
  'copy',
  'copy.locales',
  'copy.locales.en-GB',
  'copy.locales.pt-BR',
  'copy.locales.en-GB.archiveFilename',
  'archiveLocale',
  'authorize',
  'enqueueBuild',
  'notify',
  'audit',
] as const;

/** The key the error names: `sections.0.kind` reads `export.sections[0].kind`. */
const named = (path: string): string => `export.${path}`.replace(/\.(\d+)(?=\.|$)/gu, '[$1]');

function refusal(run: () => unknown): TenantConfigError {
  try {
    run();
  } catch (error) {
    if (error instanceof TenantConfigError) return error;
    throw error;
  }
  throw new Error('no TenantConfigError');
}

/** The key a config with `override` is refused on. */
function keyOf(env: ReturnType<typeof exportHost>, override: Partial<TenantExportConfig<{ label: 'tx' }>>): string {
  return refusal(() => env.build(override)).key;
}

describe('the export config', () => {
  it('boots with every piece given', () => {
    expect(() => exportHost().build()).not.toThrow();
  });

  it.each(REQUIRED)('fails at boot without %s, naming it', (path) => {
    const env = exportHost();
    const broken = without(env.config, path) as TenantExportConfig<{ label: 'tx' }>;
    const error = refusal(() => createTenantExport({ ...env.host.tenant(), port: env.host.config.port }, env.host.lifecycle, broken));
    expect(error.key).toBe(named(path));
  });

  it.each(['locale', 'onError', 'db.table'])('fails at boot without lifecycle.%s, naming it', (path) => {
    const env = exportHost();
    const lifecycle = without(env.host.lifecycle, path) as typeof env.host.lifecycle;
    const error = refusal(() => createTenantExport({ ...env.host.tenant(), port: env.host.config.port }, lifecycle, env.config));
    expect(error.key).toBe(`lifecycle.${path}`);
  });

  it('fails at boot without the tenant port time zone', () => {
    const env = exportHost();
    const port: Partial<typeof env.host.config.port> = { ...env.host.config.port };
    delete port.timeZone;
    const error = refusal(() => createTenantExport({ ...env.host.tenant(), port } as never, env.host.lifecycle, env.config));
    expect(error.key).toBe('port.timeZone');
  });

  it('refuses bad values', () => {
    const env = exportHost();
    const cases: [Partial<TenantExportConfig<{ label: 'tx' }>>, string][] = [
      [{ sections: [] }, 'export.sections'],
      [{ sections: [{ kind: 'file', name: 'a.csv', data: async () => '' }, { kind: 'file', name: 'a.csv', data: async () => '' }] }, 'export.sections[1].name'],
      [{ sections: [{ kind: 'nope', name: 'a' } as never] }, 'export.sections[0].kind'],
      [{ sections: [{ kind: 'files' } as never] }, 'export.sections[0].files'],
      [{ limits: { ...env.config.limits, beatEveryMs: env.config.limits.staleAfterMs } }, 'export.limits.beatEveryMs'],
      [{ limits: { ...env.config.limits, linkDays: 0 } }, 'export.limits.linkDays'],
      [{ mirror: { created: async () => undefined } as never }, 'export.mirror.updated'],
    ];
    expect(cases.map(([override]) => keyOf(env, override))).toEqual(cases.map(([, key]) => key));
  });

  it('boots without a mirror: it is the expand phase only', () => {
    const env = exportHost();
    const config: Partial<typeof env.config> = { ...env.config };
    delete config.mirror;
    expect(() => createTenantExport({ ...env.host.tenant(), port: env.host.config.port }, env.host.lifecycle, config as typeof env.config)).not.toThrow();
  });
});
