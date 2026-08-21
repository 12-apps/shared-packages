import type { ShiftErrorCode } from './errors';

/**
 * A shift's kind — one of the HOST's own ids, never one of this package's.
 *
 * Through 3.x this was `'kitchen' | 'service'`: a two-literal union, exported
 * alongside a runtime `SHIFT_KINDS` array and validated against those exact
 * strings. That put `kitchen` in the types of every adopter and in the OpenAPI
 * generated from them — a clinic rostering hygienists shipped a wire contract
 * naming a kitchen. A union leaks worse than a stray string does, and this is
 * why: a string is cosmetic and stops where it is written, a union propagates
 * into everything that reads the type.
 *
 * So the SET is configuration ({@link ShiftServiceOptions.kinds}, required)
 * and the TYPE is `string`. The service still refuses a kind outside the
 * configured set — it simply holds no opinion about which ids those are.
 *
 * The two `resourceType` constants that sat here went the same way, and for a
 * plainer reason: `KITCHEN_STATIONS_RESOURCE_TYPE` and
 * `SECTORS_RESOURCE_TYPE` were never this package's values. Each had to equal
 * the namespace of a HOST action its own RBAC check derives, which is the
 * definition of host vocabulary — the wiring manifest already says as much
 * about permissions ("the ids the routes check are host vocabulary"). A host
 * declares them beside the actions they must match, where a mismatch is
 * visible, instead of importing them from a package that cannot know.
 */
export type ShiftKind = string;

export const SHIFT_END_REASONS = ['user', 'supervisor', 'auto'] as const;
export type ShiftEndReason = (typeof SHIFT_END_REASONS)[number];

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
  /**
   * The kinds of shift this host runs — REQUIRED, and with no default, which
   * is the whole point: a default here would be one application's roster
   * spelled into every other one's types. Checked at assembly (non-empty, no
   * blanks) rather than on first `openShift`, so a misconfigured host fails
   * where it is wired instead of when a worker clocks in.
   */
  kinds: readonly ShiftKind[];
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
