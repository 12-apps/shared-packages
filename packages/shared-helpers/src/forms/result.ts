/**
 * Discriminated-union result type for operations that can fail.
 *
 * Pure and framework-agnostic. The `ok` discriminant narrows the union so
 * consumers can safely read `data` on success or `error` on failure.
 *
 * @typeParam T - The success payload type.
 * @module shared-helpers/forms/result
 */
export type Result<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: string;
      /**
       * Per-field error messages, keyed by form field name, when the failure is
       * attributable to specific input(s). Lets a form highlight the exact
       * offending field(s) instead of only showing the summary `error`.
       */
      fieldErrors?: Record<string, string>;
    };

/**
 * Builds a successful {@link Result} wrapping `data`.
 *
 * @typeParam T - The success payload type.
 * @param data - The value to wrap.
 * @returns `{ ok: true, data }`.
 */
export const ok = <T>(data: T): Result<T> => ({ ok: true, data });

/**
 * Builds a failed {@link Result} wrapping an error `message`.
 *
 * @param error - A user-safe error message (never an internal/stack detail).
 * @param fieldErrors - Optional per-field messages so a form can highlight the
 *   exact offending field(s). Omitted when the failure isn't field-specific.
 * @returns `{ ok: false, error, fieldErrors? }`.
 */
export const err = (
  error: string,
  fieldErrors?: Record<string, string>,
): Result<never> =>
  fieldErrors ? { ok: false, error, fieldErrors } : { ok: false, error };
