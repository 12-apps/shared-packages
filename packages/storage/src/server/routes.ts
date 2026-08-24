import { CONTENT_TYPE_BY_EXTENSION, acceptedContentTypeOf } from '../content-types';
import { parseObjectMemberKey } from '../keys';
import { STORAGE_PATHS } from '../paths';
import { isStorageProblem, type StorageMessageContext, type StorageMessages } from '../problems';
import type { StorageDriver } from './driver';
import { readBodyCapped } from './read-body';
import { storeImage, type StoreImageDeps } from './store-image';

/**
 * The endpoints, as framework-neutral descriptors. There are exactly two, and
 * neither hands a caller an address to upload to.
 *
 *   POST <mount>/uploads/image      the ONE way a browser stores bytes
 *   GET  <mount>/uploads/local/…    how an object is read back
 *
 * ## Why one POST, and why never a presigned URL
 *
 * An earlier contract had the browser ask for an ADDRESS and then PUT to it. Two
 * requests — and the key had to be minted at the first, before anybody had seen
 * the bytes, which means PREDICTING whether crops will exist. The prediction
 * needed flags and special cases to stay true and a 422 for when it did not.
 *
 * The obvious form of that second hop is a presigned bucket URL, and it is the
 * one thing this package must never offer. A `PUT` with a `Content-Type` is never
 * a "simple" request, so the browser sends an `OPTIONS` preflight; a freshly
 * created bucket answers it with 403 and no `Access-Control-Allow-*`, and the
 * upload is never sent. THE SERVER SEES NOTHING — no request, no log line, no
 * error rate. The browser cannot say why, because a blocked cross-origin fetch is
 * deliberately indistinguishable from an offline network. And the person who sees
 * the message is a store owner, about a bucket only an operator can configure.
 *
 * One same-origin POST removes the second hop, the prediction and the CORS class
 * together. It is also the only shape that CAN work now: a stored photo is a set
 * of objects the server derives from the bytes, so an upload the server never
 * sees cannot produce one.
 */

/**
 * Who is calling — resolved by the HOST and never computed here.
 *
 * `mayUpload` is one boolean on purpose. Two independent questions feed it —
 * "may this person store objects?" (roles, memberships, plan) and "may this
 * SESSION change anything?" (a read-only impersonation, a maintenance mode) — and
 * both are the host's, answered before it delegates. A package that tried to
 * compute either would be wrong for every host but the first.
 */
export interface StorageActor {
  /** The tenant whose objects this call may touch — the key's scope segment. */
  scope: string;
  mayUpload: boolean;
}

export interface StorageRouteContext {
  actor: StorageActor | null;
  params: Record<string, string | undefined>;
  request: Request;
  /**
   * The language to answer in — the same field `@12-apps/wiring`'s
   * `WireRequest` carries, mirrored here because this surface builds its own
   * context. Populated by the host's adapter; absent is not an error.
   */
  locale?: string;
}

/** A JSON answer, an object's bytes, or a redirect to where the object lives. */
export type StorageRouteResponse =
  | { status: number; body: unknown }
  | { status: number; bytes: Uint8Array; headers: Record<string, string> }
  | { status: number; redirect: string };

export interface StorageRoute {
  method: 'GET' | 'POST';
  /** Path suffix, relative to the mount. */
  path: string;
  /** `actor` routes answer 401 before the handler runs; `public` ones do not. */
  auth: 'actor' | 'public';
  /**
   * The path ends in a catch-all whose whole remainder is the `key` param. An
   * adapter spells that its own way; the descriptor says only that it is there.
   */
  wildcardParam?: 'key';
  handle(context: StorageRouteContext): Promise<StorageRouteResponse>;
}

interface RoutesDeps extends Omit<StoreImageDeps, "messages"> {
  driver: StorageDriver;
  /**
   * The factory, unresolved, plus the limit it needs. Resolving into a value
   * here is what would re-freeze the language into the mount — this object is
   * built once, per process.
   */
  messages: (context: StorageMessageContext) => StorageMessages;
  limit: string;
}

/** Keys are content-addressed (a uuid), so an object may be cached forever. */
const IMMUTABLE = 'public, max-age=31536000, immutable';

async function handleUpload(
  deps: RoutesDeps,
  context: StorageRouteContext,
): Promise<StorageRouteResponse> {
  const actor = context.actor;
  if (!actor?.mayUpload) {
    // Stays a CODE, unlike the refusals below, and deliberately: `mayUpload` is the
    // host's own boolean, so the package cannot phrase WHY without asserting a role
    // model it does not have. The browser half owns that sentence and lets the host
    // override it (`WebStorageMessages.forbidden`).
    return { status: 403, body: { error: 'forbidden' } };
  }
  // Worded HERE, per request, from the tag the adapter put on the context —
  // never at the mount, which ran once at boot.
  const messages = deps.messages({ limit: deps.limit, locale: context.locale });
  const contentType = acceptedContentTypeOf(context.request.headers.get('content-type'));
  if (!contentType) {
    return { status: 400, body: { error: messages.unsupported_content_type } };
  }
  // Capped WHILE STREAMING, so an oversize body is refused without ever being
  // held whole in memory.
  const bytes = await readBodyCapped(context.request, deps.maxBytes);
  if (bytes === null) {
    // The configured SENTENCE, not the code `file_too_large`. These two refusals
    // are decided before the write path runs, so they used to be the only ones the
    // endpoint stated as a bare code — and the browser then re-derived the number
    // from its OWN default. A mount capped at 4 MB refusing a 6 MB file produced
    // "o limite é 8 MB": a ceiling nothing enforced, in the one package whose
    // headline claim is that there is exactly ONE number. The sentence is built
    // from this mount's `maxBytes` and carries this mount's `messages` overrides.
    return { status: 413, body: { error: messages.file_too_large } };
  }
  try {
    // No byte check here: `storeImage` owns it, so the endpoint and a host write
    // holding raw bytes cannot disagree about whether it ran (see store-image.ts).
    const imageKey = await storeImage({ ...deps, messages }, { bytes, contentType, scope: actor.scope });
    return { status: 200, body: { data: { imageKey } } };
  } catch (error) {
    // The write path speaks in StorageProblemError precisely so both entrances
    // answer with the same status and the same sentence.
    if (isStorageProblem(error)) {
      return { status: error.status, body: { error: error.message } };
    }
    throw error;
  }
}

/**
 * Serve a stored object, or send the caller where it actually lives.
 *
 * Which of the two applies is read off the DRIVER — a driver that holds its own
 * bytes implements `read`, a bucket-backed one does not. That used to be an
 * environment flag consulted inside the route, i.e. the same fact recorded in a
 * second place where it could disagree with the driver in use.
 *
 * The redirect is not a nicety: a consumer may still be asking for this route
 * after a switch to a bucket — a cached page, a storefront bundle mid-deploy that
 * fell back to the bare key — and a 404 there is a catalog full of broken images.
 */
async function handleServe(
  deps: RoutesDeps,
  context: StorageRouteContext,
): Promise<StorageRouteResponse> {
  const key = context.params.key ?? '';
  const member = parseObjectMemberKey(key, deps.keyPrefix);
  if (!member || !(member.extension in CONTENT_TYPE_BY_EXTENSION)) {
    return { status: 400, body: { error: 'invalid_key' } };
  }
  if (!deps.driver.read) {
    const url = deps.driver.publicUrl(key);
    // `publicUrl` may answer a relative path on a misconfigured driver, and a
    // redirect to one loops back here forever. 404 instead — the same answer the
    // object being absent gives.
    return /^https?:\/\//i.test(url)
      ? { status: 302, redirect: url }
      : { status: 404, body: { error: 'not_found' } };
  }
  const object = await deps.driver.read(key);
  if (!object) return { status: 404, body: { error: 'not_found' } };
  return {
    status: 200,
    bytes: object.bytes,
    headers: { 'content-type': object.contentType, 'cache-control': IMMUTABLE },
  };
}

export function storageRoutes(deps: RoutesDeps): readonly StorageRoute[] {
  return [
    {
      method: 'POST',
      path: STORAGE_PATHS.upload,
      auth: 'actor',
      handle: (context) => handleUpload(deps, context),
    },
    {
      method: 'GET',
      path: STORAGE_PATHS.serve,
      // Objects are world-readable by design — a store's logo is printed in its
      // own storefront HTML — and the key is an unguessable uuid path. Gating the
      // read would mean every `<img>` in a public storefront carried a session.
      auth: 'public',
      wildcardParam: 'key',
      handle: (context) => handleServe(deps, context),
    },
  ];
}
