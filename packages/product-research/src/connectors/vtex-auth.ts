import { credentialsOf } from '../integrations';
import type { SourceRecord } from '../types';
import type { FetchInit } from './types';

/**
 * The OPTIONAL application key a VTEX source may run under (FUT-520): the
 * `appKey`/`appToken` pair a store issues inside its OWN admin, scoped by
 * License Manager roles, and sent as the two headers VTEX documents.
 *
 * WHAT THIS IS NOT — and the PR must not imply otherwise: it is not the fix for
 * a store that refuses us at its edge. Measured on Atacadão: the identical URL
 * with our exact production User-Agent answers 308 → 206 with ten real products
 * from a different IP, while the droplet is refused in 197ms at the FIRST hop —
 * and the refused endpoint is `/api/catalog_system/PUB/…`, which needs no
 * authentication at all, so the decision is made before any credential is read.
 * No header lifts it. The value is operational: a store that issues an
 * integration key usually also allowlists that integration, and the key is the
 * concrete artifact that makes the allowlist request possible. Read this ticket
 * as the Atacadão fix and the real investigation (egress IP / allowlist) gets
 * closed with the source still dead.
 *
 * The credential lives in HEADERS ONLY: never in `baseUrl` userinfo (refused at
 * the dialog by `./vtex-validate`), never in a query string, never in a stored
 * or rendered message — every sentence about it names the FIELD, never the
 * value. It is resolved ONCE per search so every tier sends the identical
 * object; a tier that built its own could silently be left unkeyed.
 */

/** The credential fields the write surface and the key dialog validate. */
export const VTEX_APP_KEY_FIELD = 'appKey';
export const VTEX_APP_TOKEN_FIELD = 'appToken';
export const VTEX_CREDENTIAL_FIELDS = [VTEX_APP_KEY_FIELD, VTEX_APP_TOKEN_FIELD] as const;

/** The headers VTEX authenticates an application key with. */
const APP_KEY_HEADER = 'X-VTEX-API-AppKey';
const APP_TOKEN_HEADER = 'X-VTEX-API-AppToken';

/** One store's application key, as VTEX issues it. */
export interface VtexAppCredentials {
  appKey: string;
  appToken: string;
}

/**
 * The source's application key, or `undefined` when it has none. A pair missing
 * — or blanking — either half is NO credential rather than a one-header
 * request: VTEX authenticates the two together, so a half-configured pair can
 * only produce a 403 that would then be misread as the store's own block.
 */
export const vtexCredentials = (
  source: Pick<SourceRecord, 'config'>,
): VtexAppCredentials | undefined => {
  const stored = credentialsOf(source);
  const appKey = (stored[VTEX_APP_KEY_FIELD] ?? '').trim();
  const appToken = (stored[VTEX_APP_TOKEN_FIELD] ?? '').trim();
  return appKey === '' || appToken === '' ? undefined : { appKey, appToken };
};

/**
 * The per-call init every tier of one search shares, or `undefined` for an
 * unkeyed source — whose requests must stay byte-identical to what they were
 * before this module existed.
 *
 * `credentialsRequired` states that the exchange is meaningless without these
 * headers, so the host aborts rather than continuing de-credentialed across a
 * redirect that changes host (see `FetchInit`). Without it a key configured on
 * an apex is dropped at the apex→www hop and the anonymous retry's refusal
 * looks exactly like the block this ticket is about.
 */
export const vtexAuthInit = (source: Pick<SourceRecord, 'config'>): FetchInit | undefined => {
  const credentials = vtexCredentials(source);
  if (credentials === undefined) return undefined;
  return {
    headers: {
      [APP_KEY_HEADER]: credentials.appKey,
      [APP_TOKEN_HEADER]: credentials.appToken,
    },
    credentialsRequired: true,
  };
};
