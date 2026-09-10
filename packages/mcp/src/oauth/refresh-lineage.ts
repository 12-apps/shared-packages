import type { RefreshTokenStore, StoredRefreshToken } from "./stores";

/**
 * The walk over `rotatedFrom`, and the revocation the replay rule spends it on.
 *
 * Split out of `./refresh.ts` because it is the one part of that file with no
 * opinion about tokens: it takes a family of rows, follows the links between
 * them, and revokes what it reaches. It knows nothing about grace windows,
 * scopes, error codes or the request being served — which is also why it takes a
 * {@link RefreshTokenStore} rather than the refresh context, keeping the
 * dependency pointing one way.
 */

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
export async function revokeLineage(
  store: RefreshTokenStore,
  scopedTo: Pick<StoredRefreshToken, "userEmail" | "clientId">,
  seedHash: string,
): Promise<void> {
  // The lineage is confined to one (userEmail, clientId) pair, so load that set
  // once and walk the `rotatedFrom` links in memory — a small, bounded chain.
  const family = await store.listFamily(scopedTo.userEmail, scopedTo.clientId);
  const lineage = collectLineage(buildLineageIndex(family), seedHash);
  await store.revokeHashes([...lineage], new Date());
}
