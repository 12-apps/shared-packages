import { err, ok, type Result } from './result';
import { validateFields, type ValidatorSchema } from './validators';

/** Generic, user-safe message returned when a handler throws. */
const GENERIC_ERROR = 'Something went wrong. Please try again.';

/**
 * An error whose `message` is safe to show to the end user.
 *
 * Handlers throw this to surface a *specific, actionable* failure (e.g. "a
 * product with this name already exists") through {@link createServerAction}
 * instead of collapsing into the {@link GENERIC_ERROR}. Any error that is NOT
 * an `ActionError` is treated as unexpected: it is logged server-side and the
 * caller receives the generic message so internal details never leak.
 */
export class ActionError extends Error {
  /**
   * The form field this failure is attributable to (e.g. `"name"` for a
   * duplicate-name conflict). When set, {@link createServerAction} surfaces it
   * as `fieldErrors` so the form can highlight that exact field.
   */
  readonly field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.name = 'ActionError';
    this.field = field;
  }
}

/**
 * Wraps a handler-agnostic server action with validate-first semantics.
 *
 * The returned action:
 * 1. Runs {@link validateFields} against `input` using `schema`. On the first
 *    field error it returns `err(message)` **without invoking `handler`**.
 * 2. Otherwise invokes `handler(input)` and returns `ok` with its resolved
 *    value.
 * 3. Passes through the message of an {@link ActionError} thrown by `handler`
 *    (a deliberate, user-safe failure), and maps any *other* exception to a
 *    generic `err` message — logging the real cause server-side so production
 *    failures stay diagnosable without leaking internals to the client.
 *
 * @typeParam I - The validated input shape (string fields keyed by name).
 * @typeParam O - The handler's success payload type.
 * @param schema - Per-field validators applied before the handler runs.
 * @param handler - The business logic, run only when input is valid.
 * @returns An async action that resolves to a {@link Result}.
 */
export const createServerAction = <I extends Record<string, string>, O>(
  schema: ValidatorSchema<I>,
  handler: (input: I) => Promise<O> | O,
): ((input: I) => Promise<Result<O>>) => {
  return async (input: I): Promise<Result<O>> => {
    const errors = validateFields(input, schema);
    // Surface the first failing field by name so the form highlights it.
    const firstField = (Object.keys(errors) as (keyof I)[]).find(
      (field) => typeof errors[field] === 'string',
    );
    if (firstField !== undefined) {
      const message = errors[firstField] as string;
      return err(message, { [String(firstField)]: message });
    }

    try {
      return ok(await handler(input));
    } catch (error) {
      if (error instanceof ActionError) {
        return err(error.message, error.field ? { [error.field]: error.message } : undefined);
      }
      // Unexpected: log the real cause server-side (never sent to the client)
      // so prod failures are diagnosable, and return a safe generic message.
      console.error('[serverAction] handler threw an unexpected error:', error);
      return err(GENERIC_ERROR);
    }
  };
};
