import type { JSX, ReactNode } from "react";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

import {
  createLocalHost,
  createSharedWorkerHost,
  type ChannelHost,
  type WorkerConnector,
} from "./channel-host";
import { SubscriptionRegistry, type SubscriptionHandle } from "./subscription-registry";
import type {
  RealtimeMessage,
  RealtimeStatus,
  RealtimeTransportConfig,
  WireSourceFactory,
} from "./types";

/**
 * `createWebEvents` — the event system's BROWSER half as one factory (12-16).
 *
 *     const events = createWebEvents({ apiBase: "/api" });
 *
 *     // in the shell, once
 *     <events.Provider endpoint={events.tenantEndpoint(slug)}>…</events.Provider>
 *     <events.UserProvider>…</events.UserProvider>
 *
 *     // in a screen
 *     const { status } = events.useTopics({ topics: ["kitchen"], onMessage: invalidate });
 *     useQuery({ …, refetchInterval: reconcileRefetchInterval(status, POLL, RECONCILE) });
 *
 * What is INSIDE: the wire, the reconnect policy and its jitter, the ws→sse demotion,
 * the liveness watch, the ticket handshake, the union across screens and (optionally)
 * across tabs, and the routing of an event back to the screens that asked for it.
 *
 * What stays the HOST's: where the API is mounted, and — if it wants the cross-tab
 * optimisation — a two-line worker module its own bundler can emit.
 *
 * ## Two providers, not one
 *
 * The scope of a subscription is a property of its ENDPOINT — tenant-scoped topics are
 * authorized against a tenant, user-scoped ones against a session — so one provider per
 * endpoint is the honest arrangement, and an app that talks to both mounts both.
 * Collapsing them would mean one route authorizing both scopes at once, which buys one
 * connection at the cost of putting two authorization models in one place.
 *
 * The two contexts are created PER FACTORY CALL rather than at module scope, so two
 * `createWebEvents` in one app (two API bases, a nested embed) cannot see each other's
 * providers.
 *
 * ## The scope is in the TYPE of the hook, never in a string
 *
 * `useTopics` reads the tenant context and `useUserTopics` the user one. One shared
 * context would resolve to whichever provider happened to be nearer in the tree — and
 * inside an admin app the nearer one is always the tenant provider, so a
 * user-scoped consumer would ask a store's endpoint for a user topic. That endpoint does
 * not serve it: the connection opens, reports itself live, and carries nothing.
 */

/** Default mount of the API this browser half talks to. */
const DEFAULT_API_BASE = "/api";

/**
 * Default paths of the two subscribe surfaces, relative to `apiBase`.
 *
 * These are future-pay's own spellings, so a host that mounts `createApiEvents` with the
 * matching surface paths configures nothing at all.
 */
const DEFAULT_TENANT_PATH = (tenantSlug: string): string =>
  `/admin/${encodeURIComponent(tenantSlug)}/realtime`;
const DEFAULT_USER_PATH = "/account/realtime";

export interface WebEventsConfig {
  /** Where the API is mounted. Default `/api`. */
  apiBase?: string;
  /**
   * The tenant-scoped surface's path, relative to `apiBase`. Must match the
   * `EventsSurfaceConfig.path` the server half was given, minus the API mount.
   */
  tenantPath?: (tenantSlug: string) => string;
  /** The user-scoped surface's path, relative to `apiBase`. */
  userPath?: string;
  /** Where the ws/ticket endpoints live, when they are not derived from the above. */
  transport?: RealtimeTransportConfig;
  /**
   * How to reach a SharedWorker, so one connection serves every tab of a person.
   *
   * Omitted by default, and that default is deliberate: emitting a worker chunk is the
   * HOST bundler's job (see `@12-apps/realtime/worker`). Without one the connection lives
   * in the page, which is fully functional — the worker is an optimisation.
   */
  connectWorker?: WorkerConnector;
}

export interface EventsProviderProps {
  /**
   * The subscribe endpoint, or `null` to keep realtime off entirely (no tenant resolved
   * yet). Descendants then report `disconnected` and keep polling, which is the same
   * degraded mode as a dead stream.
   */
  endpoint: string | null;
  children: ReactNode;
  /**
   * Test/transport seam — leave unset in app code.
   *
   * Passing one also forces the IN-PAGE host: a caller that supplies a wire is asking
   * for the connection to be here, where it can drive it.
   */
  createSource?: WireSourceFactory;
  /** Randomness for the reconnect jitter; injected by tests. */
  random?: () => number;
  /** Override the factory's worker connector for this subtree (tests). */
  connectWorker?: WorkerConnector;
}

export interface UseTopicsOptions {
  /**
   * Client-side topic specs, or `null` to want nothing — a screen whose permissions do
   * not reach any topic, which is a normal state and not an error. It contributes
   * nothing to the union and receives nothing.
   */
  topics: readonly string[] | null;
  /**
   * Called per event on one of `topics`. Reads the latest callback each event, so an
   * inline closure is fine and costs no re-registration.
   */
  onMessage?: (message: RealtimeMessage) => void;
}

export interface UseTopicsResult {
  status: RealtimeStatus;
  /** Sugar for `status === "connected"`. */
  connected: boolean;
  /**
   * Which arrangement is carrying this subscription, or `null` before the connection
   * exists. Present so a host can show it in a health readout — and so the consumer
   * harness can prove the SharedWorker path is really taken rather than assume it.
   */
  host: ChannelHost["kind"] | null;
}

export interface WebEvents {
  /** The TENANT-scoped connection: `tenant:<id>:<domain>` topics. */
  Provider(props: EventsProviderProps): JSX.Element;
  /**
   * The USER-scoped connection: `user:<userId>:<domain>` topics, on the one endpoint
   * that reads the session rather than a path.
   *
   * Mounted once per app, above the router. The endpoint takes no id and no `?topics=`
   * from the caller, so there is nothing to configure and nothing a host could get
   * wrong; `endpoint` stays overridable only for tests.
   */
  UserProvider(props: Partial<EventsProviderProps> & { children: ReactNode }): JSX.Element;
  useTopics(options: UseTopicsOptions): UseTopicsResult;
  useUserTopics(options: UseTopicsOptions): UseTopicsResult;
  /** The tenant surface's subscribe endpoint, without a topic list. */
  tenantEndpoint(tenantSlug: string): string;
  /** The user surface's subscribe endpoint. No id: the server reads the session. */
  userEndpoint(): string;
}

interface EventsContextValue {
  registry: SubscriptionRegistry;
  status: RealtimeStatus;
  host: ChannelHost["kind"] | null;
}

/** What a connection needs beyond the provider's own props. */
interface ConnectionConfig {
  transport?: RealtimeTransportConfig;
  connectWorker?: WorkerConnector;
}

/**
 * One connection and its registry, shared by both scopes.
 *
 * Module-scope so both providers use ONE implementation — everything about owning a
 * channel, coalescing the union and routing events is identical between them, and
 * duplicating it would be two places to fix a subscription bug.
 */
function useEventsConnection(
  options: Omit<EventsProviderProps, "children">,
  shared: ConnectionConfig,
): EventsContextValue {
  const { endpoint, createSource, random } = options;
  const connectWorker = options.connectWorker ?? shared.connectWorker;
  const [status, setStatus] = useState<RealtimeStatus>("disconnected");
  const [host, setHost] = useState<ChannelHost["kind"] | null>(null);
  const channelRef = useRef<ChannelHost | null>(null);
  const registry = useCoalescedRegistry(channelRef);

  useEffect(() => {
    if (!endpoint) {
      setStatus("disconnected");
      setHost(null);
      return undefined;
    }
    const handlers = {
      onMessage: (message: RealtimeMessage) => registry.deliver(message),
      onStatusChange: setStatus,
    };
    // The SharedWorker first, and only when nothing has asked for a specific wire:
    // `createSource` is an in-page seam, so a caller that passes one is asking for the
    // connection to be here where it can drive it.
    const channel =
      (createSource || !connectWorker
        ? null
        : createSharedWorkerHost(endpoint, handlers, connectWorker)) ??
      createLocalHost(endpoint, handlers, {
        transport: shared.transport,
        createSource,
        random,
      });
    channelRef.current = channel;
    setHost(channel.kind);
    // Adopt whatever is already registered: screens mount before this effect runs, and on
    // an endpoint change they never unmounted at all.
    channel.setTopics(registry.union);
    return () => {
      channelRef.current = null;
      channel.close();
    };
  }, [endpoint, createSource, connectWorker, random, registry, shared]);

  return useMemo(() => ({ registry, status, host }), [registry, status, host]);
}

/**
 * The registry, applying its union to the channel on a MICROTASK.
 *
 * The coalescing is load-bearing. Navigating unmounts the old screen and mounts the new
 * one in a single commit: React runs the cleanups first, so the union passes through EMPTY
 * on its way from one screen's topics to the next's. Applied inline that empty state
 * closes the connection and the next topic reopens it — precisely the churn this provider
 * exists to remove, reintroduced one layer up. Coalescing to the end of the commit means
 * the channel only ever sees where the union landed.
 *
 * The registry itself outlives every connection: screens register against the shell, and a
 * reconnect (or an endpoint change) must not make them re-register.
 */
function useCoalescedRegistry(
  channelRef: { current: ChannelHost | null },
): SubscriptionRegistry {
  return useMemo(() => {
    const pending = { scheduled: false };
    const registryRef: { current: SubscriptionRegistry | null } = { current: null };
    const instance = new SubscriptionRegistry(() => {
      if (pending.scheduled) return;
      pending.scheduled = true;
      queueMicrotask(() => {
        pending.scheduled = false;
        const union = registryRef.current?.union;
        if (union) channelRef.current?.setTopics(union);
      });
    });
    registryRef.current = instance;
    return instance;
  }, [channelRef]);
}

/** The registration itself, identical for both scopes. */
function useRegisteredTopics(
  context: EventsContextValue | null,
  options: UseTopicsOptions,
): UseTopicsResult {
  const registry = context?.registry ?? null;
  const status = context?.status ?? "disconnected";

  const onMessageRef = useRef(options.onMessage);
  onMessageRef.current = options.onMessage;

  // A stable key so an inline array literal does not re-register every render.
  const topics = options.topics;
  const key = topics === null ? null : [...topics].sort().join(",");

  // Registration is tied to the COMPONENT's life, not to the topic list's.
  // Re-registering on every change would release and re-add across a commit, and the union
  // would dip through a state this screen never asked for.
  const handleRef = useRef<SubscriptionHandle | null>(null);
  useEffect(() => {
    if (!registry) return undefined;
    const handle = registry.register({
      topics: [],
      onMessage: (message: RealtimeMessage) => onMessageRef.current?.(message),
    });
    handleRef.current = handle;
    return () => {
      handleRef.current = null;
      handle.release();
    };
  }, [registry]);

  useEffect(() => {
    handleRef.current?.update({
      topics: key ? key.split(",") : [],
      onMessage: (message: RealtimeMessage) => onMessageRef.current?.(message),
    });
  }, [key]);

  return { status, connected: status === "connected", host: context?.host ?? null };
}

export function createWebEvents(config: WebEventsConfig = {}): WebEvents {
  const apiBase = config.apiBase ?? DEFAULT_API_BASE;
  const tenantPath = config.tenantPath ?? DEFAULT_TENANT_PATH;
  const userPath = config.userPath ?? DEFAULT_USER_PATH;
  const shared: ConnectionConfig = {
    transport: config.transport,
    connectWorker: config.connectWorker,
  };

  const tenantEndpoint = (tenantSlug: string): string => `${apiBase}${tenantPath(tenantSlug)}`;
  const userEndpoint = (): string => `${apiBase}${userPath}`;

  // Per factory, not per module — see the header.
  const TenantContext = createContext<EventsContextValue | null>(null);
  const UserContext = createContext<EventsContextValue | null>(null);

  function Provider({ children, ...options }: EventsProviderProps): JSX.Element {
    const value = useEventsConnection(options, shared);
    return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
  }

  function UserProvider({
    children,
    endpoint = userEndpoint(),
    ...options
  }: Partial<EventsProviderProps> & { children: ReactNode }): JSX.Element {
    const value = useEventsConnection({ ...options, endpoint }, shared);
    return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
  }

  return {
    Provider,
    UserProvider,
    tenantEndpoint,
    userEndpoint,

    useTopics(options: UseTopicsOptions): UseTopicsResult {
      const context = useContext(TenantContext);
      if (!context) {
        // A tenant subscription is written by a screen inside an app that owns its shell,
        // so a missing provider is a wiring mistake worth shouting about.
        throw new Error(
          "useTopics needs the <Provider> from this createWebEvents(); mount one in the " +
            "app shell (or use useRealtime for a standalone channel)",
        );
      }
      return useRegisteredTopics(context, options);
    },

    useUserTopics(options: UseTopicsOptions): UseTopicsResult {
      // Unlike the tenant hook, a missing provider is NOT an error here, and the asymmetry
      // is deliberate: the user-scoped consumers (a notification bell, a consent dialog)
      // ship as components that mount in whatever host embeds them, and a host that has not
      // adopted the provider must keep working.
      //
      // It degrades to `disconnected`, which is the honest answer rather than a silent one:
      // every consumer reads that status and keeps its full-speed poll, exactly as it did
      // before realtime existed. Nothing reports itself live.
      const context = useContext(UserContext);
      return useRegisteredTopics(context, options);
    },
  };
}
