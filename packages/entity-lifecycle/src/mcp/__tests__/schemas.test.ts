import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { draftJson, writeOutcome } from '../../server/context';
import { lifecycleMcpEndpoints } from '../endpoints';
import {
  draftResponse,
  type LifecycleSchemasMatchTheWire,
  writeOutcomeResponse,
} from '../schemas';

/**
 * The runtime twin of the type-level guards in `schemas.ts`.
 *
 * Those assert that the ADVERTISED schema and the type the producer promises
 * describe the same fields. This asserts the remaining half: that the schema
 * accepts what the producer actually EMITS, and keeps all of it.
 *
 * The distinction is the point. A type says `updatedAt: string`; the producer
 * could still hand over a `Date` through an `as` cast or a loosened seam, and
 * only a parse would notice. And zod strips unknown keys by default, so a field
 * the producer sends and the schema never heard of vanishes SILENTLY — the
 * exact shape of the bug this surface keeps having, and one that no type error
 * would report.
 *
 * Fed from the real producers rather than a hand-written fixture, deliberately:
 * a literal written here would be one more copy of the shape, which is the
 * problem these guards exist to end.
 */
describe('the advertised schemas accept what the routes produce', () => {
  it('holds every schema to the wire vocabulary at compile time', () => {
    // The assertion IS the type: `LifecycleSchemasMatchTheWire` is a tuple of
    // `Assert<Exact<schema, wire>>`, so this line stops compiling the moment a
    // schema and its producer disagree in either direction. Naming it here
    // gives the guard a consumer as well — an export nothing references is
    // dead code to `knip`, and a guard deleted as dead code guards nothing.
    const proof: LifecycleSchemasMatchTheWire = [true, true, true, true, true];
    expect(proof).toHaveLength(5);
  });

  it('keeps every field of a write outcome — applied and parked alike', () => {
    for (const result of [
      { status: 'applied', entityId: 'ent_1' },
      { status: 'pending-approval', requestId: 'req_1' },
    ] as const) {
      const produced = writeOutcome(result);
      const parsed = writeOutcomeResponse.parse({ data: produced });
      expect(parsed.data).toEqual(produced);
      // Not implied by toEqual: it would pass just as happily if the schema had
      // stripped a key the producer never sent.
      expect(Object.keys(parsed.data).sort()).toEqual(Object.keys(produced).sort());
    }
  });

  it('keeps every field of a draft, and carries a null draft through', () => {
    const produced = draftJson({
      id: 'draft_1',
      tenantId: 'ten_1',
      entityType: 'supplier',
      entityId: 'ent_1',
      data: { name: 'Fornecedor', nested: { ok: true }, list: [1, 2] },
      status: 'OPEN',
      createdBy: 'usr_1',
      updatedBy: 'usr_1',
      createdAt: new Date('2026-01-02T03:04:05.000Z'),
      updatedAt: new Date('2026-01-02T03:04:05.000Z'),
    });
    const parsed = draftResponse.parse({ data: produced });
    expect(parsed.data).toEqual(produced);
    expect(Object.keys(parsed.data.draft!).sort()).toEqual(Object.keys(produced.draft!).sort());
    // The absent-draft answer is a real answer, not an error.
    expect(draftResponse.parse({ data: draftJson(null) }).data).toEqual({ draft: null });
  });
});

describe('every advertised schema is representable in JSON Schema', () => {
  /**
   * The property 4.3.0 broke: `z.custom` typed two snapshot fields nicely and
   * threw in `z.toJSONSchema` under its DEFAULT `unrepresentable: "throw"` —
   * which is precisely how the origin host renders every one of these schemas
   * into its MCP tool surface, so the bump failed its surface build. This pin
   * runs the same conversion the host runs, over every schema of every tool
   * the factory emits, so an unrepresentable construct fails here first.
   *
   * The `$ref` half is the second trap: a recursive JSON-value union DOES
   * convert, but only as a cyclic `$defs` reference, and the MCP inliner
   * refuses recursion ("Recursive schema not supported"). Ref-free output is
   * what keeps these schemas consumable by an inlining host.
   */
  it('converts every tool schema under zod defaults, with no $refs', () => {
    const tools = lifecycleMcpEndpoints({
      collectionPath: '/api/admin/{tenantSlug}/suppliers',
      noun: 'Supplier',
      summaries: {
        getVersions: 'history',
        restoreVersion: 'restore',
        getDraft: 'read draft',
        saveDraft: 'write draft',
        publishDraft: 'publish',
        discardDraft: 'discard',
        listDrafts: 'list drafts',
        createDraft: 'new draft',
      },
    });
    expect(tools).toHaveLength(8);
    for (const tool of tools) {
      const schemas: Array<[string, z.ZodType | undefined]> = [
        ['params', tool.params],
        ['query', tool.query],
        ['body', tool.body],
        ['response', tool.response],
      ];
      for (const [slot, schema] of schemas) {
        if (!schema) continue;
        for (const io of ['input', 'output'] as const) {
          const rendered = z.toJSONSchema(schema, { target: 'draft-2020-12', io });
          expect(
            JSON.stringify(rendered).includes('"$ref"'),
            `${tool.operationId} ${slot} (${io}) emits a $ref an inlining host cannot take`,
          ).toBe(false);
        }
      }
    }
  });
});
