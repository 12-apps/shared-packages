import type { ResearchHttpMessages, ResearchHttpResponse } from './types';

/** The tiny moves every route group shares — envelopes and coercions. */

export function ok(data: unknown, status = 200): ResearchHttpResponse {
  return { status, body: { data } };
}

export function refuse(status: number, error: string): ResearchHttpResponse {
  return { status, body: { error } };
}

export function recordOf(body: unknown): Record<string, unknown> {
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
}

export function intOf(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * The submitted field names must be EXACTLY what this source's connector
 * reads — an unknown name is a key nothing will ever send, and a missing one
 * is a half-configured pair whose provider rejection would then be misread
 * as the store blocking us. Names only; no value is ever echoed.
 */
export function credentialFieldsProblem(
  fields: readonly string[] | undefined,
  credentials: Record<string, string>,
  messages: ResearchHttpMessages,
): string | null {
  if (fields === undefined) return messages.keylessSource;
  const submitted = Object.keys(credentials);
  const complete =
    submitted.length === fields.length && fields.every((field) => submitted.includes(field));
  return complete ? null : messages.incompleteCredentialFields(fields);
}

export function credentialsOf(body: Record<string, unknown>): Record<string, string> {
  const submitted = recordOf(body['credentials']);
  return Object.fromEntries(
    Object.entries(submitted).filter((entry): entry is [string, string] => {
      return typeof entry[1] === 'string';
    }),
  );
}
