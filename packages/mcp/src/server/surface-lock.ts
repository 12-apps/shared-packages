import { createHash } from "node:crypto";

import { buildManifest, serializeManifest } from "./manifest";
import type { GeneratedTool } from "../types";

/**
 * Making a server's advertised version impossible to leave behind.
 *
 * THE PROBLEM, which every MCP server on this transport has. `tools/list` is
 * answered on request and there is no server→client stream, so a server cannot
 * push `notifications/tools/list_changed` — and one that declares
 * `capabilities.tools.listChanged` without being able to send it is worse than
 * one that is honest, because the host then stops checking for itself. What is
 * left is `serverInfo.version` from the `initialize` handshake. A host caches the
 * tool list against it, so a version that never moves gives it no reason to ever
 * ask again: a tool that shipped stays invisible to every ALREADY CONNECTED
 * client for as long as that connection lives.
 *
 * That is not a hypothetical. In `future-pay` a new tool reached production,
 * answered on its route, and did not appear in a live connector — behind a
 * `serverInfo.version` frozen at its initial value while ~280 tools were added
 * underneath it. Nothing was broken; the only thing asking anyone to bump it was
 * a comment, and a rule enforced by a comment is not enforced.
 *
 * THE MECHANISM. An app commits a lock recording WHICH surface its current
 * version stands for. Its generator recomputes the digest and refuses to write
 * the artifacts when the digest moved while the version did not, naming the
 * value to set. Because the same generator run under `--check` is what the
 * contract gate already diffs, the failure lands in CI and in a pre-push hook
 * without a new job, without git history, and without any event-sensitivity.
 *
 * WHY A DIGEST OF THE SURFACE, NOT A PATHS FILTER. A `paths:` list over the
 * server's own directory is wrong in both directions: it fires on edits no
 * client can see (a comment in an auth helper) and misses real ones that enter
 * from outside it (a schema whose ceiling is imported from a storage module).
 * Hashing what the tools ARE — the canonical manifest serialization — has
 * neither failure mode: it is exactly the bytes `tools/list` would return.
 */

/** The committed record: which surface an app's current version stands for. */
export interface SurfaceLock {
  /** The app's surface version at the time `digest` was recorded. */
  version: number;
  /** Digest of the served tool surface (see {@link surfaceDigest}). */
  digest: string;
}

/** Everything {@link surfaceLockProblem} needs to judge one generation. */
export interface SurfaceLockCheck {
  /** The lock as committed, or `null` when there is none to contradict. */
  previous: SurfaceLock | null;
  /** The surface version the app currently declares. */
  version: number;
  /** Digest of the surface being generated now. */
  digest: string;
  /**
   * Where the app's version constant lives, repo-relative — quoted in the
   * failure so the fix is a path and a value rather than a hunt.
   */
  versionLocation: string;
  /** The constant's name, if the app does not use the default. */
  versionName?: string;
}

/**
 * Version pinned out of the digest input. The digest answers "did the SURFACE
 * change?", so it must not move merely because the version did — otherwise
 * bumping would re-satisfy the check by itself and the gate would prove nothing.
 */
const DIGEST_VERSION_SENTINEL = 0;

/** Length of the hex digest kept. Collision risk here is not adversarial. */
const DIGEST_LENGTH = 16;

const DEFAULT_VERSION_NAME = "MCP_SURFACE_VERSION";

/**
 * Digest of a served tool surface — every tool's name, description, annotations
 * and input/output schemas, in the manifest's own canonical (deep-key-sorted)
 * serialization. Stable across unrelated reordering, and identical for two
 * surfaces that a client could not tell apart.
 */
export function surfaceDigest(tools: GeneratedTool[], source: string): string {
  const canonical = serializeManifest(
    buildManifest(tools, { version: DIGEST_VERSION_SENTINEL, source }),
  );
  return createHash("sha256").update(canonical).digest("hex").slice(0, DIGEST_LENGTH);
}

/** Canonical JSON for a committed lock (trailing newline, like the manifest). */
export function serializeSurfaceLock(lock: SurfaceLock): string {
  return `${JSON.stringify(lock, null, 2)}\n`;
}

/**
 * Decide whether an app's current version may stand for its current surface.
 *
 * Returns the problem as a sentence ready to print, or `null` when the pair is
 * consistent. Four outcomes, and three of them pass:
 *
 *   - surface unchanged → fine, whatever the version did (a release bump with no
 *     surface change is legitimate and must not be blocked);
 *   - surface changed AND version moved → fine, that is the whole contract;
 *   - no lock to contradict (first run, or the file was deleted) → fine, it is
 *     simply recorded;
 *   - surface changed and version did not → the failure this exists for.
 */
export function surfaceLockProblem(check: SurfaceLockCheck): string | null {
  const { previous, version, digest, versionLocation } = check;
  if (!previous || previous.digest === digest || previous.version !== version) {
    return null;
  }
  const name = check.versionName ?? DEFAULT_VERSION_NAME;
  return (
    `the served tool surface changed but ${name} is still ${version}.\n` +
    `  A connected client is told this number on initialize and caches tools/list against it, so\n` +
    `  leaving it put ships the new surface to a client that will never ask for it again.\n` +
    `  Set ${name} = ${version + 1} in ${versionLocation}, then re-run.\n` +
    `  (surface ${previous.digest} → ${digest})`
  );
}
