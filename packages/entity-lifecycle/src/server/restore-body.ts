import type { RestoreOverrides } from '../restore-conflict';

import { LifecycleApiError, type LifecycleMessages } from './context';

/** Bounds on a restore body: a handful of short values, never a payload. */
const MAX_RESTORE_OVERRIDES = 10;
const MAX_RESTORE_OVERRIDE_LENGTH = 500;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isShortString = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= MAX_RESTORE_OVERRIDE_LENGTH;

/**
 * The optional `{ overrides }` body of a bin restore (FUT-1342) — the values
 * typed into the clash dialog, string to string. No body (the first try) is no
 * overrides. Values are trimmed; a host decides what an empty one means.
 */
export function parseRestoreBody(
  body: unknown,
  messages: LifecycleMessages,
): RestoreOverrides | undefined {
  if (body === undefined || body === null) return undefined;
  const overrides = isPlainObject(body) ? body.overrides : null;
  if (overrides === undefined) return undefined;
  const entries = isPlainObject(overrides) ? Object.entries(overrides) : null;
  if (!entries || entries.length > MAX_RESTORE_OVERRIDES || !entries.every(([, value]) => isShortString(value))) {
    throw new LifecycleApiError(400, messages.invalidBody);
  }
  return Object.fromEntries(entries.map(([key, value]) => [key, (value as string).trim()]));
}
