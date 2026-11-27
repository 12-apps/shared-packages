import { wwwCompanionOf } from '../domains/dns-names';
import type { TenantDomainPort, TenantDomainQuota } from '../domains/port';
import { domainOf, type TenantDomainRow } from '../domains/record';

/** A stored row, live and PENDING unless told otherwise. */
export function row(id: string, hostname: string, extra: Partial<TenantDomainRow> = {}): TenantDomainRow {
  return {
    id,
    hostname,
    status: 'PENDING',
    verificationToken: `tok-${id}`,
    verifiedAt: null,
    dnsPointsHere: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    pairRootId: null,
    wwwPrincipal: false,
    archivedAt: null,
    archivedByUserId: null,
    ...extra,
  };
}

type Stored = TenantDomainRow & { tenantId: string };

/** An in-memory domain table behind the port, counting every member's calls. */
export function memoryPort(seed: Stored[] = [], options: { failWritesWith?: unknown } = {}) {
  const table: Stored[] = seed.map((entry) => ({ ...entry }));
  const calls: string[] = [];
  const audits: { act: string; id: string; reason: string | null; via: string }[] = [];
  let next = 100;
  const live = (entry: Stored) => entry.archivedAt === null;
  const pairOf = (tenantId: string, id: string) =>
    table.filter((entry) => entry.tenantId === tenantId && (entry.id === id || entry.pairRootId === id));
  const port: TenantDomainPort<'tx'> = {
    rows: async (tenantId, tx) => {
      calls.push(tx === undefined ? 'rows' : 'rows@tx');
      return table
        .filter((entry) => entry.tenantId === tenantId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.hostname.localeCompare(b.hostname))
        .map((entry) => {
          const copy: Partial<Stored> = { ...entry };
          delete copy.tenantId;
          return copy as TenantDomainRow;
        });
    },
    holders: async (hostnames, tx) => {
      calls.push(tx === undefined ? 'holders' : 'holders@tx');
      return table
        .filter((entry) => live(entry) && hostnames.includes(entry.hostname))
        .map((entry) => ({ hostname: entry.hostname, tenantId: entry.tenantId }));
    },
    transaction: async (work) => {
      calls.push('transaction');
      const before = table.map((entry) => ({ ...entry }));
      try {
        return await work('tx');
      } catch (error) {
        table.splice(0, table.length, ...before);
        throw error;
      }
    },
    failure: (error) => {
      const code = (error as { code?: string } | null)?.code;
      return code === 'RETRY' ? 'retry' : code === 'TAKEN' ? 'taken' : null;
    },
    claim: async (_tx, tenantId, hostname, principal) => {
      calls.push('claim');
      if (options.failWritesWith !== undefined) throw options.failWritesWith;
      const www = wwwCompanionOf(hostname);
      const root: Stored = { ...row(`d${next++}`, hostname, { wwwPrincipal: www !== null && principal === 'www' }), tenantId };
      table.push(root);
      const companion: Stored | undefined =
        www === null ? undefined : { ...row(`d${next++}`, www, { pairRootId: root.id }), tenantId };
      if (companion !== undefined) table.push(companion);
      return domainOf(root, companion);
    },
    setPrincipal: async (_tx, tenantId, id, principal) => {
      calls.push('setPrincipal');
      for (const entry of pairOf(tenantId, id)) if (entry.id === id) entry.wwwPrincipal = principal === 'www';
    },
    recordCheck: async (_tx, tenantId, domain, outcome) => {
      calls.push('recordCheck');
      for (const name of domain.names) {
        const entry = table.find((candidate) => candidate.tenantId === tenantId && candidate.id === domain.rowIds[name.hostname]);
        if (entry === undefined) continue;
        entry.status = outcome.verified ? 'ACTIVE' : 'FAILED';
        const pointing = outcome.pointsHere[name.hostname];
        if (pointing !== null && pointing !== undefined) entry.dnsPointsHere = pointing;
      }
    },
    archive: async (_tx, tenantId, id, at, by) => {
      calls.push('archive');
      for (const entry of pairOf(tenantId, id)) Object.assign(entry, { archivedAt: at, archivedByUserId: by, status: 'DISABLED' });
    },
    restore: async (_tx, tenantId, id) => {
      calls.push('restore');
      for (const entry of pairOf(tenantId, id)) Object.assign(entry, { archivedAt: null, archivedByUserId: null, status: 'PENDING' });
    },
    audit: async (_tx, line) => {
      calls.push('audit');
      audits.push({ act: line.act, id: line.domain.id, reason: line.reason, via: line.via });
    },
  };
  return {
    port,
    table,
    calls,
    audits,
  };
}

/** A quota with a limit (`null` = unlimited), counting live roots. */
export function memoryQuota(
  table: Stored[],
  options: { limit?: number | null; entitled?: boolean; refuse?: 'planRequired' | 'planLimit' } = {},
) {
  const calls: string[] = [];
  const quota: TenantDomainQuota<'tx'> = {
    mayVerify: async () => (calls.push('mayVerify'), options.entitled ?? true),
    reserve: async () => {
      calls.push('reserve');
      return options.refuse !== undefined ? { refused: options.refuse } : { limit: options.limit ?? null };
    },
    used: async (tenantId) => {
      calls.push('used');
      return table.filter((entry) => entry.tenantId === tenantId && entry.archivedAt === null && entry.pairRootId === null).length;
    },
  };
  return { quota, calls };
}
