/**
 * The harness's OWN endpoints around `@12-apps/impersonation` — the demo routes
 * that stand behind the write gate, and the controls the browser drives.
 *
 * Split out of `impersonation-host.ts` for the size gate, along the seam the
 * file already had: nothing here is wiring. The four demo routes are the
 * arrangement every guarded route in a real app has (a money write, an
 * allowlisted money read, an unlisted money GET where the verb lies, and an
 * account write), and the `/__harness/**` routes are levers no endpoint of the
 * package exposes — which branches exist, who works at one, what the trail
 * recorded, and the two switches a spec flips.
 */
import type { Hono } from 'hono';

import {
  IMPERSONATION_TENANTS,
  PEOPLE,
  SYSTEM_LIBRARIAN,
} from './impersonation-directory';
import type { HarnessImpersonation } from './impersonation-host';
import { RBAC_TENANT_ID } from './rbac-host';

/**
 * The HOST endpoints that stand behind the gate — the arrangement every guarded
 * route in a real app has, and the only way to see the refusals from a browser.
 *
 * Four shapes, deliberately: a money WRITE, an allowlisted money READ, an
 * unlisted money GET (the one where the verb lies), and an account write.
 */
export function mountImpersonationDemo(app: Hono, harness: HarnessImpersonation): void {
  app.get('/api/loans', (c) => c.json({ loans: [{ id: 'l-1', title: 'Dune' }] }));
  app.get('/api/loans/:id/receipt', (c) => c.json({ receipt: c.req.param('id') }));
  app.post('/api/loans/:id/renew', (c) => c.json({ renewed: c.req.param('id') }));
  app.post('/api/borrower-profile', (c) => c.json({ saved: true }));
  app.post('/api/catalog-notes', (c) => c.json({ saved: true }));

  // The host's OWN catalogs, which the dialog takes as config: the branches a
  // session may be bounded to, and who works at one.
  app.get('/__harness/impersonation/branches', (c) => c.json(IMPERSONATION_TENANTS));
  app.get('/__harness/impersonation/staff/:slug', (c) => {
    const slug = c.req.param('slug');
    const branch = IMPERSONATION_TENANTS.find((tenant) => tenant.slug === slug);
    return c.json(
      PEOPLE.filter((person) => person.tenantId === branch?.id).map((person) => person.id),
    );
  });

  app.get('/__harness/impersonation/trail', (c) => c.json(harness.trail));
  app.post('/__harness/impersonation/revoke', async (c) => {
    const body = (await c.req.json()) as { userId?: string; revoked?: boolean };
    harness.revoke(body.userId ?? SYSTEM_LIBRARIAN.id, body.revoked !== false);
    return c.body(null, 204);
  });
  app.post('/__harness/impersonation/entitlement', async (c) => {
    const body = (await c.req.json()) as { tenantId?: string; enabled?: boolean };
    harness.setEntitled(body.tenantId ?? RBAC_TENANT_ID, body.enabled !== false);
    return c.body(null, 204);
  });
}
