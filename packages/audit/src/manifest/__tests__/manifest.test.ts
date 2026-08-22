/**
 * The wiring-compliance suite (the report-builder shape): the manifest is a
 * plain `satisfies`-checked value with the contract as a type-only
 * devDependency, so the producer factories' runtime assertions run HERE.
 */

import { describe, expect, it } from 'vitest';
import {
  assertDbMirror,
  assertExportsMirror,
  defineManifest,
  defineServerManifest,
} from '@12-apps/wiring/producer';
import type { PackageManifest } from '@12-apps/wiring';

import packageJson from '../../../package.json';
import { auditManifest } from '../index';
import { auditServerManifest } from '../server';

/**
 * The manifest as an ADOPTER's type sees it. `as const satisfies` narrows the
 * value to its literal, on which an absent optional key is a compile error
 * rather than `undefined` — so the widened view is what a claim about absence
 * has to be made against. Built per case: the flakiness lane refuses shared
 * test-scope bindings.
 */
function declared(): PackageManifest {
  return auditManifest;
}

describe('the audit manifest', () => {
  it('passes the producer assertions — the contract is a devDependency, so the check lives here', () => {
    expect(defineManifest(auditManifest)).toBe(auditManifest);
  });

  it('declares the audit-log partial and the migration that created it', () => {
    expect(auditManifest.name).toBe('@12-apps/audit');
    expect(auditManifest.contract).toBe(1);
    expect(auditManifest.db).toEqual({
      partial: 'prisma/audit.prisma',
      migrations: 'prisma/migrations',
    });
  });

  it('inventories the http capability, and nothing this package does not ship', () => {
    // The inventory is what `assemble()` holds a host to. `web` stays absent:
    // the React viewer is a component, not a mountable web surface.
    expect(auditManifest.server).toEqual(['http']);
    expect(declared().web).toBeUndefined();
  });

  it('files its telemetry under `audit` — mandatory now a runtime half exists', () => {
    // Withheld while the manifest was pure data (a namespace with nothing
    // logging under it is a declaration about nobody); required the moment a
    // capability runs, so a refused read files here rather than nowhere.
    expect(auditManifest.observability).toEqual({ namespace: 'audit' });
  });

  it('matches the inventory it declares — the server manifest cannot drift', () => {
    // `defineServerManifest` is the producer assertion that the runtime
    // manifest's keys are exactly what `./index` inventoried. A capability
    // added to one and not the other is a boot failure, not a silent 404.
    expect(defineServerManifest(auditManifest, auditServerManifest)).toBe(auditServerManifest);
  });

  it('mirrors the db declaration and the manifest subpath into package.json', () => {
    // The mirror is what host tooling actually reads — plain JSON, because an
    // assembler cannot execute this package's TypeScript. `assertDbMirror` is
    // what stops the two from drifting.
    assertDbMirror(auditManifest, packageJson);
    assertExportsMirror(auditManifest, packageJson);
  });
});
