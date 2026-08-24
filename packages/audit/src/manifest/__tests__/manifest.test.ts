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

import packageJson from '../../../package.json';
import { auditManifest } from '../index';
import { auditServerManifest } from '../server';
import { auditWebManifest } from '../web';
import { AUDIT_READ_PERMISSION } from '../../core/permissions';
import { createWebAudit } from '../../react/create-web-audit';


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

  it('inventories every capability this package ships, and nothing it does not', () => {
    // The inventory is what `assemble()` holds a host to. `jobs` and `web`
    // both used to be absent while the code for them shipped — the retention
    // sweep with no schedule, and a real `createWeb*` factory with no
    // declaration and no written narrowing, in the package whose own docblock
    // argues that structural discovery is the drift the contract prevents.
    expect(auditManifest.server).toEqual(['http', 'jobs']);
    expect(auditManifest.web).toEqual(['surface', 'areas']);
  });

  it('declares the retention sweep with the cadence a host used to restate', () => {
    // The wire name a bound host sees is `audit.retention` — namespace
    // prepended once at bind time.
    expect(auditServerManifest.jobs.namespace).toBe('audit');
    const { retention } = auditServerManifest.jobs.blueprints;
    expect(retention.name).toBe('retention');
    // Single-flight and idempotent: two passes deleting from the same table
    // would race each other's cutoffs, and the next tick is the only recovery
    // an idempotent pass needs.
    expect(retention.queue).toBe('sweeps');
    expect(retention.concurrency).toBe(1);
    expect(retention.attempts).toBe(1);
    expect(retention.schedule).toEqual({ pattern: '30 4 * * *' });
    expect(retention.lease).toEqual({ ttlMs: 30 * 60_000 });
    // No timezone, deliberately: a package cannot know a host's business
    // hours, and UTC is the honest default rather than a guess at one.
    expect(retention.schedule).not.toHaveProperty('timezone');
  });

  it('declares the trail surface, gated on the id this package itself owns', () => {
    expect(auditWebManifest.surface.create).toBe(createWebAudit);
    const [area] = auditWebManifest.areas;
    expect(area.area).toBe('admin');
    // Referenced, not retyped — the manifest cannot drift from the gate the
    // server half enforces.
    expect(area.routes[0]?.permission).toBe(AUDIT_READ_PERMISSION);
    expect(area.nav[0]?.permission).toBe(AUDIT_READ_PERMISSION);
    // The trail names who did what; it is not a screen to leave ungated.
    expect(AUDIT_READ_PERMISSION).toBe('audit:read');
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
    expect(defineWebManifest(auditManifest, auditWebManifest)).toBe(auditWebManifest);
  });

  it('mirrors the db declaration and the manifest subpath into package.json', () => {
    // The mirror is what host tooling actually reads — plain JSON, because an
    // assembler cannot execute this package's TypeScript. `assertDbMirror` is
    // what stops the two from drifting.
    assertDbMirror(auditManifest, packageJson);
    assertExportsMirror(auditManifest, packageJson);
  });
});
