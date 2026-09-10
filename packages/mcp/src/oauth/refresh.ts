import { createHash, randomBytes } from "node:crypto";

import {
  DEFAULT_ROTATION_GRACE_MS,
  openSuccessor,
  sealSuccessor,
} from "./rotation-grace";
import type { NewRefreshToken, RefreshTokenStore, StoredRefreshToken } from "./stores";

/**
 * Refresh-token issue + rotation (12-23, ported from the origin host's
 * `lib/mcp/oauth/refresh.ts` — behaviour unchanged; Prisma calls became the
 * `RefreshTokenStore` port).
 *
 * Refresh tokens are opaque high-entropy strings; only their SHA-256 HASH is ever
 * stored — the plaintext is returned once at issue/rotate time and never
 * persisted, never logged.
 *
 * Rotation-on-use with replay protection:
 *   - {@link issueRefreshToken} mints a root token bound to email + sub + client
 *     + scopes;
 *   - {@link rotateRefreshToken} consumes a token: it issues a NEW token chained
 *     via `rotatedFrom` and revokes the parent, so a token is single-use;
 *   - reuse of an already-rotated/revoked token OUTSIDE the grace window is a
 *     REPLAY: rejected, AND the whole lineage (every ancestor + descendant
 *     reachable through `rotatedFrom`) is revoked — the OAuth 2.1 refresh-token
 *     replay rule;
 *   - reuse INSIDE the window is a RETRY, and answers with the successor that
 *     rotation already minted rather than a second one (`./rotation-grace.ts`).
 *     A lost response and two concurrent refreshes are the routine reasons one
 *     client uses one token twice, and punishing them as theft is what cost a
 *     connected user their session and sent them back through the whole
 *     authorization flow;
 *   - CONCURRENT reuse takes that same retry path. The store's `rotate` is a
 *     claim-once write, so of two simultaneous rotations of one parent exactly
 *     one successor is ever WRITTEN — that invariant is untouched, and without it
 *     replay protection would be bypassable by WINNING a race instead of arriving
 *     second (see `RefreshTokenStore.rotate`). The loser is now handed the
 *     winner's token instead of destroying it;
 *   - the cost is real and is NOT a one-rotation deferral: two parties left
 *     holding one successor take the retry path again at every subsequent
 *     rotation, so they stay in lockstep for as long as their uses keep falling
 *     inside the window. What survives is: a collision is detected only when the
 *     two uses fall more than `graceMs` apart. `./rotation-grace.ts` argues why
 *     that is the accepted trade and `graceMs: 0` is the way back out;
 *   - rotate may only NARROW scope (new ⊆ original); broadening is rejected and
 *     nothing new is stored.
 */

/** Bytes of entropy per opaque refresh token (→ 64 hex chars). */
const REFRESH_TOKEN_BYTES = 32;

/** Refresh-token lifetime — long-lived relative to the 15-min access token. */
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** The single failure discriminator surfaced to the token endpoint. */
export type RefreshTokenErrorCode = "invalid_grant" | "invalid_scope";

/**
 * A typed refresh-token failure. Every rejection — unknown, expired, revoked,
 * already-rotated (replay), wrong client, or a scope-broadening request —
 * surfaces as a discriminated error the token endpoint maps to the RFC 6749
 * error JSON.
 */
export class RefreshTokenError extends Error {
  readonly code: RefreshTokenErrorCode;

  constructor(code: RefreshTokenErrorCode, message?: string) {
    super(message ?? code);
    this.name = "RefreshTokenError";
    this.code = code;
  }
}

/** The result of issuing/rotating: the plaintext token (once) + bound scopes. */
export interface IssuedRefreshToken {
  /** The opaque plaintext refresh token — returned once, never persisted. */
  refreshToken: string;
  scopes: string[];
}

/** SHA-256 hex digest — the at-rest form of an opaque refresh token. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Generate a fresh opaque refresh token (high-entropy hex). */
function generateToken(): string {
  return randomBytes(REFRESH_TOKEN_BYTES).toString("hex");
}

export interface RefreshTokenContext {
  store: RefreshTokenStore;
  /** Lifetime of a newly stored token. Default 30 days. */
  ttlMs?: number;
  /**
   * How long a just-rotated token keeps answering with the successor it minted,
   * instead of being treated as a replay. Default
   * {@link DEFAULT_ROTATION_GRACE_MS}; `0` restores the strict rule.
   *
   * This is what makes a rotation RETRYABLE. See `./rotation-grace.ts` for why the
   * window returns the same successor rather than minting a second one, and why
   * that keeps replay detection intact.
   */
  graceMs?: number;
}

/** The configured grace window, in milliseconds. `<= 0` disables it. */
function graceWindowMs(context: RefreshTokenContext): number {
  return context.graceMs ?? DEFAULT_ROTATION_GRACE_MS;
}

function expiryOf(context: RefreshTokenContext): Date {
  return new Date(Date.now() + (context.ttlMs ?? REFRESH_TOKEN_TTL_MS));
}

/**
 * Issue a fresh (root) refresh token bound to a user (email + OAuth `sub`) +
 * client + scopes. The plaintext is returned once; only its hash is stored.
 */
export async function issueRefreshToken(
  context: RefreshTokenContext,
  binding: { userEmail: string; userSub: string; clientId: string; scopes: string[] },
): Promise<IssuedRefreshToken> {
  const refreshToken = generateToken();
  const row: NewRefreshToken = {
    tokenHash: hashToken(refreshToken),
    userEmail: binding.userEmail,
    userSub: binding.userSub,
    clientId: binding.clientId,
    scopes: binding.scopes,
    expiresAt: expiryOf(context),
    rotatedFrom: null,
  };
  await context.store.create(row);
  return { refreshToken, scopes: binding.scopes };
}

/**
 * A pre-built O(1)-lookup index of one `(userEmail, clientId)` token family:
 * `byHash` resolves a hash to its row (to walk ancestors via `rotatedFrom`), and
 * `childrenOf` is the reverse index mapping a parent hash to its direct successor
 * hashes (to walk descendants). Both are built in a single pass so the lineage
 * traversal never re-scans the family (no O(n²) inner loop).
 */
interface LineageIndex {
  byHash: Map<string, StoredRefreshToken>;
  childrenOf: Map<string, string[]>;
}

function buildLineageIndex(family: StoredRefreshToken[]): LineageIndex {
  const byHash = new Map<string, StoredRefreshToken>();
  const childrenOf = new Map<string, string[]>();
  for (const row of family) {
    byHash.set(row.tokenHash, row);
    if (!row.rotatedFrom) continue;
    const siblings = childrenOf.get(row.rotatedFrom) ?? [];
    siblings.push(row.tokenHash);
    childrenOf.set(row.rotatedFrom, siblings);
  }
  return { byHash, childrenOf };
}

/**
 * Collect every token hash reachable from `seedHash` — its ancestors (via
 * `rotatedFrom`) and its descendants (via the reverse index) — by a BFS over the
 * pre-built index. Each neighbour lookup is O(1), so the walk is linear in the
 * family size.
 */
function collectLineage(index: LineageIndex, seedHash: string): Set<string> {
  const lineage = new Set<string>();
  const queue = [seedHash];
  while (queue.length > 0) {
    const hash = queue.shift();
    if (!hash || lineage.has(hash)) continue;
    lineage.add(hash);

    const parent = index.byHash.get(hash)?.rotatedFrom ?? null;
    if (parent && !lineage.has(parent)) queue.push(parent);

    const children = (index.childrenOf.get(hash) ?? []).filter((child) => !lineage.has(child));
    queue.push(...children);
  }
  return lineage;
}

/**
 * Walk a token's rotation lineage (both directions) and revoke every token in it.
 * Called on replay detection, so a leaked refresh token — once reused —
 * invalidates the entire chain it belongs to.
 */
async function revokeLineage(
  context: RefreshTokenContext,
  scopedTo: Pick<StoredRefreshToken, "userEmail" | "clientId">,
  seedHash: string,
): Promise<void> {
  // The lineage is confined to one (userEmail, clientId) pair, so load that set
  // once and walk the `rotatedFrom` links in memory — a small, bounded chain.
  const family = await context.store.listFamily(scopedTo.userEmail, scopedTo.clientId);
  const lineage = collectLineage(buildLineageIndex(family), seedHash);
  await context.store.revokeHashes([...lineage], new Date());
}

/** Reject any requested scope not already on the token (narrow-only). */
function narrowedScopes(current: StoredRefreshToken, requested?: string[]): string[] {
  const scopes = requested ?? current.scopes;
  const original = new Set(current.scopes);
  for (const scope of scopes) {
    if (!original.has(scope)) {
      throw new RefreshTokenError(
        "invalid_scope",
        `scope '${scope}' broadens the refresh token grant`,
      );
    }
  }
  return scopes;
}

/** Set equality over scope lists, which are unordered and may repeat. */
function sameScopes(left: readonly string[], right: readonly string[]): boolean {
  const wanted = new Set(left);
  const held = new Set(right);
  if (wanted.size !== held.size) return false;
  for (const scope of wanted) {
    if (!held.has(scope)) return false;
  }
  return true;
}

/**
 * The grace path: a token that was already consumed is being presented again.
 *
 * Returns the successor that consumption minted — the SAME one, recovered by
 * opening the seal with the parent the caller just presented — when every
 * condition for a retry holds, and `null` when any of them does not, in which
 * case the caller falls through to the replay rule unchanged.
 *
 * The conditions are the security argument, so each is checked rather than
 * assumed:
 *
 *   - the successor still exists and is NOT revoked. A revoked one means the
 *     lineage already died to a real replay, and grace must never resurrect it;
 *   - it has not expired on its own TTL;
 *   - the seal opens with THIS parent, which is what proves the caller held the
 *     token it claims to be retrying rather than merely knowing its hash;
 *   - the sealed deadline has not passed. It rides inside the AEAD blob, so it
 *     cannot be extended by editing the row;
 *   - the request asks for the same scopes. A retry repeats its original
 *     request; a different scope set is a NEW decision, and answering it with a
 *     token minted for the old one would silently ignore what was asked.
 */
async function graceReissue(
  context: RefreshTokenContext,
  current: StoredRefreshToken,
  tokenHash: string,
  parentPlaintext: string,
  requestedScopes?: string[],
): Promise<IssuedRefreshToken | null> {
  if (graceWindowMs(context) <= 0) return null;

  const family = await context.store.listFamily(current.userEmail, current.clientId);
  const successor = family.find((row) => row.rotatedFrom === tokenHash);
  if (!successor?.graceSeal || successor.revokedAt) return null;

  const now = Date.now();
  if (successor.expiresAt.getTime() <= now) return null;
  if (requestedScopes && !sameScopes(requestedScopes, successor.scopes)) return null;

  const opened = openSuccessor(parentPlaintext, successor.graceSeal);
  if (!opened || opened.graceUntil <= now) return null;

  return { refreshToken: opened.successor, scopes: successor.scopes };
}

/**
 * Rotate a refresh token on use: validate it (must exist, be BOUND to the
 * presenting client, be unexpired, unrevoked and un-rotated), then issue a NEW
 * token chained via `rotatedFrom` and revoke the consumed one. Optionally NARROW
 * scope; a broadening request is `invalid_scope`.
 *
 * Client binding (OAuth 2.1 §4.3 / RFC 6749 §10.4) is checked BEFORE any rotation
 * or revocation, so client A can never redeem client B's refresh token — nor
 * silently consume B's token by trying: the token stays live for its rightful
 * owner.
 */
export async function rotateRefreshToken(
  context: RefreshTokenContext,
  plaintext: string,
  expectedClientId: string,
  newScopes?: string[],
): Promise<IssuedRefreshToken> {
  const tokenHash = hashToken(plaintext);
  const current = await context.store.findByHash(tokenHash);

  if (!current) {
    throw new RefreshTokenError("invalid_grant", "unknown refresh token");
  }
  if (current.clientId !== expectedClientId) {
    throw new RefreshTokenError(
      "invalid_grant",
      "refresh token was not issued to this client",
    );
  }
  // Expired → reject (not a replay; no lineage revocation needed beyond the
  // expiry itself).
  if (current.expiresAt.getTime() <= Date.now()) {
    throw new RefreshTokenError("invalid_grant", "refresh token expired");
  }
  // Already revoked OR already used as the parent of a rotation. Inside the grace
  // window this is a RETRY and answers with the successor that consumption
  // already minted; outside it, it is the replay it looks like — rejected, with
  // the whole lineage revoked.
  if (current.revokedAt || (await context.store.hasSuccessor(tokenHash))) {
    const retried = await graceReissue(context, current, tokenHash, plaintext, newScopes);
    if (retried) return retried;
    await replay(context, current, tokenHash);
  }

  const scopes = narrowedScopes(current, newScopes);
  const successorPlaintext = generateToken();
  const grace = graceWindowMs(context);
  const claimed = await context.store.rotate(
    {
      tokenHash: hashToken(successorPlaintext),
      userEmail: current.userEmail,
      userSub: current.userSub,
      clientId: current.clientId,
      scopes,
      expiresAt: expiryOf(context),
      rotatedFrom: tokenHash,
      // Sealed under the PARENT the caller just presented, so a retry of this
      // very rotation can be answered with this same token and nothing else can
      // read it. Omitted entirely when the window is off, so the strict rule
      // stores nothing extra.
      graceSeal:
        grace > 0 ? sealSuccessor(plaintext, successorPlaintext, Date.now() + grace) : null,
    },
    tokenHash,
    new Date(),
  );
  // The checks above are a READ, so a concurrent rotation of the same parent can
  // pass them too; `rotate` is the serialization point and it hands the claim to
  // exactly one caller. Exactly one successor is therefore ever written — that
  // part is unchanged, and it is the invariant replay protection rests on.
  //
  // What the loser is TOLD changed. It used to be the replay answer: reject, and
  // revoke the lineage including the successor just handed to the winner. That
  // is correct against an attacker racing the client, and catastrophic for the
  // far more common case of one client refreshing twice — it destroyed a working
  // session and forced a human back through the authorization flow. So the loser
  // now takes the same grace path as a sequential retry and receives the WINNER's
  // token: one successor, two callers holding it, no second family. What that
  // costs is stated honestly in `./rotation-grace.ts` — not a one-rotation
  // deferral, but detection only once two uses fall more than the window apart.
  if (!claimed) {
    const retried = await graceReissue(context, current, tokenHash, plaintext, newScopes);
    if (retried) return retried;
    await replay(context, current, tokenHash);
  }

  return { refreshToken: successorPlaintext, scopes };
}

/** Detected reuse: revoke the whole lineage and reject. Never returns. */
async function replay(
  context: RefreshTokenContext,
  current: StoredRefreshToken,
  tokenHash: string,
): Promise<never> {
  await revokeLineage(context, current, tokenHash);
  throw new RefreshTokenError(
    "invalid_grant",
    "refresh token already used (replay) — lineage revoked",
  );
}

/** The stable identity a refresh token is bound to. */
export interface RefreshTokenIdentity {
  /** The user's email — the identity the AS binds to and route guards resolve by. */
  userEmail: string;
  /** The original OAuth subject, kept stable across every rotation. */
  userSub: string;
}

/**
 * Resolve the identity (`email` + original OAuth `sub`) a refresh token is bound
 * to. The token endpoint uses this after rotation to mint the successor access
 * token with the correct email AND the SAME stable `sub` as the initial token (no
 * re-consent, no `sub` drift). `null` if the row is unexpectedly absent.
 */
export async function getRefreshTokenIdentity(
  context: RefreshTokenContext,
  plaintext: string,
): Promise<RefreshTokenIdentity | null> {
  const row = await context.store.findByHash(hashToken(plaintext));
  return row ? { userEmail: row.userEmail, userSub: row.userSub } : null;
}
