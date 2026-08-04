/**
 * Strip audited-sensitive fields out of a tool result before it reaches the
 * agent.
 *
 * The dispatcher forwards the wrapped endpoint's response body verbatim, so a
 * narrowed `outputSchema` alone would only change what the manifest CLAIMS is
 * returned. This module is what actually removes the value, keeping the served
 * payload and the advertised schema in agreement.
 */

/** Walk one dotted path, mapping over arrays, and delete the leaf. */
function stripPath(value: unknown, segments: readonly string[]): void {
  if (value === null || typeof value !== "object") return;

  if (Array.isArray(value)) {
    value.forEach((entry) => stripPath(entry, segments));
    return;
  }

  const [head, ...rest] = segments;
  if (!head) return;

  const record = value as Record<string, unknown>;
  if (rest.length === 0) {
    delete record[head];
    return;
  }
  if (head in record) stripPath(record[head], rest);
}

/**
 * Return `body` without the listed dotted paths.
 *
 * The input is deep-cloned first: dispatch results are handed straight to the
 * JSON-RPC encoder AND reused as `structuredContent`, so mutating in place
 * could leak a half-redacted object into one of the two surfaces.
 */
export function redactResponseBody(
  body: unknown,
  paths: readonly string[] | undefined,
): unknown {
  if (!paths?.length || body === null || typeof body !== "object") return body;

  const clone = structuredClone(body);
  paths.forEach((path) => stripPath(clone, path.split(".")));
  return clone;
}
