/**
 * The draft-write body, parsed by hand (this server half takes no runtime
 * dependency on the optional `zod` peer): `{ data: <snapshot> }` and nothing
 * else, and with a collection's `draftData` validator (FUT-4867), only the
 * `data` that validator passes.
 */
import type { Snapshot } from '../types';

import { invalidInput, unrecognizedKeys, type LifecycleMessages } from './context';

/**
 * A collection's own validator for a draft's `data` (FUT-4867), as this server
 * half needs it: anything with a zod-style `safeParse`. Declared structurally
 * so the server takes no runtime dependency on the optional `zod` peer — a zod
 * schema satisfies it as it is, and so does any hand-written validator that
 * answers the same two shapes.
 */
export interface LifecycleDraftDataValidator {
  safeParse(value: unknown):
    | { success: true; data: unknown }
    | {
        success: false;
        error: { issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }> };
      };
}

/** A validator's issue path, dotted under `data` the way every other problem is written. */
function issuePath(path: ReadonlyArray<PropertyKey>): string {
  return ['data', ...path.map((step) => String(step))].join('.');
}

/**
 * The one body shape the draft writes accept: `{ data: <snapshot> }`, and
 * nothing else — the same strictness `saveDraftBody` advertises (this server
 * half takes no runtime dependency on the optional `zod` peer, so it enforces
 * the schema's rule by hand).
 *
 * With the collection's `draftData` validator (FUT-4867), `data` must also
 * pass it: a refusal is the same 422, one problem per issue at its dotted path
 * (`data.name`), and what is stored is the validator's OUTPUT. Without one,
 * any JSON object is a draft, as before.
 */
export function parseSnapshotBody(
  body: unknown,
  messages: LifecycleMessages,
  draftData?: LifecycleDraftDataValidator,
): Snapshot {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw invalidInput(messages, [{ path: '', message: 'Expected an object' }]);
  }
  const record = body as Record<string, unknown>;
  const problems = unrecognizedKeys(record, ['data']);
  const data = record.data;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    problems.push({ path: 'data', message: 'Expected an object' });
  }
  if (problems.length > 0) throw invalidInput(messages, problems);
  if (!draftData) return data as Snapshot;
  const parsed = draftData.safeParse(data);
  if (!parsed.success) {
    throw invalidInput(
      messages,
      parsed.error.issues.map((issue) => ({ path: issuePath(issue.path), message: issue.message })),
    );
  }
  return parsed.data as Snapshot;
}
