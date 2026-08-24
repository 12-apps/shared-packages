import { describe, expect, it } from 'vitest';

import { createWebRbac } from '../../react/create-web-rbac';
import { rbacWebManifest } from '../web';

/**
 * The manifest's `areas` name SCREENS by string key, and nothing checked that
 * those strings resolve.
 *
 * A capability answered with a key the surface does not return is not a red
 * assembly: the consumer binds `surface`, reports it bound, and the host
 * projecting the row gets `undefined` where a component should be. The whole
 * point of declaring `areas` is that a host can build nav from data — so a key
 * that resolves to nothing is a nav entry to a blank screen, and the wiring
 * report says everything is fine.
 *
 * That is the same silent-hole class the capability contract exists to close,
 * reintroduced one level down by a string. This is the test that closes it.
 */
describe('rbacWebManifest areas', () => {
  /**
   * Built with the narrowest config that satisfies the factory. What is asserted
   * is the SHAPE of what comes back, so nothing here depends on the config being
   * realistic — only on it being accepted.
   */
  function surfaceKeys(): string[] {
    const surface = createWebRbac({
      apiBase: '/api/admin/t',
      catalog: {
        permissions: { list: [] },
        governance: { ownerRoles: ['OWNER'] },
        roleTemplates: [],
        labels: {},
      },
      copy: { operationFailed: 'failed', permissionLabels: {} },
    } as never);
    return Object.keys(surface as object);
  }

  it('names only screens the surface actually returns', () => {
    const keys = new Set(surfaceKeys());
    const declared = rbacWebManifest.areas.flatMap((area) =>
      area.routes.map((route) => route.screen),
    );

    expect(declared.length).toBeGreaterThan(0);
    for (const screen of declared) {
      expect({ screen, resolvable: keys.has(screen) }).toEqual({ screen, resolvable: true });
    }
  });

  it('gates every declared route on a permission this package owns', () => {
    // A row with no permission is a nav entry every member sees, whatever the
    // screen behind it then refuses — the gate belongs in the declaration so a
    // host can hide the row rather than serve a 403 to a click.
    for (const area of rbacWebManifest.areas) {
      for (const route of area.routes) {
        expect({ path: route.path, gated: typeof route.permission === 'string' }).toEqual({
          path: route.path,
          gated: true,
        });
      }
    }
  });
});
