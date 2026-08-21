import { DEMO_CATALOG, type DemoPermission } from '../../__tests__/demo-catalog';

import type { RbacAuditEntry, RbacServerConfig, RbacUserIdentity } from '../context';
import { createApiRbac, type ApiRbac } from '../create-api-rbac';
import { PT_BR_RBAC_MESSAGES } from '../pt-BR';

import { createFakeRbacDb, type FakeRbacState } from './fake-db';

/**
 * The shared test host (12-13): `createApiRbac` over the in-memory seam with
 * the DEMO host's composed catalog — the same wiring the harness proves over
 * real SQL, and the same one-object `catalog` seam a real host passes.
 */

export interface TestHost {
  api: ApiRbac<DemoPermission>;
  state: FakeRbacState;
  audits: RbacAuditEntry[];
  directory: Map<string, RbacUserIdentity>;
}

export function createTestHost(
  overrides: Partial<RbacServerConfig<DemoPermission>> = {},
): TestHost {
  const { db, state } = createFakeRbacDb();
  const audits: RbacAuditEntry[] = [];
  const directory = new Map<string, RbacUserIdentity>();
  const api = createApiRbac<DemoPermission>({
    db: async () => db,
    catalog: DEMO_CATALOG,
    // The demo host's OWN vocabulary — none of it a package default, and none
    // of it a word the extracted application used. `ownerRoles` is left unset
    // on purpose: it derives from `DEMO_CATALOG.governance.ownerRoles`
    // (DIRECTOR + NETWORK_OPS), so these suites run the roster invariants on
    // the set the composed catalog actually names.
    adminRoles: ['DIRECTOR', 'HEAD_LIBRARIAN'],
    customerRole: 'PATRON',
    // Required copy, passed the way a pt-BR host passes it — the suites
    // assert these exact sentences on the wire.
    messages: PT_BR_RBAC_MESSAGES,
    directory: {
      getUsers: async (ids) =>
        ids.flatMap((id) => {
          const identity = directory.get(id);
          return identity ? [identity] : [];
        }),
      searchUsers: async (q) =>
        [...directory.values()]
          .filter(
            (identity) =>
              identity.email.toLowerCase().includes(q.toLowerCase()) ||
              (identity.name ?? '').toLowerCase().includes(q.toLowerCase()),
          )
          .map((identity) => identity.id),
    },
    audit: (entry) => {
      audits.push(entry);
    },
    ...overrides,
  });
  return { api, state, audits, directory };
}

/** A member actor at a tenant. */
export const memberActor = (tenantId: string, userId: string) => ({
  tenantId,
  userId,
  isSuper: false,
});

/** The env-allowlist platform admin (no user row). */
export const superActor = (tenantId: string) => ({
  tenantId,
  userId: null,
  isSuper: true,
});
