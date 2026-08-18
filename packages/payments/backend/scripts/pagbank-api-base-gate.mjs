// The PagBank API-host gate: those two hostnames are spelled in ONE module.
//
// They were written out five times inside `@12-apps/payments-backend`, in five
// different shapes — two bare consts plus a private `apiBaseFor`, a
// `TOKEN_BASE` record, a `DEFAULT_API_BASE` record, the sandbox half alone,
// and the production host quoted in a docstring — and a sixth time in the
// first adopting host, which is how anyone noticed at all. Every copy agreed,
// which is exactly why none of them was ever suspicious. A duplicate only
// bites the day one of them changes, and on this surface that day ends with a
// live charge sent at the sandbox host, or the reverse.
//
// So the gate asserts the PROPERTY rather than the values: no source file
// outside `providers/pagbank-api-base.ts` may contain either literal. A test
// asserting `pagbankApiBase('PRODUCTION') === '…'` (and `pagbank-api-base.test.ts`
// does) pins what the function answers; only a sweep can pin that nobody has
// quietly grown a sixth spelling in a module with no reason to import a peer.
//
// ## Why a script and not a vitest case
//
// This started as a case in `pagbank-api-base.test.ts` and `quality:flakiness`
// was right to refuse it: `test-flakiness/no-unmocked-fs` bans real filesystem
// reads in a suite, because a test whose result depends on what is on disk
// fails for reasons that have nothing to do with the code under test. A
// repo-wide source sweep is not a unit test — it is a gate, and this repo
// already keeps gates of that shape (`host-brand-gate.mjs`,
// `migration-freeze-gate.mjs`), run from `quality:portability`.
//
// ## Why it lives INSIDE the payments package
//
// It names a provider, and `payments/no-provider-name-literal` says provider
// names live inside `packages/payments/**` and nowhere else. The rule offers
// an exemption glob for a gate that must spell a vendor to police it, and two
// entries already use it — but an exemption is a line somebody has to keep
// justifying, and this gate needed none: the package it guards is the package
// the rule already scopes it out of. Sitting next to the module it protects is
// also simply where it belongs.
//
// ## Scope: non-test SOURCE
//
// Tests are excluded deliberately, and it is not an allowlist. A test that
// asserts which host a request went to has to name that host — that is the
// assertion — and rewriting them to import the helper would make each one
// tautological: it would pass whatever the helper returned, including a wrong
// value. Markdown is excluded for the same reason: `OAUTH.md` documents
// PagBank's endpoints for a human, and prose naming a public URL is not a
// second source of truth for the code.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** The single module allowed to spell them. */
const SOURCE_OF_TRUTH = 'packages/payments/backend/src/providers/pagbank-api-base.ts';

/** Run from the repo root, whatever the caller's cwd. */
const REPO_ROOT = new URL('../../../../', import.meta.url).pathname;

/** Either Orders API host, however it is quoted. */
const HOST_RE = /https:\/\/(?:sandbox\.)?api\.pagseguro\.com/;

/** A test file, in any of the conventions this repo uses. */
function isTest(path) {
  return path.includes('/__tests__/') || /\.(test|spec)\.[cm]?tsx?$/.test(path);
}

function trackedSources() {
  // Scoped to the package that owns the adapter. Nothing outside it has any
  // business naming a PagBank host — `payments/no-provider-name-literal`
  // enforces that far more broadly, on the provider's NAME, before a URL
  // carrying it could ever be written.
  const out = execFileSync('git', ['ls-files', '-z', '--', 'packages/payments/**/src/*'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return out
    .split('\0')
    .filter(Boolean)
    .filter((path) => /\.[cm]?tsx?$/.test(path))
    .filter((path) => !isTest(path))
    .filter((path) => path !== SOURCE_OF_TRUTH);
}

const offenders = trackedSources().filter((path) => {
  try {
    return HOST_RE.test(readFileSync(REPO_ROOT + path, 'utf8'));
  } catch {
    // A path git tracks but the worktree lacks (a partial checkout) is not an
    // offence — there is nothing to read and nothing to duplicate.
    return false;
  }
});

if (offenders.length > 0) {
  console.error(
    'pagbank-api-base: PagBank’s Orders API host is spelled outside its one module:',
  );
  for (const path of offenders) console.error(`  - ${path}`);
  console.error(`\nImport { pagbankApiBase } from '${SOURCE_OF_TRUTH}' instead.`);
  console.error(
    'It takes the environment as a REQUIRED argument, so a caller that does not\n' +
      'know which environment it is in has to answer that first rather than\n' +
      'inheriting a guess.',
  );
  process.exit(1);
}

console.log(
  `pagbank-api-base: clean — both hosts spelled only in ${SOURCE_OF_TRUTH}.`,
);
