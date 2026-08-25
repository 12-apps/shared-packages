/**
 * Hand-written because the implementation is `.mjs` — see the note at the top
 * of `build-entries.mjs` for why it is JS rather than TS. One function, one
 * signature: there is nothing here that can drift out of step unnoticed, and
 * the completeness test beside it would fail immediately if it did.
 */

/** tsup's entry map for this package: output name -> source file. */
export declare function buildEntries(packageRoot: string): Record<string, string>;
