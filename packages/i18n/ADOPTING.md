# Adopting `@12-apps/i18n`

The locale axis for packages whose copy is already the host's.

Every package here states the sentences it renders as required, typed config
with no defaults, and ships a named pack per language. That interface **is** the
translation schema — a second language is a second value satisfying it. What was
missing was the axis: something to say *which* language, resolved once per
reader, in a shape nineteen packages agree on.

## What a package ships

A locale pack, exported from `./locales`, keyed by BCP-47 tag:

```ts
// packages/<name>/src/locales/index.ts
import type { DiscountsWebCopy } from '../react/copy';
import { PT_BR_DISCOUNTS_WEB_COPY } from './pt-BR';
import { EN_US_DISCOUNTS_WEB_COPY } from './en-US';

/**
 * Structural mirror of `@12-apps/i18n`'s `LocalePack`. Declared locally rather
 * than imported so this package keeps no dependency on it — see below.
 */
type LocalePack<T> = { readonly 'pt-BR': T; readonly 'en-US': T };

export const DISCOUNTS_WEB_COPY = {
  'pt-BR': PT_BR_DISCOUNTS_WEB_COPY,
  'en-US': EN_US_DISCOUNTS_WEB_COPY,
} as const satisfies LocalePack<DiscountsWebCopy>;
```

**A package does not import this one.** `@12-apps/payments-*` is forbidden from
importing a sibling workspace package at all (`payments/no-host-imports`), and
every package here is meant to be liftable into a repo that has never heard of
`@12-apps/i18n`. A shared *type* that forced a shared *dependency* would spend
the portability the copy port bought. The one-line local mirror gives the same
key-checking; `scripts/locale-coverage-gate.mjs` checks the two agree by tag.

The existing `PT_BR_*` exports stay exactly where they were. A host passing one
by hand keeps working, unchanged, forever — the pack is additive.

## What a host does

**One audience.** Nothing changes. Keep passing the named pack:

```ts
copy: PT_BR_DISCOUNTS_SERVER_COPY,
```

**Two audiences, chosen per request.** Pass a resolver instead of a value, and
let the package ask for the sentence when it needs it:

```ts
import { localeCopy } from '@12-apps/i18n';
import { DISCOUNTS_SERVER_COPY } from '@12-apps/discounts/server/locales';

copy: localeCopy(DISCOUNTS_SERVER_COPY),
```

**In the browser**, mount the provider once, above everything:

```tsx
import { DEFAULT_LOCALE, LocaleProvider } from '@12-apps/i18n/react';

<LocaleProvider locale={DEFAULT_LOCALE}>{app}</LocaleProvider>
```

`useLocale` **throws** outside a provider rather than assuming a language, for
the reason the copy port exists: a language reached by saying nothing is the one
that ships to the wrong audience unnoticed. A host keeping Portuguese names
`DEFAULT_LOCALE` — one reviewable line, never a silence.

Then read a pack anywhere below it:

```tsx
const copy = useLocaleCopy(DISCOUNTS_WEB_COPY);
```

**On the server**, resolve once per request and put it in scope:

```ts
import { resolveLocale } from '@12-apps/i18n';
import { localeFromRequest } from '@12-apps/i18n/server';

const locale = resolveLocale({
  explicit: localeFromRequest(request),
  user: session?.locale,
  tenant: tenant.defaultLocale,
  acceptLanguage: request.headers.get('accept-language'),
});
```

The precedence is the package's, not the caller's — explicit, then the reader's
own setting, then the tenant's, then the browser's guess, then
`DEFAULT_LOCALE` — so two hosts cannot disagree about it. An unrecognised tag at
any level **falls through** to the next rather than resolving to the default: a
stale `es-AR` on a user row must not out-rank a tenant that says `en-US`.

## Formatting is a second axis, and it is not language

`createFormats` takes the locale **and** the currency, separately and on
purpose. An English-reading admin of a Brazilian store still sees BRL. The
currency has no default because a currency guessed from a language is a wrong
*price*, which is the only error here that costs money rather than clarity.

```ts
const formats = createFormats({ locale, currency: 'BRL' });
formats.money(123456);        // R$ 1.234,56  /  R$1,234.56
formats.parseDecimal('12,5'); // 12.5 — the separator is read from Intl, not assumed
```

Parsing is the half that gets forgotten: a form takes what the operator typed,
in their own notation, and `Number("12,5")` is `NaN`.

## Proving a translation is complete

TypeScript refuses a *missing* key — the packs are typed against one interface.
Three things it does not refuse, and all three are what a half-finished
translation looks like: an optional key present in one locale only, a nested
object stubbed `{}`, and an interpolating function whose translation dropped a
parameter. One assertion covers all three:

```ts
import { assertLocaleParity } from '@12-apps/i18n/testing';

it('speaks both languages the same way', () => {
  assertLocaleParity('DISCOUNTS_WEB_COPY', DISCOUNTS_WEB_COPY);
});
```

And repo-wide, `pnpm quality:locales` fails any package that ships one language
and not the other. Packages mid-port carry a line in `.locale-coverage.json`;
that ledger only ever shrinks.
