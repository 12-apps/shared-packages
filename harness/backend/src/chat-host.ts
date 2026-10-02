/**
 * The `@12-apps/chat` adoption, through the wiring consumer like the discounts
 * and shift surfaces beside it.
 *
 * What is genuinely the HOST's, and all that is here: what a thread is ABOUT
 * (this host's demo service requests), who is a party to which one and under
 * which role (`authorize`), what each role is called and may send (`roles`),
 * which words a refusal reads in (the package's en-US pack, passed by hand),
 * and where the rows live (the GENERATED Prisma client over the package's own
 * migration). Everything else — the write window check, the contact filter,
 * the rate limit, the read markers, the `{ data }` envelope and the rule that
 * no person id crosses the wire — is the package's, which is the claim under
 * test.
 *
 * ## The roster is real, and that is the point
 *
 * A harness whose `authorize` answered "yes, as whoever you said" would adopt
 * the surface and never exercise the one seam the package refuses to own: who
 * is IN a thread. So this host has a small roster of its own — two requests,
 * each with one requester and one field agent, plus a support team that reads
 * every request as one shared reader — and a caller who is none of those gets
 * the package's 404, exactly as a stranger would in a real adopter.
 *
 * ## The db is the generated client
 *
 * `ChatDb` is declared structurally so "a Prisma client carrying the chat
 * models satisfies it". The only way to check that promise from a consumer is
 * to hand the routes exactly that: the client `prisma generate` built from the
 * assembled partials, running over the tables the package's own migration
 * created. A hand-written stand-in would prove the shape of the port and
 * nothing about the partial.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PGlite } from '@electric-sql/pglite';
import { chatManifest } from '@12-apps/chat/manifest';
import { chatServerManifest } from '@12-apps/chat/manifest/server';
import {
  EN_US_CHAT_SERVER_COPY,
  type ChatAccess,
  type ChatDb,
  type ChatRefusalEvent,
  type ChatRequest,
  type ChatRoleConfig,
} from '@12-apps/chat/server';
import type { MountedRoute } from '@12-apps/wiring';
import { createWiringHost, type WiringReport } from '@12-apps/wiring/consumer';
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';

import type { HarnessPrismaClient } from './prisma';
import { harnessLoggerFor, honoRouterFor } from './wire-hono';

/** The package's own migrations, read out of its installed tarball. */
const MIGRATIONS_DIR = fileURLToPath(
  new URL('../node_modules/@12-apps/chat/prisma/migrations/', import.meta.url),
);

/** Where `mount-surfaces.ts` hangs the three routes — one thread per request. */
export const CHAT_MOUNT_PATH = '/api/admin/:tenantSlug/requests/:requestId/chat';

/** The tenant every demo request belongs to. Matches the frontend's tenant. */
export const CHAT_TENANT_ID = 'harness';

/**
 * The cookie this host resolves the caller from — its stand-in for a session.
 *
 * A cookie rather than a header because that is what the web surface's
 * "credentialed fetch" carries in a real adopter: the browser attaches it, so
 * the page hands the package a plain same-origin `fetch` and nothing else.
 */
export const CHAT_PERSON_COOKIE = 'harness_chat_person';

/** The roles a thread here may hold. Host vocabulary, in the host's words. */
export const CHAT_ROLES: Readonly<Record<'requester' | 'agent' | 'team', ChatRoleConfig>> = {
  requester: {
    label: 'Requester',
    shared: false,
    maxLength: 500,
    freeText: true,
    blockContact: [],
    quickReplies: [],
    rateLimit: { max: 30, windowMs: 60_000 },
  },
  // The role the contact filter exists for: a field agent may not hand the
  // requester a way around the platform.
  agent: {
    label: 'Field agent',
    shared: false,
    maxLength: 160,
    freeText: true,
    blockContact: ['phone', 'email', 'url', 'handle'],
    quickReplies: [
      { key: 'on-site', text: 'I am on site.' },
      { key: 'running-late', text: 'Running a few minutes late.' },
    ],
    rateLimit: { max: 30, windowMs: 60_000 },
  },
  // Everyone on the team speaks — and reads — as one.
  team: {
    label: 'Support team',
    shared: true,
    maxLength: 1000,
    freeText: true,
    blockContact: [],
    quickReplies: [],
    rateLimit: { max: 30, windowMs: 60_000 },
  },
};

/** The one id every team member's read marker moves. */
export const CHAT_TEAM_READER = 'support-team';

/** This host's people. Who they are is the host's; the package sees only roles. */
export const CHAT_PEOPLE = {
  requester: 'riley',
  agent: 'sam',
  team: ['taylor', 'jordan'],
  stranger: 'casey',
} as const;

interface DemoRequest {
  id: string;
  requester: string;
  agent: string;
  /** False once the work is done: the parties may read, not write. */
  open: boolean;
}

/** The subjects a thread can be about. Any other id is a 404, as in a real host. */
export const CHAT_REQUESTS: readonly DemoRequest[] = [
  { id: 'request-open', requester: CHAT_PEOPLE.requester, agent: CHAT_PEOPLE.agent, open: true },
  { id: 'request-done', requester: CHAT_PEOPLE.requester, agent: CHAT_PEOPLE.agent, open: false },
];

/** The caller, as this host's session layer resolves it. */
interface ChatActor {
  person: string;
}

/** Apply the published migrations, in name order — as a host deploy would. */
export async function applyChatMigrations(pg: PGlite): Promise<void> {
  const names = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  // Zero would leave every request failing as "relation chat_threads does not
  // exist" rather than as the packaging mistake it is.
  if (names.length === 0) throw new Error(`No chat migrations at ${MIGRATIONS_DIR}`);
  for (const name of names) {
    await pg.exec(readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf-8'));
  }
}

/** Back to no threads at all — the `/__harness/reset` contract. */
export async function reseedChat(pg: PGlite, chat: HarnessChat): Promise<void> {
  // Children first: markers and messages reference the thread row.
  await pg.exec(`
    DELETE FROM chat_read_markers;
    DELETE FROM chat_messages;
    DELETE FROM chat_threads;
  `);
  chat.refusals.length = 0;
}

/** Which role `person` holds on `request`, or null when they are not a party. */
function roleOf(request: DemoRequest, person: string): keyof typeof CHAT_ROLES | null {
  if (person === request.requester) return 'requester';
  if (person === request.agent) return 'agent';
  return (CHAT_PEOPLE.team as readonly string[]).includes(person) ? 'team' : null;
}

/**
 * The host's whole policy, per request: is this caller a party to the thread
 * the URL names, under which role, and may that role still write?
 *
 * A closed request leaves its parties read-only and the team able to answer —
 * a write window is exactly the kind of rule the package refuses to guess.
 */
export async function authorizeChat(request: ChatRequest<ChatActor>): Promise<ChatAccess | null> {
  if (request.params['tenantSlug'] !== CHAT_TENANT_ID) return null;
  const subject = CHAT_REQUESTS.find((entry) => entry.id === request.params['requestId']);
  if (!subject) return null;
  const role = roleOf(subject, request.actor.person);
  if (role === null) return null;
  return {
    tenantId: CHAT_TENANT_ID,
    threadKey: `request:${subject.id}`,
    role,
    authorId: request.actor.person,
    readerId: role === 'team' ? CHAT_TEAM_READER : request.actor.person,
    canWrite: subject.open || role === 'team',
  };
}

/** The session lookup: the cookie, or no caller at all (the bridge's 401). */
function chatActorOf(c: Context): ChatActor | null {
  const person = getCookie(c, CHAT_PERSON_COOKIE);
  return person ? { person } : null;
}

export interface HarnessChat {
  router: ReturnType<typeof honoRouterFor>;
  report: WiringReport;
  routes: readonly MountedRoute[];
  /**
   * Every send the content rules refused, as `onRefused` reported it — the
   * host's view of who keeps trying. An array here; a moderation table in a
   * real adopter.
   */
  refusals: ChatRefusalEvent[];
}

export function chatHost(prisma: HarnessPrismaClient): HarnessChat {
  const logger = harnessLoggerFor(chatManifest.observability.namespace);
  const refusals: ChatRefusalEvent[] = [];
  const host = createWiringHost({
    name: 'harness-backend',
    kind: 'server',
    ports: { loggerFor: harnessLoggerFor },
  });
  host.adoptServer({
    manifest: chatManifest,
    server: chatServerManifest,
    bindings: {
      http: {
        mountPath: CHAT_MOUNT_PATH,
        config: {
          // The generated client carries the chat models; the seam is
          // structural, so the cast is the only line this host owes it.
          db: () => prisma as unknown as ChatDb,
          authorize: authorizeChat,
          roles: CHAT_ROLES,
          // Passed BY HAND — choosing English is a reviewable line here.
          copy: EN_US_CHAT_SERVER_COPY,
          onRefused: (event: ChatRefusalEvent) => {
            refusals.push(event);
          },
          onError: (error: unknown, context: { readonly hook: string }) =>
            logger.error(`chat ${context.hook} failed`, error),
        },
      },
    },
  });
  const wired = host.assemble();
  return {
    router: honoRouterFor(wired.routes, chatActorOf),
    report: wired.report,
    routes: wired.routes,
    refusals,
  };
}
