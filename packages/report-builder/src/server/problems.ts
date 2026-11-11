import type { z } from 'zod';

import { InvalidInputError, type InputProblem } from '../errors';

/**
 * Every problem of a refused parse, with its path. An unknown key is one problem
 * per key, at the key's own path, so a client can paint the exact field that
 * should not have been sent.
 */
function problemsOf(error: z.ZodError): InputProblem[] {
  return error.issues.flatMap((issue) => {
    const base = issue.path.map(String);
    if (issue.code === 'unrecognized_keys') {
      return issue.keys.map((key) => ({ path: [...base, key].join('.'), message: 'Unrecognized key' }));
    }
    return [{ path: base.join('.'), message: issue.message }];
  });
}

/** The 422 a refused input becomes: the first problem as the sentence, all of them as the list. */
export function invalidInputError(error: z.ZodError, fallback: string): InvalidInputError {
  const problems = problemsOf(error);
  const first = problems[0];
  return new InvalidInputError(
    first ? `${first.path || 'body'}: ${first.message}` : fallback,
    problems,
  );
}
