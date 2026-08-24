/**
 * The realtime surface's HOST half (12-16) — the glue a real adopter writes, and nothing
 * more: who is calling, which tenant a slug resolves to, and where the outbox rows live.
 *
 * Everything else — `?topics=` parsing, the SSE wire, the ticket mint, the connection cap,
 * the driver, the outbox drain — is the package's.
 *
 * ## Why the authorize seam here is deliberately opinionated
 *
 * It is not a stub that says yes. The one property the whole design turns on is that a
 * client cannot be served a topic the host did not resolve, and a permissive seam would
 * make every spec in `tests/realtime-endpoints.test.ts` vacuous. So this host implements
 * the shape the origin host has: a tenant resolved from the PATH, a caller resolved from the
 * request, per-domain read tiers, and a kitchen qualifier the caller must have reach for.
 */
import type { PGlite } from '@electric-sql/pglite';
import type { Hono } from 'hono';
import { tenantTopic, userTopic, type RealtimeDriver } from '@12-apps/realtime';
import { realtimeManifest } from '@12-apps/realtime/manifest';
import {
  realtimeServerManifest,
  type createWireApiEvents,
} from '@12-apps/realtime/manifest/server';
import {
  EventsDenial,
  PT_BR_EVENTS_MESSAGES,
  type EventsServerConfig,
  type EventsTopicSpec,
  type RealtimeOutbox,
} from '@12-apps/realtime/server';
import type { BoundJob, MountedRoute } from '@12-apps/wiring';
import { createWiringHost, type WiringReport } from '@12-apps/wiring/consumer';

import { realtimeOutboxDrainDb } from './realtime-db';
import type { SqlRunner } from './rbac-db-shared';
import { harnessLoggerFor, honoRouterFor } from './wire-hono';

/**
 * The ticket secret BOTH halves use.
 *
 * A literal, and shared deliberately: the API signs with it and the gateway verifies with
 * it, and a mismatch is the one failure mode that shows up as every socket being refused
 * with no other symptom. A real deployment configures `REALTIME_TICKET_SECRET` in both
 * processes; the harness runs them in one, so one constant is the honest equivalent.
 */
export const HARNESS_TICKET_SECRET = 'harness-realtime-secret';

/**
 * Where `mount-surfaces.ts` hangs the surface — the adoption's claim, and the
 * prefix the report names. The descriptors' own paths already carry the rest
 * (`/admin/:tenantSlug/realtime`, `/account/realtime`), because a realtime
 * surface's path is the HOST's configuration rather than the package's
 * convention.
 */
export const REALTIME_MOUNT_PATH = '/api';

/** The harness's two tenants, by slug — a real host reads its own table. */
const TENANTS: Record<string, string> = {
  'loja-a': 'tenant-a',
  'loja-b': 'tenant-b',
};

/** One caller of the harness surface, and its reach. */
interface HarnessActor {
  userId: string;
  /** Which tenants this caller belongs to. */
  tenants: readonly string[];
  /** Domains this caller may read at those tenants. */
  domains: readonly string[];
  /** Kitchen stations this caller may watch; `"all"` is the class tier. */
  stations: readonly string[] | 'all';
}

const ACTORS: Record<string, HarnessActor> = {
  owner: {
    userId: 'user-owner',
    tenants: ['tenant-a'],
    domains: ['kitchen', 'orders', 'tables'],
    stations: 'all',
  },
  // A station-scoped cook: may watch the kitchen, but only the station they hold.
  cook: {
    userId: 'user-cook',
    tenants: ['tenant-a'],
    domains: ['kitchen'],
    stations: ['station-1'],
  },
  // A member of the OTHER store — the cross-tenant probe.
  outsider: {
    userId: 'user-outsider',
    tenants: ['tenant-b'],
    domains: ['kitchen', 'orders', 'tables'],
    stations: 'all',
  },
};

/** The subscribable domains, and which of them may carry a qualifier. */
const DOMAINS = ['kitchen', 'orders', 'tables'] as const;
const QUALIFIED_DOMAINS = ['kitchen'] as const;

/**
 * Who the caller is: a header the backend suite sets, or a cookie the BROWSER sets.
 *
 * Both, and the cookie is not a convenience. `EventSource` cannot set a header at all — that
 * is the whole reason the SSE endpoint authorizes itself while the WebSocket needs a signed
 * ticket — so a browser spec can only present an identity the way a real deployment does: a
 * cookie the request carries by itself. A header-only seam here would have every stream from
 * the SPA answer 401 and the page would sit `unavailable` reporting nothing, which is
 * precisely how a harness ends up proving that the degraded path works.
 *
 * Neither present is still UNAUTHENTICATED. The harness must not default to a caller.
 */
function actorOf(request: Request | undefined): HarnessActor | null {
  const name = request?.headers.get('x-harness-actor') ?? actorCookie(request);
  return ACTORS[name] ?? null;
}

/** The `harness-actor` cookie's value, or `''`. */
function actorCookie(request: Request | undefined): string {
  const header = request?.headers.get('cookie') ?? '';
  const match = /(?:^|;\s*)harness-actor=([^;]*)/.exec(header);
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

/** The tenant id for a slug, or `null` — resolved from the PATH, never from the query. */
function tenantIdOf(slug: string | undefined): string | null {
  return (slug && TENANTS[slug]) || null;
}

/**
 * May this caller watch ONE requested spec?
 *
 * Extracted from `authorize` because the two questions are different: the seam above decides
 * WHO and WHICH STORE, this decides WHAT — and the kitchen's qualifier check is the reason
 * `qualifiedDomains` lists that domain at all. A class-tier caller watches any station,
 * including the unqualified firehose; an instance-tier one must NAME a station they hold, and
 * the firehose is refused outright because it is the class tier by another name.
 */
function assertMayWatch(actor: HarnessActor, spec: EventsTopicSpec): void {
  if (!actor.domains.includes(spec.domain)) {
    throw new EventsDenial(403, `Sem permissão para o tópico: ${spec.domain}.`);
  }
  if (spec.domain !== 'kitchen' || actor.stations === 'all') return;
  const [station, ...rest] = spec.qualifiers;
  if (station === undefined || rest.length > 0 || !actor.stations.includes(station)) {
    throw new EventsDenial(403, `Sem permissão para o tópico: ${spec.domain}.`);
  }
}

/**
 * Everything the package's factory takes: the host's own half of the surface,
 * unchanged by the adoption. Extracted so the binder below reads as the wiring
 * it is — and so both stay inside the size gate.
 *
 * `driver` is passed IN rather than resolved from the environment, and that is what lets the
 * gateway share this bus: `configureRealtime` installs one driver per process, so handing the
 * same object to both halves means a publish on the API side is observed by a subscription the
 * gateway made. Two separately-resolved inline drivers would each be their own bus, and the
 * socket would sit open and silent — the failure the liveness watch exists to catch.
 */
function eventsConfig(
  driver: RealtimeDriver,
  drainDb: ReturnType<typeof realtimeOutboxDrainDb>,
): EventsServerConfig {
  return {
    // The wire sentences are the HOST's now (realtime requires them); this
    // harness host already speaks pt-BR in its own authorize refusals below,
    // so it passes the pack — the same one line a real host writes.
    messages: PT_BR_EVENTS_MESSAGES,
    driver,
    ticketSecret: HARNESS_TICKET_SECRET,
    installSignalHooks: false,
    outbox: { db: () => drainDb },
    surfaces: [
      {
        name: 'admin',
        path: '/admin/:tenantSlug/realtime',
        domains: [...DOMAINS],
        qualifiedDomains: [...QUALIFIED_DOMAINS],
        authorize: async ({ params, specs, request }) => {
          const tenantId = tenantIdOf(params.tenantSlug);
          if (!tenantId) throw new EventsDenial(404, 'Loja não encontrada.');
          const actor = actorOf(request);
          if (!actor) throw new EventsDenial(401, 'Não autenticado.');
          // The cross-tenant refusal, and the reason a slug can never be smuggled: the
          // tenant comes from the path and the membership from the actor.
          if (!actor.tenants.includes(tenantId)) {
            throw new EventsDenial(403, 'Sem acesso a esta loja.');
          }

          for (const spec of specs) assertMayWatch(actor, spec);

          return {
            subjectId: tenantId,
            // RESOLVED here, from ids the host resolved: the client never influences the
            // tenant segment.
            topics: specs.map((spec) => tenantTopic(tenantId, spec.domain, ...spec.qualifiers)),
          };
        },
      },
      {
        name: 'account',
        path: '/account/realtime',
        domains: ['notifications', 'consent'],
        authorize: async ({ specs, request }) => {
          const actor = actorOf(request);
          if (!actor) throw new EventsDenial(401, 'Não autenticado.');
          // The subject IS the caller: there is no id in the path and nothing here a caller
          // could point at somebody else.
          return {
            subjectId: actor.userId,
            topics: specs.map((spec) => userTopic(actor.userId, spec.domain)),
          };
        },
      },
    ],
  };
}

/**
 * How long a PUBLISHED outbox row survives before the purge blueprint removes
 * it. The HOST's number — retention is storage policy, and the package says so
 * where it leaves the field open. A week, which is ADOPTING.md's own example.
 */
const OUTBOX_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** The package's whole server surface, plus the router this host mounts. */
export type HarnessEvents = Omit<ReturnType<typeof createWireApiEvents>, 'routes'> & {
  router: Hono;
};

export interface RealtimeHost {
  events: HarnessEvents;
  /** The db the enqueue side writes through, for the suite's own transactions. */
  drainDb: ReturnType<typeof realtimeOutboxDrainDb>;
  report: WiringReport;
  routes: readonly MountedRoute[];
  /** The package's OWN blueprints — the drain and the purge — bound to this host. */
  jobs: readonly BoundJob[];
}

/**
 * The surface, adopted through `@12-apps/wiring/consumer`.
 *
 * The package anticipated this: `manifest/server` ships `createWireApiEvents`,
 * a WIRE VIEW that renames the descriptors' `kind` to the contract's
 * `transport` and forwards the raw request, "changing nothing else". So the
 * host's ONE bridge serves these routes the way it serves every other adopted
 * surface, and `@12-apps/realtime/hono` — a whole adapter this host no longer
 * needs — stops being on the import list.
 *
 * Two things about this surface the earlier adoptions never exercised, and both
 * are the reason the bridge was fixed BEFORE this file was touched:
 *
 * - a subscribe route answers the RAW arm of `WireRouteAnswer` — a live SSE
 *   body — and an adapter that runs that through `c.json` produces a request
 *   that never completes;
 * - a POST `…/ticket` carries no body the bridge must invent, but it does need
 *   the raw `Request`: the authorize seam above reads the caller out of a
 *   COOKIE, which is the only identity `EventSource` can present.
 *
 * The `jobs` half is bound rather than declined. The package moved the drain's
 * ten-second cadence and the purge's daily pattern into the blueprints because
 * both are claims about ITS domain, and it states what a host that cannot
 * repeat sub-minute must do instead: decline in writing. Vitest can repeat at
 * any cadence — the harness runs a pass on demand — so declining here would be
 * a fiction, and binding is what puts the blueprints under test at all.
 */
export function realtimeHost(pg: PGlite, driver: RealtimeDriver): RealtimeHost {
  const drainDb = realtimeOutboxDrainDb(pg as unknown as SqlRunner);
  // The outbox instance belongs to the ASSEMBLED api, and the jobs binding is
  // written before assemble — so the deps reach for it late. A second
  // `createRealtimeOutbox` over the same rows would be a second drain claiming
  // the same events, which is the one thing the claim-by-UPDATE design exists
  // to make impossible to need.
  const outbox: { current: RealtimeOutbox | null } = { current: null };
  const requireOutbox = (): RealtimeOutbox => {
    if (!outbox.current) throw new Error('realtime outbox is not configured');
    return outbox.current;
  };

  const host = createWiringHost({
    name: 'harness-backend',
    kind: 'server',
    // The port behind the manifest's mandatory namespace: "a refused ticket or
    // a failed drain files under `realtime`, not nowhere."
    ports: { loggerFor: harnessLoggerFor },
  });

  host.adoptServer({
    manifest: realtimeManifest,
    server: realtimeServerManifest,
    // The first `env` answer in this host, and a DECLINE with the reason
    // written out — because every one of the six vars is answered by CONFIG
    // here instead. The driver is passed in as an object (`REALTIME_DRIVER`,
    // `REDIS_URL`), the ticket secret is the literal both halves share
    // (`REALTIME_TICKET_SECRET`), the cap is left at the package's default,
    // and the two `worker`-scoped gateway vars are `server.ts`'s constants:
    // this harness runs the API and the gateway in ONE process, and a
    // process that read them from the ambient environment would be a
    // harness whose result depends on the shell that started it.
    //
    // Handing `process.env` over instead would report `0/6 vars set` and
    // read as a host that simply has not configured realtime yet. It has —
    // in the line above.
    env: {
      declined:
        'every declared var is supplied as configuration by this host: the driver object and ticket secret in eventsConfig, the gateway port in server.ts. The harness runs both processes in one and must not read the ambient environment.',
    },
    bindings: {
      http: { mountPath: REALTIME_MOUNT_PATH, config: eventsConfig(driver, drainDb) },
      jobs: {
        deps: {
          outbox: {
            drain: () => requireOutbox().drain(),
            purgePublished: (olderThanMs: number) => requireOutbox().purgePublished(olderThanMs),
          },
          purgeRetentionMs: OUTBOX_RETENTION_MS,
        },
      },
    },
  });

  const wired = host.assemble();
  const api = wired.http[realtimeManifest.name] as ReturnType<typeof createWireApiEvents>;
  outbox.current = api.outbox;

  return {
    drainDb,
    report: wired.report,
    routes: wired.routes,
    jobs: wired.jobs,
    events: {
      ...api,
      // No actor: this surface authorizes ITSELF, per topic, inside the
      // package's `authorize` seam — which is the property the whole design
      // turns on. A bridge-level 401 would answer before that seam ran, so an
      // unauthenticated request would get the bridge's refusal instead of the
      // surface's, and every per-topic denial above would become unreachable.
      router: honoRouterFor(wired.routes, () => REALTIME_CALLER),
    },
  };
}

/**
 * The sentinel the bridge treats as "there is a caller". Frozen and shared: it
 * carries nothing, because nothing downstream reads it — the wire view drops
 * the contract's `actor` field on the way to `EventsRoute.handle`.
 */
const REALTIME_CALLER = Object.freeze({});
