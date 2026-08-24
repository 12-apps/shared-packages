/**
 * `@12-apps/i18n` from a CONSUMER — the SERVER half, which had none.
 *
 * The frontend harness drives `./react` well: a `<LocaleProvider>` at the root
 * of `main.tsx`, the observability page reading its words through
 * `useLocaleCopy`, and a spec that flips `?locale=` and watches the sentences
 * follow. That is the LAST hop. The hop before it — a request becoming a
 * locale — had no consumer in either half, and it is the hop where the rule
 * actually lives:
 *
 *     explicit -> user -> tenant -> request -> default
 *
 * ## What only a consumer can see here
 *
 * Three things, and none of them is a re-run of the package's own suite.
 *
 * 1. **`./server` resolves and reads a REAL request.** `localeFromRequest`
 *    takes a web-standard `Request`; whether a host's framework hands one over
 *    intact is exactly the question a unit test constructs its way around by
 *    building the `Request` itself. Here Hono's `c.req.raw` is the request the
 *    socket delivered.
 * 2. **The fall-through is reachable at every rung.** An unrecognised tag must
 *    drop to the NEXT candidate rather than to the default — a stale `es-AR` on
 *    a user row must not out-rank a tenant that says `en-US`. That is a claim
 *    about five levels composed, which is the shape a host gets wrong.
 * 3. **The packs that SHIP are bilingual.** Every bilingual package runs
 *    `assertLocaleParity` in its own suite, against its own source. A consumer
 *    runs the same assertion against what the tarball actually contains — the
 *    `@12-apps/typescript-config` failure (an empty tarball for three releases)
 *    is what a `files` entry can do to a package whose own tests all pass.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { DEFAULT_LOCALE, LOCALES, matchLocale } from '@12-apps/i18n';
import { assertLocaleParity } from '@12-apps/i18n/testing';
import { ENTITLEMENTS_MESSAGES } from '@12-apps/entitlements/server';
import { LIFECYCLE_MESSAGES } from '@12-apps/entity-lifecycle/server';
import { ONBOARDING_MESSAGES } from '@12-apps/onboarding/server';
import { RBAC_MESSAGES } from '@12-apps/rbac/server';
import { STORAGE_MESSAGES } from '@12-apps/storage';

import { createHarnessBackend, type HarnessBackend } from '../src/app';
import {
  forgetStoredLocales,
  HARNESS_LOCALE_COOKIE,
  rememberTenantLocale,
  rememberUserLocale,
} from '../src/i18n-host';

let backend: HarnessBackend;

beforeAll(async () => {
  backend = await createHarnessBackend();
}, 120_000);

afterEach(() => {
  forgetStoredLocales();
});

afterAll(async () => {
  await backend.close();
});

/** One probe request, with whatever the caller wants the request to carry. */
async function probe(
  path: string,
  init: { header?: string; cookie?: string; user?: string; tenant?: string } = {},
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {};
  if (init.header !== undefined) headers['accept-language'] = init.header;
  if (init.cookie !== undefined) headers['cookie'] = `${HARNESS_LOCALE_COOKIE}=${init.cookie}`;
  if (init.user !== undefined) headers['x-harness-user'] = init.user;
  if (init.tenant !== undefined) headers['x-harness-tenant'] = init.tenant;

  const response = await backend.app.request(`/__harness/locale${path}`, { headers });
  expect(response.status).toBe(200);
  return (await response.json()) as Record<string, unknown>;
}

describe('what the REQUEST alone says', () => {
  it('takes an explicit ?lang= over everything else the request carries', async () => {
    // The three sources ranked against each other, all disagreeing. A host that
    // read them in any other order would still pass a test that set one at a
    // time, which is why they are set together.
    const body = await probe('/request?lang=en-US', {
      cookie: 'pt-BR',
      header: 'pt-BR,pt;q=0.9',
    });

    expect(body['locale']).toBe('en-US');
  });

  it('takes the remembered cookie over the browser guess', async () => {
    // `Accept-Language` is a guess made by a browser the reader may never have
    // configured; the cookie is a choice they made here.
    expect(await probe('/request', { cookie: 'en-US', header: 'pt-BR' })).toEqual({
      locale: 'en-US',
    });
  });

  it('falls back to Accept-Language, honouring q-values', async () => {
    // Not first-listed: `q` ranks them, and the package sorts by it.
    expect(await probe('/request', { header: 'de;q=0.9,en-US;q=1.0' })).toEqual({
      locale: 'en-US',
    });
  });

  it('drops a q=0 tag rather than ranking it last', async () => {
    // `de, en;q=0` is a reader asking for German and REFUSING English. Ranking
    // English last would still hand it to them, since German is not spoken here.
    expect(await probe('/request', { header: 'de, en-US;q=0' })).toEqual({ locale: null });
  });

  it('answers null — not the default — when the request names nothing we speak', async () => {
    // The property the whole ladder rests on. A function that quietly answered
    // pt-BR here would out-rank the stored preference it is supposed to lose
    // to, and the bug would look like "the user's setting is ignored".
    expect(await probe('/request', { header: 'ja-JP,ko-KR' })).toEqual({ locale: null });
    expect(await probe('/request')).toEqual({ locale: null });
  });

  it('ignores the header entirely when the host says to', async () => {
    // A host serving a single-language deployment turns the guess off; the
    // cookie and the explicit choice still work.
    expect(await probe('/request-no-header', { header: 'en-US' })).toEqual({ locale: null });
    expect(await probe('/request-no-header', { header: 'en-US', cookie: 'en-US' })).toEqual({
      locale: 'en-US',
    });
  });

  it('matches a tag by LANGUAGE when the region is not one of ours', async () => {
    // `en-GB` is English, and a British reader given English is served while a
    // British reader given Portuguese is not. The region's own spelling is a
    // later problem; the wrong LANGUAGE is the one worth solving.
    expect(await probe('/request', { header: 'en-GB' })).toEqual({ locale: 'en-US' });
    expect(await probe('/request', { header: 'pt-PT' })).toEqual({ locale: 'pt-BR' });
  });
});

describe('the whole ladder, as an adopter assembles it', () => {
  it('lets the reader own setting beat the store default', async () => {
    rememberUserLocale('ana', 'en-US');
    rememberTenantLocale('padaria', 'pt-BR');

    // A person who chose English does not want their store's default undoing it.
    const body = await probe('/resolve', { user: 'ana', tenant: 'padaria', header: 'pt-BR' });

    expect(body['locale']).toBe('en-US');
  });

  it('lets the store default beat the browser guess', async () => {
    rememberTenantLocale('padaria', 'en-US');

    // The right answer for a reader who has never chosen — and better than a
    // header the reader may never have configured.
    expect(await probe('/resolve', { tenant: 'padaria', header: 'pt-BR' })).toMatchObject({
      locale: 'en-US',
    });
  });

  it('lets an explicit choice beat even the reader own setting', async () => {
    rememberUserLocale('ana', 'pt-BR');

    // `?lang=` IS a preference, freshly expressed — "show me this page in that
    // language right now" outranks what was saved last month.
    expect(await probe('/resolve?lang=en-US', { user: 'ana' })).toMatchObject({
      locale: 'en-US',
    });
  });

  it('FALLS THROUGH a stale stored tag instead of resolving it to the default', async () => {
    // The rung that is easy to get wrong and impossible to see: a user row
    // holding a locale this app has stopped speaking. Resolving it to the
    // default would silently discard the tenant's answer below it, and the
    // symptom is "our English store shows Portuguese to one user".
    rememberUserLocale('ana', 'es-AR');
    rememberTenantLocale('padaria', 'en-US');

    expect(await probe('/resolve', { user: 'ana', tenant: 'padaria' })).toMatchObject({
      locale: 'en-US',
    });
  });

  it('reaches the default only when every candidate was absent or unknown', async () => {
    rememberUserLocale('ana', 'es-AR');
    rememberTenantLocale('padaria', 'ja-JP');

    const body = await probe('/resolve', { user: 'ana', tenant: 'padaria', header: 'ko-KR' });

    expect(body['locale']).toBe(DEFAULT_LOCALE);
    expect(body['default']).toBe('pt-BR');
  });
});

describe('the SECOND axis — notation, which is not translation', () => {
  it('writes money, numbers and dates the way each reader reads them', async () => {
    const ptBr = await probe('/formats', { cookie: 'pt-BR' });
    const enUs = await probe('/formats', { cookie: 'en-US' });

    // "1.234,56" is not a translation of "1,234.56" — it is the same number
    // written for a different reader, which is why this axis exists separately
    // from the copy packs.
    expect(ptBr['decimalSeparator']).toBe(',');
    expect(enUs['decimalSeparator']).toBe('.');
    expect(String(ptBr['number'])).toBe('1.234,50');
    expect(String(enUs['number'])).toBe('1,234.50');
    expect(String(ptBr['percent'])).toBe('12,5%');
    expect(String(enUs['percent'])).toBe('12.5%');
  });

  it('keeps the CURRENCY when the language changes — a wrong one is a wrong price', async () => {
    const ptBr = await probe('/formats', { cookie: 'pt-BR' });
    const enUs = await probe('/formats', { cookie: 'en-US' });

    // An English-reading admin of a Brazilian store still sees BRL. The two
    // arrive as separate options for exactly this reason: every other error on
    // this axis costs clarity, and this one costs money.
    expect(String(ptBr['money'])).toContain('1.234,56');
    expect(String(enUs['money'])).toContain('1,234.56');
    expect(String(enUs['money'])).toMatch(/R\$/u);
  });

  it('reads a calendar date in UTC, not in the reader zone', async () => {
    // A date column holds a calendar day at UTC midnight, so formatting it in
    // the reader's own zone shows anyone west of Greenwich the day BEFORE the
    // one that was typed.
    expect(String((await probe('/formats', { cookie: 'pt-BR' }))['date'])).toBe('09/03/2026');
    expect(String((await probe('/formats', { cookie: 'en-US' }))['date'])).toBe('3/9/2026');
  });

  it('parses back what the operator typed, in their own notation', async () => {
    // The half that gets forgotten: a form takes "12,5" from a Brazilian
    // operator and `Number("12,5")` is `NaN`.
    expect((await probe('/formats?typed=1.234,56', { cookie: 'pt-BR' }))['parsed']).toBe(1234.56);
    expect((await probe('/formats?typed=1,234.56', { cookie: 'en-US' }))['parsed']).toBe(1234.56);
    // Blank is `null` in either notation — nothing was typed.
    expect((await probe('/formats?typed=', { cookie: 'pt-BR' }))['parsed']).toBeNull();
    expect((await probe('/formats?typed=', { cookie: 'en-US' }))['parsed']).toBeNull();
  });

  it('refuses two decimal separators — in the notation where that is nonsense', async () => {
    // `1,2,3` is the package's own example of what a partial rewrite lets
    // through, and it is only nonsense in pt-BR: there `,` is the DECIMAL
    // separator, so two of them are a malformed number and `null` is the whole
    // job of the return type. (A `replace` with a string argument rewrites the
    // first match only, which would read this as 1.2 rather than as garbage.)
    expect((await probe('/formats?typed=1,2,3', { cookie: 'pt-BR' }))['parsed']).toBeNull();

    // The SAME string in en-US is not malformed at all — there `,` is the GROUP
    // separator, so this is a badly-grouped 123 and reading it as 123 is
    // correct. Worth pinning both: a parser shared across notations has two
    // right answers for one input, and a suite asserting only the first would
    // read as "malformed input is rejected" while half the audience's valid
    // input was being rejected too.
    expect((await probe('/formats?typed=1,2,3', { cookie: 'en-US' }))['parsed']).toBe(123);
  });
});

describe('the packs the tarballs actually ship', () => {
  // Each of these runs `assertLocaleParity` in its OWN suite, against its own
  // source tree. This is the same assertion applied to what a consumer
  // resolves — the one place a `files` entry that stopped shipping `locales.ts`,
  // or a barrel that stopped re-exporting the pack, shows up as a failure
  // rather than as a package whose tests are all green.
  const packs = [
    ['ENTITLEMENTS_MESSAGES', ENTITLEMENTS_MESSAGES],
    ['LIFECYCLE_MESSAGES', LIFECYCLE_MESSAGES],
    ['ONBOARDING_MESSAGES', ONBOARDING_MESSAGES],
    ['RBAC_MESSAGES', RBAC_MESSAGES],
    ['STORAGE_MESSAGES', STORAGE_MESSAGES],
  ] as const;

  it.each(packs)('%s speaks every canonical locale, the same way', (name, pack) => {
    expect(() => assertLocaleParity(name, pack)).not.toThrow();
  });

  it('is asserting against BOTH locales, not one repeated', () => {
    // The guard on the guard. `assertLocaleParity` compares shapes, so a pack
    // whose `en-US` value WAS its `pt-BR` value would sail through it — and a
    // suite built on it alone would report a finished translation.
    expect([...LOCALES]).toEqual(['pt-BR', 'en-US']);
    expect(ENTITLEMENTS_MESSAGES['en-US']).not.toEqual(ENTITLEMENTS_MESSAGES['pt-BR']);
    expect(RBAC_MESSAGES['en-US']).not.toEqual(RBAC_MESSAGES['pt-BR']);
  });

  it('exports the matcher a host needs to trust a tag off the wire', () => {
    // The one function every adopter calls on unvalidated input, reachable from
    // the ROOT entry rather than only from `./server`.
    expect(matchLocale('EN-us')).toBe('en-US');
    expect(matchLocale('  pt  ')).toBe('pt-BR');
    expect(matchLocale('')).toBeNull();
    expect(matchLocale(undefined)).toBeNull();
  });
});
