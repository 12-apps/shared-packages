/**
 * What a schedule request can earn — its own class and codes, apart from
 * `ShiftError`.
 *
 * `ShiftErrorCode` is pinned exhaustively by hosts (a `Record<ShiftErrorCode,
 * number>` status map), so a new member there would break every one of them on
 * a minor release. A host maps these through {@link SHIFT_SCHEDULE_ERROR_STATUS}.
 */
export type ShiftScheduleErrorCode =
  | 'INVALID_SLOT'
  | 'SLOT_OVERLAP'
  | 'SLOT_NOT_FOUND'
  | 'SLOT_CANCELED'
  | 'SLOT_OVER';

export class ShiftScheduleError extends Error {
  constructor(
    public readonly code: ShiftScheduleErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ShiftScheduleError';
  }
}

/** The HTTP status each code answers with. */
export const SHIFT_SCHEDULE_ERROR_STATUS = {
  INVALID_SLOT: 422,
  SLOT_OVERLAP: 409,
  SLOT_NOT_FOUND: 404,
  SLOT_CANCELED: 409,
  SLOT_OVER: 409,
} as const satisfies Record<ShiftScheduleErrorCode, number>;
