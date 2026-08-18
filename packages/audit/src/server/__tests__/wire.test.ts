import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { AuditPagingPolicy } from '../config';
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

/**
 * The `required` list of the same published document {@link advertised} reads
 * the properties of.
 */
const requiredParameters = (): string[] => {
  const json = z.toJSONSchema(auditLogQuerySchema(TEST_VOCABULARY), {
    target: 'draft-2020-12',
    io: 'input',
  }) as { required?: string[] };
  return json.required ?? [];
};

/** What a query parses to — absent, valid, or unusable. */
const parsed = (query: Record<string, unknown>, paging?: AuditPagingPolicy) =>
  auditLogQuerySchema(TEST_VOCABULARY, paging).parse(query);

describe('auditLogQuerySchema paging declaration', () => {
  /**
   * A tool schema is a PROMISE about what a caller must send. `page` and
   * `pageSize` have always been optional at runtime — `.catch` answers an
   * absent value with the fallback — and the schema said otherwise on zod
   * 4.3.5, which is inside this package's supported range even though the
   * version developed against here projects it correctly on its own.
   *
   * Asserted on the DECLARATION rather than on a parse, because a parse passes
   * either way; the whole defect was that the two disagreed.
   */
  it('declares page and pageSize optional, as the runtime already treats them', () => {
    expect(requiredParameters()).not.toContain('page');
    expect(requiredParameters()).not.toContain('pageSize');
  });

  it('still answers an absent page with the fallback, and clamps a bad one', () => {
    expect(parsed({}).page).toBe(1);
    expect(parsed({ page: 'not a number' }).page).toBe(1);
  });

  it('answers an absent size with the CEILING when a host defaults above it', () => {
    // zod's `.default` answers INSTEAD of running the chain, so a fallback that
    // is not clamped where it is declared is not clamped at all. `pagingOf`
    // refuses this policy, but the factory is also reachable with a paging
    // object that never passed through it — and there, an unclamped default
    // serves a page-less request more rows than the declared ceiling.
    const overshooting = { defaultPageSize: 1000, maxPageSize: 100, maxPage: 10 };

    expect(parsed({}, overshooting).pageSize).toBe(100);
    expect(parsed({ pageSize: 'not a number' }, overshooting).pageSize).toBe(100);
  });
});
