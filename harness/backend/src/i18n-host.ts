/**
 * `@12-apps/i18n` mounted the way a host mounts it — the SERVER half, which had
 * no consumer anywhere.
 *
 * The frontend harness already drives `./react`: the observability page reads
 * its words through `useLocaleCopy`, a `<LocaleProvider>` sits at the root of
 * `main.tsx`, and a spec flips `?locale=` and watches the sentences change.
 * What that proves is the last hop. It says nothing about the hop before it —
 * how a REQUEST becomes a locale — and that half is where the rule actually
 * lives:
 *
 *     explicit -> user -> tenant -> request -> default
 *
 * A rule with five levels and a fall-through at each of them is not something a
 * host gets right by reading a docblock. It is also not something the package's
 * own suite can prove is reachable: `localeFromRequest` takes a web-standard
 * `Request`, and whether a host's framework hands it one intact is exactly the
 * question a unit test constructs its way around.
 *
 * ## Why the probe is a real route
 *
 * Hono's `c.req.raw` is the incoming `Request`, so mounting this as an endpoint
 * makes the whole path real: the header parsing, the cookie the browser
 * actually sent, the query string as the router left it. A test building its
 * own `new Request()` would be asserting against its own construction.
 *
 * ## Why the host answers with the whole ladder
 *
 * The probe returns each rung separately — what the request alone said, and
 * what the request said once a stored user and tenant preference were laid over
 * it. That is the shape of the decision a real adopter makes (`localeFromRequest`
 * is deliberately the REQUEST half only, and returns `null` rather than
 * defaulting, so it cannot out-rank the preference it is supposed to lose to),
 * and a probe that collapsed them into one answer would make the two
 * indistinguishable.
 */
import { Hono } from 'hono';
import {
  DEFAULT_LOCALE,
  createFormats,
  resolveLocale,
  type Formats,
  type Locale,
} from '@12-apps/i18n';
import { LOCALE_COOKIE, LOCALE_QUERY_PARAM, localeFromRequest } from '@12-apps/i18n/server';

/** The cookie and query name this host uses — the package's defaults, stated. */
export const HARNESS_LOCALE_COOKIE = LOCALE_COOKIE;
export const HARNESS_LOCALE_QUERY = LOCALE_QUERY_PARAM;

/**
 * A stored preference, the way a host actually holds one.
 *
 * Two Maps rather than a table: what matters to this probe is that a
 * preference arrives from somewhere OTHER than the request, and a row would
 * only add a migration to the thing under test.
 */
const userLocales = new Map<string, string>();
const tenantLocales = new Map<string, string>();

/** Seed a stored preference, so a spec can watch it out-rank the header. */
export function rememberUserLocale(user: string, tag: string): void {
  userLocales.set(user, tag);
}

export function rememberTenantLocale(tenant: string, tag: string): void {
  tenantLocales.set(tenant, tag);
}

export function forgetStoredLocales(): void {
  userLocales.clear();
  tenantLocales.clear();
}

/**
 * The currency a store charges in, which is NOT a function of the language.
 *
 * Stated here because the package insists on it and the insistence is easy to
 * lose in adoption: `createFormats` gives `currency` no default, on the grounds
 * that a currency guessed from the language is a wrong PRICE rather than a
 * clumsy sentence. This host is a Brazilian store, so BRL travels with the
 * tenant and an English-reading admin still sees BRL.
 */
export const HARNESS_CURRENCY = 'BRL';

/** Every formatter one surface needs, for the locale that surface resolved. */
export function harnessFormats(locale: Locale): Formats {
  return createFormats({ locale, currency: HARNESS_CURRENCY, timeZone: 'UTC' });
}

/**
 * The host endpoints that make a resolved locale observable.
 *
 * Under `/__harness` because they are the SUITE's — no package declares them,
 * and a real adopter's equivalent is whatever handler needed to know which
 * language to answer in.
 */
export function localeProbes(): Hono {
  const app = new Hono();

  /**
   * What the REQUEST alone says — `?lang=`, then the cookie, then the header.
   *
   * `null` is a real answer here and the case worth having a route for: a
   * request that names no language it recognises must say so rather than
   * assert pt-BR, because asserting would silently out-rank the stored
   * preference the next rung is about to apply.
   */
  app.get('/request', (c) => c.json({ locale: localeFromRequest(c.req.raw) }));

  /** The same read with `Accept-Language` switched off, which a host may do. */
  app.get('/request-no-header', (c) =>
    c.json({ locale: localeFromRequest(c.req.raw, { acceptLanguage: false }) }),
  );

  /**
   * The whole ladder, as an adopter assembles it.
   *
   * The stored halves are looked up by header rather than by session because
   * the probe is about PRECEDENCE, not about identity — the surfaces that own
   * identity here are auth's and impersonation's.
   */
  app.get('/resolve', (c) => {
    const user = c.req.header('x-harness-user');
    const tenant = c.req.header('x-harness-tenant');
    const url = new URL(c.req.url);

    const locale = resolveLocale({
      explicit: url.searchParams.get(HARNESS_LOCALE_QUERY),
      user: user === undefined ? null : (userLocales.get(user) ?? null),
      tenant: tenant === undefined ? null : (tenantLocales.get(tenant) ?? null),
      acceptLanguage: c.req.header('accept-language') ?? null,
    });

    return c.json({ locale, default: DEFAULT_LOCALE });
  });

  /**
   * A money, a number and a date rendered for the locale this request resolved.
   *
   * On the same route as the resolution on purpose: the two axes are separate
   * (a translated sentence and a reader's own notation are different jobs) but
   * a host resolves them together, once, and this is where a consumer can see
   * that the second one actually followed the first.
   */
  app.get('/formats', (c) => {
    const locale = localeFromRequest(c.req.raw) ?? DEFAULT_LOCALE;
    const formats = harnessFormats(locale);
    return c.json({
      locale,
      money: formats.money(123_456),
      number: formats.number(1234.5, 2),
      percent: formats.percent(1250),
      date: formats.date('2026-03-09T00:00:00.000Z'),
      decimalSeparator: formats.decimalSeparator,
      // What the operator typed, in their own notation, coming back as a number
      // — the half that gets forgotten, because `Number("12,5")` is `NaN`.
      parsed: formats.parseDecimal(c.req.query('typed') ?? ''),
    });
  });

  return app;
}
