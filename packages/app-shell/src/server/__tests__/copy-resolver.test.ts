/**
 * The failure body follows the READER (FUT-925).
 *
 * `AppShellServerConfig.messages` was a plain pack, and the mount is built once
 * per process — at least one adopter memoises its call — so every 500 this
 * surface would ever emit was worded in the language its boot happened to run
 * in. A 500 is read by whoever made the request.
 *
 * These cases pin the four properties a widening like this can silently lose:
 * that the resolver is asked PER REQUEST rather than once at the mount, that an
 * absent locale stays absent instead of becoming a language this package chose,
 * that the accessor is the only reader, and that a host passing a plain pack is
 * unchanged.
 *
 * They also cover both ADAPTERS, because a tag that never reaches the accessor
 * makes every property above unobservable: the manifest's wire view carries
 * `WireRequest.locale` across, and `./hono` takes a `resolveLocale` seam for the
 * host that has no contract to carry one. The browser half's own cases are in
 * `react/__tests__/copy-resolver.test.tsx`.
 */
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { CONSENT_ACCEPT_PATH, CONSENT_STATUS_PATH } from '../../core/consent-wire';
import { appShellRouter } from '../../hono';
import { createWireApiAppShell } from '../../manifest/server';
import { messagesOf, type AppShellRequest, type AppShellServerConfig } from '../config';
import { createApiAppShell } from '../create-api-app-shell';

const VERSION = '2026-07-27';

const PT_BR = { recordFailed: 'Não foi possível registrar seu aceite.' };
const EN_US = { recordFailed: 'We could not record your acceptance.' };

function request(overrides: Partial<AppShellRequest> = {}): AppShellRequest {
  return { params: {}, query: {}, header: () => undefined, ...overrides };
}

/** A host whose `record` always throws — the one branch that renders a message. */
function failingHost(messages: AppShellServerConfig['messages']): AppShellServerConfig {
  return {
    termsVersion: VERSION,
    messages,
    consent: {
      resolveActor: () => ({ userId: 'u1' }),
      isCurrent: () => false,
      record: () => {
        throw new Error('the write failed');
      },
    },
  };
}

function acceptRoute(config: AppShellServerConfig) {
  const route = createApiAppShell(config).routes.find(
    (candidate) => candidate.path === CONSENT_ACCEPT_PATH,
  );
  if (!route) throw new Error('no accept route');
  return route;
}

describe('a 500 body follows the caller', () => {
  /**
   * Rule B, and the whole point of the change: ONE mount, two callers, two
   * languages. Both responses come from the same assembled surface, because a
   * factory that resolved at construction would have frozen the first answer
   * for the life of the process and a single-locale host could not tell that
   * from correct.
   */
  it('answers two callers in their own languages from one mount', async () => {
    const mounted = acceptRoute(
      failingHost(({ locale }) => (locale === 'en-US' ? EN_US : PT_BR)),
    );

    const ptBr = await mounted.handle(request({ locale: 'pt-BR' }));
    const enUs = await mounted.handle(request({ locale: 'en-US' }));

    expect(ptBr.body).toEqual({ error: PT_BR.recordFailed });
    expect(enUs.body).toEqual({ error: EN_US.recordFailed });
    expect(ptBr.status).toBe(500);
    expect(enUs.status).toBe(500);
  });

  /**
   * Rule E. "Nobody said" is not the same as asserting a language, so the tag
   * is passed through EXACTLY as given — `undefined`, not a default this
   * package picked. Where that default is applied is the host resolver's
   * business, which is what keeps it in one place instead of one per call site.
   */
  it('asks with no locale at all when the caller named none', async () => {
    const asked: Array<string | null | undefined> = [];
    const mounted = acceptRoute(
      failingHost(({ locale }) => {
        asked.push(locale);
        return PT_BR;
      }),
    );

    await mounted.handle(request());

    expect(asked).toEqual([undefined]);
  });

  /**
   * Rule C, made a COMPILE error rather than a runtime one: reading
   * `config.messages` where a value is expected type-errors now, and the
   * accessor is the single place a source becomes words. Asserted on both
   * shapes, since the identity branch is the one a refactor would drop.
   */
  it('resolves both shapes through the accessor', () => {
    expect(messagesOf({ messages: PT_BR })).toEqual(PT_BR);
    expect(messagesOf({ messages: PT_BR }, 'en-US')).toEqual(PT_BR);
    expect(messagesOf({ messages: ({ locale }) => (locale === 'en-US' ? EN_US : PT_BR) }, 'en-US')).toEqual(EN_US);
  });

  /**
   * Rule F, at the seam that decides whether any of the above is reachable.
   *
   * Every host that mounts this surface through the wiring contract goes
   * through the manifest's wire view, and that view builds the
   * `AppShellRequest` field by field. A view that did not carry `locale`
   * across would leave the widened field perfectly typed and permanently
   * inert — resolving with no locale forever, for every adopter, which reads
   * exactly like a host that chose not to translate.
   */
  it("carries the caller's tag across the wire view", async () => {
    const wired = createWireApiAppShell(
      failingHost(({ locale }) => (locale === 'en-US' ? EN_US : PT_BR)),
    ).routes.find((candidate) => candidate.path === CONSENT_ACCEPT_PATH);
    if (!wired) throw new Error('no accept route');

    const answer = await wired.handle({
      params: {},
      query: {},
      locale: 'en-US',
    } as Parameters<typeof wired.handle>[0]);

    expect(answer).toEqual({ status: 500, body: { error: EN_US.recordFailed } });
  });

  /**
   * The other half of rule F at that seam, and the one a passing test would
   * hide: absent has to stay ABSENT. Present-and-undefined and missing are the
   * same to a resolver and not to a reader of the request object, and only one
   * of them is honest about a consumer that negotiated nothing.
   */
  it('leaves the field absent when the consumer resolved none', async () => {
    const seen: AppShellRequest[] = [];
    const wired = createWireApiAppShell({
      ...failingHost(PT_BR),
      consent: {
        resolveActor: (received) => {
          seen.push(received);
          return null;
        },
        isCurrent: () => true,
        record: () => undefined,
      },
    }).routes.find((candidate) => candidate.path === CONSENT_STATUS_PATH);
    if (!wired) throw new Error('no status route');

    await wired.handle({ params: {}, query: {} } as Parameters<typeof wired.handle>[0]);

    expect(seen).toHaveLength(1);
    expect('locale' in seen[0]!).toBe(false);
  });

  /**
   * The OTHER adapter, and the reason it needed a seam of its own.
   *
   * A host mounting through `./hono` has no contract carrying a tag, so without
   * `resolveLocale` the widened field is inert there exactly as it would be
   * with no wire view. The seam takes the host's ANSWER rather than the rule:
   * precedence between `?lang=`, a cookie, a stored preference and
   * `Accept-Language` is host policy, and this estate's own host deliberately
   * ignores the header — a package that picked an order would pick it for
   * every adopter.
   */
  it('lets a Hono host negotiate one, and needs nothing when it does not', async () => {
    const config = failingHost(({ locale }) => (locale === 'en-US' ? EN_US : PT_BR));

    const bilingual = new Hono();
    bilingual.route(
      '/api',
      appShellRouter({ ...config, resolveLocale: (c) => c.req.query('lang') }).router,
    );
    const english = await bilingual.request(`/api${CONSENT_ACCEPT_PATH}?lang=en-US`, {
      method: 'POST',
    });
    expect(await english.json()).toEqual({ error: EN_US.recordFailed });

    const silent = new Hono();
    silent.route('/api', appShellRouter(config).router);
    const unstated = await silent.request(`/api${CONSENT_ACCEPT_PATH}`, { method: 'POST' });
    // "Nobody said" reaches the resolver, which is what lets the HOST's own
    // fallback be the only one in play.
    expect(await unstated.json()).toEqual({ error: PT_BR.recordFailed });
  });

  /** A host with one audience passes a pack and nothing about it changes. */
  it('leaves a plain pack answering exactly as before', async () => {
    const response = await acceptRoute(failingHost(PT_BR)).handle(request({ locale: 'en-US' }));
    expect(response).toEqual({ status: 500, body: { error: PT_BR.recordFailed } });
  });
});
