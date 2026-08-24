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
  defineWebManifest,
} from '@12-apps/wiring/producer';
import type { PackageManifest } from '@12-apps/wiring';

import packageJson from '../../../package.json';
import { entitlementsManifest } from '../index';
import { entitlementsServerManifest } from '../server';
import { entitlementsWebManifest } from '../web';
import { createWebEntitlements } from '../../react/create-web-entitlements';
import { createPlanChangedBlueprint, PLAN_CHANGED_NOTIFICATION_TYPE } from '../../server/notifications';
import { ptBrPlanChangedCopy } from '../../server/pt-BR';

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
    expect(defineWebManifest(entitlementsManifest, entitlementsWebManifest)).toBe(
      entitlementsWebManifest,
    );
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

  it('declares the web surface — a server host reports it out-of-scope, it is not owed an answer', () => {
    // The narrowing this replaces claimed a server host would be obliged to
    // answer for the React half. A capability declared for the OTHER runtime
    // is reported `out-of-scope`; only an applicable unanswered one is
    // `unbound`. Declaring is what makes the plan screens adoptable.
    expect(entitlementsManifest.web).toEqual(['surface', 'areas']);
    expect(entitlementsWebManifest.surface.create).toBe(createWebEntitlements);
  });

  it('suggests the plan route with NO permission gate — the upsell path must stay reachable', () => {
    // Gating the plan screen would hide the upgrade path from exactly the
    // people who cannot reach what they want. Who may REQUEST a change is a
    // separate decision, answered by `canRequestPlanChange`.
    const [area] = entitlementsWebManifest.areas;
    expect(area.area).toBe('admin');
    expect(area.routes).toEqual([{ path: 'plan', screen: 'page' }]);
    expect(area.nav[0]).toEqual({ testId: 'entitlements-plan', path: 'plan' });
  });

  it('declares no STATIC notifications capability — the plan words are the host\'s', () => {
    // Tier names are a commercial catalog, so the blueprint is a factory over
    // host copy; the manifest must not quietly grow a worded one.
    expect(declared().notifications).toBeUndefined();
    const blueprint = createPlanChangedBlueprint(ptBrPlanChangedCopy((key) => key));
    expect(blueprint.type).toBe(PLAN_CHANGED_NOTIFICATION_TYPE);
    expect(blueprint.category).toBe('system');
  });

  it('mirrors the db declaration and the manifest subpaths into package.json', () => {
    assertDbMirror(entitlementsManifest, packageJson);
    assertExportsMirror(entitlementsManifest, packageJson);
  });
});
