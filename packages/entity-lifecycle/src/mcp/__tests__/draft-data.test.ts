import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  lifecycleMcpEndpoints,
  newItemDraftMcpEndpoints,
  type LifecycleEndpointVocabulary,
} from '../endpoints';
import { saveDraftBody, saveDraftBodyOf } from '../schemas';

/**
 * A collection's own draft `data` schema (FUT-4867).
 *
 * The host rule this exists for walks every input schema and refuses any OPEN
 * place in it: an object that is not strict, a shapeless type, a record keyed
 * by any string. `saveDraftBody` has exactly one such place — `data` — and it
 * is open on purpose, because the package cannot know a collection's fields.
 * These pin both halves: the host's schema closes it, and a host that passes
 * nothing is served the same open body as before.
 */

/** Zod's own description of a schema, as far as the walk below reads it. */
interface Def {
  type: string;
  [key: string]: unknown;
}

const defOf = (schema: unknown): Def | null =>
  (schema as { _zod?: { def?: Def } } | null)?._zod?.def ?? null;

/**
 * Every open place in `schema`, by path — the same three rules the host's
 * strict-inputs gate applies, over the kinds of schema a draft body is built
 * from (objects, wrappers, arrays, unions, records).
 */
function openPlaces(schema: unknown, path = '(root)'): string[] {
  const def = defOf(schema);
  if (!def) return [];
  if (def.type === 'object') {
    const here = defOf(def.catchall)?.type === 'never' ? [] : [`${path} (non-strict object)`];
    const shape = def.shape as Record<string, unknown>;
    return [...here, ...Object.entries(shape).flatMap(([key, child]) => openPlaces(child, `${path}.${key}`))];
  }
  if (['unknown', 'any', 'custom'].includes(def.type)) return [`${path} (${def.type})`];
  if (def.type === 'record') {
    const keyOpen = ['string', 'unknown', 'any'].includes(defOf(def.keyType)?.type ?? '');
    return [...(keyOpen ? [`${path} (record keyed by any string)`] : []), ...openPlaces(def.valueType, `${path}{}`)];
  }
  if (def.type === 'array') return openPlaces(def.element, `${path}[]`);
  if (def.type === 'union') return (def.options as unknown[]).flatMap((option) => openPlaces(option, path));
  return 'innerType' in def ? openPlaces(def.innerType, path) : [];
}

/** A collection's draft data the way a host would write it: strict at every depth, partial. */
const stationDraftData = z
  .strictObject({
    name: z.string(),
    sector: z.strictObject({ id: z.string(), label: z.string() }),
    tags: z.array(z.strictObject({ value: z.string() })),
  })
  .partial();

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

const vocabulary = (extra: Partial<LifecycleEndpointVocabulary> = {}): LifecycleEndpointVocabulary => ({
  collectionPath: '/api/admin/{tenantSlug}/kitchen-stations',
  noun: 'KitchenStation',
  summaries,
  ...extra,
});

describe('saveDraftBodyOf', () => {
  it('is closed at every depth when the collection schema is', () => {
    expect(openPlaces(saveDraftBodyOf(stationDraftData))).toEqual([]);
    // The shared body is the one open place the option exists to close.
    expect(openPlaces(saveDraftBody)).toEqual([
      '(root).data (record keyed by any string)',
      '(root).data{} (unknown)',
    ]);
  });

  it('refuses an unknown key at the top, inside data, and nested deeper', () => {
    const body = saveDraftBodyOf(stationDraftData);
    expect(body.safeParse({ data: { name: 'Chapa' } }).success).toBe(true);
    expect(body.safeParse({ data: {} }).success).toBe(true);
    expect(body.safeParse({ data: { name: 'Chapa' }, status: 'PUBLISHED' }).success).toBe(false);
    expect(body.safeParse({ data: { name: 'Chapa', colour: 'red' } }).success).toBe(false);
    const nested = body.safeParse({ data: { sector: { id: 's1', label: 'Cozinha', extra: 1 } } });
    expect(nested.success).toBe(false);
    expect(nested.error?.issues[0]?.path).toEqual(['data', 'sector']);
    const inList = body.safeParse({ data: { tags: [{ value: 'quente', weight: 2 }] } });
    expect(inList.success).toBe(false);
    expect(inList.error?.issues[0]?.path).toEqual(['data', 'tags', 0]);
  });

  it('converts to JSON Schema under zod defaults, with no $refs', () => {
    const rendered = JSON.stringify(z.toJSONSchema(saveDraftBodyOf(stationDraftData), { target: 'draft-2020-12' }));
    expect(rendered.includes('"$ref"')).toBe(false);
  });
});

/** The two draft writes every plugged collection advertises. */
const isDraftWrite = (operationId: string): boolean =>
  operationId === 'saveKitchenStationDraft' || operationId === 'createKitchenStationDraft';

describe('lifecycleMcpEndpoints({ draftData })', () => {
  it('advertises the collection body on both draft writes, and only there', () => {
    const tools = lifecycleMcpEndpoints(vocabulary({ draftData: stationDraftData }));
    for (const tool of tools) {
      if (isDraftWrite(tool.operationId)) {
        expect(openPlaces(tool.body), tool.operationId).toEqual([]);
        expect(tool.body?.safeParse({ data: { name: 'Chapa', colour: 'red' } }).success).toBe(false);
      } else {
        expect(tool.body, tool.operationId).toBeUndefined();
      }
      // No other input of a draft or version tool has an open place either.
      expect([...openPlaces(tool.params), ...openPlaces(tool.query)], tool.operationId).toEqual([]);
    }
  });

  it('keeps the shared open body, the same object, when no schema is given', () => {
    const tools = lifecycleMcpEndpoints(vocabulary());
    const bodies = tools.filter((tool) => isDraftWrite(tool.operationId)).map((tool) => tool.body);
    expect(bodies).toEqual([saveDraftBody, saveDraftBody]);
    expect(bodies.every((body) => body === saveDraftBody)).toBe(true);
  });

  it('closes the new-item draft write too', () => {
    const [, update] = newItemDraftMcpEndpoints({
      collectionPath: '/api/admin/{tenantSlug}/products',
      noun: 'Product',
      summaries: { getMyNewDraft: 'resume', updateNewDraft: 'autosave' },
      draftData: stationDraftData,
    });
    expect(openPlaces(update?.body)).toEqual([]);
    const [, legacy] = newItemDraftMcpEndpoints({
      collectionPath: '/api/admin/{tenantSlug}/products',
      noun: 'Product',
      summaries: { getMyNewDraft: 'resume', updateNewDraft: 'autosave' },
    });
    expect(legacy?.body).toBe(saveDraftBody);
  });
});
