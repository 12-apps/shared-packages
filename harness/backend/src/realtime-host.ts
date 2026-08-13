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
 * the shape future-pay has: a tenant resolved from the PATH, a caller resolved from the
 * request, per-domain read tiers, and a kitchen qualifier the caller must have reach for.
 */
import type { PGlite } from '@electric-sql/pglite';
import { tenantTopic, userTopic, type RealtimeDriver } from '@12-apps/realtime';
import { eventsRouter, type EventsHono } from '@12-apps/realtime/hono';
import { EventsDenial, type EventsTopicSpec } from '@12-apps/realtime/server';

import { realtimeOutboxDrainDb } from './realtime-db';
import type { SqlRunner } from './rbac-db-shared';

/**
 * The ticket secret BOTH halves use.
 *
 * A literal, and shared deliberately: the API signs with it and the gateway verifies with
 * it, and a mismatch is the one failure mode that shows up as every socket being refused
 * with no other symptom. A real deployment configures `REALTIME_TICKET_SECRET` in both
 * processes; the harness runs them in one, so one constant is the honest equivalent.
 */
export const HARNESS_TICKET_SECRET = 'harness-realtime-secret';

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

export interface RealtimeHost {
  events: EventsHono;
  /** The db the enqueue side writes through, for the suite's own transactions. */
  drainDb: ReturnType<typeof realtimeOutboxDrainDb>;
}

/**
 * `driver` is passed IN rather than resolved from the environment, and that is what lets the
 * gateway share this bus: `configureRealtime` installs one driver per process, so handing the
 * same object to both halves means a publish on the API side is observed by a subscription the
 * gateway made. Two separately-resolved inline drivers would each be their own bus, and the
 * socket would sit open and silent — the failure the liveness watch exists to catch.
 */
export function realtimeHost(pg: PGlite, driver: RealtimeDriver): RealtimeHost {
  const drainDb = realtimeOutboxDrainDb(pg as unknown as SqlRunner);

  const events = eventsRouter({
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
  });

  return { events, drainDb };
}
