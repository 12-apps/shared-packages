/**
 * The CHECK pass of the domain operations: every operation is read against
 * the tenant's domains and every other tenant's live names, and turned into
 * the step it will take, or a named problem. Pure: nothing is read, written or
 * asked of DNS here; the engine (`./engine.ts`) reads what this needs first.
 *
 * Problems are KINDS, never sentences or wire codes: the host maps each kind
 * to its own code and its own words.
 */
import { isZoneApex, wwwCompanionOf } from './dns-names';
import { hostnameOrNull } from './hostname';
import type { TenantDomainRecord } from './record';

/** One operation on a tenant's domains. A removal and a restore may carry a reason. */
export type TenantDomainOperation =
  | { operation: 'add'; hostname: string; principal?: 'root' | 'www' }
  | { operation: 'verify'; id?: string; hostname?: string }
  | { operation: 'setPrincipal'; id?: string; hostname?: string; principal: 'root' | 'www' }
  | { operation: 'archive' | 'restore'; id?: string; hostname?: string; reason?: string };

export type TenantDomainProblemKind =
  | 'invalidHostname'
  | 'nameTaken'
  | 'nameHeldHere'
  | 'planLimit'
  | 'planRequired'
  | 'notFound'
  | 'notAPair'
  | 'nameNotFree'
  | 'removed'
  | 'duplicateTarget'
  | 'retry';

/**
 * One refused operation (`index`), or the call as a whole (`index: null`, a
 * race found in the transaction). `hostname` is the name the problem is about;
 * `input` is what was typed, for `invalidHostname`.
 */
export interface TenantDomainProblem {
  index: number | null;
  kind: TenantDomainProblemKind;
  hostname: string | null;
  input?: string;
}

/** What one checked operation will do. */
export type TenantDomainStep =
  | { index: number; kind: 'add'; hostname: string; names: string[]; principal: 'root' | 'www' }
  | { index: number; kind: 'noop'; domain: TenantDomainRecord }
  | { index: number; kind: 'principal'; domain: TenantDomainRecord; principal: 'root' | 'www' }
  | { index: number; kind: 'verify'; domain: TenantDomainRecord }
  | { index: number; kind: 'archive'; domain: TenantDomainRecord; reason: string | null }
  | { index: number; kind: 'restore'; domain: TenantDomainRecord; reason: string | null };

type AddOperation = Extract<TenantDomainOperation, { operation: 'add' }>;
type TargetOperation = Exclude<TenantDomainOperation, { operation: 'add' }>;

const isLive = (domain: TenantDomainRecord) => domain.archivedAt === null;

/** Every name a domain answers on, root first. */
export const namesOf = (domain: TenantDomainRecord): string[] => domain.names.map((name) => name.hostname);

/** The names a claim takes: the root and its `www.`, or the one subdomain. */
export function claimOf(host: string): string[] {
  const www = wwwCompanionOf(host);
  return www === null ? [host] : [host, www];
}

/**
 * The names a claim must find free in OTHER tenants: its own, and, for a `www.`
 * of a root domain, that root, whose `www.` belongs to whoever holds it (a root
 * claimed before the pair existed has no `www.` row of its own).
 */
export function guardedOf(host: string): string[] {
  const parent = host.startsWith('www.') ? host.slice(4) : null;
  return parent !== null && isZoneApex(parent) ? [...claimOf(host), parent] : claimOf(host);
}

/** The tenant's domain an operation names: by id, or by either name (a live one first; for a restore, the latest removed). */
function targetOf(domains: readonly TenantDomainRecord[], operation: TargetOperation): TenantDomainRecord | null {
  if (operation.id !== undefined) return domains.find((domain) => domain.id === operation.id) ?? null;
  const host = hostnameOrNull(operation.hostname ?? '');
  if (host === null) return null;
  const matching = domains.filter((domain) => namesOf(domain).includes(host));
  const removed = matching
    .filter((domain) => !isLive(domain))
    .sort((a, b) => (b.archivedAt?.getTime() ?? 0) - (a.archivedAt?.getTime() ?? 0));
  const live = matching.filter(isLive);
  return (operation.operation === 'restore' ? (removed[0] ?? live[0]) : (live[0] ?? removed[0])) ?? null;
}

interface Planner {
  domains: TenantDomainRecord[];
  /** Live names held by OTHER tenants, among the names this call claims. */
  takenElsewhere: Set<string>;
  claimed: Set<string>;
  targeted: Set<string>;
  /** Domains a restore of this call targeted, whose one `verify` may follow (consumed by it). */
  restored: Set<string>;
  /**
   * Live and ACTIVE domains a restore of this call found already back. The
   * verify that follows is answered `unchanged`: a stale restore must never
   * re-check, and so possibly take down, a domain that is serving.
   */
  servingAlready: Set<string>;
  problems: TenantDomainProblem[];
  steps: TenantDomainStep[];
  entitled: boolean;
}

const fail = (planner: Planner, index: number, kind: TenantDomainProblemKind, hostname: string | null): void => {
  planner.problems.push({ index, kind, hostname });
};

/** A name this tenant holds on a live domain. */
const heldHere = (planner: Planner, name: string) =>
  planner.domains.some((domain) => isLive(domain) && namesOf(domain).includes(name));

/** The step of an add whose name the tenant already holds: unchanged, or the principal it asks for. */
function ownAdd(planner: Planner, index: number, own: TenantDomainRecord, principal: AddOperation['principal']): void {
  if (planner.targeted.has(own.id)) return fail(planner, index, 'duplicateTarget', own.hostname);
  planner.targeted.add(own.id);
  const changes = principal !== undefined && principal !== own.principal && own.wwwHostname !== null;
  planner.steps.push(changes ? { index, kind: 'principal', domain: own, principal } : { index, kind: 'noop', domain: own });
}

/** Why a new claim of `names` is refused, or null: twice in this call, another domain of this tenant, another tenant. */
function claimProblem(
  planner: Planner,
  host: string,
  names: readonly string[],
): { kind: 'duplicateTarget' | 'nameHeldHere' | 'nameTaken'; name: string } | null {
  const twice = names.find((name) => planner.claimed.has(name));
  if (twice !== undefined) return { kind: 'duplicateTarget', name: twice };
  const mine = names.find((name) => heldHere(planner, name));
  if (mine !== undefined) return { kind: 'nameHeldHere', name: mine };
  const taken = guardedOf(host).find((name) => planner.takenElsewhere.has(name));
  return taken === undefined ? null : { kind: 'nameTaken', name: taken };
}

function planAdd(planner: Planner, index: number, operation: AddOperation): void {
  const host = hostnameOrNull(operation.hostname);
  if (host === null) {
    planner.problems.push({ index, kind: 'invalidHostname', hostname: null, input: operation.hostname });
    return;
  }
  const names = claimOf(host);
  if (operation.principal === 'www' && names.length === 1) return fail(planner, index, 'notAPair', host);
  // Idempotent on the name: the tenant's own live domain answering on it is answered as it is.
  const own = planner.domains.find((domain) => isLive(domain) && (domain.hostname === host || domain.wwwHostname === host));
  if (own !== undefined) return ownAdd(planner, index, own, operation.principal);
  const refused = claimProblem(planner, host, names);
  if (refused !== null) return fail(planner, index, refused.kind, refused.name);
  names.forEach((name) => planner.claimed.add(name));
  planner.steps.push({ index, kind: 'add', hostname: host, names, principal: operation.principal ?? 'root' });
}

type TargetPlan = (planner: Planner, index: number, domain: TenantDomainRecord, operation: TargetOperation) => void;

/** An act only a live domain takes, or, for a `verify`, one this call restores before it. */
const liveOnly =
  (then: TargetPlan): TargetPlan =>
  (planner, index, domain, operation) =>
    isLive(domain) || (operation.operation === 'verify' && planner.restored.has(domain.id))
      ? then(planner, index, domain, operation)
      : fail(planner, index, 'removed', domain.hostname);

const reasonOf = (operation: TargetOperation): string | null =>
  'reason' in operation ? (operation.reason ?? null) : null;

/** A restore takes its names back only while every one is still free, of every tenant, this one included. */
function busyNameOf(planner: Planner, domain: TenantDomainRecord): string | undefined {
  return namesOf(domain)
    .flatMap((name) => guardedOf(name).map((guarded) => ({ name, guarded })))
    .find(
      ({ name, guarded }) =>
        planner.takenElsewhere.has(guarded) || heldHere(planner, name) || planner.claimed.has(name),
    )?.guarded;
}

const TARGET_PLANS: Record<TargetOperation['operation'], TargetPlan> = {
  verify: liveOnly((planner, index, domain) => {
    if (planner.servingAlready.has(domain.id)) return void planner.steps.push({ index, kind: 'noop', domain });
    return planner.entitled
      ? void planner.steps.push({ index, kind: 'verify', domain })
      : fail(planner, index, 'planRequired', domain.hostname);
  }),
  setPrincipal: liveOnly((planner, index, domain, operation) => {
    if (domain.wwwHostname === null) return fail(planner, index, 'notAPair', domain.hostname);
    const principal = (operation as Extract<TargetOperation, { operation: 'setPrincipal' }>).principal;
    planner.steps.push(
      domain.principal === principal ? { index, kind: 'noop', domain } : { index, kind: 'principal', domain, principal },
    );
  }),
  archive: (planner, index, domain, operation) => {
    planner.steps.push(
      isLive(domain) ? { index, kind: 'archive', domain, reason: reasonOf(operation) } : { index, kind: 'noop', domain },
    );
  },
  restore: (planner, index, domain, operation) => {
    // Its verify may follow whatever this restore answers: `unchanged` on a live domain (a stale
    // removed list, another tab), or a refusal that is the call's one real problem.
    planner.restored.add(domain.id);
    if (isLive(domain) && domain.status === 'ACTIVE') planner.servingAlready.add(domain.id);
    if (isLive(domain)) return void planner.steps.push({ index, kind: 'noop', domain });
    const busy = busyNameOf(planner, domain);
    if (busy !== undefined) return fail(planner, index, 'nameNotFree', busy);
    namesOf(domain).forEach((name) => planner.claimed.add(name));
    planner.steps.push({ index, kind: 'restore', domain, reason: reasonOf(operation) });
  },
};

function planTargeted(planner: Planner, index: number, operation: TargetOperation): void {
  const domain = targetOf(planner.domains, operation);
  if (domain === null) return fail(planner, index, 'notFound', operation.hostname ?? null);
  // One entry per domain, but for the `verify` that may follow its `restore` (a restore button sends both).
  const verifiesRestored = operation.operation === 'verify' && planner.restored.has(domain.id);
  if (planner.targeted.has(domain.id) && !verifiesRestored) return fail(planner, index, 'duplicateTarget', domain.hostname);
  planner.targeted.add(domain.id);
  TARGET_PLANS[operation.operation](planner, index, domain, operation);
  if (verifiesRestored) planner.restored.delete(domain.id);
}

/** Every name the call may claim (adds' and restores'), to ask who else holds it in ONE read. */
export function claimableNames(
  operations: readonly TenantDomainOperation[],
  domains: readonly TenantDomainRecord[],
): string[] {
  return operations.flatMap((operation) => {
    if (operation.operation === 'add') {
      const host = hostnameOrNull(operation.hostname);
      return host === null ? [] : guardedOf(host);
    }
    const domain = operation.operation === 'restore' ? targetOf(domains, operation) : null;
    return domain === null ? [] : namesOf(domain).flatMap((name) => guardedOf(name));
  });
}

/** How many quota units the steps take: one per new claim and per restore. */
export const unitsOf = (steps: readonly TenantDomainStep[]): number =>
  steps.filter((step) => step.kind === 'add' || step.kind === 'restore').length;

/** The names the steps claim: a new claim's and a restore's. */
export const claimsOf = (steps: readonly TenantDomainStep[]): string[] =>
  steps.flatMap((step) => (step.kind === 'add' ? step.names : step.kind === 'restore' ? namesOf(step.domain) : []));

/**
 * Check every operation; nothing is written. The steps in call order, or every
 * problem. `takenElsewhere` is the live names OTHER tenants hold among
 * {@link claimableNames}; `entitled` whether a `verify` may run at all.
 */
export function planDomainOperations(input: {
  operations: readonly TenantDomainOperation[];
  domains: TenantDomainRecord[];
  takenElsewhere: ReadonlySet<string>;
  entitled: boolean;
}): { steps: TenantDomainStep[]; problems: TenantDomainProblem[] } {
  const planner: Planner = {
    domains: input.domains,
    takenElsewhere: new Set(input.takenElsewhere),
    claimed: new Set(),
    targeted: new Set(),
    restored: new Set(),
    servingAlready: new Set(),
    problems: [],
    steps: [],
    entitled: input.entitled,
  };
  input.operations.forEach((operation, index) =>
    operation.operation === 'add' ? planAdd(planner, index, operation) : planTargeted(planner, index, operation),
  );
  return planner.problems.length > 0 ? { steps: [], problems: planner.problems } : { steps: planner.steps, problems: [] };
}
