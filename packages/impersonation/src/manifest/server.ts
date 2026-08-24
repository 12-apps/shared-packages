/**
 * `@12-apps/impersonation/manifest/server` — the server capabilities.
 *
 * TWO manifests, one per mount, which is what the contract calls a privilege
 * split (payments-backend's merchant/buyer pair made the same call, and its
 * mount module argues the general case). The reason is specific here:
 *
 * - **`platform`** is the operator surface — start, stop and describe an
 *   impersonation. It carries no tenant slug and answers to platform
 *   authority alone.
 * - **`tenant`** is the preview mount, scoped by slug and gated on the
 *   caller's permissions in THAT tenant.
 *
 * One binding would hand a host one `mountPath` for two mounts that must sit
 * behind different gates — and a version bump could then widen the tenant
 * mount with a platform row nobody re-reviewed. Two manifests make that
 * impossible to express.
 *
 * `path: ''` is preserved verbatim: it means the mount ITSELF, because this
 * surface is three verbs on one resource. Assembled, `mountPath + ''` is
 * exactly the mount path, which is the URL the descriptors intend.
 *
 * THE COOKIE is why the raw answer half exists here. `ImpersonationResponse`
 * carries `{status, body, cookie?}`, and the cookie is part of the descriptor
 * precisely because a framework-neutral handler has no response object to set
 * it on — leaving it to each host to remember made "the session started but
 * the cookie never left" a per-adapter bug. Every attribute of it
 * (`httpOnly`, `sameSite`, `secure`, `path`, `maxAge`) is already the
 * package's decision, so serializing it is mechanism, not host policy: an
 * answer carrying one becomes a raw `Response` with `Set-Cookie` set, and an
 * answer without one stays `{status, body}` so the consumer's own primitives
 * shape it.
 */

import type { AnyServerManifest, WireRequest, WireRouteAnswer } from '@12-apps/wiring';

import type { ImpersonationCookie } from '../core/types';
import {
  createApiImpersonation,
  foldApiError,
  type ApiImpersonation,
  type ImpersonationRequest,
  type ImpersonationResponse,
  type ImpersonationRoute,
  type ImpersonationServerConfig,
  type ImpersonationSurface,
} from '../server';

/** `Set-Cookie` for one cookie instruction, attributes and all. */
export function serializeCookie(cookie: ImpersonationCookie): string {
  const { name, value, options } = cookie;
  const parts = [
    `${name}=${value}`,
    `Path=${options.path}`,
    `Max-Age=${options.maxAge}`,
    `SameSite=${options.sameSite === 'lax' ? 'Lax' : options.sameSite}`,
  ];
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

/** The descriptor's chosen answer, as the wiring contract carries it. */
export function asWireAnswer(answer: ImpersonationResponse): WireRouteAnswer {
  if (!answer.cookie) return { status: answer.status, body: answer.body };
  return {
    response: new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
      status: answer.status,
      headers: {
        'content-type': 'application/json',
        'set-cookie': serializeCookie(answer.cookie),
      },
    }),
  };
}

/** The value of ONE named cookie on a request, or undefined. */
export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const entry = part.trim();
    const eq = entry.indexOf('=');
    if (eq > 0 && entry.slice(0, eq) === name) return entry.slice(eq + 1);
  }
  return undefined;
}

/** One `ImpersonationRoute` as the wiring contract reads it. */
function asWireRoute(
  route: ImpersonationRoute,
  cookieName: string,
): {
  method: ImpersonationRoute['method'];
  path: string;
  handle(request: WireRequest): Promise<WireRouteAnswer>;
} {
  return {
    method: route.method,
    path: route.path,
    handle: async (request) =>
      asWireAnswer(
        await route
          .handle({
            actor: request.actor as ImpersonationRequest['actor'],
            params: request.params,
            body: request.body,
            // The SESSION cookie's value, not the whole header. The package owns
            // its own cookie name (`codec.cookieName`), so picking the entry out
            // is mechanism — a host that re-derives it is one rename away from
            // reading nothing and silently seeing no session.
            cookieValue: readCookie(request.request?.headers.get('cookie') ?? null, cookieName),
          })
          // EVERY refusal this surface makes is THROWN, not returned: the
          // lateral-move 403, the invalid-body 400, the unknown-tenant 404, the
          // machine-token refusal. `foldApiError` turns those back into the
          // status and sentence the package chose, and rethrows anything else.
          //
          // The `/hono` adapter has always done this. Leaving it out here made
          // the wire view answer correctly only on the happy path: a consumer's
          // bridge would see an exception where the contract promises an answer,
          // and the surface whose entire purpose is refusing would 500 on every
          // refusal while its successes looked fine.
          .catch(foldApiError),
      ),
  };
}

/** `createApiImpersonation`, narrowed to ONE mount's descriptors. */
function wireApiFor(surface: ImpersonationSurface) {
  return (
    config: ImpersonationServerConfig,
  ): Omit<ApiImpersonation, 'routes'> & { routes: ReturnType<typeof asWireRoute>[] } => {
    const api = createApiImpersonation(config);
    return {
      ...api,
      routes: api.routes
        .filter((route) => route.surface === surface)
        .map((route) => asWireRoute(route, api.codec.cookieName)),
    };
  };
}

export const createWireApiImpersonation = wireApiFor('platform');
export const createWireApiImpersonationPreview = wireApiFor('tenant');

/** The OPERATOR mount: start, stop and describe, behind platform authority. */
export const impersonationServerManifest = {
  name: '@12-apps/impersonation',
  http: { create: createWireApiImpersonation },
} as const satisfies AnyServerManifest;

/** The tenant PREVIEW mount: slug-scoped, gated on permissions in that tenant. */
export const impersonationPreviewServerManifest = {
  name: '@12-apps/impersonation-preview',
  http: { create: createWireApiImpersonationPreview },
} as const satisfies AnyServerManifest;
