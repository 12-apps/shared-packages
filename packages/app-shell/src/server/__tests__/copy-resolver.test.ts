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
 */
import { describe, expect, it } from 'vitest';

import { CONSENT_ACCEPT_PATH } from '../../core/consent-wire';
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
    const route = acceptRoute(
      failingHost(({ locale }) => (locale === 'en-US' ? EN_US : PT_BR)),
    );

    const [ptBr, enUs] = await Promise.all([
      route.handle(request({ locale: 'pt-BR' })),
      route.handle(request({ locale: 'en-US' })),
    ]);

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
    const route = acceptRoute(
      failingHost(({ locale }) => {
        asked.push(locale);
        return PT_BR;
      }),
    );

    await route.handle(request());

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

  /** A host with one audience passes a pack and nothing about it changes. */
  it('leaves a plain pack answering exactly as before', async () => {
    const response = await acceptRoute(failingHost(PT_BR)).handle(request({ locale: 'en-US' }));
    expect(response).toEqual({ status: 500, body: { error: PT_BR.recordFailed } });
  });
});
