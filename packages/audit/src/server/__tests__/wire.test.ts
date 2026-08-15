import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { auditLogQuerySchema } from '../wire';

import { TEST_VOCABULARY } from './fixtures';

/**
 * What the listing endpoint ADVERTISES about itself.
 *
 * A host projects this very schema into its OpenAPI document and its tool
 * manifest — that is the point of building it here rather than restating it —
 * so a parameter that parses correctly and describes itself wrongly is a
 * contract bug with no runtime symptom on this side of the wire. It bit once
 * already: `page` and `pageSize` were parsed out of `z.string().transform(…)`,
 * which published `{"type":"string"}` to every generated client, so the ceiling
 * a request is clamped to, the default it gets and the fact that it is an
 * integer at all were all invisible.
 *
 * These cases read the JSON Schema, not the parse result, because the published
 * document is the artefact under test.
 */
const advertised = (paging?: { defaultPageSize: number; maxPageSize: number; maxPage: number }) => {
  const schema = auditLogQuerySchema(TEST_VOCABULARY, paging);
  const json = z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' }) as {
    properties: Record<string, Record<string, unknown>>;
  };
  return json.properties;
};

describe('the advertised query contract', () => {
  it('publishes the paging parameters as bounded integers with their defaults', () => {
    const props = advertised();

    expect(props.page).toMatchObject({
      type: 'integer',
      minimum: 1,
      maximum: 10_000,
      default: 1,
    });
    expect(props.pageSize).toMatchObject({
      type: 'integer',
      minimum: 1,
      maximum: 100,
      default: 20,
    });
  });

  it('publishes the HOST’s paging numbers, not the package’s', () => {
    // The schema a host advertises and the clamps its endpoint applies are the
    // same three values, so a host that raises its ceiling raises the documented
    // one with it.
    const props = advertised({ defaultPageSize: 50, maxPageSize: 500, maxPage: 200 });

    expect(props.pageSize).toMatchObject({ maximum: 500, default: 50 });
    expect(props.page).toMatchObject({ maximum: 200 });
  });

  it('publishes the keyword’s length bound', () => {
    expect(advertised().q).toMatchObject({ type: 'string', maxLength: 200 });
  });

  it('publishes the orders it serves, and which one is the default', () => {
    expect(advertised().sort).toMatchObject({
      enum: ['createdAt:desc', 'createdAt:asc'],
      default: 'createdAt:desc',
    });
  });

  it('publishes the filter enums as the vocabulary’s own ids', () => {
    // The pills a caller may filter on ARE the actions a mutation can emit.
    const parsed = auditLogQuerySchema(TEST_VOCABULARY).safeParse({
      action_in: TEST_VOCABULARY.actionIds.join(','),
    });
    expect(parsed.success).toBe(true);
  });
});
