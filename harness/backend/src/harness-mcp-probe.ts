/**
 * The SUITE'S own two endpoints on the MCP surface (12-23) — never the package's.
 *
 * An authorization server answers grants, not queries: it has no read endpoint
 * for its own tables, correctly. But the properties worth pinning at the tarball
 * level are properties of the ROWS — a refresh token that exists only as a hash, a
 * connection recorded against one user and never across users — so the suite needs
 * a door to them. It lives under `/__harness` for the same reason the reset does:
 * so nothing can mistake it for part of the published surface.
 *
 * It returns HASHES. A debug endpoint that echoed a token would be the exact leak
 * the storage design exists to prevent, and it would be in the one place nobody
 * audits.
 */
import type { PGlite } from '@electric-sql/pglite';
import { Hono } from 'hono';

import type { HarnessMcpOauth } from './mcp-oauth-host';

export function mcpProbeRouter(pg: PGlite, mcpOauth: HarnessMcpOauth): Hono {
  const router = new Hono();

  /**
   * A RESOURCE SERVER, one endpoint wide.
   *
   * The other half of an authorization server is somebody CHECKING what it
   * minted, and "minted for origin A, verified against origin B" is a failure that
   * only appears when both halves are real. `verifyBearer` is bound to the same
   * signing key, resource path and trusted-origin resolution as the token
   * endpoint, so a token this surface issued verifies here and one from anywhere
   * else does not.
   */
  router.get('/__harness/mcp/whoami', async (c) => {
    const bearer = c.req.header('authorization')?.replace(/^Bearer /i, '');
    if (!bearer) return c.json({ error: 'invalid_token' }, 401);
    try {
      return c.json({ data: await mcpOauth.verifyBearer(bearer, c.req.raw) });
    } catch {
      // No detail: a resource server that explained WHICH claim failed would be an
      // oracle for forging the next attempt.
      return c.json({ error: 'invalid_token' }, 401);
    }
  });

  /** What the authorization server actually wrote — hashes and flags only. */
  router.get('/__harness/mcp/state', async (c) => {
    const { rows: tokens } = await pg.query<Record<string, unknown>>(
      `SELECT token_hash, user_email, user_sub, client_id, scopes, rotated_from,
              revoked_at IS NOT NULL AS revoked
         FROM oauth_refresh_tokens ORDER BY created_at`,
    );
    const { rows: clients } = await pg.query<Record<string, unknown>>(
      `SELECT client_id, client_secret_hash, redirect_uris, client_name,
              token_endpoint_auth_method, scopes
         FROM oauth_clients ORDER BY created_at`,
    );
    const { rows: connections } = await pg.query<Record<string, unknown>>(
      `SELECT user_id, oauth_client_id, client_name, host, revoked_at IS NOT NULL AS revoked
         FROM mcp_connections ORDER BY connected_at`,
    );
    return c.json({ tokens, clients, connections });
  });

  return router;
}
