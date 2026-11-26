import { describe, expect, it } from 'vitest';

import type { TenantDomainDnsChecks } from '../domains/checks';
import { createTenantDomains } from '../domains/engine';
import { memoryPort, memoryQuota, row } from './domains-fixtures';

const T = 't1';
const ctx = { tenantId: T, actorId: 'u1', via: 'panel' };

function fakeDns(owned: boolean, pointsHere: boolean | null = null) {
  const asked: string[] = [];
  const dns: TenantDomainDnsChecks = {
    targets: () => ['203.0.113.10'],
    ownsRecord: async (hostname) => (asked.push(`txt ${hostname}`), owned),
    pointsHere: async (hostname) => (asked.push(`ip ${hostname}`), pointsHere),
  };
  return { dns, asked };
}

function setup(
  seed: Parameters<typeof memoryPort>[0] = [],
  quotaOptions: Parameters<typeof memoryQuota>[1] = {},
  failWritesWith?: unknown,
) {
  const memory = memoryPort(seed, { failWritesWith });
  const quota = memoryQuota(memory.table, quotaOptions);
  const dns = fakeDns(true, true);
  const engine = createTenantDomains({ port: memory.port, quota: quota.quota, dns: dns.dns });
  return { ...memory, quotaCalls: quota.calls, asked: dns.asked, engine };
}

describe('the domain engine', () => {
  it('claims a pair: rows, holders, reserve, then ONE transaction and ONE re-read', async () => {
    const s = setup([], { limit: 3 });
    const answer = await s.engine.run(ctx, { operations: [{ operation: 'add', hostname: 'acme.com' }] });
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.results).toEqual([
      { index: 0, operation: 'add', outcome: 'created', hostnames: ['acme.com', 'www.acme.com'], domainId: answer.domains[0]?.id },
    ]);
    expect(answer.domains[0]?.wwwHostname).toBe('www.acme.com');
    expect(s.calls).toEqual(['rows', 'holders', 'transaction', 'holders@tx', 'claim', 'rows']);
    expect(s.quotaCalls).toEqual(['reserve', 'used']);
  });

  it('is all or nothing: one problem refuses the call, nothing written, no DNS asked', async () => {
    const s = setup([{ ...row('a', 'acme.com'), tenantId: T }]);
    const answer = await s.engine.run(ctx, {
      operations: [
        { operation: 'add', hostname: 'new.com' },
        { operation: 'verify', id: 'a' },
        { operation: 'add', hostname: 'bad' },
      ],
    });
    expect(answer).toEqual({ ok: false, problems: [{ index: 2, kind: 'invalidHostname', hostname: null, input: 'bad' }] });
    expect(s.calls).toEqual(['rows', 'holders']);
    expect(s.asked).toEqual([]);
    expect(s.table).toHaveLength(1);
  });

  it('validateOnly previews, asking no DNS and writing nothing', async () => {
    const s = setup([{ ...row('a', 'acme.com'), tenantId: T }]);
    const answer = await s.engine.run(ctx, {
      validateOnly: true,
      operations: [{ operation: 'verify', id: 'a' }, { operation: 'add', hostname: 'new.com' }],
    });
    expect(answer.ok && answer.results.map((result) => [result.outcome, result.domainId])).toEqual([
      ['would_apply', 'a'],
      ['would_apply', null],
    ]);
    expect(s.asked).toEqual([]);
    expect(s.calls).not.toContain('transaction');
  });

  it('verifies with the lookups made before the transaction, every name asked', async () => {
    const s = setup([
      { ...row('a', 'acme.com'), tenantId: T },
      { ...row('aw', 'www.acme.com', { pairRootId: 'a' }), tenantId: T },
    ]);
    const answer = await s.engine.run(ctx, { operations: [{ operation: 'verify', id: 'a' }] });
    expect(answer.ok && answer.results[0]?.outcome).toBe('verified');
    expect(s.asked).toEqual(['txt acme.com', 'ip acme.com', 'ip www.acme.com']);
    expect(s.calls.indexOf('transaction')).toBeGreaterThan(-1);
    expect(s.table.every((entry) => entry.status === 'ACTIVE' && entry.dnsPointsHere === true)).toBe(true);
    expect(s.quotaCalls).toEqual(['mayVerify']);
  });

  it('answers the quota refusal on each claim and restore', async () => {
    const s = setup([{ ...row('r', 'old.com', { archivedAt: new Date('2026-01-01') }), tenantId: T }], { refuse: 'planLimit' });
    const answer = await s.engine.run(ctx, {
      operations: [{ operation: 'add', hostname: 'acme.com' }, { operation: 'restore', id: 'r' }],
    });
    expect(answer).toEqual({
      ok: false,
      problems: [
        { index: 0, kind: 'planLimit', hostname: 'acme.com' },
        { index: 1, kind: 'planLimit', hostname: 'old.com' },
      ],
    });
    expect(s.calls).not.toContain('transaction');
  });

  it('a name another tenant took in the meantime: nameTaken, nothing written', async () => {
    const s = setup();
    const holders = s.port.holders;
    s.port.holders = async (names, tx) => (tx === undefined ? [] : [{ hostname: 'acme.com', tenantId: 'other' }, ...(await holders(names, tx))]);
    const answer = await s.engine.run(ctx, { operations: [{ operation: 'add', hostname: 'acme.com' }] });
    expect(answer).toEqual({ ok: false, problems: [{ index: null, kind: 'nameTaken', hostname: 'acme.com' }] });
    expect(s.table).toHaveLength(0);
  });

  it('the last unit taken in the meantime: planLimit, the recount on the transaction', async () => {
    const s = setup([{ ...row('x', 'x.com'), tenantId: T }], { limit: 1 });
    const answer = await s.engine.run(ctx, { operations: [{ operation: 'add', hostname: 'acme.com' }] });
    expect(answer).toEqual({ ok: false, problems: [{ index: null, kind: 'planLimit', hostname: null }] });
    expect(s.quotaCalls).toEqual(['reserve', 'used']);
    expect(s.table).toHaveLength(1);
  });

  it('classifies a thrown error through failure(): retry, taken, else rethrown', async () => {
    const retry = setup([], {}, { code: 'RETRY' });
    await expect(retry.engine.run(ctx, { operations: [{ operation: 'add', hostname: 'acme.com' }] })).resolves.toEqual({
      ok: false,
      problems: [{ index: null, kind: 'retry', hostname: null }],
    });
    const taken = setup([], {}, { code: 'TAKEN' });
    await expect(taken.engine.run(ctx, { operations: [{ operation: 'add', hostname: 'acme.com' }] })).resolves.toEqual({
      ok: false,
      problems: [{ index: null, kind: 'nameTaken', hostname: 'acme.com' }],
    });
    const boom = new Error('connection lost');
    const other = setup([], {}, boom);
    await expect(other.engine.run(ctx, { operations: [{ operation: 'add', hostname: 'acme.com' }] })).rejects.toBe(boom);
  });

  it('writes one audit line per removal and per restore, with the reason and via', async () => {
    const s = setup([
      { ...row('a', 'acme.com'), tenantId: T },
      { ...row('r', 'old.com', { archivedAt: new Date('2026-01-01') }), tenantId: T },
    ]);
    const answer = await s.engine.run(
      { ...ctx, via: 'agent' },
      { operations: [{ operation: 'archive', id: 'a', reason: 'moved' }, { operation: 'restore', id: 'r' }] },
    );
    expect(answer.ok && answer.results.map((result) => result.outcome)).toEqual(['archived', 'restored']);
    expect(s.audits).toEqual([
      { act: 'archive', id: 'a', reason: 'moved', via: 'agent' },
      { act: 'restore', id: 'r', reason: null, via: 'agent' },
    ]);
    expect(s.calls.filter((call) => call === 'rows')).toHaveLength(2);
    expect(s.table.find((entry) => entry.id === 'a')).toMatchObject({ status: 'DISABLED', archivedByUserId: 'u1' });
  });

  it('asks mayVerify only when the call has a verify', async () => {
    const s = setup([{ ...row('a', 'acme.com'), tenantId: T }], { entitled: false });
    await s.engine.run(ctx, { operations: [{ operation: 'archive', id: 'a' }] });
    expect(s.quotaCalls).toEqual([]);
    const refused = await s.engine.run(ctx, { operations: [{ operation: 'verify', hostname: 'acme.com' }] });
    expect(refused.ok).toBe(false);
  });
});
