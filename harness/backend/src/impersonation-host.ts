/**
 * Everything `@12-apps/impersonation` needs from a HOST, in one object.
 *
 * What is genuinely the host's, and all that is here: who is calling (a
 * header-driven session stand-in — a browser cannot have a real one), the
 * cipher the cookie is sealed with, which of this app's URLs are money and
 * which are somebody's own account, how long a session may last, what its
 * sentences say, and where the trail goes. Everything else — the codec's
 * refusals, the branch order of the write gate, the three verbs, the banner and
 * the dialog — is the package's, which is the entire claim under test.
 *
 * The vocabulary below is the harness's own (branches, borrowers, loans, fines),
 * and that is deliberate: a host whose words the package could have guessed
 * would prove nothing about whether it guesses.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

import { Hono } from 'hono';
import type { Context, MiddlewareHandler } from 'hono';

import {
  impersonationManifest,
  impersonationPreviewManifest,
} from '@12-apps/impersonation/manifest';
import {
  impersonationPreviewServerManifest,
  impersonationServerManifest,
  type createWireApiImpersonation,
} from '@12-apps/impersonation/manifest/server';
import {
  IMPERSONATION_PERMISSIONS,
  type ImpersonationCodec,
  type ImpersonationTarget,
  type ImpersonationTenant,
} from '@12-apps/impersonation';
import {
  ImpersonationRefusedError,
  type ImpersonationActor,
  type ImpersonationAuditPort,
  type ImpersonationDirectory,
  type ImpersonationMessages,
  type ImpersonationServerConfig,
  type ImpersonationStartEntry,
} from '@12-apps/impersonation/server';

import type { MountedRoute } from '@12-apps/wiring';
import { createWiringHost, type WiringReport } from '@12-apps/wiring/consumer';

import {
  DIRECTORY_PORT,
  IMPERSONATION_TENANTS,
  resolveActor,
  revoked,
  stillAuthorized,
} from './impersonation-directory';
import { harnessLoggerFor, honoRouterFor } from './wire-hono';

/** Where the shared session surface is mounted. Read by the SPA too. */
export const IMPERSONATION_PLATFORM_PATH = '/api/desk-session';

/** The tenant preview mount, as a template the SPA rebuilds per branch. */
export const impersonationTenantPath = (slug: string): string =>
  `/api/admin/${slug}/desk-session`;

/**
 * An authenticated cipher, which is what the package asks a host for.
 *
 * AES-256-GCM: the authentication tag IS the signature check, so a payload that
 * was edited, truncated or minted under a different key fails to decrypt. A real
 * adopter passes whatever it already uses to round-trip values that must come
 * back untampered; the harness derives a key from a fixed passphrase because it
 * is a fixture and its cookies never outlive a run.
 */
function harnessCodec(): ImpersonationCodec {
  const key = scryptSync('harness-desk-sessions', 'harness-salt', 32);
  return {
    encrypt(plaintext) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const sealed = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return [iv, cipher.getAuthTag(), sealed]
        .map((part) => part.toString('base64url'))
        .join('.');
    },
    decrypt(ciphertext) {
      const [iv, tag, sealed] = ciphertext.split('.');
      if (!iv || !tag || !sealed) throw new Error('malformed');
      const decipher = createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(iv, 'base64url'),
      );
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(sealed, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    },
  };
}

/** The harness's own sentences. Nothing in the package supplies these. */
const MESSAGES: ImpersonationMessages = {
  machineTokenRefused: 'An integration key cannot open a desk session.',
  notAuthorized: 'Desk sessions are for library staff.',
  actorNotRecorded: 'Your staff record is incomplete, so nothing could be logged.',
  targetIsPlatformAdmin:
    'A system librarian may not be opened from the desk — the log could not say who did what.',
  targetNotFound: 'No such borrower.',
  notAMember: 'This person is not registered at this branch.',
  alreadyImpersonating: 'Close the open desk session before starting another.',
  tenantNotFound: 'No such branch.',
  invalidBody: 'The request could not be read.',
  readOnly: 'This desk session can only look, not change.',
  transactionBlocked: 'Loans and fines are never settled from a desk session.',
  accountBlocked: "A borrower's own details are theirs to change.",
  revoked: 'Desk sessions were switched off for this branch while yours was open.',
};

/** The trail, in memory — the harness's stand-in for an append-only table. */
export interface ImpersonationTrail {
  started: ImpersonationStartEntry[];
  ended: unknown[];
  refused: unknown[];
}

/** A denial the harness's own entitlement toggle raises. */
class BranchDeskSessionsOff extends Error {}

/**
 * WHERE THIS APP'S OWN SURFACES ARE — the four tables the write gate consults.
 *
 * The package has no idea, and a default here would be somebody else's URL
 * layout. The `moneyReads` entries are anchored to the whole pathname, so an
 * entry never carries its children in with it.
 */
const PATHS = {
  money: [/^\/api\/loans(\/|$)/, /^\/api\/fines(\/|$)/],
  moneyReads: [/^\/api\/loans$/, /^\/api\/fines$/],
  account: [/^\/api\/borrower-profile(\/|$)/],
  session: [
    new RegExp(`^${IMPERSONATION_PLATFORM_PATH}$`),
    /^\/api\/admin\/[^/]+\/desk-session$/,
  ],
};

export type HarnessImpersonation = ReturnType<typeof impersonationHost>;

/** The tenant PREVIEW mount, as the adoption names it. */
export const IMPERSONATION_TENANT_MOUNT = '/api/admin/:tenantSlug/desk-session';

/**
 * The config both mounts take — the host's whole half, unchanged by the
 * adoption. Extracted so the binder below reads as the wiring it is.
 *
 * `resolveActor` is NOT in here any more. Under the contract, who is calling is
 * the BRIDGE's answer (the same seam every other adopted surface uses), and the
 * package reads it off `request.actor`. That is one resolution rather than two,
 * which matters on this surface more than on most: a mount and a write gate
 * that disagreed about the caller would gate one identity's writes while
 * minting for another.
 */
function impersonationConfig(deps: {
  audit: ImpersonationAuditPort;
  entitled: Set<string>;
}): ImpersonationServerConfig {
  return {
    cookieName: 'harness_desk_session',
    // The harness is served over plain HTTP; a real deploy answers `true`.
    secure: false,
    codec: harnessCodec(),
    // The library closes the desk after a shift, and a look is much shorter.
    timeBox: { operator: 30 * 60 * 1000, preview: 10 * 60 * 1000 },
    paths: PATHS,
    directory: DIRECTORY_PORT,
    audit: deps.audit,
    mintPolicy: {
      targetApps: ['counter', 'catalogue'],
      reasonLength: { min: 15, max: 280 },
    },
    previewPermission: IMPERSONATION_PERMISSIONS.preview,
    previewEntitlement: {
      require: async (tenantId) => {
        if (!deps.entitled.has(tenantId)) throw new BranchDeskSessionsOff();
      },
      isDenial: (error) => error instanceof BranchDeskSessionsOff,
      denialResponse: () => ({
        status: 409,
        message: 'Desk sessions are switched off for this branch.',
      }),
    },
    messages: MESSAGES,
    stillAuthorized,
  };
}

/** One package's mounted routes, out of an aggregate carrying two. */
const routesOf = (routes: readonly MountedRoute[], name: string): readonly MountedRoute[] =>
  routes.filter((mounted) => mounted.packageName === name);

/**
 * The two mounts, adopted through `@12-apps/wiring/consumer`.
 *
 * TWO adoptions, because the package ships two manifests — and that is a
 * PRIVILEGE SPLIT rather than bookkeeping. The operator mount answers to
 * platform authority and carries no slug; the preview mount is slug-scoped and
 * gated on the caller's permissions in that tenant. One binding would hand this
 * host a single `mountPath` for two mounts that must sit behind different
 * gates, and a version bump could then widen the tenant mount with a platform
 * row nobody re-reviewed. Two manifests make that impossible to express, and
 * the aggregate still reports both.
 *
 * The `e2e` world is DECLINED here and answered by the web harness, whose
 * `playwright.config.ts` already reads `impersonationFeatures`,
 * `impersonationFeaturesRoot` and `impersonationSteps` off the package. The
 * declaration is the point of that capability rather than a formality: a
 * shipped world nobody adopts is a few hundred lines of journeys re-derived by
 * hand in a host, undiscovered.
 */
export function impersonationHost() {
  const trail: ImpersonationTrail = { started: [], ended: [], refused: [] };
  /** Which branches currently allow desk sessions — the harness's own switch. */
  const entitled = new Set<string>(IMPERSONATION_TENANTS.map((tenant) => tenant.id));

  const audit: ImpersonationAuditPort = {
    started: async (entry) => void trail.started.push(entry),
    ended: async (entry) => void trail.ended.push(entry),
    refused: async (entry) => void trail.refused.push(entry),
  };

  const config = impersonationConfig({ audit, entitled });
  const host = createWiringHost({
    name: 'harness-backend',
    kind: 'server',
    // The port behind both manifests' mandatory namespace — they share it
    // (`impersonation`), because a refusal on either mount is one story.
    ports: { loggerFor: harnessLoggerFor },
  });

  host.adoptServer({
    manifest: impersonationManifest,
    server: impersonationServerManifest,
    e2e: { declined: 'the journeys drive screens — the web harness answers for the world' },
    bindings: { http: { mountPath: IMPERSONATION_PLATFORM_PATH, config } },
  });
  host.adoptServer({
    manifest: impersonationPreviewManifest,
    server: impersonationPreviewServerManifest,
    bindings: { http: { mountPath: IMPERSONATION_TENANT_MOUNT, config } },
  });

  const wired = host.assemble();
  // The gate, the codec and `readState` are the rest of the api and stay a
  // LIBRARY: the write gate runs in front of every route in this app, most of
  // which have nothing to do with this package, so it could never have come off
  // a mount. `wired.http[name]` keeps them beside the routes instead of
  // rebuilding the surface — two codecs over one cookie is two answers to
  // "whose session is this".
  const surface = wired.http[impersonationManifest.name] as ReturnType<
    typeof createWireApiImpersonation
  >;

  return {
    report: wired.report,
    routes: wired.routes,
    platform: honoRouterFor(routesOf(wired.routes, impersonationManifest.name), resolveActor),
    tenant: honoRouterFor(routesOf(wired.routes, impersonationPreviewManifest.name), resolveActor),
    writeGate: writeGate(surface),
    trail,
    revoke(userId: string, value: boolean): void {
      if (value) revoked.add(userId);
      else revoked.delete(userId);
    },
    reset(): void {
      revoked.clear();
      trail.started.length = 0;
      trail.ended.length = 0;
      trail.refused.length = 0;
      entitled.clear();
      for (const tenant of IMPERSONATION_TENANTS) entitled.add(tenant.id);
    },
    setEntitled(tenantId: string, value: boolean): void {
      if (value) entitled.add(tenantId);
      else entitled.delete(tenantId);
    },
  };
}

/**
 * The per-request gate, as middleware — where a host puts it.
 *
 * In front of EVERY `/api` route and before any body is read, so a blocked route
 * answers the same 403 whatever the payload looks like and no handler side
 * effect can precede the check. It short-circuits on the cookie header, so
 * traffic that is not impersonated pays a substring test and nothing else.
 */
function writeGate(surface: ReturnType<typeof createWireApiImpersonation>): MiddlewareHandler {
  return async (c, next) => {
    const cookie = readCookie(c, 'harness_desk_session');
    if (!cookie) return next();
    const impersonation = surface.readState({ actor: resolveActor(c), cookieValue: cookie });
    try {
      await surface.guard.assertAllowed({
        impersonation,
        pathname: new URL(c.req.url).pathname,
        method: c.req.method.toUpperCase(),
      });
    } catch (error) {
      if (!(error instanceof ImpersonationRefusedError)) throw error;
      return c.json({ error: error.message, code: error.code }, 403);
    }
    return next();
  };
}

/** One cookie off the raw header, tolerating a value that contains `=`. */
function readCookie(c: Context, name: string): string | undefined {
  const header = c.req.header('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const entry = part.trim();
    const eq = entry.indexOf('=');
    if (eq > 0 && entry.slice(0, eq) === name) return entry.slice(eq + 1);
  }
  return undefined;
}
