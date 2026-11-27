import { describe, expect, it } from 'vitest';

import { claimableNames, claimOf, guardedOf, planDomainOperations, unitsOf, type TenantDomainOperation } from '../domains/plan';
import { canonicalHostOf, domainsOf, pairRedirectOf, type TenantDomainRow } from '../domains/record';
import { row } from './domains-fixtures';

const pair = (id: string, root: string, extra: Partial<TenantDomainRow> = {}): TenantDomainRow[] => [
  row(id, root, extra),
  row(`${id}w`, `www.${root}`, { ...extra, pairRootId: id, wwwPrincipal: false }),
];

function plan(rows: TenantDomainRow[], operations: TenantDomainOperation[], taken: string[] = [], entitled = true) {
  return planDomainOperations({ operations, domains: domainsOf(rows), takenElsewhere: new Set(taken), entitled });
}

describe('the names a claim takes and guards', () => {
  it('a root takes its www; a www. of a root also guards that root', () => {
    expect(claimOf('acme.com')).toEqual(['acme.com', 'www.acme.com']);
    expect(claimOf('shop.acme.com')).toEqual(['shop.acme.com']);
    expect(guardedOf('www.acme.com')).toEqual(['www.acme.com', 'acme.com']);
  });

  it('asks about the names of adds and restores only, each with what it guards', () => {
    const removed = pair('r', 'old.com', { archivedAt: new Date('2026-02-01') });
    expect(
      claimableNames(
        [{ operation: 'add', hostname: 'acme.com' }, { operation: 'restore', id: 'r' }, { operation: 'verify', id: 'x' }],
        domainsOf(removed),
      ),
    ).toEqual(['acme.com', 'www.acme.com', 'old.com', 'www.old.com', 'www.old.com', 'old.com']);
  });
});

describe('planDomainOperations', () => {
  it('claims a root with its www as one step, one unit', () => {
    const { steps, problems } = plan([], [{ operation: 'add', hostname: 'HTTPS://Acme.com/' }]);
    expect(problems).toEqual([]);
    expect(steps).toEqual([{ index: 0, kind: 'add', hostname: 'acme.com', names: ['acme.com', 'www.acme.com'], principal: 'root' }]);
    expect(unitsOf(steps)).toBe(1);
  });

  it('refuses the www. of a root another tenant holds', () => {
    expect(plan([], [{ operation: 'add', hostname: 'www.acme.com' }], ['acme.com']).problems).toEqual([
      { index: 0, kind: 'nameTaken', hostname: 'acme.com' },
    ]);
  });

  it('answers its own live name as it is, and a principal it asks for', () => {
    const rows = pair('a', 'acme.com');
    expect(plan(rows, [{ operation: 'add', hostname: 'www.acme.com' }]).steps[0]?.kind).toBe('noop');
    expect(plan(rows, [{ operation: 'add', hostname: 'acme.com', principal: 'www' }]).steps[0]?.kind).toBe('principal');
  });

  it('a name held on another live domain of this tenant', () => {
    const rows = [row('s', 'www.acme.com')];
    expect(plan(rows, [{ operation: 'add', hostname: 'acme.com' }]).problems).toEqual([
      { index: 0, kind: 'nameHeldHere', hostname: 'www.acme.com' },
    ]);
  });

  it('the same name twice in one call, and the same domain targeted twice', () => {
    expect(
      plan([], [
        { operation: 'add', hostname: 'acme.com' },
        { operation: 'add', hostname: 'acme.com' },
      ]).problems,
    ).toEqual([{ index: 1, kind: 'duplicateTarget', hostname: 'acme.com' }]);
    expect(
      plan(pair('a', 'acme.com'), [
        { operation: 'archive', id: 'a' },
        { operation: 'verify', id: 'a' },
      ]).problems,
    ).toEqual([{ index: 1, kind: 'duplicateTarget', hostname: 'acme.com' }]);
  });

  it('every problem at once, writing nothing: invalid, not found, not a pair', () => {
    const { steps, problems } = plan([row('s', 'shop.acme.com')], [
      { operation: 'add', hostname: 'nope' },
      { operation: 'verify', hostname: 'other.com' },
      { operation: 'setPrincipal', id: 's', principal: 'www' },
      { operation: 'add', hostname: 'menu.acme.com', principal: 'www' },
    ]);
    expect(steps).toEqual([]);
    expect(problems).toEqual([
      { index: 0, kind: 'invalidHostname', hostname: null, input: 'nope' },
      { index: 1, kind: 'notFound', hostname: 'other.com' },
      { index: 2, kind: 'notAPair', hostname: 'shop.acme.com' },
      { index: 3, kind: 'notAPair', hostname: 'menu.acme.com' },
    ]);
  });

  it('a removed domain takes no verify or principal; its removal again is unchanged', () => {
    const rows = pair('a', 'acme.com', { archivedAt: new Date('2026-02-01') });
    expect(plan(rows, [{ operation: 'verify', id: 'a' }]).problems).toEqual([{ index: 0, kind: 'removed', hostname: 'acme.com' }]);
    expect(plan(rows, [{ operation: 'archive', id: 'a' }]).steps[0]?.kind).toBe('noop');
  });

  it('restores while every name is free, and refuses one another tenant took', () => {
    const rows = pair('a', 'acme.com', { archivedAt: new Date('2026-02-01') });
    const ok = plan(rows, [{ operation: 'restore', id: 'a' }, { operation: 'verify', id: 'a' }]);
    expect(ok.steps.map((step) => step.kind)).toEqual(['restore', 'verify']);
    expect(plan(rows, [{ operation: 'restore', id: 'a' }], ['www.acme.com']).problems).toEqual([
      { index: 0, kind: 'nameNotFree', hostname: 'www.acme.com' },
    ]);
  });

  it('a stale restore of an ACTIVE domain answers unchanged, and so does its verify', () => {
    const rows = pair('a', 'acme.com', { status: 'ACTIVE' });
    const { steps } = plan(rows, [{ operation: 'restore', id: 'a' }, { operation: 'verify', id: 'a' }]);
    expect(steps.map((step) => step.kind)).toEqual(['noop', 'noop']);
  });

  it('a verify without the entitlement is planRequired', () => {
    expect(plan(pair('a', 'acme.com'), [{ operation: 'verify', id: 'a' }], [], false).problems).toEqual([
      { index: 0, kind: 'planRequired', hostname: 'acme.com' },
    ]);
  });

  it('by name, a restore picks the latest removed and anything else the live one', () => {
    const rows = [
      row('old', 'acme.com', { archivedAt: new Date('2026-01-01') }),
      row('newer', 'acme.com', { archivedAt: new Date('2026-03-01') }),
      row('live', 'acme.com'),
    ];
    expect(plan(rows, [{ operation: 'archive', hostname: 'acme.com' }]).steps[0]).toMatchObject({ domain: { id: 'live' } });
    const restore = plan(rows.slice(0, 2), [{ operation: 'restore', hostname: 'acme.com' }]);
    expect(restore.steps[0]).toMatchObject({ kind: 'restore', domain: { id: 'newer' } });
  });
});

describe('the canonical host and the pair redirect', () => {
  it('the oldest ACTIVE domain at its principal, skipping one known to point elsewhere', () => {
    const first = pair('a', 'first.com', { status: 'ACTIVE' });
    first[0] = { ...first[0]!, wwwPrincipal: true, dnsPointsHere: true };
    first[1] = { ...first[1]!, dnsPointsHere: false };
    const second = [row('b', 'second.com', { status: 'ACTIVE' })];
    expect(canonicalHostOf([...first, ...second])).toBe('second.com');
    first[1] = { ...first[1], dnsPointsHere: null };
    expect(canonicalHostOf([...first, ...second])).toBe('www.first.com');
    expect(canonicalHostOf([])).toBeNull();
  });

  it("redirects a pair's other name to its principal, only while ACTIVE and pointed", () => {
    const rows = pair('a', 'acme.com', { status: 'ACTIVE' });
    expect(pairRedirectOf(rows, 'www.acme.com')).toBe('acme.com');
    expect(pairRedirectOf(rows, 'acme.com')).toBeNull();
    expect(pairRedirectOf([{ ...rows[0]!, dnsPointsHere: false }, rows[1]!], 'www.acme.com')).toBeNull();
    expect(pairRedirectOf([{ ...rows[0]!, status: 'PENDING' }, rows[1]!], 'www.acme.com')).toBeNull();
    expect(pairRedirectOf([row('s', 'shop.acme.com', { status: 'ACTIVE' })], 'shop.acme.com')).toBeNull();
  });
});
