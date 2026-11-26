/**
 * THE ONE ENGINE behind every change to a tenant's custom domains: a panel's
 * one-operation calls and an agent's bulk write run exactly this, so removing
 * a domain, restoring it and choosing its principal behave the same on both.
 *
 * All or nothing, in three passes:
 * 1. every operation is checked against the tenant's domains and every other
 *    tenant's live names (`./plan.ts`): each problem named, nothing written;
 * 2. the DNS lookups a `verify` needs run next, OUTSIDE the transaction (they
 *    can take seconds and change nothing here);
 * 3. ONE serializable transaction re-checks the names and the plan's count and
 *    applies everything, with an audit line per removal and per restore.
 *
 * Statements, in order: `rows`, `holders`, (`mayVerify`), (`reserve`); then, in
 * the transaction, `holders` again and `used` when the limit is a number, the
 * writes, the audits; then ONE `rows` for the answer. Copy-free: problems are
 * kinds, and the host words them.
 */
import { TenantConfigError } from '../validate';
import type { TenantDomainDnsChecks } from './checks';
import {
  claimableNames,
  claimsOf,
  guardedOf,
  namesOf,
  planDomainOperations,
  unitsOf,
  type TenantDomainOperation,
  type TenantDomainProblem,
  type TenantDomainStep,
} from './plan';
import {
  TENANT_DOMAIN_PORT_METHODS,
  TENANT_DOMAIN_QUOTA_METHODS,
  type TenantDomainPort,
  type TenantDomainQuota,
} from './port';
import { domainsOf, type TenantDomainRecord } from './record';

/** Who acts and from where. `via` is opaque: it reaches the quota and the audit line as given. */
export interface TenantDomainContext {
  tenantId: string;
  /** Who removes, recorded on the removed row. */
  actorId: string | null;
  via: string;
}

export type TenantDomainOutcome =
  | 'created'
  | 'unchanged'
  | 'verified'
  | 'not_verified'
  | 'updated'
  | 'archived'
  | 'restored'
  | 'would_apply';

export interface TenantDomainResult {
  index: number;
  operation: TenantDomainOperation['operation'];
  outcome: TenantDomainOutcome;
  /** The names the operation is about. */
  hostnames: string[];
  /** The domain the result is about (in `domains`), or null for a previewed new claim. */
  domainId: string | null;
}

export type TenantDomainAnswer =
  | { ok: true; validateOnly: boolean; results: TenantDomainResult[]; domains: TenantDomainRecord[] }
  | { ok: false; problems: TenantDomainProblem[] };

export interface TenantDomainsConfig<Tx = unknown> {
  port: TenantDomainPort<Tx>;
  quota: TenantDomainQuota<Tx>;
  dns: TenantDomainDnsChecks;
}

export interface TenantDomains {
  /** Run a call's operations, all or nothing. */
  run(
    ctx: TenantDomainContext,
    body: { operations: readonly TenantDomainOperation[]; validateOnly?: boolean },
  ): Promise<TenantDomainAnswer>;
}

type Bag = Record<string, unknown>;
const isBag = (value: unknown): value is Bag => typeof value === 'object' && value !== null && !Array.isArray(value);

function requireMembers(value: unknown, key: string, members: readonly string[]): void {
  if (!isBag(value)) {
    throw new TenantConfigError(key, value === undefined || value === null ? 'is required and missing' : 'must be an object');
  }
  for (const member of members) {
    if (value[member] === undefined || value[member] === null) {
      throw new TenantConfigError(`${key}.${member}`, 'is required and missing');
    }
    if (typeof value[member] !== 'function') throw new TenantConfigError(`${key}.${member}`, 'must be a function');
  }
}

/** Check the port and the quota; keys are named under `prefix` (`domains.`). */
export function validateDomainPorts(value: Bag, prefix: string): void {
  requireMembers(value.port, `${prefix}port`, TENANT_DOMAIN_PORT_METHODS);
  requireMembers(value.quota, `${prefix}quota`, TENANT_DOMAIN_QUOTA_METHODS);
}

/** Raised inside the transaction when a race took a name or the plan's last unit. */
class RaceRefusal extends Error {
  constructor(readonly problem: TenantDomainProblem) {
    super(`@12-apps/tenant: domain race (${problem.kind})`);
  }
}

type Found = ReadonlyMap<string, { verified: boolean; pointsHere: Readonly<Record<string, boolean | null>> }>;
type Applied = { id: string; outcome: TenantDomainOutcome };
type Writer<Tx, K extends TenantDomainStep['kind']> = (
  tx: Tx,
  ctx: TenantDomainContext,
  step: Extract<TenantDomainStep, { kind: K }>,
  found: Found,
  now: Date,
) => Promise<Applied>;

function writersOf<Tx>(port: TenantDomainPort<Tx>): { [K in TenantDomainStep['kind']]: Writer<Tx, K> } {
  const audit = (tx: Tx, ctx: TenantDomainContext, step: Extract<TenantDomainStep, { kind: 'archive' | 'restore' }>) =>
    port.audit(tx, { act: step.kind, tenantId: ctx.tenantId, domain: step.domain, reason: step.reason, via: ctx.via });
  return {
    add: async (tx, ctx, step) => ({
      id: (await port.claim(tx, ctx.tenantId, step.hostname, step.principal)).id,
      outcome: 'created',
    }),
    noop: async (_tx, _ctx, step) => ({ id: step.domain.id, outcome: 'unchanged' }),
    principal: async (tx, ctx, step) => {
      await port.setPrincipal(tx, ctx.tenantId, step.domain.id, step.principal);
      return { id: step.domain.id, outcome: 'updated' };
    },
    verify: async (tx, ctx, step, found, now) => {
      const outcome = found.get(step.domain.id) ?? { verified: false, pointsHere: {} };
      await port.recordCheck(tx, ctx.tenantId, step.domain, outcome, now);
      return { id: step.domain.id, outcome: outcome.verified ? 'verified' : 'not_verified' };
    },
    archive: async (tx, ctx, step, _found, now) => {
      await port.archive(tx, ctx.tenantId, step.domain.id, now, ctx.actorId);
      await audit(tx, ctx, step);
      return { id: step.domain.id, outcome: 'archived' };
    },
    restore: async (tx, ctx, step) => {
      await port.restore(tx, ctx.tenantId, step.domain.id);
      await audit(tx, ctx, step);
      return { id: step.domain.id, outcome: 'restored' };
    },
  };
}

/** The DNS answers every `verify` needs, by domain id: the TXT at the root, and where each name points. */
async function lookups(dns: TenantDomainDnsChecks, steps: readonly TenantDomainStep[]): Promise<Found> {
  const verifies = steps.filter((step): step is Extract<TenantDomainStep, { kind: 'verify' }> => step.kind === 'verify');
  const answers = await Promise.all(
    verifies.map(async ({ domain }) => {
      const names = namesOf(domain);
      const [verified, pointing] = await Promise.all([
        dns.ownsRecord(domain.hostname, domain.verificationToken),
        Promise.all(names.map((name) => dns.pointsHere(name))),
      ]);
      return [domain.id, { verified, pointsHere: Object.fromEntries(names.map((name, at) => [name, pointing[at] ?? null])) }] as const;
    }),
  );
  return new Map(answers);
}

/** What `validateOnly` answers: each step as it would go, writing nothing and asking no DNS. */
const previewOf = (step: TenantDomainStep) => ({
  step,
  id: step.kind === 'add' ? null : step.domain.id,
  outcome: step.kind === 'noop' ? ('unchanged' as const) : ('would_apply' as const),
});

/** The quota refusal, told on each claim and restore. */
function quotaProblems(steps: readonly TenantDomainStep[], kind: 'planRequired' | 'planLimit'): TenantDomainProblem[] {
  return steps.flatMap((step) =>
    step.kind === 'add' || step.kind === 'restore'
      ? [{ index: step.index, kind, hostname: step.kind === 'add' ? step.hostname : step.domain.hostname }]
      : [],
  );
}

interface EngineDeps<Tx> {
  port: TenantDomainPort<Tx>;
  quota: TenantDomainQuota<Tx>;
  dns: TenantDomainDnsChecks;
  writers: { [K in TenantDomainStep['kind']]: Writer<Tx, K> };
}

/** Re-check, in the transaction, what a concurrent call could have changed: the names and the plan's count. */
async function recheck<Tx>(
  deps: EngineDeps<Tx>,
  tx: Tx,
  ctx: TenantDomainContext,
  steps: readonly TenantDomainStep[],
  limit: number | null,
): Promise<void> {
  const claims = new Set(claimsOf(steps));
  const guarded = [...new Set(claimsOf(steps).flatMap((name) => guardedOf(name)))];
  // This tenant's own rows block only the names it claims; another tenant's block their roots too.
  const holder = (await deps.port.holders(guarded, tx)).find(
    (row) => claims.has(row.hostname) || row.tenantId !== ctx.tenantId,
  );
  if (holder !== undefined) {
    const kind = holder.tenantId === ctx.tenantId ? 'nameHeldHere' : 'nameTaken';
    throw new RaceRefusal({ index: null, kind, hostname: holder.hostname });
  }
  const units = unitsOf(steps);
  if (units > 0 && typeof limit === 'number' && (await deps.quota.used(ctx.tenantId, tx)) + units > limit) {
    throw new RaceRefusal({ index: null, kind: 'planLimit', hostname: null });
  }
}

/** What a thrown transaction means: a problem, or rethrown. */
function problemOf<Tx>(deps: EngineDeps<Tx>, error: unknown, steps: readonly TenantDomainStep[]): TenantDomainProblem {
  if (error instanceof RaceRefusal) return error.problem;
  const kind = deps.port.failure(error);
  if (kind === 'retry') return { index: null, kind: 'retry', hostname: null };
  if (kind !== 'taken') throw error;
  const name = claimsOf(steps)[0] ?? '';
  return { index: null, kind: 'nameTaken', hostname: name || null };
}

/** The one transaction: re-check, then every step in call order; a race is a problem, never a partial write. */
async function commit<Tx>(
  deps: EngineDeps<Tx>,
  ctx: TenantDomainContext,
  steps: readonly TenantDomainStep[],
  limit: number | null,
): Promise<{ applied: ({ step: TenantDomainStep } & Applied)[] } | { problems: TenantDomainProblem[] }> {
  const found = await lookups(deps.dns, steps);
  const now = new Date();
  try {
    const applied = await deps.port.transaction(async (tx) => {
      await recheck(deps, tx, ctx, steps, limit);
      const out: ({ step: TenantDomainStep } & Applied)[] = [];
      for (const step of steps) {
        const write = deps.writers[step.kind] as Writer<Tx, TenantDomainStep['kind']>;
        out.push({ step, ...(await write(tx, ctx, step, found, now)) });
      }
      return out;
    });
    return { applied };
  } catch (error) {
    return { problems: [problemOf(deps, error, steps)] };
  }
}

/** The answer: each step's result, and every domain as it is now (ONE re-read). */
async function answer<Tx>(
  deps: EngineDeps<Tx>,
  tenantId: string,
  operations: readonly TenantDomainOperation[],
  applied: readonly { step: TenantDomainStep; id: string | null; outcome: TenantDomainOutcome }[],
  validateOnly: boolean,
): Promise<TenantDomainAnswer> {
  const domains = domainsOf(await deps.port.rows(tenantId));
  const results = applied.map(({ step, id, outcome }) => ({
    index: step.index,
    operation: (operations[step.index] as TenantDomainOperation).operation,
    outcome,
    hostnames: step.kind === 'add' ? step.names : namesOf(step.domain),
    domainId: id,
  }));
  return { ok: true, validateOnly, results, domains };
}

/** Read and plan: the steps, or every problem (the quota's refusal included). */
async function planned<Tx>(
  deps: EngineDeps<Tx>,
  ctx: TenantDomainContext,
  operations: readonly TenantDomainOperation[],
): Promise<{ steps: TenantDomainStep[]; limit: number | null } | { problems: TenantDomainProblem[] }> {
  const domains = domainsOf(await deps.port.rows(ctx.tenantId));
  const holders = await deps.port.holders(claimableNames(operations, domains));
  const entitled = operations.some((operation) => operation.operation === 'verify')
    ? await deps.quota.mayVerify(ctx.tenantId, ctx.via)
    : true;
  const takenElsewhere = new Set(
    holders.filter((holder) => holder.tenantId !== ctx.tenantId).map((holder) => holder.hostname),
  );
  const { steps, problems } = planDomainOperations({ operations, domains, takenElsewhere, entitled });
  if (problems.length > 0) return { problems };
  const units = unitsOf(steps);
  if (units === 0) return { steps, limit: null };
  const reserved = await deps.quota.reserve(ctx.tenantId, units, ctx.via);
  return 'refused' in reserved ? { problems: quotaProblems(steps, reserved.refused) } : { steps, limit: reserved.limit };
}

export function createTenantDomains<Tx>(config: TenantDomainsConfig<Tx>): TenantDomains {
  if (!isBag(config)) throw new TenantConfigError('config', 'is required and missing');
  validateDomainPorts(config as unknown as Bag, '');
  requireMembers((config as unknown as Bag).dns, 'dns', ['targets', 'ownsRecord', 'pointsHere']);
  const deps: EngineDeps<Tx> = { port: config.port, quota: config.quota, dns: config.dns, writers: writersOf(config.port) };
  return {
    run: async (ctx, body) => {
      const { operations } = body;
      const plan = await planned(deps, ctx, operations);
      if ('problems' in plan) return { ok: false, problems: plan.problems };
      if (body.validateOnly === true) return answer(deps, ctx.tenantId, operations, plan.steps.map(previewOf), true);
      const done = await commit(deps, ctx, plan.steps, plan.limit);
      return 'problems' in done ? { ok: false, problems: done.problems } : answer(deps, ctx.tenantId, operations, done.applied, false);
    },
  };
}
