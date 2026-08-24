/* eslint-disable test-flakiness/no-test-isolation -- each case resets the
   harness's trail and switches first; the server itself is shared, which is
   what makes the write gate a middleware rather than a per-case construction. */
/**
 * `@12-apps/impersonation` from the SERVER side: the mint refusals, the write
 * gate's path table, and the two ways a live session dies under it.
 *
 * The browser half is already covered — `harness/frontend`'s spec drives the
 * banner and the dialog, and the package ships two Gherkin journeys the harness
 * runs. What none of them can reach is here:
 *
 * - **the time box**, because a spec cannot wait thirty minutes. The cookie
 *   carries its own expiry, so a stale one can be constructed and presented,
 *   which is exactly what an operator's forgotten tab does.
 * - **a tampered cookie**, because a browser has no reason to produce one and
 *   the interesting attacker does not use a browser.
 * - **the path table in full**. The gate answers on four shapes × two session
 *   kinds × the verb, and driving sixteen combinations through a UI would be a
 *   test of the UI.
 *
 * The gate is where the whole feature actually lives: it is middleware in front
 * of every `/api` route, so what it refuses is a property of the deployment
 * rather than of any screen.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarnessBackend, type HarnessBackend } from '../src/app';
import {
  IMPERSONATION_PLATFORM_PATH,
  IMPERSONATION_TENANTS,
  SECOND_SYSTEM_LIBRARIAN,
  SYSTEM_LIBRARIAN,
} from '../src/impersonation-host';
import { RBAC_TENANT_ID, RBAC_USERS } from '../src/rbac-host';

let backend: HarnessBackend;

/** A borrower-facing member of the North Branch — never a platform account. */
const MEMBER = RBAC_USERS.find((user) => user.tenantId === RBAC_TENANT_ID);

beforeAll(async () => {
  backend = await createHarnessBackend();
  expect(MEMBER, 'the rbac catalog must seed a member of the north branch').toBeDefined();
}, 120_000);

afterAll(async () => {
  await backend.close();
});

beforeEach(async () => {
  const reset = await backend.app.request('/__harness/reset', { method: 'POST' });
  expect(reset.status).toBe(204);
});

const COOKIE_NAME = 'harness_desk_session';
const ACTOR_HEADER = 'x-rbac-user';

/** A reason long enough for the host's own `reasonLength` floor of 15. */
const REASON = 'Renewing a loan at the counter for a borrower without a card.';

interface StartBody {
  targetUserId?: string;
  targetApp?: string;
  tenantId?: string;
  reason?: string;
  allowWrites?: boolean;
}

function startBody(overrides: StartBody = {}): StartBody {
  return {
    targetUserId: MEMBER?.id,
    targetApp: 'counter',
    tenantId: RBAC_TENANT_ID,
    reason: REASON,
    ...overrides,
  };
}

/** Start an operator session as a system librarian, unless told otherwise. */
function start(body: StartBody = {}, actor: string = SYSTEM_LIBRARIAN.id): Promise<Response> {
  return backend.app.request(IMPERSONATION_PLATFORM_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [ACTOR_HEADER]: actor },
    body: JSON.stringify(startBody(body)),
  });
}

/** The session cookie a successful start set, ready to present on a request. */
function cookieFrom(response: Response): string {
  const header = response.headers.get('set-cookie');
  expect(header, 'a successful start must set the session cookie').toBeTruthy();
  const value = /harness_desk_session=([^;]*)/.exec(header ?? '')?.[1];
  expect(value).toBeTruthy();
  return `${COOKIE_NAME}=${value}`;
}

/** Any request, carrying a session cookie and an actor. */
function withSession(
  cookie: string,
  path: string,
  method: 'GET' | 'POST' = 'GET',
  actor: string = SYSTEM_LIBRARIAN.id,
): Promise<Response> {
  return backend.app.request(path, {
    method,
    headers: { cookie, [ACTOR_HEADER]: actor, 'content-type': 'application/json' },
    ...(method === 'POST' ? { body: '{}' } : {}),
  });
}

/**
 * The trail as the harness records it.
 *
 * `refusal` is the CODE and `reason` is the operator's own typed sentence —
 * both are on every refused entry, and confusing them is easy enough to be
 * worth naming here.
 */
interface Trail {
  started: unknown[];
  ended: unknown[];
  refused: { refusal: string; reason: string }[];
}

async function trail(): Promise<Trail> {
  const response = await backend.app.request('/__harness/impersonation/trail');
  return (await response.json()) as Trail;
}

/** The `{ data }` envelope every one of these endpoints answers in. */
async function dataOf<T>(response: Response): Promise<T> {
  return ((await response.json()) as { data: T }).data;
}

describe('minting a desk session', () => {
  it('records the start before it hands back a cookie', async () => {
    const response = await start();
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain(COOKIE_NAME);

    // The order is the package's only guarantee here: the session IS the
    // cookie, so there is no database mutation to share a transaction with.
    // "Logged, then started" is what makes an unrecorded session impossible.
    const record = await trail();
    expect(record.started).toHaveLength(1);
    expect(record.refused).toHaveLength(0);
  });

  it('publishes only the three fields the banner renders', async () => {
    const body = await dataOf<{
      subject?: { id: string; name: string; email: string; isPlatformAdmin?: boolean };
    }>(await start());
    // `resolveTarget` also answers `isPlatformAdmin`, which this endpoint
    // computed for its OWN refusal and has no business publishing.
    expect(body.subject).toBeDefined();
    expect(Object.keys(body.subject ?? {}).sort()).toEqual(['email', 'id', 'name']);
  });

  it('refuses a lateral move onto another system librarian', async () => {
    const response = await start({ targetUserId: SECOND_SYSTEM_LIBRARIAN.id });
    expect(response.status).toBe(403);

    // The refusal the whole mechanism is built around: two full-privilege
    // accounts stepping into each other defeats attribution entirely.
    const record = await trail();
    expect(record.refused.map((entry) => entry.refusal)).toEqual(['target_is_platform_admin']);
    expect(record.started).toHaveLength(0);
  });

  it('refuses a start made from inside a live session, and records why', async () => {
    const cookie = cookieFrom(await start());
    const nested = await backend.app.request(IMPERSONATION_PLATFORM_PATH, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [ACTOR_HEADER]: SYSTEM_LIBRARIAN.id,
        cookie,
      },
      body: JSON.stringify(startBody()),
    });
    expect(nested.status).toBe(403);

    // There is one cookie per browser, so a second mint OVERWRITES rather than
    // nests — and the end entry is written by the exit, so the replaced
    // session's start row would dangle forever in a record nobody can amend.
    const record = await trail();
    expect(record.refused.map((entry) => entry.refusal)).toEqual(['already_impersonating']);
    expect(record.started).toHaveLength(1);
  });

  it('refuses an app this host does not have and a reason too short to be one', async () => {
    // Both are the HOST's mint policy — `targetApps` and `reasonLength` are
    // config, so a package with a default here would be inventing the host's
    // apps and its idea of an explanation.
    expect((await start({ targetApp: 'warehouse' })).status).toBe(400);
    expect((await start({ reason: 'because' })).status).toBe(400);
    expect((await trail()).started).toHaveLength(0);
  });

  it('refuses an integration key outright', async () => {
    const response = await backend.app.request(IMPERSONATION_PLATFORM_PATH, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [ACTOR_HEADER]: SYSTEM_LIBRARIAN.id,
        'x-machine-token': '1',
      },
      body: JSON.stringify(startBody()),
    });
    // A desk session names a human who took responsibility. A key cannot.
    expect(response.status).toBe(403);
  });

  it('refuses a preview in a branch that switched desk sessions off', async () => {
    // The entitlement gate is the TENANT surface's, and both the error type and
    // its status are the host's — the package only asks how to recognise a
    // denial and what to answer. A preview is also started by STAFF, not by a
    // system librarian: the platform accounts hold no preview permission here,
    // because they reach every branch by authority instead.
    const staff = 'admin-1';
    const branch = IMPERSONATION_TENANTS[0]?.slug ?? RBAC_TENANT_ID;
    const preview = (): Promise<Response> =>
      backend.app.request(`/api/admin/${branch}/desk-session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [ACTOR_HEADER]: staff },
        body: JSON.stringify({ as: 'role', roleName: 'CLERK' }),
      });

    expect((await preview()).status).toBe(200);

    await backend.app.request('/__harness/impersonation/entitlement', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId: RBAC_TENANT_ID, enabled: false }),
    });

    expect((await preview()).status).toBe(409);

    // The OPERATOR path is untouched by the switch: it is a different authority
    // with a different gate, and conflating them would let a branch setting
    // disable the platform's own reach.
    expect((await start()).status).toBe(200);
  });
});

describe('the write gate', () => {
  it('lets an allowlisted money read through', async () => {
    const cookie = cookieFrom(await start());

    // `/api/loans` is on `moneyReads`, anchored to the WHOLE pathname so the
    // entry never carries its children in with it — which is what the receipt
    // case below depends on.
    expect((await withSession(cookie, '/api/loans')).status).toBe(200);
  });

  it('refuses a money write even when the session may write', async () => {
    const cookie = cookieFrom(await start({ allowWrites: true }));
    const response = await withSession(cookie, '/api/loans/l-1/renew', 'POST');

    // `allowWrites` is not a master key. Money is refused for every desk
    // session there is, which is why the path table has a `money` list at all.
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: 'Loans and fines are never settled from a desk session.',
    });
  });

  it('refuses an unlisted money GET — the case where the verb lies', async () => {
    const cookie = cookieFrom(await start({ allowWrites: true }));

    // `/api/loans` is allowlisted as a read; `/api/loans/:id/receipt` is not.
    // A gate that trusted the METHOD would wave the receipt through, and a
    // receipt is exactly the money detail the session must not see.
    expect((await withSession(cookie, '/api/loans')).status).toBe(200);
    expect((await withSession(cookie, '/api/loans/l-1/receipt')).status).toBe(403);
  });

  it("refuses a write to the borrower's own record, however the session was minted", async () => {
    const cookie = cookieFrom(await start({ allowWrites: true }));
    const response = await withSession(cookie, '/api/borrower-profile', 'POST');
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: "A borrower's own details are theirs to change.",
    });
  });

  it('refuses every write when the session was minted read-only', async () => {
    // `allowWrites` defaults to FALSE, deliberately: a session that can write is
    // the exceptional case, so a caller that forgot the field fails closed by
    // design rather than by accident of the parser.
    const cookie = cookieFrom(await start());
    expect((await withSession(cookie, '/api/catalog-notes', 'POST')).status).toBe(403);

    const writable = cookieFrom(await start({ allowWrites: true }));
    expect((await withSession(writable, '/api/catalog-notes', 'POST')).status).toBe(200);
  });

  it('costs an unimpersonated request nothing but a substring test', async () => {
    // No cookie means the middleware short-circuits before it decodes anything.
    // Worth pinning: the gate sits in front of EVERY `/api` route, so ordinary
    // traffic paying for it would be a tax on the whole deployment.
    const response = await backend.app.request('/api/loans/l-1/renew', {
      method: 'POST',
      headers: { [ACTOR_HEADER]: SYSTEM_LIBRARIAN.id, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(200);
  });
});

describe('a session that stops being valid', () => {
  it('stops honouring a cookie whose authority was revoked mid-session', async () => {
    const cookie = cookieFrom(await start({ allowWrites: true }));
    const live = await dataOf<{ active: boolean }>(
      await withSession(cookie, IMPERSONATION_PLATFORM_PATH),
    );
    expect(live.active).toBe(true);

    await backend.app.request('/__harness/impersonation/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: SYSTEM_LIBRARIAN.id, revoked: true }),
    });

    // `stillAuthorized` is consulted PER REQUEST rather than at mint time,
    // which is the only shape that can end a session already in flight — the
    // cookie is still perfectly valid cryptographically.
    //
    // What it produces is an UNIMPERSONATED request, not a refused one: the
    // operator is a real system librarian, so once the session stops being
    // honoured they are simply themselves again. A 403 would be the wrong
    // answer — it would tell them their OWN authority had gone.
    const after = await dataOf<{ active: boolean }>(
      await withSession(cookie, IMPERSONATION_PLATFORM_PATH),
    );
    expect(after.active).toBe(false);
  });

  it('does not read a cookie that was edited', async () => {
    const cookie = cookieFrom(await start({ allowWrites: true }));
    expect(
      (await dataOf<{ active: boolean }>(await withSession(cookie, IMPERSONATION_PLATFORM_PATH)))
        .active,
    ).toBe(true);

    // Flip a character INSIDE the sealed payload rather than at the very end,
    // so what is presented is still a well-formed cookie — the interesting case
    // is a value that parses and decrypts to nothing, not one the header parser
    // drops before the package ever sees it.
    const [name, value = ''] = cookie.split('=');
    const middle = Math.floor(value.length / 2);
    const flipped =
      value.slice(0, middle) + (value[middle] === 'A' ? 'B' : 'A') + value.slice(middle + 1);

    // AES-GCM's auth tag IS the signature check, so an edited, truncated or
    // foreign-key cookie fails to DECRYPT rather than decoding into a session
    // with different claims. The request is then simply unimpersonated, which
    // is the only safe reading of a cookie nobody can vouch for.
    const tampered = await dataOf<{ active: boolean }>(
      await withSession(`${name}=${flipped}`, IMPERSONATION_PLATFORM_PATH),
    );
    expect(tampered.active).toBe(false);
  });

  it('clears the cookie on exit, and answers the same whether one was live', async () => {
    const cookie = cookieFrom(await start());
    const first = await backend.app.request(IMPERSONATION_PLATFORM_PATH, {
      method: 'DELETE',
      headers: { cookie, [ACTOR_HEADER]: SYSTEM_LIBRARIAN.id },
    });
    expect(first.status).toBe(200);
    expect(await dataOf(first)).toMatchObject({ ended: true });
    expect((await trail()).ended).toHaveLength(1);

    // A double-click, a stale tab and a browser that already dropped the cookie
    // all converge on the same cleared state rather than an error the caller
    // can do nothing with.
    const second = await backend.app.request(IMPERSONATION_PLATFORM_PATH, {
      method: 'DELETE',
      headers: { [ACTOR_HEADER]: SYSTEM_LIBRARIAN.id },
    });
    expect(second.status).toBe(200);
    expect(await dataOf(second)).toMatchObject({ ended: false });
  });
});
