import { LOCALES, matchLocale, type Locale } from '../core/locale';

import type { LocaleStore } from './store';

/**
 * The two endpoints a reader's own language needs, as descriptors.
 *
 * Both are session-gated and both act on the CALLER and nobody else: the user
 * id comes from the host's resolved session, never from the body or the path.
 * That is what keeps this surface safe to mount at an account path with no
 * further authorization — there is no id a caller could substitute.
 *
 * Shipped by this package rather than restated in every host, for the reason
 * the whole locale axis exists: "read and write one validated tag for the
 * caller" is mechanism with no host vocabulary in it. The origin host wrote
 * exactly these two handlers, a repository, a zod body and a route file, and
 * every other host would have written them again.
 */

/** Twin of the wiring contract's request; no import, so this package stays liftable. */
export interface LocaleRequest {
  /** The host's resolved caller. `null` is refused before a handler runs. */
  userId?: string | null;
  body?: unknown;
}

export interface LocaleResponse {
  status: number;
  body: unknown;
}

export interface LocaleRoute {
  method: 'GET' | 'PUT';
  path: string;
  session: true;
  handle(request: LocaleRequest): Promise<LocaleResponse>;
}

export interface LocaleRoutesConfig {
  store: LocaleStore;
}

/**
 * Read the tag a caller is asking to store.
 *
 * An ABSENT key and an explicit `null` deliberately do not mean the same thing:
 * `null` is the clear, and a missing key is a malformed request. Treating the
 * two alike would make "forget my choice" unreachable for any client that omits
 * the field by accident — and silently, which is the worse half.
 */
function requestedLocale(body: unknown): { ok: true; locale: Locale | null } | { ok: false } {
  if (typeof body !== 'object' || body === null || !('locale' in body)) return { ok: false };
  const value = (body as { locale: unknown }).locale;
  if (value === null) return { ok: true, locale: null };
  if (typeof value !== 'string') return { ok: false };
  const locale = matchLocale(value);
  return locale === null ? { ok: false } : { ok: true, locale };
}

export function localeRoutes(config: LocaleRoutesConfig): LocaleRoute[] {
  const { store } = config;

  return [
    {
      method: 'GET',
      path: '/',
      session: true,
      handle: async ({ userId }) => ({
        status: 200,
        body: { data: { locale: await store.read(userId as string) } },
      }),
    },
    {
      method: 'PUT',
      path: '/',
      session: true,
      handle: async ({ userId, body }) => {
        const requested = requestedLocale(body);
        if (!requested.ok) {
          // Named in the refusal so a client can tell "you sent a language I do
          // not speak" from "you sent nothing" without guessing.
          return {
            status: 400,
            body: { error: `locale must be null or one of: ${LOCALES.join(', ')}` },
          };
        }
        return {
          status: 200,
          body: { data: { locale: await store.write(userId as string, requested.locale) } },
        };
      },
    },
  ];
}
