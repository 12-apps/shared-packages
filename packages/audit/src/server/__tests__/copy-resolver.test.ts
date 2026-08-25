/* eslint-disable test-flakiness/no-database-operations, test-flakiness/no-test-isolation --
   the "database" here is the in-memory fake in `fake-db.ts`, built fresh per
   case: there is no real database to isolate and no state that outlives a
   test. Same reason as `routes.test.ts`, which this file sits beside. */
import { describe, expect, it } from 'vitest';

import { DEFAULT_MESSAGES, type AuditMessages, type AuditRequest } from '../config';
import { createApiAudit } from '../create-api-audit';
import { messagesOf } from '../policy';

import { fakeAuditDb } from './fake-db';
import { TEST_VOCABULARY } from './fixtures';

/**
 * The copy seam: `messages` takes a partial override OR a resolver, and the
 * routes resolve it per request.
 *
 * An audit log is opened by whichever operator is looking, so the language is
 * the REQUEST's rather than the deployment's — and `createApiAudit` builds its
 * route table once at the host's mount, which is where that used to be lost.
 */

const TENANT = 'client-1';

const PT: Partial<AuditMessages> = { unauthenticated: 'Não autenticado.' };
const EN: Partial<AuditMessages> = { unauthenticated: 'Not signed in.' };

function mount(messages: NonNullable<Parameters<typeof createApiAudit>[0]['messages']>) {
  const fake = fakeAuditDb();
  const api = createApiAudit({
    db: () => Promise.resolve(fake.db),
    // `null` = unauthenticated, which is the cheapest route to a refusal we can
    // read the language off.
    resolveActor: () => null,
    vocabulary: TEST_VOCABULARY,
    messages,
  });
  const request = (locale?: string): AuditRequest => ({
    params: { tenantSlug: 'my-store' },
    query: {},
    header: () => undefined,
    ...(locale ? { locale } : {}),
  });
  return {
    api,
    async refuse(locale?: string) {
      const route = api.routes.find((candidate) => candidate.path === '/audit-logs');
      if (!route) throw new Error('no listing route');
      return route.handle(request(locale));
    },
  };
}

const errorOf = (body: unknown): string => (body as { error: string }).error;

describe('messagesOf', () => {
  it('merges a plain partial over the packaged defaults, as before', () => {
    const merged = messagesOf({ messages: PT });

    expect(merged.unauthenticated).toBe(PT.unauthenticated);
    expect(merged.forbidden).toBe(DEFAULT_MESSAGES.forbidden);
  });

  it('asks a resolver for the locale it was given, then merges', () => {
    const source = ({ locale }: { readonly locale?: string | null }) =>
      locale === 'en-US' ? EN : PT;

    expect(messagesOf({ messages: source }, 'en-US').unauthenticated).toBe(EN.unauthenticated);
    expect(messagesOf({ messages: source }, 'pt-BR').unauthenticated).toBe(PT.unauthenticated);
    // The defaults still fill the gaps a partial leaves.
    expect(messagesOf({ messages: source }, 'en-US').forbidden).toBe(DEFAULT_MESSAGES.forbidden);
  });

  it('treats an absent locale as "nobody said"', () => {
    const seen: Array<string | null | undefined> = [];
    messagesOf({
      messages: ({ locale }) => {
        seen.push(locale);
        return PT;
      },
    });

    expect(seen).toEqual([undefined]);
  });
});

describe('the refusals can follow the operator', () => {
  it('answers two operators in their own languages from ONE mount', async () => {
    const h = mount(({ locale }: { readonly locale?: string | null }) =>
      locale === 'en-US' ? EN : PT,
    );

    const [pt, en] = await Promise.all([h.refuse('pt-BR'), h.refuse('en-US')]);

    expect(errorOf(pt.body)).toBe(PT.unauthenticated);
    expect(errorOf(en.body)).toBe(EN.unauthenticated);
  });

  it('keeps the STATUS fixed while the sentence follows the operator', async () => {
    const h = mount(({ locale }: { readonly locale?: string | null }) =>
      locale === 'en-US' ? EN : PT,
    );

    const [pt, en] = await Promise.all([h.refuse('pt-BR'), h.refuse('en-US')]);

    expect(en.status).toBe(pt.status);
    expect(en.status).toBe(401);
    expect(errorOf(en.body)).not.toBe(errorOf(pt.body));
  });

  it('still takes a plain partial, so a single-audience host changes nothing', async () => {
    const h = mount(PT);
    const response = await h.refuse('en-US');

    expect(errorOf(response.body)).toBe(PT.unauthenticated);
  });

  it('refuses a blank sentence at the MOUNT, not on the request that needed it', () => {
    /**
     * Rule E, and why the mount asks with no locale at all.
     *
     * `messagesOf` is where a blank override is refused. That refusal has to
     * land at boot: a host whose copy is empty must fail to start rather than
     * 500 on whichever endpoint first reached for the missing string.
     */
    expect(() =>
      createApiAudit({
        db: () => Promise.resolve(fakeAuditDb().db),
        resolveActor: () => null,
        vocabulary: TEST_VOCABULARY,
        messages: () => ({ unauthenticated: '   ' }),
      }),
    ).toThrow();
  });
});

describe('the vocabulary stays fixed, whoever is reading', () => {
  /**
   * Rule H, and the reason `vocabulary` was deliberately NOT widened alongside
   * `messages`.
   *
   * Everything this half of the package reads off it is mechanism: `actionIds`
   * and `resourceIds` are the wire's allowed filter values, and `allowlistFor`
   * decides which fields are persisted to an APPEND-ONLY table. A resolver
   * there would make the wire contract and the contents of an immutable row
   * language-dependent — and unlike a mistranslated sentence, a row written
   * with the wrong allowlist cannot be amended afterwards.
   */
  it('offers the same filter values to every reader', async () => {
    const h = mount(({ locale }: { readonly locale?: string | null }) =>
      locale === 'en-US' ? EN : PT,
    );

    // The vocabulary is one guarded value, shared by every request — so the
    // ids a filter may select on cannot vary with who is asking.
    expect(h.api.vocabulary.actionIds).toBe(TEST_VOCABULARY.actionIds);
    expect(h.api.vocabulary.resourceIds).toBe(TEST_VOCABULARY.resourceIds);
  });

  it('rejects an unknown action identically in both languages', async () => {
    // What the caller is TOLD may follow them; what the wire ACCEPTS may not.
    const fake = fakeAuditDb();
    const api = createApiAudit({
      db: () => Promise.resolve(fake.db),
      resolveActor: () => ({ tenantId: TENANT, userId: 'u', permissions: ['audit:read'] }),
      vocabulary: TEST_VOCABULARY,
      messages: ({ locale }) => (locale === 'en-US' ? EN : PT),
    });
    const route = api.routes.find((candidate) => candidate.path === '/audit-logs');
    if (!route) throw new Error('no listing route');

    const ask = (locale: string) =>
      route.handle({
        params: { tenantSlug: 'my-store' },
        query: { action_in: 'not-a-real-action' },
        header: () => undefined,
        locale,
      });

    const [pt, en] = await Promise.all([ask('pt-BR'), ask('en-US')]);

    expect(en.status).toBe(pt.status);
    expect(en.status).toBe(400);
  });
});
