/**
 * Everything `@12-apps/mcp/oauth` needs from a HOST, in one object (12-23).
 *
 * What is genuinely the host's, and all that is here: the cookie session the
 * authorize endpoint binds a code to (a header-driven stand-in — a harness cannot
 * have a real one), the signing material, and where the three owned tables live
 * (the PGlite-backed ports in `mcp-oauth-db.ts`). Everything after that — the RFC
 * wire, PKCE, single-use codes, rotation, replay revocation, both discovery
 * documents — is the package's, which is the claim under test.
 *
 * The tables arrive the way a host deploy applies them: the PACKAGE'S OWN
 * migration, read out of the installed tarball.
 */
import { generateKeyPairSync } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PGlite } from '@electric-sql/pglite';
import { mcpManifest } from '@12-apps/mcp/manifest';
import { mcpServerManifest } from '@12-apps/mcp/manifest/server';
import { signingKeyProvider } from '@12-apps/mcp/oauth';
import { createWiringHost } from '@12-apps/wiring/consumer';

/** The resource-server half the probe binds — see the note at its use. */
type McpVerifyBearer = (bearer: string, request: Request) => Promise<unknown>;

import { harnessLoggerFor, honoRouterFor } from './wire-hono';

import { mcpOauthDb } from './mcp-oauth-db';

const MIGRATIONS_DIR = fileURLToPath(
  new URL('../node_modules/@12-apps/mcp/prisma/migrations/', import.meta.url),
);

/** The header a spec sets to sign in as somebody; absent means the owner. */
const SESSION_HEADER = 'x-mcp-user';

/** `deny` makes the host's consent decision a refusal; anything else approves. */
export const APPROVAL_HEADER = 'x-mcp-approve';

/** The signed-in user most specs drive. */
export const MCP_USER_EMAIL = 'ana@harness.dev';

/** A second signed-in user — connections are per-user, so isolation needs two. */
export const MCP_USER_B_EMAIL = 'beatriz@harness-b.dev';

/**
 * An email with NO user row behind it. `resolveUserId` answers `null` for it, and
 * the package must then still issue tokens while recording no connection: email is
 * the identity the AS binds to, and a host that has not created a row yet is a
 * normal state rather than a reason to refuse a grant.
 */
export const MCP_USER_WITHOUT_ROW = 'ghost@harness.dev';

/** The host's own user table, as a map — what a real host resolves by email. */
const USER_IDS = new Map<string, string>([
  [MCP_USER_EMAIL, 'user-ana'],
  [MCP_USER_B_EMAIL, 'user-beatriz'],
]);

/**
 * ONE key pair per process, generated at import time.
 *
 * Real material rather than a stub: every invariant worth proving here — a code
 * that cannot be replayed as an access token, an audience a resource server pins,
 * a `kid` a verifier resolves out of the published JWKS — is a property of actual
 * ES256 signatures. Generated rather than committed, because a private key in a
 * repository is a private key on the internet.
 */
const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const SIGNING_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

/** The `kid` the JWKS publishes and every issued token carries. */
export const MCP_SIGNING_KID = 'harness-key-1';

/** Apply the published migrations, in name order — as a host deploy would. */
export async function applyMcpMigrations(pg: PGlite): Promise<void> {
  const names = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const name of names) {
    await pg.exec(readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf-8'));
  }
}

/** Back to a clean slate — the `/__harness/reset` contract. */
export async function reseedMcpOauth(pg: PGlite): Promise<void> {
  await pg.exec('TRUNCATE TABLE oauth_clients, oauth_refresh_tokens, mcp_connections');
}

/**
 * Where `mount-surfaces.ts` hangs the router: the ORIGIN ROOT.
 *
 * Not a prefix, and that is the package's requirement rather than a harness
 * convenience — a connector reads `/.well-known/oauth-authorization-server`
 * from the origin, so an authorization server mounted under `/api` is one no
 * client can discover.
 */
export const MCP_OAUTH_MOUNT_PATH = '/';

/** Everything `@12-apps/mcp/oauth` asks a host for. */
function oauthConfig(pg: PGlite) {
  return {
    stores: mcpOauthDb(pg),
    signingKey: signingKeyProvider(() => ({ pem: SIGNING_PEM, kid: MCP_SIGNING_KID })),
    /**
     * The cookie session, stood in for by a header. `null` is how a spec asks for
     * the unauthenticated path: the package mints nothing and 302s the caller into
     * the host's sign-in flow instead.
     */
    resolveSession: (request) => {
      const email = request.headers.get(SESSION_HEADER);
      if (!email || email === 'anonymous') return null;
      // A real host passes the OAuth `sub` it verified (the origin host: the Google
      // one), which is deliberately NOT the DB id — the AS binds to email.
      return { subject: `google-sub-${email}`, email };
    },
    connections: {
      // `null` for an email with no row yet: recording is skipped and the grant
      // still succeeds.
      resolveUserId: (email) => USER_IDS.get(email) ?? null,
      // The throttle is what a real host leaves at its default; the suite needs
      // consecutive grants to be visible, so liveness is recorded every time.
      activityThrottleMs: 0,
    },
    /**
     * One process, acknowledged out loud. The field has no default, and the harness
     * is where that requirement has to be shown to be real: a host cannot mount
     * this surface without deciding whether its code-replay guard is shared, because
     * a silent in-process default is the one setting here that fails OPEN the day a
     * deployment grows a second pod.
     */
    codeReplay: 'in-process',
    /**
     * The host's consent decision. A real host shows a screen; here it is a header,
     * so a spec can drive both answers — including the refusal, which is what
     * protects an OPEN registration endpoint from minting a code for a client the
     * signed-in user never agreed to.
     */
    resolveApproval: (request: Request) => request.headers.get(APPROVAL_HEADER) !== 'deny',
  };
}

/**
 * The OAuth 2.1 authorization server, ADOPTED rather than routed.
 *
 * This host used to call `mcpOauthRouter(config)` — the package's own Hono
 * mount, which works and binds nothing. `@12-apps/mcp` declares
 * `server: ['http']`, and a manifest no host adopts is not an unanswered
 * capability: it is a package the wiring report never hears about. Same blind
 * spot that left three WEB manifests unbound in the sibling harness, and the
 * same one `@12-apps/app-shell` had.
 *
 * Every route is `public` — an authorization server's endpoints are reached by
 * callers who have no session with it yet, which is the whole point — and each
 * needs the RAW request forwarded, because the package's wire view throws
 * without one rather than silently handling half a request. This harness's
 * bridge does both, and that is not incidental: forwarding the raw request was
 * one of the defects adopting these manifests found in the bridge itself.
 */
export function mcpOauthHost(pg: PGlite) {
  const wiring = createWiringHost({
    name: 'harness-backend',
    kind: 'server',
    ports: { loggerFor: harnessLoggerFor },
  });
  wiring.adoptServer({
    manifest: mcpManifest,
    server: mcpServerManifest,
    bindings: { http: { mountPath: MCP_OAUTH_MOUNT_PATH, config: oauthConfig(pg) } },
  });
  const wired = wiring.assemble();

  /**
   * The created surface itself, not just its routes.
   *
   * `assemble()` keys `http` by package name and hands back exactly what
   * `http.create` returned — which for this package is more than a route table:
   * `verifyBearer` is on it, and the harness's one-endpoint RESOURCE SERVER
   * (`harness-mcp-probe.ts`) is bound to it.
   *
   * Worth stating because dropping it is what this conversion did first, and
   * the suite caught it: `/whoami` answered 401 for a token the authorization
   * server had just minted. That failure is the whole reason the probe exists —
   * "minted for origin A, verified against origin B" only appears when both
   * halves are real — so it failing here was the fixture working, not noise.
   */
  const api = wired.http[mcpManifest.name] as { verifyBearer: McpVerifyBearer };

  return {
    ...api,
    router: honoRouterFor(wired.routes, () => null),
    report: wired.report,
    routes: wired.routes,
  };
}

/** The mounted surface's type — inferred, so the handlers keep their shape. */
export type HarnessMcpOauth = ReturnType<typeof mcpOauthHost>;
