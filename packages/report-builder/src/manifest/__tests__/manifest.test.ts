/**
 * The wiring-compliance suite. The producer factories already ASSERT at
 * import (a malformed manifest fails this file's imports before any case
 * runs); what the cases pin is the contract the manifests promise:
 * identity, inventory, and that the contributions ARE the existing exports
 * rather than parallel restatements that could drift.
 */

import { describe, expect, it } from 'vitest';
import type { WirePermissionsContribution } from '@12-apps/wiring';

import { REPORT_BUILDER_PERMISSIONS } from '../../server/contribution';
import { createApiReportBuilder } from '../../server/create-report-builder';
import { createWebReportBuilder } from '../../react/create-report-builder';
import { reportBuilderManifest } from '../index';
import { reportBuilderServerManifest } from '../server';
import { reportBuilderWebManifest } from '../web';

describe('the shared manifest', () => {
  it('declares the package identity and the runtime inventory', () => {
    expect(reportBuilderManifest.name).toBe('@12-apps/report-builder');
    expect(reportBuilderManifest.contract).toBe(1);
    expect(reportBuilderManifest.server).toEqual(['http']);
    expect(reportBuilderManifest.web).toEqual(['surface', 'areas']);
  });

  it('contributes the SAME permission object composePermissions consumers use', () => {
    // Identity, not equality: a copy could drift from the /server export.
    expect(reportBuilderManifest.permissions).toBe(REPORT_BUILDER_PERMISSIONS);
    // And the rbac-shaped contribution satisfies the wiring twin.
    const contribution: WirePermissionsContribution = REPORT_BUILDER_PERMISSIONS;
    expect(contribution.ids).toEqual(['reports:manage']);
  });

  it('declares the Prisma contribution prisma:sync actually copies', () => {
    expect(reportBuilderManifest.db).toEqual({
      partial: 'prisma/report-builder.prisma',
      migrations: 'prisma/migrations',
    });
  });
});

describe('the runtime manifests', () => {
  it('hands hosts the existing factories, not wrappers that could drift', () => {
    expect(reportBuilderServerManifest.http?.create).toBe(createApiReportBuilder);
    expect(reportBuilderWebManifest.surface?.create).toBe(createWebReportBuilder);
  });

  it('suggests the admin area as one splat route with a matching nav anchor', () => {
    const area = reportBuilderWebManifest.areas?.[0];
    expect(area?.area).toBe('admin');
    expect(area?.routes?.map((route) => route.path)).toEqual(['reports/*']);
    expect(area?.nav?.[0]?.path).toBe('reports/*');
  });
});
