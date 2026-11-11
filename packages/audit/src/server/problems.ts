import type { z } from 'zod';

/** One thing wrong with a request input, and where (dotted path, empty for the whole input). */
export interface InputProblem {
  path: string;
  message: string;
}

/**
 * Every problem of a refused parse, with its path. An unknown key is one problem
 * per key, at the key's own path, so a client can paint the exact field that
 * should not have been sent.
 */
export function problemsOf(error: z.ZodError): InputProblem[] {
  return error.issues.flatMap((issue) => {
    const base = issue.path.map(String);
    if (issue.code === 'unrecognized_keys') {
      return issue.keys.map((key) => ({ path: [...base, key].join('.'), message: 'Unrecognized key' }));
    }
    return [{ path: base.join('.'), message: issue.message }];
  });
}
