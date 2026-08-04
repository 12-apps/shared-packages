import type { ShiftErrorCode } from './errors';

export const SHIFT_KINDS = ['kitchen', 'service'] as const;
export type ShiftKind = (typeof SHIFT_KINDS)[number];

export const SHIFT_END_REASONS = ['user', 'supervisor', 'auto'] as const;
export type ShiftEndReason = (typeof SHIFT_END_REASONS)[number];

/**
 * The `ResourceAssignment.resourceType` a kitchen-station claim is stored under.
 *
 * It must equal the NAMESPACE of the action whose entity gate reads it, because
 * a host's RBAC point check derives the resource type from the action prefix
 * (`kitchen:read:station` -> `kitchen`). Spelling it `kitchen-stations` — the
 * admin CRUD surface's name — made `can(cook, 'kitchen:read:station', station)`
 * look up a type nothing was ever written under, so an open kitchen shift
 * granted nothing.
 */
export const KITCHEN_STATIONS_RESOURCE_TYPE = 'kitchen';

/**
 * The `ResourceAssignment.resourceType` a dining-room SECTOR claim is stored
 * under (FUT-450/452), written when a waiter opens a `service` shift.
 *
 * Note this deliberately does NOT follow the rule above, and the difference is
 * the point. A station claim is stored under the namespace of the action that
 * reads it (`kitchen:read:station` -> `kitchen`) because the claim and the
 * question are about the same thing. A sector claim is not: the rows carry
 * SECTOR ids, but the question asked of them is `tables:read:assigned` — about
 * MESAS. Storing them under `tables` would put a sector id in a column every
 * other reader treats as a mesa id.
 *
 * So the rows say what they are, and the host's `assignmentResolver` expands
 * them into the mesa ids the question is about. Keeping the storage honest is
 * what lets that expansion be a live query, which is in turn what makes a mesa
 * moved between sectors mid-shift take effect on the waiter's next request.
 */
export const SECTORS_RESOURCE_TYPE = 'sectors';

export interface ShiftResource {
  type: string;
  id: string;
  exclusive?: boolean;
}

export interface Shift {
  id: string;
  clientId: string;
  userId: string;
  kind: ShiftKind;
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

export interface OpenShiftInput {
  clientId: string;
  userId: string;
  kind: ShiftKind;
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

export interface ShiftListInput {
  clientId: string;
  userId?: string;
  kind?: ShiftKind;
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
  listOpenShifts(clientId: string, kind?: ShiftKind): Promise<Shift[]>;
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

export interface ShiftServiceOptions {
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

export interface ShiftService {
  openShift(input: OpenShiftInput): Promise<Shift>;
  closeOwnShift(input: CloseOwnShiftInput): Promise<Shift>;
  forceCloseShift(input: ForceCloseShiftInput): Promise<Shift>;
  getShift(input: { clientId: string; shiftId: string }): Promise<Shift | null>;
  getOpenShift(input: { clientId: string; userId: string }): Promise<Shift | null>;
  listOpenShifts(input: { clientId: string; kind?: ShiftKind }): Promise<Shift[]>;
  listShifts(input: ShiftListInput): Promise<ShiftPage>;
  autoCloseOverdue(input: AutoCloseInput): Promise<AutoCloseResult>;
}
