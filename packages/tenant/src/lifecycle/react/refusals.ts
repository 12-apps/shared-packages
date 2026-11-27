/**
 * How a host's app answers a closing tenant's refusals: the server's own
 * sentence, never a failure with a retry that can never work.
 *
 * - The read-only refusal (a write by a close-permission holder while the
 *   tenant is closing) raises ONE toast with the way to the close page, from
 *   the query client's global error hook ({@link RefusalReaders.interceptReadOnly})
 *   and from a one-time watch over the app's own writes
 *   ({@link RefusalReaders.watchReadOnlyWrites}).
 * - The closing / closed refusal on the app's first read: the gone screen,
 *   instead of a load failure ({@link RefusalReaders.closingRefusalOf}).
 *
 * Every code and path is the host's (`refusals`, `paths`).
 */
import type { TenantErrorAnswer, TenantToast } from './types';

/** Which closing refusal an answer is. */
export type TenantClosingRefusal = 'closing' | 'closed' | 'readOnly';

export interface TenantRefusalConfig {
  /** The host's refusal codes, as its API answers them in a 403 body's `code`. */
  refusals: { closing: string; closed: string; readOnly: string };
  paths: {
    /** The app's own path prefix, ending in `/` (`/app/`): a tenant's screens are `<app><slug>/…`. */
    app: string;
    /** The app's API prefix (`/api/app/`): only writes under it are watched. */
    api: string;
    /** The close page, under the tenant's own route, with no leading `/` (`settings/close`). */
    closePage: string;
  };
  errorAnswer: TenantErrorAnswer;
  toast: TenantToast;
  /** Leave for a full path of the app (`(path) => window.location.assign(path)`): the toast's way out and the switch. */
  navigate: (path: string) => void;
  /** The noun the host's test ids carry (`close-<word>-dialog`, `<word>-gone-screen`). */
  testIdWord: string;
}

export interface RefusalReaders {
  /** The closing refusal an error carries (a 403 whose body names one of the codes), or null. */
  closingRefusalOf(error: unknown): TenantClosingRefusal | null;
  /** The query client's global hook's half: a write refused read-only raises the one toast. */
  interceptReadOnly(error: unknown, words: { seeClosing: string }): void;
  /** Watch the app's own writes once, at boot, for the read-only refusal. Reads a CLONE; changes nothing. */
  watchReadOnlyWrites(words: () => { seeClosing: string }): void;
  /** Where "switch tenant" goes: the one other tenant, else the picker; null with none. */
  switchTarget(otherSlugs: readonly string[]): string | null;
  /** The close page of a tenant, as a full path. */
  closePagePath(slug: string): string;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

const WATCH_FLAG = '__tenantReadOnlyWatch';

export function makeRefusalReaders(config: TenantRefusalConfig): RefusalReaders {
  const { refusals, paths, toast } = config;
  const byCode = new Map<string, TenantClosingRefusal>([
    [refusals.closing, 'closing'],
    [refusals.closed, 'closed'],
    [refusals.readOnly, 'readOnly'],
  ]);
  const slugPattern = new RegExp(`${escapeRegExp(paths.app)}([^/]+)/`, 'u');
  const toastId = `${config.testIdWord}-read-only`;

  function refusalOfBody(body: unknown): TenantClosingRefusal | null {
    const code = typeof body === 'object' && body !== null ? (body as { code?: unknown }).code : undefined;
    return typeof code === 'string' ? (byCode.get(code) ?? null) : null;
  }

  const closePagePath = (slug: string) => `${paths.app}${slug}/${paths.closePage}`;

  /** The tenant slug of the app path the person is on, for the toast's way out. */
  function slugOnScreen(): string | null {
    return slugPattern.exec(`${window.location.pathname}/`)?.[1] ?? null;
  }

  function raiseReadOnly(message: string, words: { seeClosing: string }): void {
    const slug = slugOnScreen();
    toast(message, {
      id: toastId,
      severity: 'warning',
      duration: 8_000,
      dismissible: true,
      assertive: true,
      testId: `${config.testIdWord}-read-only-toast`,
      actions: slug ? [{ label: words.seeClosing, onClick: () => config.navigate(closePagePath(slug)) }] : undefined,
    });
  }

  function closingRefusalOf(error: unknown): TenantClosingRefusal | null {
    const answer = config.errorAnswer(error);
    if (answer === null || answer.status !== 403) return null;
    return refusalOfBody(answer.body);
  }

  return {
    closingRefusalOf,
    interceptReadOnly(error, words) {
      if (closingRefusalOf(error) !== 'readOnly') return;
      raiseReadOnly(error instanceof Error ? error.message : '', words);
    },
    watchReadOnlyWrites(words) {
      if (typeof window === 'undefined') return;
      const scope = window as unknown as Record<string, unknown>;
      if (scope[WATCH_FLAG] === true) return;
      scope[WATCH_FLAG] = true;
      const original = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const response = await original(input, init);
        const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
        if (response.status === 403 && method !== 'GET' && response.url.includes(paths.api)) {
          void response
            .clone()
            .json()
            .then((body: unknown) => {
              if (refusalOfBody(body) === 'readOnly') raiseReadOnly((body as { error?: string }).error ?? '', words());
            })
            .catch(() => undefined);
        }
        return response;
      };
    },
    switchTarget(otherSlugs) {
      if (otherSlugs.length === 0) return null;
      return otherSlugs.length === 1 ? `${paths.app}${otherSlugs[0]}` : paths.app;
    },
    closePagePath,
  };
}
