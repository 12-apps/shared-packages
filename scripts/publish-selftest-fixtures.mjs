/**
 * The npm outputs scripts/publish-selftest.mjs feeds to scripts/publish.mjs.
 *
 * Their own module because PROVENANCE is the difference between testing npm and
 * testing this repo's idea of npm, and it deserves to be stated per fixture
 * instead of claimed once for all of them. Each one below says whether it was
 * copied or constructed, and constructed ones say what they were shaped after.
 *
 * Keeping them here also leaves the self-test room to grow: it is one file away
 * from the 400-line size gate, and a new classification should cost a case, not
 * a refactor.
 */

// VERBATIM — run 31682461784, `npm publish` of @12-apps/audit@1.0.0, contiguous.
// The 2FA notice and the full debug-log path are part of what npm printed and
// are kept: a fixture trimmed to the "interesting" lines is a paraphrase.
export const ENEEDAUTH = [
  "npm notice total files: 31",
  "npm notice",
  "npm notice npm tokens that bypass 2FA are being restricted for account changes and direct publishing. Learn how to prepare: https://gh.io/npm-gat-bypass2fa-deprecation",
  "npm error code ENEEDAUTH",
  "npm error need auth This command requires you to be logged in to https://registry.npmjs.org",
  "npm error need auth You need to authorize this machine using `npm login`",
  "npm error A complete log of this run can be found in: /home/runner/.npm/_logs/2026-08-13T08_42_13_115Z-debug-0.log",
].join("\n");

// VERBATIM — same run, `npm publish` of @12-apps/eslint-config@1.0.1, hence the
// 1.0.1 in npm's text where the fixture package is at 1.0.0. The version is
// npm's to print; nothing reads it.
export const ALREADY_PUBLISHED = [
  "npm notice",
  "npm notice npm tokens that bypass 2FA are being restricted for account changes and direct publishing. Learn how to prepare: https://gh.io/npm-gat-bypass2fa-deprecation",
  "npm error You cannot publish over the previously published versions: 1.0.1.",
  "npm error A complete log of this run can be found in: /home/runner/.npm/_logs/2026-08-13T08_41_09_135Z-debug-0.log",
].join("\n");

// CONSTRUCTED — no 409 occurred in the cited run, so there is nothing to copy.
// Shaped after npm's registry error line (`npm error <status> <text> - <METHOD>
// <url> - <message>`) and carrying the two markers TRANSIENT matches.
export const TRANSIENT = [
  "npm error code E409",
  "npm error 409 Conflict - PUT https://registry.npmjs.org/@selftest%2fone - Failed to save packument",
].join("\n");

export const OK = [
  "npm notice Publishing to https://registry.npmjs.org/",
  "+ @selftest/one@1.0.0",
].join("\n");

/**
 * CONSTRUCTED — npm at `--loglevel verbose`, which is how publish.mjs runs it.
 * That run predates the flag, so there is nothing to copy here either.
 *
 * Two properties of the real thing are reproduced, and both are load bearing.
 * The `oidc` line — the only place npm ever says WHY it has no credential — is
 * printed long before the error block, so it falls outside any tail of the
 * output. And it arrives buried in machine chatter that must not reach the job
 * log, including one http line whose URL contains "oidc" and would therefore
 * survive a filter written against the word rather than npm's log prefix.
 */
export function verbose(oidcLine) {
  return [
    "npm verbose cli /opt/hostedtoolcache/node/24.0.0/x64/bin/node /usr/local/bin/npm",
    "npm info using npm@11.5.1",
    "npm info using node@v24.0.0",
    `npm verbose oidc ${oidcLine}`,
    "npm http fetch POST https://registry.npmjs.org/-/npm/v1/oidc/token/exchange/package/@selftest%2frefused 401 214ms",
    "npm verbose stack HttpErrorGeneral: 401 Unauthorized",
    "npm verbose cwd /home/runner/work/shared-packages/shared-packages/packages/audit",
    "npm verbose os Linux 6.11.0-1018-azure",
    "npm verbose node v24.0.0",
    "npm verbose npm  v11.5.1",
    ENEEDAUTH,
    "npm verbose exit 1",
    "npm verbose code 1",
  ].join("\n");
}

// The registry's side of a refused exchange. Its wording is the registry's, not
// npm's, and publish.mjs quotes it rather than interpreting it — which is the
// only reason a message this repo cannot pin down is safe to rely on.
export const REFUSAL = "package @selftest/refused does not have a trusted publisher configured";
export const REFUSED = verbose(`Failed token exchange request with body message: ${REFUSAL}`);

// `Unknown error` is npm's placeholder when the exchange threw before any
// response body existed — i.e. a network-level failure, which is retryable.
export const EXCHANGE_BROKE = verbose(
  "Failed token exchange request with body message: Unknown error",
);

// The one output where the transient and no-credential tests disagree.
export const BOTH_TOKENS = `${TRANSIENT}\n${ENEEDAUTH}`;
