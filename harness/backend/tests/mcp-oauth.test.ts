/* eslint-disable test-flakiness/no-database-operations -- the database is the
   subject: this is the origin host's OAuth round-trip, refresh, client and metadata
   integration suites, ported to run against the PUBLISHED @12-apps/mcp tarball
   over a real Postgres, driving the same app a connector would. */
/* eslint-disable test-flakiness/no-test-isolation -- every `response` here is a
   local const inside its own case; the rule matches the identifier across the file
   rather than its scope. The shared state that WOULD matter — the database — is
   reset in beforeEach. */
import { createHash, randomBytes } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarnessBackend, type HarnessBackend } from '../src/app';
import {
  APPROVAL_HEADER,
  MCP_SIGNING_KID,
  MCP_USER_B_EMAIL,
  MCP_USER_EMAIL,
  MCP_USER_WITHOUT_ROW,
} from '../src/mcp-oauth-host';

/**
 * The @12-apps/mcp OAuth 2.1 authorization server end-to-end (12-23): the port of
 * the origin host's `oauth-roundtrip`, `oauth-refresh`, `oauth-clients`,
 * `oauth-metadata` and `oauth-schema` integration suites.
 *
 * What moves the proof past the package's own unit suite is what is REAL here:
 * the published tarball, its own Hono mount, its own migration, a real Postgres
 * behind the three ports, and real ES256 signatures. The properties that only
 * this arrangement can show are the ones with the highest stakes — that a
 * refresh token exists in the database as a hash and nothing else, that a
 * rotation is two writes or none, and that the token the AS minted verifies at
 * the resource server on the same origin.
 */

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
}

interface StateRow {
  token_hash: string;
  user_email: string;
  user_sub: string;
  client_id: string;
  scopes: string[];
  rotated_from: string | null;
  revoked: boolean;
}

interface HarnessState {
  tokens: StateRow[];
  clients: {
    client_id: string;
    client_secret_hash: string | null;
    redirect_uris: string[];
    client_name: string | null;
    token_endpoint_auth_method: string;
    scopes: string[];
  }[];
  connections: {
    user_id: string;
    oauth_client_id: string;
    client_name: string | null;
    host: string | null;
    revoked: boolean;
  }[];
}

/** A Claude.ai callback — registered exactly, and attributable to a provider. */
const CLAUDE_REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

let backend: HarnessBackend;

beforeAll(async () => {
  backend = await createHarnessBackend();
}, 120_000);

afterAll(async () => {
  await backend.close();
});

beforeEach(async () => {
  const reset = await backend.app.request('/__harness/reset', { method: 'POST' });
  expect(reset.status).toBe(204);
});

function base64url(buffer: Buffer): string {
  return buffer.toString('base64url');
}

/** A PKCE pair, computed the way a real client computes it. */
function pkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  return {
    verifier,
    challenge: base64url(createHash('sha256').update(verifier).digest()),
  };
}

async function register(
  metadata: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await backend.app.request('/api/oauth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(metadata),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** Register a public PKCE client — what a connector's own registration produces. */
async function publicClient(redirectUri = CLAUDE_REDIRECT, scope?: string): Promise<string> {
  const { status, body } = await register({
    redirect_uris: [redirectUri],
    client_name: 'Claude',
    ...(scope ? { scope } : {}),
  });
  expect(status).toBe(201);
  return body.client_id as string;
}

interface AuthorizeOptions {
  clientId: string;
  challenge: string;
  redirectUri?: string;
  email?: string | null;
  scope?: string;
  state?: string;
  responseType?: string;
  challengeMethod?: string;
  /** `false` makes the HOST's consent decision a refusal (see `resolveApproval`). */
  approve?: boolean;
}

function authorize(options: AuthorizeOptions): Promise<Response> {
  const query = new URLSearchParams({
    response_type: options.responseType ?? 'code',
    client_id: options.clientId,
    redirect_uri: options.redirectUri ?? CLAUDE_REDIRECT,
    code_challenge: options.challenge,
    code_challenge_method: options.challengeMethod ?? 'S256',
    ...(options.scope ? { scope: options.scope } : {}),
    ...(options.state ? { state: options.state } : {}),
  });
  const email = options.email === undefined ? MCP_USER_EMAIL : options.email;
  return backend.app.request(`/api/oauth/authorize?${query.toString()}`, {
    headers: {
      ...(email ? { 'x-mcp-user': email } : {}),
      ...(options.approve === false ? { [APPROVAL_HEADER]: 'deny' } : {}),
    },
  });
}

/** The `code` out of a 302 back to the client. */
function codeFrom(response: Response): string {
  const location = response.headers.get('location');
  expect(location).toBeTruthy();
  const code = new URL(location as string).searchParams.get('code');
  expect(code).toBeTruthy();
  return code as string;
}

function token(form: Record<string, string>, headers: Record<string, string> = {}) {
  return backend.app.request('/api/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(form).toString(),
  });
}

async function state(): Promise<HarnessState> {
  const response = await backend.app.request('/__harness/mcp/state');
  expect(response.status).toBe(200);
  return (await response.json()) as HarnessState;
}

/**
 * register → authorize → token, the whole happy path, as one call.
 *
 * The requested scope is EXPLICIT, because the grant carries whatever the client
 * asked for and nothing more — see the empty-scope case below, which pins that
 * behaviour rather than assuming a default nobody applies.
 */
async function grant(
  email: string = MCP_USER_EMAIL,
  scope = 'mcp:read mcp:write',
): Promise<{ clientId: string; tokens: TokenResponse }> {
  const clientId = await publicClient();
  const { verifier, challenge } = pkcePair();
  const code = codeFrom(await authorize({ clientId, challenge, email, scope }));
  const response = await token({
    grant_type: 'authorization_code',
    code,
    redirect_uri: CLAUDE_REDIRECT,
    code_verifier: verifier,
    client_id: clientId,
  });
  expect(response.status).toBe(200);
  return { clientId, tokens: (await response.json()) as TokenResponse };
}

describe('dynamic client registration, over the real table', () => {
  it('registers a public PKCE client with no secret at all', async () => {
    const { status, body } = await register({
      redirect_uris: [CLAUDE_REDIRECT],
      client_name: 'Claude',
    });
    expect(status).toBe(201);
    expect(body.client_secret).toBeUndefined();
    expect(body.token_endpoint_auth_method).toBe('none');

    const [row] = (await state()).clients;
    expect(row?.client_secret_hash).toBeNull();
    // TEXT[] round-trip: the exact-match allowlist the authorize endpoint reads.
    expect(row?.redirect_uris).toEqual([CLAUDE_REDIRECT]);
    expect(row?.scopes).toEqual(['mcp:read', 'mcp:write']);
  });

  it("hashes a confidential client's secret and returns the plaintext once", async () => {
    const { body } = await register({
      redirect_uris: [CLAUDE_REDIRECT],
      token_endpoint_auth_method: 'client_secret_basic',
    });
    const secret = body.client_secret as string;
    expect(secret).toMatch(/^[0-9a-f]{64}$/);

    const [row] = (await state()).clients;
    expect(row?.client_secret_hash).toBe(createHash('sha256').update(secret).digest('hex'));
    // The plaintext is nowhere in the database — not in another column, not
    // anywhere. This is the assertion the port exists to keep true.
    expect(JSON.stringify(await state())).not.toContain(secret);
  });

  it('refuses metadata that would widen what the AS supports', async () => {
    expect((await register({ redirect_uris: [] })).status).toBe(400);
    expect((await register({ redirect_uris: ['/relative'] })).status).toBe(400);
    expect(
      (await register({ redirect_uris: [CLAUDE_REDIRECT], scope: 'mcp:read admin:everything' }))
        .status,
    ).toBe(400);
    expect(
      (
        await register({
          redirect_uris: [CLAUDE_REDIRECT],
          token_endpoint_auth_method: 'private_key_jwt',
        })
      ).status,
    ).toBe(400);
    // Nothing was written by any of the four.
    expect((await state()).clients).toEqual([]);
  });
});

describe('authorize — identity and the open-redirect guard', () => {
  it('sends an unauthenticated caller to sign-in and mints nothing', async () => {
    const clientId = await publicClient();
    const { challenge } = pkcePair();
    const response = await authorize({ clientId, challenge, email: null });

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') as string);
    expect(location.pathname).toBe('/login');
    // The flow resumes post-login: the callback points back at the authorize URL.
    expect(location.searchParams.get('callbackUrl')).toContain('/api/oauth/authorize');
    expect(location.searchParams.get('code')).toBeNull();
  });

  it('400s in plain text rather than redirecting to an unregistered URI', async () => {
    const clientId = await publicClient();
    const { challenge } = pkcePair();
    const refused = await authorize({
      clientId,
      challenge,
      redirectUri: 'https://atacante.example/callback',
    });

    expect(refused.status).toBe(400);
    expect(refused.headers.get('location')).toBeNull();
    expect(await refused.text()).toContain('redirect_uri');
  });

  it('refuses a missing or non-S256 challenge, echoing the state', async () => {
    const clientId = await publicClient();
    const { challenge } = pkcePair();
    for (const attempt of [
      { challenge: '', challengeMethod: 'S256' },
      { challenge, challengeMethod: 'plain' },
    ]) {
      const response = await authorize({ clientId, ...attempt, state: 'xyz' });
      const location = new URL(response.headers.get('location') as string);
      expect(location.searchParams.get('error')).toBe('invalid_request');
      expect(location.searchParams.get('state')).toBe('xyz');
    }
  });

  it('mints nothing when the HOST refuses consent', async () => {
    // The endpoint has no consent screen of its own and registration is open, so
    // the host's approval decision is the only thing standing between "attacker
    // registers a client with their own redirect_uri and scope" and "a signed-in
    // admin's browser hands them a code". Refusal is an `access_denied` redirect,
    // and — the actual property — no code.
    const clientId = await publicClient();
    const { challenge } = pkcePair();
    const response = await authorize({ clientId, challenge, approve: false, state: 'xyz' });

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') as string);
    expect(location.searchParams.get('error')).toBe('access_denied');
    expect(location.searchParams.get('state')).toBe('xyz');
    expect(location.searchParams.get('code')).toBeNull();
    // Nothing was recorded either: no grant, so no connection.
    expect((await state()).tokens).toHaveLength(0);
  });

  it('refuses a scope the CLIENT did not register for', async () => {
    const clientId = await publicClient(CLAUDE_REDIRECT, 'mcp:read');
    const { challenge } = pkcePair();
    const response = await authorize({ clientId, challenge, scope: 'mcp:read mcp:write' });
    const location = new URL(response.headers.get('location') as string);
    expect(location.searchParams.get('error')).toBe('invalid_scope');
  });
});

describe('the authorization_code grant', () => {
  it('issues a token the resource server on this origin accepts', async () => {
    const { tokens } = await grant();
    expect(tokens.token_type).toBe('Bearer');
    expect(tokens.access_token.split('.')).toHaveLength(3);

    const whoami = await backend.app.request('/__harness/mcp/whoami', {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    expect(whoami.status).toBe(200);
    const { data } = (await whoami.json()) as {
      data: { email: string; subject: string; scopes: string[] };
    };
    // The identity came from the SESSION, through the code, into the token —
    // never from anything the client sent.
    expect(data.email).toBe(MCP_USER_EMAIL);
    expect(data.subject).toBe(`google-sub-${MCP_USER_EMAIL}`);
  });

  it('refuses a bearer this surface did not mint', async () => {
    const response = await backend.app.request('/__harness/mcp/whoami', {
      headers: { authorization: 'Bearer not.a.token' },
    });
    expect(response.status).toBe(401);
  });

  it('refuses a second redemption of the same code', async () => {
    const clientId = await publicClient();
    const { verifier, challenge } = pkcePair();
    const code = codeFrom(await authorize({ clientId, challenge }));
    const form = {
      grant_type: 'authorization_code',
      code,
      redirect_uri: CLAUDE_REDIRECT,
      code_verifier: verifier,
      client_id: clientId,
    };

    expect((await token(form)).status).toBe(200);
    const replay = await token(form);
    expect(replay.status).toBe(400);
    expect((await replay.json()) as { error: string }).toMatchObject({ error: 'invalid_grant' });
  });

  it('refuses a mismatched verifier and a redirect_uri the code was not bound to', async () => {
    const clientId = await publicClient();
    const { challenge } = pkcePair();
    const code = codeFrom(await authorize({ clientId, challenge }));

    const wrongVerifier = await token({
      grant_type: 'authorization_code',
      code,
      redirect_uri: CLAUDE_REDIRECT,
      code_verifier: base64url(randomBytes(32)),
      client_id: clientId,
    });
    expect(wrongVerifier.status).toBe(400);

    const second = pkcePair();
    const otherCode = codeFrom(await authorize({ clientId, challenge: second.challenge }));
    const wrongRedirect = await token({
      grant_type: 'authorization_code',
      code: otherCode,
      redirect_uri: 'https://claude.ai/other',
      code_verifier: second.verifier,
      client_id: clientId,
    });
    expect(wrongRedirect.status).toBe(400);
  });

  it('requires the secret of a confidential client, and accepts HTTP Basic', async () => {
    const { body } = await register({
      redirect_uris: [CLAUDE_REDIRECT],
      token_endpoint_auth_method: 'client_secret_basic',
    });
    const clientId = body.client_id as string;
    const secret = body.client_secret as string;
    const { verifier, challenge } = pkcePair();
    const code = codeFrom(await authorize({ clientId, challenge }));

    const unauthenticated = await token({
      grant_type: 'authorization_code',
      code,
      redirect_uri: CLAUDE_REDIRECT,
      code_verifier: verifier,
      client_id: clientId,
    });
    expect(unauthenticated.status).toBe(401);

    // The code survived the refusal — a failed client authentication must not
    // consume it.
    const authenticated = await token(
      {
        grant_type: 'authorization_code',
        code,
        redirect_uri: CLAUDE_REDIRECT,
        code_verifier: verifier,
      },
      {
        authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`,
      },
    );
    expect(authenticated.status).toBe(200);
  });

  it('stores the refresh token as a hash, and only as a hash', async () => {
    const { tokens } = await grant();
    const rows = (await state()).tokens;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.token_hash).toBe(
      createHash('sha256').update(tokens.refresh_token).digest('hex'),
    );
    expect(JSON.stringify(rows)).not.toContain(tokens.refresh_token);
    // Nor is the code kept anywhere: an authorization code is a signed blob, so
    // there is no `oauth_codes` table to leak (and none to sweep).
    expect(Object.keys(await state())).toEqual(['tokens', 'clients', 'connections']);
  });
});

describe('the refresh_token grant', () => {
  it('rotates the token, keeps the stable subject, and chains the lineage', async () => {
    const { clientId, tokens } = await grant();

    const exchange = await token({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: clientId,
    });
    expect(exchange.status).toBe(200);
    const rotated = (await exchange.json()) as TokenResponse;
    expect(rotated.refresh_token).not.toBe(tokens.refresh_token);

    const whoami = await backend.app.request('/__harness/mcp/whoami', {
      headers: { authorization: `Bearer ${rotated.access_token}` },
    });
    const { data } = (await whoami.json()) as { data: { subject: string } };
    // The successor carries the ORIGINAL `sub`, not the email — the drift that
    // breaks identity correlation after the first refresh.
    expect(data.subject).toBe(`google-sub-${MCP_USER_EMAIL}`);

    const rows = (await state()).tokens;
    expect(rows).toHaveLength(2);
    const parent = rows.find((row) => row.token_hash === createHash('sha256')
      .update(tokens.refresh_token)
      .digest('hex'));
    const child = rows.find((row) => row.rotated_from === parent?.token_hash);
    expect(parent?.revoked).toBe(true);
    expect(child?.revoked).toBe(false);
  });

  it('hands CONCURRENT rotations to exactly one caller, over the real table', async () => {
    // The claim-once contract, proven against a REAL database rather than a map —
    // this store is raw SQL (`UPDATE … WHERE revoked_at IS NULL`, count must be 1),
    // so what is under test here is a NON-Prisma host meeting the same requirement.
    // Before the claim existed both requests answered 200 and one parent ended up
    // with two LIVE successors, which defeats OAuth 2.1 §4.3.1 replay protection by
    // winning a race instead of arriving second.
    const { clientId, tokens } = await grant();
    const refresh = () =>
      token({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: clientId,
      });

    const statuses = (await Promise.all([refresh(), refresh()]))
      .map((response) => response.status)
      .sort();
    expect(statuses).toEqual([200, 400]);

    // Exactly ONE successor row was written — two would mean the claim leaked — and
    // the loser is treated as the replay it is, so the whole lineage is revoked.
    const rows = (await state()).tokens;
    expect(rows.filter((row) => row.rotated_from !== null)).toHaveLength(1);
    expect(rows.every((row) => row.revoked)).toBe(true);
  });

  it('treats reuse as a replay and revokes the WHOLE lineage', async () => {
    const { clientId, tokens } = await grant();
    const first = (await (
      await token({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: clientId,
      })
    ).json()) as TokenResponse;

    // The leaked ancestor, presented again.
    const replay = await token({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: clientId,
    });
    expect(replay.status).toBe(400);

    // And the successor a thief would use next is dead too.
    const afterReplay = await token({
      grant_type: 'refresh_token',
      refresh_token: first.refresh_token,
      client_id: clientId,
    });
    expect(afterReplay.status).toBe(400);
    expect((await state()).tokens.every((row) => row.revoked)).toBe(true);
  });

  it("refuses another client's refresh token and leaves it usable by its owner", async () => {
    const { clientId, tokens } = await grant();
    const thief = await publicClient('https://chatgpt.com/connector_platform_oauth_redirect');

    const stolen = await token({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: thief,
    });
    expect(stolen.status).toBe(400);

    // Not consumed by the attempt: the token still belongs to its client.
    const owner = await token({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: clientId,
    });
    expect(owner.status).toBe(200);
  });

  it('lets scope narrow and refuses any widening', async () => {
    const { clientId, tokens } = await grant();

    const narrowed = await token({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: clientId,
      scope: 'mcp:read',
    });
    expect(narrowed.status).toBe(200);
    const next = (await narrowed.json()) as TokenResponse;
    expect(next.scope).toBe('mcp:read');

    const widened = await token({
      grant_type: 'refresh_token',
      refresh_token: next.refresh_token,
      client_id: clientId,
      scope: 'mcp:read mcp:write',
    });
    expect(widened.status).toBe(400);
    expect((await widened.json()) as { error: string }).toMatchObject({ error: 'invalid_scope' });
  });

  it('grants exactly what was requested — an omitted scope is not a default', async () => {
    // Faithful to the ported implementation: authorize ACCEPTS a request with no
    // `scope` (the client may rely on the server's default), but nothing then
    // widens it — the code carries "" and the token is issued with no scopes. So
    // a later "narrowing" to `mcp:read` is a BROADENING and is refused. Worth
    // pinning rather than fixing here: preserving behaviour is the porting rule,
    // and a host that wants a default passes the scope its connector asked for.
    const { clientId, tokens } = await grant(MCP_USER_EMAIL, '');
    expect(tokens.scope).toBe('');

    const widened = await token({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: clientId,
      scope: 'mcp:read',
    });
    expect(widened.status).toBe(400);
  });

  it('refuses an unknown token and an unsupported grant type', async () => {
    const clientId = await publicClient();
    expect(
      (await token({ grant_type: 'refresh_token', refresh_token: 'nope', client_id: clientId }))
        .status,
    ).toBe(400);
    const unsupported = await token({ grant_type: 'password', client_id: clientId });
    expect((await unsupported.json()) as { error: string }).toMatchObject({
      error: 'unsupported_grant_type',
    });
  });
});

describe('connection liveness, per user', () => {
  it('records the AI host on a grant, attributed from the redirect URIs', async () => {
    await grant();
    const [connection] = (await state()).connections;
    expect(connection).toMatchObject({ user_id: 'user-ana', host: 'claude', revoked: false });
  });

  it('keeps two users connections apart', async () => {
    await grant(MCP_USER_EMAIL);
    await grant(MCP_USER_B_EMAIL);
    const owners = (await state()).connections.map((row) => row.user_id).sort();
    expect(owners).toEqual(['user-ana', 'user-beatriz']);
  });

  it('still issues tokens for an email with no user row, recording nothing', async () => {
    const { tokens } = await grant(MCP_USER_WITHOUT_ROW);
    expect(tokens.access_token.split('.')).toHaveLength(3);
    // Email is the identity the AS binds to; a host that has not created a row is
    // a normal state, not a reason to refuse the grant.
    expect((await state()).connections).toEqual([]);
  });
});

describe('discovery, from the origin root', () => {
  it('advertises endpoints derived from the request origin', async () => {
    const response = await backend.app.request('/.well-known/oauth-authorization-server');
    expect(response.status).toBe(200);
    const doc = (await response.json()) as Record<string, unknown>;
    expect(doc.issuer).toBe('http://localhost');
    expect(doc.authorization_endpoint).toBe('http://localhost/api/oauth/authorize');
    expect(doc.token_endpoint).toBe('http://localhost/api/oauth/token');
    expect(doc.registration_endpoint).toBe('http://localhost/api/oauth/register');
    expect(doc.jwks_uri).toBe('http://localhost/.well-known/jwks.json');
    // OAuth 2.1, pinned: code only, S256 only.
    expect(doc.response_types_supported).toEqual(['code']);
    expect(doc.code_challenge_methods_supported).toEqual(['S256']);
  });

  it('keeps the resource document on the same scopes and issuer', async () => {
    const as = (await (
      await backend.app.request('/.well-known/oauth-authorization-server')
    ).json()) as Record<string, unknown>;
    const resource = (await (
      await backend.app.request('/.well-known/oauth-protected-resource')
    ).json()) as Record<string, unknown>;

    expect(resource.resource).toBe('http://localhost/api/mcp');
    expect(resource.authorization_servers).toEqual([as.issuer]);
    expect(resource.scopes_supported).toEqual(as.scopes_supported);
  });

  it('publishes only the public half of the signing key', async () => {
    const response = await backend.app.request('/.well-known/jwks.json');
    expect(response.status).toBe(200);
    const { keys } = (await response.json()) as { keys: Record<string, unknown>[] };
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ kid: MCP_SIGNING_KID, kty: 'EC', crv: 'P-256', alg: 'ES256' });
    // `d` is the private scalar. Publishing it would hand out the ability to mint.
    expect(keys[0]?.d).toBeUndefined();
  });
});
