import type { ZodError } from 'zod';

/**
 * The "this source's config does not parse" sentence, shared by the connectors
 * that validate `PriceSource.config` with zod (FUT-517).
 *
 * WHY NOT `error.message`: zod's text is English, unbounded, and it QUOTES the
 * offending value. A value inside a price source's `config` can be a
 * credential — that is the whole reason
 * `apps/web/lib/repositories/platform/research-scrub.ts` exists — and this
 * string is stored on the run and rendered to a tenant admin. The field PATHS
 * carry the entire actionable diagnostic (which field to fix) and none of the
 * value.
 *
 * WHY NOT the source's `name`: it is operator-typed free text, and
 * research-scrub's `MAX_NAME_CHARS` note records that operators do paste keys
 * into it. The surfaces that render this reason already print the source name
 * beside it (`source-status.tsx` puts it on the row), so repeating it inside
 * the sentence buys nothing and carries risk.
 *
 * Its own module rather than a home in `searchapi-errors.ts` because it is not
 * a SearchApi concern: `vtex.ts` and `mercado-livre.ts` build the identical
 * English string today and can adopt this without a second move.
 */
export const invalidConfigMessage = (sourceLabel: string, error: ZodError): string => {
  // A path is empty when the whole config failed (a non-object, say), and zod
  // reports one issue per failing field — de-duplicated because two issues on
  // one field must not name it twice.
  const named = error.issues.map((issue) => issue.path.map(String).join('.'));
  const fields = [...new Set(named.filter((field) => field !== ''))];
  if (fields.length === 0) {
    return `Configuração da fonte ${sourceLabel} inválida — revise os campos da fonte`;
  }
  return `Configuração da fonte ${sourceLabel} inválida — revise: ${fields.join(', ')}`;
};
