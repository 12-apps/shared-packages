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
