import { describe, expect, it } from 'vitest';

import { lifecycleMcpEndpoints, type LifecycleEndpointVocabulary } from '../endpoints';
import {
  draftItemParams,
  draftResponse,
  draftsResponse,
  lifecycleTenantParams,
  saveDraftBody,
  versionItemParams,
  versionsParams,
  versionsResponse,
  writeOutcomeResponse,
} from '../schemas';

/**
 * These assertions are a CONTRACT, not a description.
 *
 * Every operation id here is an MCP tool name a connected agent has already
 * learned, and every path is a route a host already serves. Changing one is not
 * a refactor — it is a tool disappearing from under whoever was using it, and a
 * 404 for whoever was calling it. So the eight are written out in full, by hand,
 * rather than derived the way the implementation derives them: a test that
 * builds its expectation with the same template as the code under test would
 * agree with any typo it contained.
 */

const summaries: LifecycleEndpointVocabulary['summaries'] = {
  getVersions: 'history',
  restoreVersion: 'restore',
  getDraft: 'read draft',
  saveDraft: 'write draft',
  publishDraft: 'publish',
  discardDraft: 'discard',
  listDrafts: 'list drafts',
  createDraft: 'new draft',
};

const suppliers = () =>
  lifecycleMcpEndpoints({
    collectionPath: '/api/admin/{tenantSlug}/suppliers',
    noun: 'Supplier',
    summaries,
  });

describe('lifecycleMcpEndpoints', () => {
  it('emits the eight capabilities, in a fixed order', () => {
    expect(suppliers().map((e) => e.operationId)).toEqual([
      'getSupplierVersions',
      'restoreSupplierVersion',
      'getSupplierDraft',
      'saveSupplierDraft',
      'publishSupplierDraft',
      'discardSupplierDraft',
      'listSupplierDrafts',
      'createSupplierDraft',
    ]);
  });

  it('routes each one where the host already serves it', () => {
    expect(suppliers().map((e) => `${e.method.toUpperCase()} ${e.path}`)).toEqual([
      'GET /api/admin/{tenantSlug}/suppliers/{id}/versions',
      'POST /api/admin/{tenantSlug}/suppliers/{id}/versions/{version}/restore',
      'GET /api/admin/{tenantSlug}/suppliers/{id}/draft',
      'PUT /api/admin/{tenantSlug}/suppliers/{id}/draft',
      'POST /api/admin/{tenantSlug}/suppliers/drafts/{draftId}/publish',
      'DELETE /api/admin/{tenantSlug}/suppliers/drafts/{draftId}',
      'GET /api/admin/{tenantSlug}/suppliers/drafts',
      'POST /api/admin/{tenantSlug}/suppliers/drafts',
    ]);
  });

  it('takes a collection mounted deeper than one segment', () => {
    // One real host keeps its loss reasons under `config/`, which is why the
    // vocabulary carries a PATH and not a segment.
    const [first] = lifecycleMcpEndpoints({
      collectionPath: '/api/admin/{tenantSlug}/config/loss-reasons',
      noun: 'LossReason',
      summaries,
    });
    expect(first?.operationId).toBe('getLossReasonVersions');
    expect(first?.path).toBe('/api/admin/{tenantSlug}/config/loss-reasons/{id}/versions');
  });

  it('binds each endpoint to the shared schemas', () => {
    const byId = new Map(suppliers().map((e) => [e.operationId, e]));
    expect(byId.get('getSupplierVersions')?.params).toBe(versionsParams);
    expect(byId.get('getSupplierVersions')?.response).toBe(versionsResponse);
    expect(byId.get('restoreSupplierVersion')?.params).toBe(versionItemParams);
    expect(byId.get('restoreSupplierVersion')?.response).toBe(writeOutcomeResponse);
    expect(byId.get('saveSupplierDraft')?.body).toBe(saveDraftBody);
    expect(byId.get('saveSupplierDraft')?.response).toBe(draftResponse);
    expect(byId.get('publishSupplierDraft')?.params).toBe(draftItemParams);
    expect(byId.get('listSupplierDrafts')?.params).toBe(lifecycleTenantParams);
    expect(byId.get('listSupplierDrafts')?.response).toBe(draftsResponse);
  });

  it('gives the discard a 204 and therefore no response schema', () => {
    // The pair a manifest cannot advertise together — a body promised by a
    // schema that the route will never send.
    const discard = suppliers().find((e) => e.operationId === 'discardSupplierDraft');
    expect(discard?.status).toBe(204);
    expect(discard?.response).toBeUndefined();
  });

  it('says what each tool is for in the HOST’s words, unedited', () => {
    // The summaries are passed through rather than built from the noun. One
    // host's six differ in ways no template produces — "uncreated stations"
    // beside "uncreated items", and a collection named in Portuguese.
    const real = 'The tenant\'s open kitchen-station drafts (including drafts of new, uncreated stations).';
    const [, , , , , , listDrafts] = lifecycleMcpEndpoints({
      collectionPath: '/api/admin/{tenantSlug}/kitchen-stations',
      noun: 'KitchenStation',
      summaries: { ...summaries, listDrafts: real },
    });
    expect(listDrafts?.summary).toBe(real);
  });

  it('tags every endpoint together, and lets a host say otherwise', () => {
    expect(suppliers().every((e) => e.tags?.join() === 'lifecycle')).toBe(true);
    const custom = lifecycleMcpEndpoints({
      collectionPath: '/x',
      noun: 'X',
      summaries,
      tags: ['lifecycle', 'config'],
    });
    expect(custom.every((e) => e.tags?.join() === 'lifecycle,config')).toBe(true);
  });

  it('hands each call its own arrays, so one host cannot edit another', () => {
    const a = suppliers();
    const b = suppliers();
    expect(a[0]?.tags).not.toBe(b[0]?.tags);
  });
});

/**
 * The behaviour defaults — Phase 3's producer half.
 *
 * These are what let a host's policy-hint table become OVERRIDES: 48
 * hand-written lines for one factory's eight endpoints, times every collection
 * plugged in, restating what this file already knows. Written out by hand for
 * the same reason as the operation ids above — deriving the expectation from
 * the same constants the code uses would agree with any mistake in them.
 */
describe('the behaviour a host no longer has to restate', () => {
  it('classifies every one of the eight, and never reaches outside the host', () => {
    const byId = Object.fromEntries(
      suppliers().map((endpoint) => [endpoint.operationId, endpoint.annotations]),
    );
    expect(byId).toEqual({
      getSupplierVersions: { readOnly: true, destructive: false, openWorld: false },
      restoreSupplierVersion: { readOnly: false, destructive: false, openWorld: false },
      getSupplierDraft: { readOnly: true, destructive: false, openWorld: false },
      saveSupplierDraft: { readOnly: false, destructive: false, openWorld: false },
      publishSupplierDraft: { readOnly: false, destructive: false, openWorld: false },
      // The one destructive tool of the eight: a discarded draft was never
      // published, so no version history covers it and nothing restores it.
      discardSupplierDraft: { readOnly: false, destructive: true, openWorld: false },
      listSupplierDrafts: { readOnly: true, destructive: false, openWorld: false },
      createSupplierDraft: { readOnly: false, destructive: false, openWorld: false },
    });
  });

  it('asserts behaviour and NOT the label — the title stays host copy', () => {
    // Behaviour is this package's knowledge; the words an agent reads are the
    // host's, in the host's language, from the same vocabulary that supplies
    // `noun` and `summaries`. A title here would be a silent default.
    suppliers().forEach((endpoint) => {
      expect(endpoint.annotations).not.toHaveProperty('title');
    });
  });

  it('hands every collection the same classification — it is about the verb, not the noun', () => {
    const products = lifecycleMcpEndpoints({
      collectionPath: '/api/admin/{tenantSlug}/products',
      noun: 'Product',
      summaries,
    });
    expect(products.map((endpoint) => endpoint.annotations)).toEqual(
      suppliers().map((endpoint) => endpoint.annotations),
    );
  });
});
