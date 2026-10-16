import type { RestoreConflict } from './restore-conflict';

/** Typed failures thrown by the lifecycle service. */

export type LifecycleErrorCode =
  | 'ENTITY_NOT_FOUND'
  | 'VERSION_NOT_FOUND'
  | 'ENTRY_NOT_FOUND'
  | 'DRAFT_NOT_FOUND'
  | 'REQUEST_NOT_FOUND'
  | 'REQUEST_ALREADY_DECIDED'
  | 'FEATURE_DISABLED'
  | 'NOT_AUTHORIZED'
  | 'INVALID_STATE';

export class LifecycleError extends Error {
  readonly code: LifecycleErrorCode;

  constructor(code: LifecycleErrorCode, message: string) {
    super(message);
    this.name = 'LifecycleError';
    this.code = code;
  }
}

/**
 * A restore the host refused because the record's name, code or another unique
 * value is taken now. Carries the host's own wording of the clash, which the
 * bin screen shows in a dialog that retries with the values the person types.
 */
export class RestoreConflictError extends LifecycleError {
  readonly conflict: RestoreConflict;

  constructor(conflict: RestoreConflict) {
    // `INVALID_STATE` rather than a new code: a new member of
    // `LifecycleErrorCode` breaks every adopter with an exhaustive map of it,
    // and the class itself is what the HTTP surface tells apart (409).
    super('INVALID_STATE', conflict.message);
    this.name = 'RestoreConflictError';
    this.conflict = conflict;
  }
}
