/**
 * The pure readings both halves answer from a validated config, and the
 * deep freeze both apply to it.
 */
import type { TenantCopyPack, TenantCoreConfig, TenantRefusalCodes } from './config';

/** Which refusal a code is, by the host's own codes. */
export type TenantRefusalKind = keyof TenantRefusalCodes;

/** `T` with every nested object and array read-only; functions are left as they are. */
export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer E)[]
    ? readonly DeepReadonly<E>[]
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;

/**
 * A frozen COPY of the plain data in `value`: objects and arrays are copied
 * and frozen at every depth, functions are kept as they are. The host's own
 * objects are never frozen in place, and a change it makes to them after
 * startup does not reach the validated config.
 */
export function frozenCopy<T>(value: T): DeepReadonly<T> {
  if (Array.isArray(value)) return Object.freeze(value.map((item: unknown) => frozenCopy(item))) as DeepReadonly<T>;
  if (typeof value !== 'object' || value === null) return value as DeepReadonly<T>;
  const copy = Object.fromEntries(
    Object.entries(value).map(([key, child]: [string, unknown]) => [key, frozenCopy(child)]),
  );
  return Object.freeze(copy) as DeepReadonly<T>;
}

/** What both factories hand back on top of their own half. */
export interface TenantReadings<S extends string> {
  /** True only for the statuses the package acts on: active, closing, closed and `closableFrom`. */
  isLifecycleStatus(status: string): status is S;
  /** True when a close may start from `status` (`statuses.closableFrom`). */
  isClosableFrom(status: string): status is S;
  /** The copy pack for a locale tag, or the default locale's when none matches. */
  copyFor(locale: string | null | undefined): TenantCopyPack;
  /** Which refusal a code from the API is, or null when it is none of the package's. */
  refusalKind(code: string): TenantRefusalKind | null;
}

export function createReadings<S extends string>(
  config: DeepReadonly<TenantCoreConfig<S>>,
): TenantReadings<S> {
  const { statuses } = config;
  const closable = new Set<string>(statuses.closableFrom);
  const lifecycle = new Set<string>([statuses.active, statuses.closing, statuses.closed, ...closable]);
  const byCode = new Map<string, TenantRefusalKind>(
    (Object.entries(config.ids.refusals) as [TenantRefusalKind, string][]).map(([kind, code]) => [code, kind]),
  );
  const { locales, defaultLocale } = config.copy;
  return {
    isLifecycleStatus: (status: string): status is S => lifecycle.has(status),
    isClosableFrom: (status: string): status is S => closable.has(status),
    copyFor: (locale) =>
      (locale !== null && locale !== undefined && Object.hasOwn(locales, locale)
        ? locales[locale]
        : locales[defaultLocale]) as TenantCopyPack,
    refusalKind: (code) => byCode.get(code) ?? null,
  };
}
