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
import { entitlementsManifest } from '../index';
import { entitlementsServerManifest } from '../server';

/**
 * The manifest as an ADOPTER's type sees it. `as const satisfies` narrows the
 * value to its literal, on which an absent optional key is a compile error
 * rather than `undefined` — so the widened view is what a claim about
 * absence has to be made against. Built per case: the flakiness lane refuses
 * shared test-scope bindings.
 */
function declared(): PackageManifest {
  return entitlementsManifest;
}

describe('the entitlements manifest', () => {
  it('passes the producer assertions — the contract is a devDependency, so the check lives here', () => {
    expect(defineManifest(entitlementsManifest)).toBe(entitlementsManifest);
    expect(defineServerManifest(entitlementsManifest, entitlementsServerManifest)).toBe(
      entitlementsServerManifest,
    );
  });

  it('declares the plan surface, the watermark partial and the namespace', () => {
    expect(entitlementsManifest.name).toBe('@12-apps/entitlements');
    expect(entitlementsManifest.contract).toBe(1);
    expect(entitlementsManifest.server).toEqual(['http']);
    expect(entitlementsManifest.db).toEqual({
      partial: 'prisma/entitlements.prisma',
      migrations: 'prisma/migrations',
    });
    expect(entitlementsManifest.observability).toEqual({ namespace: 'entitlements' });
  });

  it('declares no static permissions — the contribution is a factory over host copy', () => {
    // `plan:request` reaches a catalog through `entitlementsPermissions(labels)`
    // because its label segments render in the host's role editor. Declaring the
    // ids here would compile one application's vocabulary into every adopter.
    expect(declared().permissions).toBeUndefined();
  });

  it('declares no web inventory — a server host must not owe an answer for the React half', () => {
    expect(declared().web).toBeUndefined();
  });

  it('mirrors the db declaration and the manifest subpaths into package.json', () => {
    assertDbMirror(entitlementsManifest, packageJson);
    assertExportsMirror(entitlementsManifest, packageJson);
  });
});
