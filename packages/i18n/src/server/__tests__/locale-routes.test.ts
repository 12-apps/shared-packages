import { describe, expect, it, vi } from 'vitest';

import { createApiLocale } from '../create-api-locale';
import { localeRoutes } from '../locale-routes';
import type { LocaleStore } from '../store';
import type { Locale } from '../../core/locale';

/**
 * The two endpoints, and the refusals that make them safe to mount at an
 * account path with no further authorization.
 */

function stub(overrides: Partial<LocaleStore> = {}): LocaleStore {
  return {
    read: vi.fn(async () => null),
    write: vi.fn(async (_userId: string, locale: 'pt-BR' | 'en-US' | null) => locale),
    ...overrides,
  } as LocaleStore;
}

const get = (config: { store: LocaleStore }) => localeRoutes(config)[0]!;
const put = (config: { store: LocaleStore }) => localeRoutes(config)[1]!;

describe('GET', () => {
  it('answers the caller their own tag', async () => {
    const store = stub({ read: vi.fn(async (): Promise<Locale> => 'en-US') });
    const response = await get({ store }).handle({ userId: 'u1' });

    expect(response).toEqual({ status: 200, body: { data: { locale: 'en-US' } } });
    expect(store.read).toHaveBeenCalledWith('u1');
  });

  it('answers null — not a default — for a reader who never chose', async () => {
    const response = await get({ store: stub() }).handle({ userId: 'u1' });
    expect(response.body).toEqual({ data: { locale: null } });
  });
});

describe('PUT', () => {
  it('stores a choice', async () => {
    const store = stub();
    const response = await put({ store }).handle({ userId: 'u1', body: { locale: 'en-US' } });

    expect(response.status).toBe(200);
    expect(store.write).toHaveBeenCalledWith('u1', 'en-US');
  });

  it('takes an explicit null as the CLEAR', async () => {
    const store = stub();
    await put({ store }).handle({ userId: 'u1', body: { locale: null } });
    expect(store.write).toHaveBeenCalledWith('u1', null);
  });

  /**
   * An ABSENT key and an explicit `null` must not mean the same thing. Folding
   * them together makes "forget my choice" unreachable for any client that
   * omits the field by accident — silently, which is the worse half.
   */
  it('refuses an absent locale key rather than treating it as the clear', async () => {
    const store = stub();
    const response = await put({ store }).handle({ userId: 'u1', body: {} });

    expect(response.status).toBe(400);
    expect(store.write).not.toHaveBeenCalled();
  });

  it('refuses a tag outside the canonical list, and names what it accepts', async () => {
    const store = stub();
    const response = await put({ store }).handle({ userId: 'u1', body: { locale: 'klingon' } });

    expect(response.status).toBe(400);
    expect(String((response.body as { error: string }).error)).toContain('pt-BR');
    expect(store.write).not.toHaveBeenCalled();
  });

  it('normalises a differently-cased tag rather than refusing it', async () => {
    const store = stub();
    await put({ store }).handle({ userId: 'u1', body: { locale: 'PT-br' } });
    expect(store.write).toHaveBeenCalledWith('u1', 'pt-BR');
  });
});

describe('as a wire contribution', () => {
  it('refuses both endpoints with 401 when the host resolved nobody', async () => {
    // The property that lets this mount at an account path with no further
    // gate: there is no id a caller could substitute, so "no actor" is the
    // only refusal either endpoint needs.
    const store = stub();
    const routes = createApiLocale({ store }).routes;

    for (const route of routes) {
      const response = await route.handle({
        actor: null,
        params: {},
        query: {},
        body: { locale: 'en-US' },
      } as Parameters<typeof route.handle>[0]);
      expect(response.status).toBe(401);
    }
    expect(store.read).not.toHaveBeenCalled();
    expect(store.write).not.toHaveBeenCalled();
  });

  it('declares both endpoints as authenticated', async () => {
    expect(createApiLocale({ store: stub() }).routes.map((r) => r.kind)).toEqual([
      'authenticated',
      'authenticated',
    ]);
  });
});
