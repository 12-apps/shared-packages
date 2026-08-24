/**
 * The wiring-compliance suite (the report-builder shape): the manifests are
 * plain `satisfies`-checked values with the contract as a type-only
 * devDependency, so the producer factories' runtime assertions run HERE.
 *
 * The surface gets a BEHAVIOURAL case beside the declarations, because the
 * binding it exists to make is invisible to a type: both screens must receive
 * the SAME client object the host bound once, and the run screen the same
 * channel identity — a factory that rebuilt either would type-check and then
 * break the hook the run screen uses it as.
 */

import { describe, expect, it } from 'vitest';
import {
  assertDbMirror,
  assertEnvMirror,
  assertExportsMirror,
  defineManifest,
  defineWebManifest,
} from '@12-apps/wiring/producer';
import type { PackageManifest } from '@12-apps/wiring';

import packageJson from '../../../package.json';
import type { ResearchApiClient } from '../../client';
import type { UseResearchRunChannel } from '../../run-channel';
import { productResearchUiManifest } from '../index';
import { productResearchUiWebManifest } from '../web';

/**
 * The manifest as an ADOPTER's type sees it — `as const satisfies` narrows to
 * the literal, on which an absent optional key is a compile error rather than
 * `undefined`. Built per case: the flakiness lane refuses shared test-scope
 * bindings.
 */
function declared(): PackageManifest {
  return productResearchUiManifest;
}

/** A port that answers nothing — no case below renders. */
function port(): ResearchApiClient {
  return {} as ResearchApiClient;
}

describe('the product-research-ui manifest', () => {
  it('passes the producer assertions — the contract is a devDependency, so the check lives here', () => {
    expect(defineManifest(productResearchUiManifest)).toBe(productResearchUiManifest);
    expect(defineWebManifest(productResearchUiManifest, productResearchUiWebManifest)).toBe(
      productResearchUiWebManifest,
    );
  });

  it('declares the web half and the namespace it shares with the engine', () => {
    expect(productResearchUiManifest.name).toBe('@12-apps/product-research-ui');
    expect(productResearchUiManifest.contract).toBe(1);
    expect(productResearchUiManifest.web).toEqual(['surface', 'areas']);
    // The same namespace as `@12-apps/product-research`: a buyer's failed
    // research is ONE incident whichever half raised it.
    expect(productResearchUiManifest.observability).toEqual({ namespace: 'product-research' });
  });

  it('declares no server inventory and none of the engine capabilities', () => {
    expect(declared().server).toBeUndefined();
    expect(declared().db).toBeUndefined();
    expect(declared().mcp).toBeUndefined();
    expect(declared().permissions).toBeUndefined();
    expect(declared().env).toBeUndefined();
    expect(declared().e2e).toBeUndefined();
  });

  it('suggests the two admin routes, deep-linkable run included, with no gates', () => {
    expect(productResearchUiWebManifest.areas).toEqual([
      {
        area: 'admin',
        routes: [
          { path: 'research', screen: 'home' },
          { path: 'research/requests/:requestId', screen: 'run' },
        ],
        nav: [{ testId: 'research', path: 'research' }],
      },
    ]);
    // The ids belong to the sibling that enforces them — see `../web`.
    const [area] = productResearchUiWebManifest.areas;
    expect(area?.routes.every((route) => !('permission' in route))).toBe(true);
    expect(area?.nav.every((row) => !('feature' in row) && !('badge' in row))).toBe(true);
  });

  it('mirrors the (absent) db declaration and the manifest subpaths into package.json', () => {
    assertDbMirror(productResearchUiManifest, packageJson);
    assertEnvMirror(productResearchUiManifest, packageJson);
    assertExportsMirror(productResearchUiManifest, packageJson);
  });
});

describe('the bound surface', () => {
  it('names one screen per suggested route', () => {
    const surface = productResearchUiWebManifest.surface.create({ client: port() });
    const [area] = productResearchUiWebManifest.areas;
    const screens = new Set(Object.keys(surface));
    for (const route of area?.routes ?? []) {
      expect(screens.has(route.screen)).toBe(true);
    }
  });

  it('binds ONE client and ONE channel identity into both screens', () => {
    const client = port();
    const runChannel = (() => ({})) as unknown as UseResearchRunChannel;
    const surface = productResearchUiWebManifest.surface.create({ client, runChannel });

    // The elements the surface renders carry the bound values as props, which
    // is the only place the binding is observable without a DOM.
    const home = surface.home({ messages: {} as never, onOpenRequest: () => undefined });
    const run = surface.run({ messages: {} as never, requestId: 'r1' });

    expect(home.props.client).toBe(client);
    expect(run.props.client).toBe(client);
    // Stable for the life of the screen — the seam is used as a hook.
    expect(run.props.runChannel).toBe(runChannel);
  });

  it('leaves the run screen polling when the host declines the realtime seam', () => {
    const surface = productResearchUiWebManifest.surface.create({ client: port() });
    const run = surface.run({ messages: {} as never, requestId: 'r1' });
    expect(run.props.runChannel).toBeUndefined();
  });
});
