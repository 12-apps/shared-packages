/**
 * The pure readings both halves answer from a validated config.
 */
import type { TenantCopyPack, TenantCoreConfig, TenantRefusalCodes } from './config';

/** Which refusal a code is, by the host's own codes. */
export type TenantRefusalKind = keyof TenantRefusalCodes;

/** What both factories hand back on top of their own half. */
export interface TenantReadings<S extends string> {
  /** True only for the three statuses the package acts on. */
  isLifecycleStatus(status: string): status is S;
  /** The copy pack for a locale tag, or the default locale's when none matches. */
  copyFor(locale: string | null | undefined): TenantCopyPack;
  /** Which refusal a code from the API is, or null when it is none of the package's. */
  refusalKind(code: string): TenantRefusalKind | null;
}

export function createReadings<S extends string>(config: TenantCoreConfig<S>): TenantReadings<S> {
  const lifecycle = new Set<string>([
    config.statuses.active,
    config.statuses.closing,
    config.statuses.closed,
  ]);
  const byCode = new Map<string, TenantRefusalKind>(
    (Object.entries(config.ids.refusals) as [TenantRefusalKind, string][]).map(([kind, code]) => [code, kind]),
  );
  const { locales, defaultLocale } = config.copy;
  return {
    isLifecycleStatus: (status: string): status is S => lifecycle.has(status),
    copyFor: (locale) =>
      (locale !== null && locale !== undefined && Object.hasOwn(locales, locale)
        ? locales[locale]
        : locales[defaultLocale]) as TenantCopyPack,
    refusalKind: (code) => byCode.get(code) ?? null,
  };
}
