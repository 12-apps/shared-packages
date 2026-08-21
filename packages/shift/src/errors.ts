export type ShiftErrorCode =
  | 'INVALID_SHIFT'
  | 'SHIFT_ALREADY_OPEN'
  | 'SHIFT_NOT_FOUND'
  | 'SHIFT_ALREADY_ENDED'
  | 'SHIFT_NOT_OWNED'
  | 'RESOURCE_TAKEN'
  | 'ASSIGNMENT_CONFLICT';

export class ShiftError extends Error {
  constructor(
    public readonly code: ShiftErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ShiftError';
  }
}

/**
 * A wiring mistake, not a shift outcome.
 *
 * Kept apart from {@link ShiftError} because the two are answered by different
 * people at different times: a `ShiftError` is a response a worker's request
 * earned, carries a code a host maps to a status, and is expected traffic. This
 * one says the service was CONSTRUCTED wrong — it can only be thrown before any
 * request exists, and no host should be mapping it to anything but a crash.
 */
export class ShiftConfigError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ShiftConfigError';
  }
}
