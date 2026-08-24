/* eslint-disable test-flakiness/no-database-operations, test-flakiness/no-test-isolation --
   the database IS the subject: these cases drive the PUBLISHED @12-apps/billing
   routes through the harness's own app, over a real Postgres holding the tables
   the package deliberately does not ship. Each case reseeds first. */
/**
 * `@12-apps/billing`'s card-on-file surface as a CONSUMER gets it (FUT-340).
 *
 * This is the first adoption in the harness whose SCHEMA is the host's. The
 * package's manifest states the absence and the reason — subscriptions, cycles
 * and stored instruments all carry foreign keys into the host's own account
 * table, so a package partial cannot declare them — and the whole obligation
 * reaches the package through three ports instead.
 *
 * That is what makes a consumer harness worth having here. There is no
 * migration to replay and no schema to diff: if the ports and the tables an
 * adopter must author for them ever stop lining up, nothing upstream notices.
 *
 * The properties below concentrate on the two the package's own suite cannot
 * reach, because both are about a SECOND owner and a REAL provider session:
 *
 *  - a session minted for one subscription must not complete against another;
 *  - a removal must take EVERY pointer off file, including one at an acquirer
 *    the owner no longer collects through.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApiBilling } from '@12-apps/billing/server';
import { renderWiringReport, unclaimedRoutes } from '@12-apps/wiring/consumer';

import { createHarnessBackend, type HarnessBackend } from '../src/app';
import {
  BILLING_COPY,
  BILLING_OWNER,
  BILLING_OWNER_B,
  BILLING_OWNER_HEADER,
  billingPlatform,
} from '../src/billing-host';
import {
  CHARGE_ONLY_PROVIDER,
  PLATFORM_MERCHANT,
  VAULTING_PROVIDER,
  billingProviders,
} from '../src/billing-payments';

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
  billingProviders.reset();
  backend.billing.payments.credentials.setChain(PLATFORM_MERCHANT, [
    VAULTING_PROVIDER,
    CHARGE_ONLY_PROVIDER,
  ]);
});

interface Card {
  provider: string;
  brand: string | null;
  last4: string | null;
  isDefault: boolean;
}
interface VaultStart {
  provider: string;
  tokenization: string;
  publicKey: string | null;
  clientSecret: string | null;
  sessionId: string | null;
}

/** Drive the surface as one signed-in subscriber. */
function as(ownerId: string = BILLING_OWNER) {
  const base = '/api/account/billing';
  const headers = { [BILLING_OWNER_HEADER]: ownerId, 'content-type': 'application/json' };
  return {
    listCards: () => backend.app.request(`${base}/card`, { headers }),
    beginSession: () => backend.app.request(`${base}/card/session`, { method: 'POST', headers }),
    completeSession: (body: Record<string, unknown>) =>
      backend.app.request(`${base}/card`, { method: 'POST', headers, body: JSON.stringify(body) }),
    forgetCards: () => backend.app.request(`${base}/card`, { method: 'DELETE', headers }),
  };
}

/** Open a session and finish it — the whole happy path, in one line. */
async function saveCard(ownerId: string = BILLING_OWNER): Promise<string> {
  const start = (await (await as(ownerId).beginSession()).json()) as VaultStart;
  const done = await as(ownerId).completeSession({ sessionId: start.sessionId });
  expect(done.status).toBe(200);
  return String(start.sessionId);
}

async function cardsOf(ownerId: string = BILLING_OWNER): Promise<Card[]> {
  return ((await (await as(ownerId).listCards()).json()) as { cards: Card[] }).cards;
}

/** What the row actually holds — the half a screen must never see. */
async function storedPointers(ownerId: string): Promise<Record<string, unknown>[]> {
  const { rows } = await backend.pg.query<Record<string, unknown>>(
    `SELECT provider, provider_instrument_id AS "instrumentId", is_default AS "isDefault"
       FROM billing_instruments WHERE owner_id = $1 ORDER BY created_at ASC`,
    [ownerId],
  );
  return rows;
}

describe('putting a card on file', () => {
  it('opens a session carrying what the browser needs and no credential', async () => {
    const start = (await (await as().beginSession()).json()) as VaultStart;

    expect(start.provider).toBe(VAULTING_PROVIDER);
    // Both of these are MEANT to reach the browser — that is what they are for.
    // The client secret authorises confirming ONE session and nothing else, and
    // the publishable key is public by construction.
    expect(start.publicKey).toBe('pk_harness_public');
    expect(start.clientSecret).toMatch(/_secret$/);
    // What is NOT here: the connection's stored secrets. A session that carried
    // them would be a credential leak the host could not see.
    expect(JSON.stringify(start)).not.toContain('sk_harness_stub');
  });

  it('stores the instrument and answers the list, so a screen needs one call', async () => {
    await saveCard();

    const cards = await cardsOf();
    expect(cards).toEqual([
      { provider: VAULTING_PROVIDER, brand: 'visa', last4: '4242', expMonth: 12, expYear: 2031, isDefault: true },
    ]);
  });

  it('never lets the vault reference out to a screen', async () => {
    await saveCard();

    // The row holds an opaque provider id; the read a screen makes does not
    // select it. That is the whole promise of `listCards`, and the surest way
    // to keep it is for the column never to be in the query.
    const pointers = await storedPointers(BILLING_OWNER);
    expect(String(pointers[0]?.['instrumentId'])).toMatch(/^vault_/);
    expect(JSON.stringify(await cardsOf())).not.toContain('vault_');
  });

  it('replaces the card rather than accumulating a second default', async () => {
    await saveCard();
    await saveCard();

    const pointers = await storedPointers(BILLING_OWNER);
    expect(pointers).toHaveLength(2);
    // A partial unique index refuses two defaults per owner: two is a row
    // nobody can answer "which card did we charge" from.
    expect(pointers.filter((row) => row['isDefault'] === true)).toHaveLength(1);
    expect((await cardsOf())[0]?.isDefault).toBe(true);
  });
});

describe("completing somebody else's session", () => {
  it('is refused, because the reference comes from the host row', async () => {
    // THE property this surface exists for. `complete` is reached from a
    // browser, so its session id is attacker-controlled and names an object at
    // the PROVIDER rather than in the host's database.
    //
    // What makes it safe is that the package passes a subscription id read from
    // the OWNER's own row — never echoed from the request — so the provider's
    // session, stamped at `begin`, cannot match. A billing layer that took the
    // reference from the body would satisfy every type and lose this.
    const stranger = (await (await as(BILLING_OWNER_B).beginSession()).json()) as VaultStart;

    const response = await as(BILLING_OWNER).completeSession({ sessionId: stranger.sessionId });

    // 400, in this host's words. The package answers its OWN rejections and
    // hands a provider refusal back — deliberately, so a host maps it onto its
    // own error type. Without that mapping (`mapProviderError` in
    // `billing-host.ts`) this is a bare 500 with no words in it, which is the
    // shape a naive adoption ships.
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain('Não foi possível guardar');

    // And nothing was attached either way — to either owner.
    expect(await storedPointers(BILLING_OWNER)).toEqual([]);
    expect(await storedPointers(BILLING_OWNER_B)).toEqual([]);
  });

  it('shows one subscriber nothing of another', async () => {
    await saveCard(BILLING_OWNER);

    expect(await cardsOf(BILLING_OWNER_B)).toEqual([]);
  });
});

describe('taking the cards back off file', () => {
  it('removes EVERY pointer, including one at a former acquirer', async () => {
    // An owner can hold a card at yesterday's acquirer as well as today's, and
    // the screen shows one of them. A removal that only saw the visible one
    // would leave a card on file the owner believes is gone — chargeable again
    // the day somebody switches acquirer back.
    await saveCard();
    await backend.pg.query(
      `UPDATE billing_instruments SET provider = $1, is_default = false WHERE owner_id = $2`,
      [CHARGE_ONLY_PROVIDER, BILLING_OWNER],
    );
    await saveCard();
    expect(await storedPointers(BILLING_OWNER)).toHaveLength(2);

    expect((await as().forgetCards()).status).toBe(200);
    expect(await storedPointers(BILLING_OWNER)).toEqual([]);
  });

  it('is idempotent for an owner with nothing on file', async () => {
    // An owner with no card has already arrived where this call was going, and
    // a 404 for that would be a lie. It answers the (empty) list.
    const response = await as().forgetCards();

    expect(response.status).toBe(200);
    expect(((await response.json()) as { cards: Card[] }).cards).toEqual([]);
  });

  it('keeps the pointer, in the host words, when a retry could still clear it', async () => {
    await saveCard();
    billingProviders.detachFailsRetriably = true;

    const response = await as().forgetCards();

    expect(response.status).toBe(BILLING_COPY.detachFailed.status);
    expect(await response.json()).toEqual({ message: BILLING_COPY.detachFailed.message });
    // The row SURVIVES. Everything permanent has already dropped its pointer by
    // the time this returns false, so dropping it here would leave a card the
    // provider still holds and we no longer know about.
    expect(await storedPointers(BILLING_OWNER)).toHaveLength(1);
  });
});

describe('what this deployment cannot do', () => {
  it('refuses in the host words when the platform has no account', async () => {
    // Checked FIRST and EARLY: a deployment with no platform account should do
    // nothing quietly, not raise a charge that throws deep inside the gateway
    // once per customer.
    billingPlatform.enabled = false;

    const response = await as().beginSession();

    expect(response.status).toBe(BILLING_COPY.rejections['no-platform-account'].status);
    expect(await response.json()).toEqual({
      message: BILLING_COPY.rejections['no-platform-account'].message,
    });
  });

  it('refuses in the host words when the acquirer cannot save a card', async () => {
    // Not an error state: an operator fixes it by switching acquirer, which is
    // exactly why the package answers a rejection rather than throwing. A
    // harness with only vaulting providers could never reach this branch.
    backend.billing.payments.credentials.setChain(PLATFORM_MERCHANT, [CHARGE_ONLY_PROVIDER]);

    const response = await as().beginSession();

    expect(response.status).toBe(BILLING_COPY.rejections['provider-cannot-vault'].status);
    expect(await response.json()).toEqual({
      message: BILLING_COPY.rejections['provider-cannot-vault'].message,
    });
  });

  it('refuses a body carrying no usable session id', async () => {
    const response = await as().completeSession({ sessionId: '   ' });

    expect(response.status).toBe(BILLING_COPY.invalidSession.status);
    expect(await response.json()).toEqual({ message: BILLING_COPY.invalidSession.message });
  });
});

describe('the caller', () => {
  it('answers 401 with no owner at all', async () => {
    expect((await backend.app.request('/api/account/billing/card')).status).toBe(401);
  });
});

describe('the copy this surface refuses to default', () => {
  /** The three ports, satisfied but never reached — the copy check runs first. */
  const deps = {
    subscriptions: { findTarget: async () => null },
    instruments: {
      save: async () => undefined,
      listPointers: async () => [],
      forget: async () => undefined,
      listCards: async () => [],
    },
    merchant: { kind: 'PLATFORM', id: 'x' },
    enabled: async () => true,
    payments: async () => {
      throw new Error('not reached');
    },
  } as never;

  it('throws naming the field, rather than shipping a default voice', () => {
    // The contract worth adopting against. A default in the origin platform's
    // language reads as finished to the next platform right up until it reaches
    // a user — so this surface has none, and says which sentence is missing at
    // construction rather than at the request that needed it.
    expect(() => createApiBilling({ ...(deps as object) } as never)).toThrow(/copy/);
  });

  it('refuses a refusal with no words in it', () => {
    // A blank message is a 500 wearing a status code. Checked per field, so the
    // one that is blank is the one named.
    const copy = {
      ...BILLING_COPY,
      invalidSession: { status: 400, message: '   ' },
    };
    expect(() => createApiBilling({ ...(deps as object), copy } as never)).toThrow(
      /invalidSession/,
    );
  });

  it('refuses a status that is not a refusal', () => {
    // The status travels WITH the sentence, because "is an unconfigured
    // platform a 503 or a 501" is the same kind of host decision the words are.
    // A 200 here would be a refusal the caller reads as success.
    const copy = {
      ...BILLING_COPY,
      detachFailed: { status: 200, message: 'tudo certo' },
    };
    expect(() => createApiBilling({ ...(deps as object), copy } as never)).toThrow(
      /detachFailed/,
    );
  });
});

describe('adopted through @12-apps/wiring, not by calling the factory', () => {
  // Calling `createApiBilling` by hand is the failure the contract was written
  // to stop: "a version bump that adds a capability arrives silently —
  // report-builder 5.x shipped three working-copy endpoints its own client
  // calls, and the origin host never mounted them; the editor's autosave 404s
  // and nothing is red."

  it('accounts for every capability the package declares', () => {
    const { report } = backend.billing;
    const statuses = new Map(
      report.packages[0]?.capabilities.map((entry) => [entry.kind, entry.status]),
    );

    expect(statuses.get('http')).toBe('bound');
    // MANDATORY for runtime manifests, and the manifest says why: "the money
    // path is the one place where 'it failed and filed nowhere' is
    // unaffordable, so the binder hands this package a logger already scoped to
    // `billing`." `createApiBilling` takes no logger argument — the BINDER
    // supplies it, so a hand-mount ships a money path that files nowhere.
    expect(statuses.get('observability')).toBe('bound');
    // And nothing is left unanswered: `assemble()` throws while anything is,
    // which is what turns the next capability billing declares into a red
    // build rather than an endpoint nobody mounted.
    expect([...statuses.values()]).not.toContain('unanswered');
  });

  it('states the four declared absences rather than leaving them to be inferred', () => {
    // The manifest names them and gives a reason for each: no `db` (the models
    // still carry foreign keys into host tables), no `permissions` (who may put
    // a card on file is a role decision), no `notifications` (the one notice is
    // entirely host copy), no `mcp` (the surface writes a payment instrument,
    // which stays behind a human). A capability that is absent from the
    // manifest is absent from the report — which is how a host reading this
    // knows those four are decisions rather than omissions.
    const kinds = backend.billing.report.packages[0]?.capabilities.map((entry) => entry.kind);

    expect(kinds).not.toContain('db');
    expect(kinds).not.toContain('permissions');
    expect(kinds).not.toContain('mcp');
  });

  it('names a descriptor this host forgot to claim', () => {
    // The pin the contract prescribes for a host that mounts by hand. All four
    // routes go through one router here, so the real list is complete; dropping
    // one is what proves the check would speak up.
    const { routes } = backend.billing;
    const allButOne = routes
      .slice(1)
      .map((mounted) => `${mounted.route.method} ${'/api/account/billing'}${mounted.route.path}`);

    const missing = unclaimedRoutes(routes, allButOne);
    expect(missing).toHaveLength(1);
    expect(missing[0]?.route.path).toBe(routes[0]?.route.path);
  });

  it('renders a report naming the mount', () => {
    expect(renderWiringReport(backend.billing.report)).toContain('/api/account/billing');
  });
});
