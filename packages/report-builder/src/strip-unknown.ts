import type { z } from 'zod';

/**
 * A stored value, with every key the strict `schema` does not declare removed.
 *
 * The request schemas are strict: an unknown key is a 422. A row read back from
 * the database is not a request, and one written by another release (a key
 * since removed, or added before a rollback) must keep opening. This view drops
 * exactly what the schema names as unrecognized, at any depth, and leaves every
 * other problem for the normal parse to report. It repeats because a strict
 * object reports an unknown key before its own rules run.
 */
export function withoutUnrecognizedKeys(schema: z.ZodType, input: unknown): unknown {
  const current: unknown = structuredClone(input);
  for (let pass = 0; pass < 8; pass += 1) {
    const result = schema.safeParse(current);
    if (result.success) return current;
    const unknown = result.error.issues.filter((issue) => issue.code === 'unrecognized_keys');
    if (unknown.length === 0) return current;
    unknown.forEach((issue) => dropKeys(current, issue.path, issue.keys));
  }
  return current;
}

/** Delete `keys` from the object found at `path` inside `root`, when it is there. */
function dropKeys(root: unknown, path: ReadonlyArray<PropertyKey>, keys: string[]): void {
  let node = root;
  for (const segment of path) {
    if (typeof node !== 'object' || node === null) return;
    node = (node as Record<PropertyKey, unknown>)[segment];
  }
  if (typeof node !== 'object' || node === null) return;
  for (const key of keys) delete (node as Record<string, unknown>)[key];
}
