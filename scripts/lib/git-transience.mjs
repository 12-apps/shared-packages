// Whether a failed semantic-release invocation is worth another attempt.
//
// Extracted from scripts/release-tags.mjs so the DRY-RUN that gates a major
// (scripts/next-versions.mjs) and the real release read the same answer. Both
// shell out to the same binary against the same remote, so both meet the same
// transport faults — and two copies of this knowledge would drift in the
// direction that costs most: the copy that stops recognising a transient fault
// starts reporting it as a real one, which for the gate means a red run on a
// TLS blip and for the release means a package silently left unreleased.
//
// `server certificate verification failed` is first because it is the one this
// repo has actually been bitten by (run 31427350698, which cost `auth-v1.22.0`
// four days); the rest are the neighbouring faults from git's transport layer
// that would behave identically and should not each need their own outage to
// get added.
const TRANSIENT_GIT =
  /server certificate verification failed|unable to access|Could not resolve host|Temporary failure in name resolution|Connection (?:timed out|reset)|Operation timed out|early EOF|RPC failed|gnutls_handshake|GnuTLS recv error|SSL(?:_ERROR|read|write| connect)|TLS connect error|the remote end hung up|HTTP 5\d\d|The requested URL returned error: 5\d\d|502 Bad Gateway|503 Service Unavailable/i;

// semantic-release's verdict when its preflight `git push --dry-run` fails, for
// ANY reason. Ambiguous by construction: it covers both a token that genuinely
// cannot push and a runner that could not reach github.com for a moment.
const NO_PERMISSION = /\bEGITNOPERMISSION\b/;

// The stale-ref race. Push runs are keyed by SHA (see the concurrency block in
// ci.yml), so two merges landing minutes apart release CONCURRENTLY on purpose.
// The older run's `HEAD:main` is then behind the ref it is pushing to, and git
// refuses it — which is correct, and which the next run resolves by definition.
const STALE_REF = /non-fast-forward|fetch first|Updates were rejected|cannot lock ref|reference already exists/i;

/**
 * Whether another attempt could plausibly change the answer.
 *
 * The git transport error is read BEFORE the semantic-release error code,
 * because the code is a lossy summary of it: EGITNOPERMISSION means "the
 * preflight push did not succeed" and nothing more.
 *
 * A bare EGITNOPERMISSION with no transport error underneath is still retried,
 * on the same reasoning scripts/publish.mjs applies to ENEEDAUTH: if the token
 * really cannot push, three more attempts cost ~50s of a run that was going to
 * fail anyway, and the diagnosis at the end is unchanged. If it was the network,
 * retrying is the entire fix. The asymmetry is not close.
 */
export function classifyGitFailure(output) {
  if (TRANSIENT_GIT.test(output)) return { retry: true, why: "a git transport failure" };
  if (STALE_REF.test(output)) return { retry: true, why: "a concurrent push to main" };
  if (NO_PERMISSION.test(output)) {
    return {
      retry: true,
      why:
        "EGITNOPERMISSION, which semantic-release reports for ANY failure of its " +
        "preflight `git push --dry-run` — including a transient one",
    };
  }
  return { retry: false, why: null };
}

/**
 * Synchronous on purpose: there is nothing to overlap with, and the point of a
 * backoff is that the next attempt does NOT start until the fault has had time
 * to clear.
 */
export function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Explicit, because spawnSync's 1 MB default does not truncate — it KILLS the
// child and returns `status: null`, so a run that actually succeeded comes back
// looking like a failure. semantic-release at this repo's package count is
// comfortably into the megabytes.
export const MAX_OUTPUT = 64 * 1024 * 1024;
