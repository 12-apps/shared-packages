/**
 * The shared port vocabulary — what a HOST provides once, for every adopted
 * package to use.
 *
 * A port is the consumer half of a capability a package REQUIRES (send this
 * mail, tell this user, defer this work), as opposed to the contribution
 * half it PROVIDES. Today each package that needs one either restates its
 * own interface (`EmailCredentialsMailer`), imports a heavy subpath for a
 * two-line type (`EmailDriver` out of `@12-apps/notifications/server`), or
 * has the host invent a bespoke callback at the mount (`notifyDispatched`).
 * One zero-dependency home ends the restating: packages type against these,
 * hosts implement each exactly once.
 *
 * Two rules, both inherited from the seams these twins come from:
 *
 * - `EmailPort.send` THROWS on failure — the caller owns retry, exactly as
 *   `EmailDriver` behaves under the notifications transport.
 * - `NotifyPort.emit` and `JobsEnqueuePort.enqueue` NEVER throw — a deferred
 *   side effect must not take down the request that scheduled it (the
 *   `enqueueJob` rule). Failure is an outcome, not an exception.
 *
 * The memory implementations are reference ports for tests — the same role
 * `createMemory*Store` plays in the packages that own storage seams.
 */

import type { EmailPort, WireEmailMessage } from "../contract/email";

export type { EmailPort, WireEmailMessage };

/** Who a notification is for: one user, or everyone holding a permission. */
export type NotifyRecipient =
  | { userId: string }
  | { tenantId: string; permission: string };

/** One domain event handed to the host's notification pipeline. */
export interface NotifyEvent<TPayload = unknown> {
  /** A type some notification blueprint declares (`order.paid`). */
  type: string;
  recipient: NotifyRecipient;
  payload: TPayload;
}

/** What happened to an emit. Never thrown. */
export interface NotifyOutcome {
  accepted: boolean;
  reason?: string;
}

/** Emit a notification event through the host's pipeline. Never throws. */
export interface NotifyPort {
  emit(event: NotifyEvent): Promise<NotifyOutcome>;
}

/** Twin of `@12-apps/jobs`' `JobLogger` / `createFeatureLogger` shape. */
export interface LoggerPort {
  info(message: string, ...meta: unknown[]): void;
  warn(message: string, ...meta: unknown[]): void;
  error(message: string, ...meta: unknown[]): void;
}

/** What happened to an enqueue — twin of `@12-apps/jobs`' `EnqueueResult`. */
export interface EnqueueOutcome {
  enqueued: boolean;
  reason?: string;
}

/**
 * Defer one job run by wire name. Never throws. The host binds this to its
 * jobs runtime; a package enqueues its own namespaced names through it.
 */
export interface JobsEnqueuePort {
  enqueue(
    name: string,
    payload: unknown,
    options?: { dedupeKey?: string },
  ): Promise<EnqueueOutcome>;
}

/** An injectable clock, for packages that take time as an argument. */
export interface ClockPort {
  now(): Date;
}

/**
 * The actor a host resolved for a request — the floor thirteen packages
 * currently duck-type for themselves. Packages needing more declare their
 * own extension of this shape; the port stays the host's ONE resolution
 * path, so impersonation ceilings and machine-token flags are applied in
 * a single place instead of once per package seam.
 */
export interface WireActor {
  id: string;
  /** The tenant the request is scoped to, when it is. */
  tenantId?: string;
  permissions?: readonly string[];
  /** A machine token, not a person — several packages refuse these writes. */
  isMachine?: boolean;
}

/**
 * Resolve who is calling. `null` means "nobody" — the caller turns that
 * into its 401; resolution failures THROW (a broken session store must not
 * masquerade as an anonymous request).
 */
export interface ActorPort<TActor = WireActor> {
  resolve(context: unknown): Promise<TActor | null>;
}

/** The user-directory row packages render (audit trails, team lists). */
export interface WireDirectoryUser {
  id: string;
  name: string;
  email?: string;
}

/**
 * Look users up in the host's directory. `getUsers` answers only the ids it
 * finds — a missing id is absent from the result, never an error, because
 * a departed teammate must not break the audit page that mentions them.
 */
export interface DirectoryPort {
  getUsers(ids: readonly string[]): Promise<readonly WireDirectoryUser[]>;
}

/** Everything a host offers its adopted packages, each optional. */
export interface WiringPorts {
  email?: EmailPort;
  notify?: NotifyPort;
  logger?: LoggerPort;
  /**
   * A namespace-scoped logger factory (`createFeatureLogger`-shaped). When a
   * manifest declares an `observability` namespace, the binder uses this to
   * build the package's logger; with only `logger` present it falls back to
   * prefixing the namespace onto each line.
   */
  loggerFor?: (namespace: string) => LoggerPort;
  jobs?: JobsEnqueuePort;
  clock?: ClockPort;
  actor?: ActorPort<never>;
  directory?: DirectoryPort;
}

/** One recorded email send. */
export interface RecordedEmail {
  to: string;
  message: WireEmailMessage;
}

/** An `EmailPort` that records instead of delivering — for tests. */
export function memoryEmailPort(): { port: EmailPort; sent: RecordedEmail[] } {
  const sent: RecordedEmail[] = [];
  return {
    sent,
    port: {
      send: (to, message) => {
        sent.push({ to, message });
        return Promise.resolve();
      },
    },
  };
}

/** A `NotifyPort` that records instead of dispatching — for tests. */
export function memoryNotifyPort(): { port: NotifyPort; events: NotifyEvent[] } {
  const events: NotifyEvent[] = [];
  return {
    events,
    port: {
      emit: (event) => {
        events.push(event);
        return Promise.resolve({ accepted: true });
      },
    },
  };
}

/** A `LoggerPort` that keeps its lines — for tests. */
export function memoryLogger(): { port: LoggerPort; lines: string[] } {
  const lines: string[] = [];
  const record = (level: string) => (message: string) => {
    lines.push(`${level} ${message}`);
  };
  return {
    lines,
    port: { info: record("info"), warn: record("warn"), error: record("error") },
  };
}

/** An `ActorPort` that always answers the given actor — for tests. */
export function memoryActorPort<TActor>(actor: TActor | null): ActorPort<TActor> {
  return { resolve: () => Promise.resolve(actor) };
}

/** A `DirectoryPort` over a fixed roster — for tests. */
export function memoryDirectoryPort(users: readonly WireDirectoryUser[]): DirectoryPort {
  return {
    getUsers: (ids) => Promise.resolve(users.filter((user) => ids.includes(user.id))),
  };
}
