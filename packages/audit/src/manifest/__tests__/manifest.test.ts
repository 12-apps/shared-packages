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
} from '@12-apps/wiring/producer';
import type { PackageManifest } from '@12-apps/wiring';

import packageJson from '../../../package.json';
import { auditManifest } from '../index';

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

  it('is DATA ONLY — no runtime inventory, so no host owes an unbound answer', () => {
    // The package does ship `createApiAudit`, and declaring `http` is its own
    // adoption: the inventory is what `assemble()` holds a host to, so listing
    // a surface an adopter may be mounting by hand would turn it red today.
    expect(declared().server).toBeUndefined();
    expect(declared().web).toBeUndefined();
  });

  it('declares no observability namespace — the contract exempts pure-data manifests', () => {
    // A namespace with nothing logging under it is a declaration about nobody.
    // It becomes mandatory on the release that declares a runtime capability.
    expect(declared().observability).toBeUndefined();
  });

  it('mirrors the db declaration and the manifest subpath into package.json', () => {
    // The mirror is what host tooling actually reads — plain JSON, because an
    // assembler cannot execute this package's TypeScript. `assertDbMirror` is
    // what stops the two from drifting.
    assertDbMirror(auditManifest, packageJson);
    assertExportsMirror(auditManifest, packageJson);
  });
});
