/**
 * Field-level form validators
 *
 * Pure, framework-agnostic validators ported from the gym-app `total-form`
 * source — NO zod, NO react-hook-form. Each validator is curried and returns a
 * `string` error message for invalid input or `undefined` when the value is
 * valid. Distinct from `utils/lib/validation.ts` (date-string validation).
 *
 * @module shared-helpers/forms/validators
 */

/** A field validator: returns an error message, or `undefined` when valid. */
export type Validator = (value: string) => string | undefined;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Requires a non-empty value (after trimming whitespace).
 *
 * @param message - Custom error message for empty input.
 * @returns A validator returning the message for empty input, else `undefined`.
 */
export const required =
  (message = 'This field is required'): Validator =>
  (value) =>
    value.trim().length === 0 ? message : undefined;

/**
 * Validates that the value is a well-formed email address.
 *
 * @param message - Custom error message for malformed input.
 * @returns A validator returning the message for invalid input, else `undefined`.
 */
export const email =
  (message = 'Enter a valid email address'): Validator =>
  (value) =>
    EMAIL_PATTERN.test(value) ? undefined : message;

/**
 * Validates that the value has at least `length` characters.
 *
 * @param length - The minimum number of characters required.
 * @param message - Custom error message for too-short input.
 * @returns A validator returning the message for short input, else `undefined`.
 */
export const minLength =
  (length: number, message = `Must be at least ${length} characters`): Validator =>
  (value) =>
    value.length < length ? message : undefined;

/** Alias of {@link minLength}. */
export const min = minLength;

/** A map of field names to the list of validators applied to that field. */
export type ValidatorSchema<T> = {
  [K in keyof T]?: Validator[];
};

/** A map of field names to the first error message produced for that field. */
export type FieldErrors<T> = {
  [K in keyof T]?: string;
};

/**
 * Runs each field's validators against `values`, short-circuiting on the first
 * failing validator per field.
 *
 * @param values - The field values to validate (keyed by field name).
 * @param schema - Validators to apply per field.
 * @returns A record containing one entry per failing field; `{}` when all valid.
 */
export const validateFields = <T extends Record<string, string>>(
  values: T,
  schema: ValidatorSchema<T>,
): FieldErrors<T> => {
  const errors: FieldErrors<T> = {};

  for (const field of Object.keys(schema) as (keyof T)[]) {
    const validators = schema[field];
    if (!validators) {
      continue;
    }

    for (const validate of validators) {
      const error = validate(values[field] ?? '');
      if (error !== undefined) {
        errors[field] = error;
        break;
      }
    }
  }

  return errors;
};
