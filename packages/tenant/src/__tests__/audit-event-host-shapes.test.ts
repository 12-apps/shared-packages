/**
 * FUT-5636 round 1, B1: a host's EXHAUSTIVE switch over the lifecycle's
 * `TenantAuditEvent` keeps compiling across this release. The check is
 * compile-time: this file is in the package's `tsc`, so a new member of the
 * union (the purge's act was briefly one) fails here, with TS2366, instead of
 * in the host's catalog bump. The purge's event is its own type.
 */
import { describe, expect, it } from 'vitest';

import type { TenantAuditEvent, TenantPurgeAuditEvent } from '../server';

/** A host's `after` writer as a real adopter wrote it: a switch with no default, every act a return. */
function hostAfter(event: TenantAuditEvent): string {
  switch (event.act) {
    case 'closeScheduled':
      return `scheduled ${event.reason}`;
    case 'closeReopened':
      return `reopened ${event.restored}`;
    case 'afterCloseFailed':
      return `failed ${event.error}`;
  }
}

/** The purge's event: written by the purge config's own `audit`. */
function purgeAfter(event: TenantPurgeAuditEvent): string {
  return `purged ${event.erased.length}`;
}

describe('the audit event unions a host switches over', () => {
  it('the lifecycle union is the three acts a host already handles; the purge act is apart', () => {
    expect(hostAfter({ act: 'afterCloseFailed', tenantId: 't', error: 'x' })).toBe('failed x');
    expect(purgeAfter({ act: 'closePurged', tenantId: 't', purgeAt: new Date(0), erased: ['a'] })).toBe('purged 1');
  });
});
