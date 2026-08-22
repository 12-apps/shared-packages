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
import { RBAC_PERMISSIONS } from '../../permissions';
import { rbacManifest } from '../index';
import { rbacServerManifest } from '../server';

/**
 * The manifest as an ADOPTER's type sees it. `as const satisfies` narrows the
 * value to its literal, on which an absent optional key is a compile error
 * rather than `undefined` — so the widened view is what a claim about
 * absence has to be made against. Built per case: the flakiness lane refuses
 * shared test-scope bindings.
 */
function declared(): PackageManifest {
  return rbacManifest;
}

describe('the rbac manifest', () => {
  it('passes the producer assertions — the contract is a devDependency, so the check lives here', () => {
    expect(defineManifest(rbacManifest)).toBe(rbacManifest);
    expect(defineServerManifest(rbacManifest, rbacServerManifest)).toBe(rbacServerManifest);
  });

  it('declares the admin surface, the five-model partial and the namespace', () => {
    expect(rbacManifest.name).toBe('@12-apps/rbac');
    expect(rbacManifest.contract).toBe(1);
    expect(rbacManifest.server).toEqual(['http']);
    expect(rbacManifest.db).toEqual({
      partial: 'prisma/rbac.prisma',
      migrations: 'prisma/migrations',
    });
    expect(rbacManifest.observability).toEqual({ namespace: 'rbac' });
  });

  it('contributes its own three ids, unlabelled — the words are host copy', () => {
    expect(rbacManifest.permissions).toBe(RBAC_PERMISSIONS);
    expect(rbacManifest.permissions.source).toBe('@12-apps/rbac');
    expect([...rbacManifest.permissions.ids].sort()).toEqual([
      'roles:manage',
      'team:manage',
      'team:read',
    ]);
    // Labels stay EMPTY rather than absent: `definePermissionContribution`
    // defaults the vocabulary to `{}`, so "ships no words" is a claim about
    // its contents. They render in the host's role editor, and shipping them
    // compiled in handed one application's voice to every adopter — this
    // contribution carried pt-BR domains and actions until it stopped.
    expect(Object.values(rbacManifest.permissions.labels ?? {}).flatMap((segment) =>
      Object.keys(segment ?? {}),
    )).toEqual([]);
  });

  it('declares no web inventory — a server host must not owe an answer for the React half', () => {
    expect(declared().web).toBeUndefined();
  });

  it('mirrors the db declaration and the manifest subpaths into package.json', () => {
    assertDbMirror(rbacManifest, packageJson);
    assertExportsMirror(rbacManifest, packageJson);
  });
});
