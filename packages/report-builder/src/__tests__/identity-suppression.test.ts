import { describe, expect, it } from 'vitest';

import { compileReport } from '../compile';
import { reportSpecSchema, type ReportSpecInput } from '../spec';

import { circulationCatalog, LIBRARY_CLERK_MIN_SAMPLE } from './fixtures';

/**
 * A SPEC THAT ISOLATES ONE PERSON IS REFUSED UNLESS IT DECLARES THE FLOOR
 * (FUT-454).
 *
 * `assertIdentitySuppression` is the cheap, actionable half of the privacy
 * rule: it reads the highest `minGroupSample` of any field the spec GROUPS BY
 * or FILTERS ON, and rejects the whole spec unless every measure declares a
 * `minSample` at least that high. The barrier proper is
 * `FieldDef.identityMinSample`, applied per row by `finalize`; this one turns
 * the most obvious per-person spec into a 400 that names what to add, instead
 * of a silently blank column.
 *
 * These three refusals had tests, and the tests were one application's kitchen
 * facts — so when that application's catalog left the package the cases left
 * with it, and the rule went from covered to uncovered without a line of it
 * changing. It is generic package logic, `ADOPTING.md` promises adopters it is
 * enforced, and it does not belong to any host's data: ported here onto a
 * catalog whose identity field is a library clerk.
 */

/** Compile against the library, or throw the way a route's caller would see. */
function compile(input: ReportSpecInput) {
  return compileReport(reportSpecSchema.parse(input), circulationCatalog);
}

/** Grouping by the identity dimension, with whatever floor the author declared. */
function perClerk(minSample?: number): ReportSpecInput {
  return {
    entity: 'loans',
    dimensions: [{ field: 'clerkId' }],
    measures: [{ field: 'loans', aggregation: 'sum', alias: 'atendimentos', minSample }],
    presentation: { kind: 'table' },
  };
}

describe('a spec that isolates an individual', () => {
  it('is refused when it declares no floor at all', () => {
    // The message has to name the thing to ADD, because "no" on its own leaves
    // the author to guess which of their choices caused it.
    expect(() => compile(perClerk())).toThrow(/minSample/);
    expect(() => compile(perClerk())).toThrow(/Grouping by "clerkId"/);
  });

  it('is refused when its floor is below the catalog’s', () => {
    expect(() => compile(perClerk(5))).toThrow(
      new RegExp(`at least ${LIBRARY_CLERK_MIN_SAMPLE}`),
    );
  });

  /**
   * The leak grouping alone would miss, and the easiest per-person spec to
   * author over MCP: NO dimension at all, so the result is one ungrouped row
   * holding exactly one clerk's numbers.
   */
  it('is refused when a FILTER narrows it to one person instead of a grouping', () => {
    expect(() =>
      compile({
        entity: 'loans',
        filters: [{ field: 'clerkId', operator: 'eq', value: 'clerk-a' }],
        measures: [{ field: 'deskSeconds', aggregation: 'p90', alias: 'balcao' }],
        presentation: { kind: 'kpi' },
      }),
    ).toThrow(/Filtering on "clerkId"/);
  });

  /**
   * The other side of the rule. A suite of refusals alone would pass against a
   * compiler that refused everything — this is what says the floor is a
   * condition an author can satisfy rather than a ban.
   */
  it('is allowed once every measure carries the floor', () => {
    expect(() => compile(perClerk(LIBRARY_CLERK_MIN_SAMPLE))).not.toThrow();
    expect(() =>
      compile({
        entity: 'loans',
        filters: [{ field: 'clerkId', operator: 'eq', value: 'clerk-a' }],
        measures: [
          {
            field: 'deskSeconds',
            aggregation: 'p90',
            alias: 'balcao',
            minSample: LIBRARY_CLERK_MIN_SAMPLE,
          },
        ],
        presentation: { kind: 'kpi' },
      }),
    ).not.toThrow();
  });

  /** A spec that names no identity field is not asked for a floor at all. */
  it('leaves an ordinary spec alone', () => {
    expect(() =>
      compile({
        entity: 'loans',
        dimensions: [{ field: 'shelfCode' }],
        measures: [{ field: 'loans', aggregation: 'sum', alias: 'atendimentos' }],
        presentation: { kind: 'table' },
      }),
    ).not.toThrow();
  });
});
