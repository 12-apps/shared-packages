import { describe, expect, it } from 'vitest';
import { assertDbMirror, assertEnvMirror, assertExportsMirror, defineManifest } from '@12-apps/wiring/producer';

import packageJson from '../../package.json';
import { tenantManifest } from '../manifest';

/**
 * The wiring contract is a type-only dependency, so the producer's assertions
 * run here: the manifest, and its mirrors into package.json.
 */
describe('the manifest', () => {
  it('passes the producer assertions and declares only the db', () => {
    expect(defineManifest(tenantManifest)).toBe(tenantManifest);
    expect(tenantManifest).toEqual({
      name: '@12-apps/tenant',
      contract: 1,
      db: { partial: 'prisma/tenant.prisma', migrations: 'prisma/migrations' },
    });
  });

  it('mirrors the db, the env absence and the exports into package.json', () => {
    expect(() => assertDbMirror(tenantManifest, packageJson)).not.toThrow();
    expect(() => assertEnvMirror(tenantManifest, packageJson)).not.toThrow();
    expect(() => assertExportsMirror(tenantManifest, packageJson)).not.toThrow();
    expect(packageJson.files).toEqual(expect.arrayContaining(['src', 'prisma', 'scripts']));
    expect(Object.keys(packageJson.exports)).toEqual(
      expect.arrayContaining(['.', './server', './hono', './react', './manifest']),
    );
  });
});
