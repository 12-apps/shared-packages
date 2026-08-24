/**
 * The reader's locale, put in scope once, and the copy that follows from it.
 *
 * Context rather than a prop for the same reason `@12-apps/ui`'s DataViews
 * family uses one: a language is a property of the whole tree, and threading it
 * through components that never mention a word is the prop-drilling context
 * exists to avoid. It also makes the switch free — changing the provider's
 * value re-renders every surface reading a pack, with no edit to any of them.
 *
 * {@link useLocale} THROWS outside a provider rather than assuming
 * {@link DEFAULT_LOCALE}. There is a defensible default and this is
 * deliberately not the place to apply it: a tree with no provider is a WIRING
 * mistake, and the whole argument of the copy port is that a language reached
 * by saying nothing is the one that ships to the wrong audience unnoticed. A
 * host keeping Portuguese writes `<LocaleProvider locale={DEFAULT_LOCALE}>` —
 * one reviewable line, never a silence.
 */
import { createContext, useContext, useMemo, type JSX, type ReactNode } from 'react';

import { createFormats, type FormatOptions, type Formats } from '../core/formats';
import { DEFAULT_LOCALE, type Locale } from '../core/locale';
import { selectCopy, type LocalePack } from '../core/pack';

const LocaleContext = createContext<Locale | null>(null);

export function LocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}): JSX.Element {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

/** The locale in scope. Throws outside a provider — see the module docstring. */
export function useLocale(): Locale {
  const locale = useContext(LocaleContext);
  if (!locale) {
    throw new Error(
      'useLocale must be called inside <LocaleProvider locale={…}>. ' +
        `@12-apps/i18n assumes no language; pass DEFAULT_LOCALE ('${DEFAULT_LOCALE}') to keep the current one.`,
    );
  }
  return locale;
}

/** One package's copy, in the locale in scope. */
export function useLocaleCopy<T>(pack: LocalePack<T>): T {
  return selectCopy(pack, useLocale());
}

/**
 * The formatters for the locale in scope, built once per (locale, currency).
 *
 * Memoised on the values rather than on the options object: a caller writing
 * `useFormats({ currency: 'BRL' })` inline passes a new object every render,
 * and a dependency on the object itself would rebuild four `Intl` formatters
 * on each one — which is the cost `createFormats` exists to pay once.
 */
export function useFormats(options: Omit<FormatOptions, 'locale'>): Formats {
  const locale = useLocale();
  const { currency, timeZone } = options;
  return useMemo(() => createFormats({ locale, currency, timeZone }), [locale, currency, timeZone]);
}
