import type { ShiftErrorCode } from './errors';
import type { ShiftKindTuple } from './vocabulary';

export const SHIFT_END_REASONS = ['user', 'supervisor', 'auto'] as const;
export type ShiftEndReason = (typeof SHIFT_END_REASONS)[number];

/**
 * A shift's `kind` is a plain string HERE, on purpose.
 *
 * This package used to export a two-entry union naming the staff structure of
 * the application it was extracted from, and validate against it. Those values
 * were never facts about work periods, and a union is the worst shape for such
 * a value to take: it reaches an adopter's generated types and its published
 * wire contract, where removing it is a breaking change rather than a setting.
 *
 * A host declares its own kinds and passes them to `createShiftService`, which
 * narrows the input side to them (see {@link ShiftServiceOptions}). The READ
 * side stays `string`, because a row is whatever the column holds: a host that
 * wants its union back on the way out narrows explicitly, with the guard
 * `defineShiftVocabulary` returns.
 *
 * This is what `resourceType` and `resourceId` have always done — the same
 * class of value, carried by value, with the host owning what the values mean.
 */

export interface ShiftResource {
  type: string;
  id: string;
  exclusive?: boolean;
}

export interface Shift {
  id: string;
  clientId: string;
  userId: string;
  kind: string;
  startedAt: Date;
  endedAt: Date | null;
  endedReason: ShiftEndReason | null;
  endedByUserId: string | null;
  resourceAssignmentId: string | null;
  resourceType: string | null;
  resourceId: string | null;
}

export interface ResourceAssignment {
  id: string;
  clientId: string;
  userId: string;
  resourceType: string;
  resourceId: string;
  validFrom: Date;
  validTo: Date | null;
}

export interface ShiftAuditInput {
  clientId: string;
  actorUserId: string | null;
  action: 'shift.start' | 'shift.end';
  resourceType: 'shift';
  resourceId: string;
  before: Record<string, string | null>;
  after: Record<string, string | null>;
}

export interface OpenShiftInput<Kind extends string = string> {
  clientId: string;
  userId: string;
  kind: Kind;
  actorUserId: string;
  resource?: ShiftResource;
  startedAt?: Date;
}

export interface CloseShiftInput {
  clientId: string;
  shiftId: string;
  byUserId: string | null;
  reason: ShiftEndReason;
  endedAt?: Date;
}

export interface CloseOwnShiftInput {
  clientId: string;
  shiftId: string;
  userId: string;
  endedAt?: Date;
}

export interface ForceCloseShiftInput {
  clientId: string;
  shiftId: string;
  byUserId: string;
  endedAt?: Date;
}

export interface ShiftListInput<Kind extends string = string> {
  clientId: string;
  userId?: string;
  kind?: Kind;
  from?: Date;
  to?: Date;
  cursor?: string;
  limit?: number;
}

export interface ShiftPage {
  items: Shift[];
  nextCursor: string | null;
}

export interface ShiftQuery {
  getShift(clientId: string, shiftId: string): Promise<Shift | null>;
  getOpenShift(clientId: string, userId: string): Promise<Shift | null>;
  listOpenShifts(clientId: string, kind?: string): Promise<Shift[]>;
  listShifts(
    input: Required<Pick<ShiftListInput, 'clientId' | 'limit'>> &
      Omit<ShiftListInput, 'clientId' | 'limit'>,
  ): Promise<ShiftPage>;
  /**
   * Open shifts that COULD be overdue at `detectedAt`. The per-tenant cutoff is
   * the service's business; a host is free to narrow this further (no tenant's
   * auto-close window is under an hour) and to cap the batch — the sweep runs
   * on a schedule, so anything left over is picked up on the next tick.
   */
  listOpenStartedBefore(detectedAt: Date): Promise<Shift[]>;
}

export interface ShiftTransaction {
  getShift(clientId: string, shiftId: string): Promise<Shift | null>;
  getOpenShift(clientId: string, userId: string): Promise<Shift | null>;
  /**
   * Serialize exclusive claims for `(clientId, resourceType, resourceId)` for
   * the rest of this transaction. Hosts backed by Postgres should use
   * `pg_advisory_xact_lock`; in-memory hosts may no-op under single-threaded tests.
   */
  lockExclusiveResource(
    clientId: string,
    resourceType: string,
    resourceId: string,
  ): Promise<void>;
  /**
   * Active = `validTo IS NULL OR validTo > at`.
   *
   * Deliberately NOT gated on `validFrom <= at`: an exclusive claim that starts
   * later still conflicts with one opening now — treating it as free would hand
   * the same resource to two workers, with the later claim silently winning.
   */
  isResourceActive(
    clientId: string,
    resourceType: string,
    resourceId: string,
    at: Date,
  ): Promise<boolean>;
  createAssignment(input: Omit<ResourceAssignment, 'validTo'>): Promise<ResourceAssignment>;
  createShift(shift: Shift): Promise<Shift>;
  endShift(input: {
    clientId: string;
    shiftId: string;
    endedAt: Date;
    endedReason: ShiftEndReason;
    endedByUserId: string | null;
  }): Promise<Shift | null>;
  endAssignment(input: { clientId: string; assignmentId: string; validTo: Date }): Promise<boolean>;
  writeAudit(input: ShiftAuditInput): Promise<void>;
}

export type ShiftUniqueConstraint =
  | 'shifts_open_client_user_key'
  | 'shifts_resource_assignment_id_key'
  | 'resource_assignments_active_unique_idx';

export interface ShiftDb extends ShiftQuery {
  transaction<T>(work: (tx: ShiftTransaction) => Promise<T>): Promise<T>;
  isUniqueViolation(error: unknown, constraint: ShiftUniqueConstraint): boolean;
}

export interface ShiftServiceOptions<Kinds extends ShiftKindTuple = ShiftKindTuple> {
  /**
   * The kinds of shift this host works in — REQUIRED, and the reason this
   * package no longer names any.
   *
   * There is deliberately no default. A default would be one application's
   * staff structure wearing the word "default", and the failure mode is
   * silence: the next host inherits it, every type checks, every test passes,
   * and the wrong vocabulary reaches production in that host's own API. Pass an
   * `as const` tuple and the service's input side narrows to exactly these
   * values.
   */
  kinds: Kinds;
  now?: () => Date;
  createId?: () => string;
}

export interface AutoCloseInput {
  detectedAt?: Date;
  maxDurationMsForTenant(clientId: string): Promise<number>;
}

/** One candidate the cross-tenant sweep could not close, and why. */
export interface AutoCloseFailure {
  clientId: string;
  shiftId: string;
  code: ShiftErrorCode | 'UNKNOWN';
  message: string;
}

/**
 * What one sweep achieved. `failures` is non-empty exactly when a row is stuck:
 * the sweep isolates each candidate, so those rows neither abort the pass nor
 * disappear from view.
 */
export interface AutoCloseResult {
  closed: Shift[];
  failures: AutoCloseFailure[];
}

export interface ShiftService<Kind extends string = string> {
  openShift(input: OpenShiftInput<Kind>): Promise<Shift>;
  closeOwnShift(input: CloseOwnShiftInput): Promise<Shift>;
  forceCloseShift(input: ForceCloseShiftInput): Promise<Shift>;
  getShift(input: { clientId: string; shiftId: string }): Promise<Shift | null>;
  getOpenShift(input: { clientId: string; userId: string }): Promise<Shift | null>;
  listOpenShifts(input: { clientId: string; kind?: Kind }): Promise<Shift[]>;
  listShifts(input: ShiftListInput<Kind>): Promise<ShiftPage>;
  autoCloseOverdue(input: AutoCloseInput): Promise<AutoCloseResult>;
}
