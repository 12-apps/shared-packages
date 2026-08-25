/**
 * The wiring-compliance suite (the report-builder shape): the manifest is a
 * plain `satisfies`-checked value with the contract as a type-only
 * devDependency, so the producer factories' runtime assertions run HERE.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

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
import { RBAC_PERMISSIONS } from '../../permissions';
import { rbacMcpEndpoints } from '../../mcp';
import { rbacManifest } from '../index';
import { rbacServerManifest } from '../server';
import { rbacWebManifest } from '../web';
import { createWebRbac } from '../../react/create-web-rbac';
import { createTeamInvitedBlueprint } from '../../server/notifications';
import { PT_BR_TEAM_INVITED_COPY } from '../../server/pt-BR';

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
    expect(defineWebManifest(rbacManifest, rbacWebManifest)).toBe(rbacWebManifest);
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

  it('declares the web surface — a server host reports it out-of-scope, it is not owed an answer', () => {
    // The narrowing this replaces claimed a server host would be obliged to
    // answer for the React half. It is not: a capability declared for the
    // OTHER runtime is reported `out-of-scope`, and only an applicable
    // unanswered one is `unbound`. Declaring is what makes the role editor and
    // the team screens adoptable at all.
    expect(rbacManifest.web).toEqual(['surface', 'areas']);
    expect(rbacWebManifest.surface.create).toBe(createWebRbac);
  });

  it('gates the suggested rows with ids THIS package contributes, never host vocabulary', () => {
    // A package guessing at a host's permission spelling would be wrong for
    // every host but the first; these two are ids the host already received in
    // the contribution, and `gatePermissions` remaps them if it spells them
    // otherwise. The pin is what stops a rename desyncing the two.
    const area = rbacWebManifest.areas[0];
    expect(area.area).toBe('admin');
    const gates = area.routes.map((route) => route.permission);
    // The DISTINCT set, not the list: the roster and the per-member profile
    // are two routes behind one gate, and pinning the list would make adding a
    // route behind an ALREADY-contributed id look like a violation.
    expect([...new Set(gates)].sort()).toEqual(['roles:manage', 'team:read']);
    gates.forEach((gate) => {
      expect(RBAC_PERMISSIONS.ids).toContain(gate);
    });
    // Every nav row opens a route this area actually declares.
    const paths = new Set(area.routes.map((route) => route.path));
    area.nav.forEach((row) => {
      expect(paths.has(row.path)).toBe(true);
    });
  });

  it('declares no STATIC notifications capability — the invite copy is the host\'s', () => {
    // A blueprint pre-worded here would be a silent pt-BR default inside a
    // library. The capability ships as a factory instead, and this pins that
    // the manifest does not quietly grow a worded one.
    expect(declared().notifications).toBeUndefined();
    const blueprint = createTeamInvitedBlueprint(PT_BR_TEAM_INVITED_COPY);
    expect(blueprint.type).toBe('rbac.team.invited');
  });

  it('mirrors the db declaration and the manifest subpaths into package.json', () => {
    assertDbMirror(rbacManifest, packageJson);
    assertExportsMirror(rbacManifest, packageJson);
  });

  it('declares the packaged journeys, so a host must answer for them', () => {
    // Undeclared, they were adopted by convention: three specs in the origin
    // host asserting this package's own test ids from outside it, invisible to
    // `assemble()`. Declared, a host either binds `featuresRoot` or declines in
    // writing — and the decline is in the report rather than in nobody's head.
    expect(rbacManifest.e2e).toEqual({
      entry: '@12-apps/rbac/e2e',
      world: { factory: 'defineRbacWorld' },
    });
  });

  it('declares no jobs and no email, and the docblock says why', () => {
    // The contract's rule is bound-or-declined-in-writing, and silence is
    // neither. Both absences are real — nothing here is deferred, and the one
    // reader this package cannot reach (an accountless invitee) needs a mail
    // that belongs to the flow owning the address before an account exists.
    // What this pins is that they stay ABSENT rather than drifting into an
    // empty declaration, which would oblige every host to bind deps for work
    // that does not exist.
    const manifest = rbacManifest as Record<string, unknown>;
    expect(manifest.jobs).toBeUndefined();
    expect(manifest.email).toBeUndefined();
    expect(rbacManifest.server).toEqual(['http']);
  });

  it('declares no STATIC mcp capability — the seventeen tools need a vocabulary', () => {
    // The contract carves this case out by name, and `lifecycleMcpEndpoints`
    // is the precedent: a tool table that cannot exist without the host's
    // mount path, catalog and sentences joins the aggregate through the
    // adoption's `mcpEndpoints` rather than sitting in the manifest.
    //
    // What this pins is that the carve-out stays HONEST in both directions —
    // no static declaration appears, AND the factory the docblock promises is
    // really exported. A narrowing whose replacement went missing would read
    // exactly like this one and ship no tools at all.
    expect((rbacManifest as Record<string, unknown>).mcp).toBeUndefined();
    expect(typeof rbacMcpEndpoints).toBe('function');
  });

  it('reads no process.env in shipped source, which is what `no env` claims', () => {
    // The one narrowing that can rot WITHOUT anybody touching this manifest:
    // `env` is absent because every deployment-shaped decision reaches this
    // package as an argument, and the day somebody adds a `process.env` read
    // the manifest is silently wrong — a host would never be asked to declare
    // a variable the package had started depending on.
    //
    // Tests and the packaged journeys are excluded: neither ships, and a
    // journey legitimately reads the environment its host puts it in.
    //
    // COMMENTS ARE STRIPPED FIRST, and that is not a convenience: the
    // narrowing's own explanation — one file up — contains the words
    // `process.env` in the sentence saying this package never reads it. A
    // scanner counting prose would fire on the docblock justifying the rule,
    // which is the same reason the payments and adapter budgets count code
    // lines only. Documenting a boundary must never cost.
    const src = join(import.meta.dirname, '../..');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (entry !== '__tests__' && entry !== 'e2e') walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry) || /\.test\./.test(entry)) continue;
        const code = readFileSync(full, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '');
        if (code.includes('process.env')) offenders.push(full.slice(src.length + 1));
      }
    };
    walk(src);
    expect(offenders).toEqual([]);
  });
});
