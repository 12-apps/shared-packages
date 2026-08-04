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
