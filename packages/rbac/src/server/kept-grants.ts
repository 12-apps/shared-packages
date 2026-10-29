import type { RbacDbProvider } from './db';
import {
  readEffectiveGrants,
  type RbacDeriveGrants,
  type RbacEffectiveGrantTable,
} from './effective-grants';
import { loadSubjectGrants } from './engine';
import { membershipRoleAt, nextGrantBoundary, type RbacGrantsPort, type RbacSubjectGrants } from './grants';

/**
 * A person's grants, kept in process memory after their first question and
 * dropped the moment the database says anything in them changed (FUT-3906,
 * moved here from the origin host by FUT-3985).
 *
 * ## Why process memory
 *
 * Invalidation comes from the database itself: the package's triggers call
 * `pg_notify('rbac_changed', <user id>)` after a change commits, and every
 * server process hears it on its own listening connection. So each process
 * keeps its own copy and drops its own, and a question reads nothing at all.
 * A shared cache would cost a round trip per question to save each process's
 * first read per person.
 *
 * ## Correct before fast
 *
 * - **Nothing is kept until the listener is up.** Without it no change could
 *   reach the copy, so every question loads. A listener that cannot start is
 *   tried again after {@link KeptGrantsOptions.retryMs}, not on every question.
 * - **A reconnect drops everything**, because a notification sent while the
 *   listener was down is lost.
 * - **A load a notification overtakes is not kept.** A generation per person,
 *   and an epoch for the whole map, are read before the load and compared
 *   after it, so a change committed during the load is never kept as current.
 * - **A backstop lifetime** bounds a delivery that never arrives. A resource
 *   grant whose window opens or closes sooner shortens it to that instant
 *   (`nextGrantBoundary`): the window passing is a change no write announces.
 *   The window itself is judged against the clock on every question, so an
 *   expired grant is not honoured even inside the lifetime.
 */

/** The channel the package's triggers notify on. */
export const RBAC_CHANGED_CHANNEL = 'rbac_changed';
/** The payload that means "everyone": a template role changed, or a TRUNCATE. */
export const RBAC_CHANGED_EVERYONE = '*';

const DEFAULT_BACKSTOP_MS = 10 * 60 * 1000;
const DEFAULT_RETRY_MS = 30 * 1000;
const DEFAULT_MAX_KEPT = 20_000;

/** What a listener reports back, the shape `LISTEN` helpers already have. */
export interface RbacChangeHandlers {
  onNotify: (payload: string) => void;
  /** The connection (re)connected: anything sent while it was down is lost. */
  onConnected: () => void;
  onError: (error: unknown) => void;
}

/** Start listening on a channel; resolves once the listener is up. */
export type RbacChangeListener = (channel: string, handlers: RbacChangeHandlers) => Promise<unknown>;

export interface KeptGrantsOptions {
  /** How a person's grants are loaded when nothing current is kept. */
  load: (subject: string) => Promise<RbacSubjectGrants>;
  listen: RbacChangeListener;
  /** Default {@link RBAC_CHANGED_CHANNEL}. */
  channel?: string;
  /** Default 10 minutes. */
  backstopMs?: number;
  /** After a listener failed to start, how long every question loads. Default 30 s. */
  retryMs?: number;
  /** A bound on the map, oldest dropped first. Default 20,000 people. */
  maxKept?: number;
  onError?: (message: string) => void;
}

export interface KeptGrants extends RbacGrantsPort {
  /** A person's grants, from memory when current. */
  grantsOf(subject: string): Promise<RbacSubjectGrants>;
  /** A person's membership role at a tenant — the audit's role stamp. */
  membershipRole(subject: string, clientId: string): Promise<string | null>;
  /** Tests: drop everything, and start the listener afresh. */
  reset(): void;
}

interface Kept {
  grants: RbacSubjectGrants;
  until: number;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The map, its generations and the listener — one instance per store. */
class KeptGrantsMemory {
  private readonly kept = new Map<string, Kept>();
  private readonly generations = new Map<string, number>();
  private readonly inFlight = new Map<string, Promise<RbacSubjectGrants>>();
  private epoch = 0;
  private listening: Promise<boolean> | null = null;
  private retryAfter = 0;

  constructor(private readonly options: KeptGrantsOptions) {}

  private report(message: string): void {
    this.options.onError?.(message);
  }

  private forgetEveryone(): void {
    this.epoch += 1;
    this.kept.clear();
    this.inFlight.clear();
  }

  private forget(payload: string): void {
    if (payload === RBAC_CHANGED_EVERYONE) {
      this.forgetEveryone();
      return;
    }
    this.generations.set(payload, (this.generations.get(payload) ?? 0) + 1);
    this.kept.delete(payload);
    this.inFlight.delete(payload);
  }

  /** Start the listener once. `false` while it is not up: then nothing is kept. */
  private ensureListening(): Promise<boolean> {
    if (this.listening) return this.listening;
    if (Date.now() < this.retryAfter) return Promise.resolve(false);
    const channel = this.options.channel ?? RBAC_CHANGED_CHANNEL;
    let started: Promise<unknown>;
    try {
      started = this.options.listen(channel, {
        onNotify: (payload) => this.forget(payload),
        onConnected: () => this.forgetEveryone(),
        onError: (error) => this.report(`[rbac-grants] listener dropped, reconnecting: ${errorText(error)}`),
      });
    } catch (error) {
      started = Promise.reject(error);
    }
    const up = started.then(
      () => true,
      (error: unknown) => {
        this.report(`[rbac-grants] cannot listen on ${channel}, keeping nothing: ${errorText(error)}`);
        if (this.listening === up) this.listening = null;
        this.retryAfter = Date.now() + (this.options.retryMs ?? DEFAULT_RETRY_MS);
        return false;
      },
    );
    this.listening = up;
    return up;
  }

  private keep(subject: string, grants: RbacSubjectGrants, loadedAt: number): void {
    const boundary = nextGrantBoundary(grants, new Date(loadedAt))?.getTime() ?? Number.POSITIVE_INFINITY;
    const backstop = loadedAt + (this.options.backstopMs ?? DEFAULT_BACKSTOP_MS);
    this.kept.delete(subject);
    this.kept.set(subject, { grants, until: Math.min(backstop, boundary) });
    if (this.kept.size > (this.options.maxKept ?? DEFAULT_MAX_KEPT)) {
      const oldest = this.kept.keys().next().value;
      if (oldest !== undefined) this.kept.delete(oldest);
    }
  }

  private async loadAndKeep(subject: string): Promise<RbacSubjectGrants> {
    const generation = this.generations.get(subject) ?? 0;
    const atEpoch = this.epoch;
    const loadedAt = Date.now();
    const grants = await this.options.load(subject);
    // Kept only if no notification for this person, or for everyone, arrived
    // while it loaded: otherwise it may predate the change.
    if (generation === (this.generations.get(subject) ?? 0) && atEpoch === this.epoch) {
      this.keep(subject, grants, loadedAt);
    }
    return grants;
  }

  async grantsOf(subject: string): Promise<RbacSubjectGrants> {
    if (!(await this.ensureListening())) return this.options.load(subject);
    const hit = this.kept.get(subject);
    if (hit && hit.until > Date.now()) return hit.grants;
    // One load for a burst of questions about the same person.
    const pending = this.inFlight.get(subject);
    if (pending) return pending;
    const loading = this.loadAndKeep(subject).finally(() => {
      if (this.inFlight.get(subject) === loading) this.inFlight.delete(subject);
    });
    this.inFlight.set(subject, loading);
    return loading;
  }

  reset(): void {
    this.kept.clear();
    this.generations.clear();
    this.inFlight.clear();
    this.epoch += 1;
    this.listening = null;
    this.retryAfter = 0;
  }
}

/**
 * The store over any loader. {@link createEffectiveGrantsStore} is the one a
 * host normally builds: this store over the effective-grants table.
 */
export function createKeptGrants(options: KeptGrantsOptions): KeptGrants {
  const memory = new KeptGrantsMemory(options);
  return {
    grantsOf: (subject) => memory.grantsOf(subject),
    // The engine's own loader reads the source tables; this store answers
    // through `options.load` instead, so every caller shares one copy.
    get: (subject) => memory.grantsOf(subject),
    membershipRole: async (subject, clientId) => membershipRoleAt(await memory.grantsOf(subject), clientId),
    reset: () => memory.reset(),
  };
}

export interface EffectiveGrantsStoreOptions extends Omit<KeptGrantsOptions, 'load'> {
  /** The host's RBAC database — the same provider its `RbacServerConfig.db` is. */
  db: RbacDbProvider;
  /** The `rbacEffectiveGrant` delegate of the same database. */
  table: RbacEffectiveGrantTable;
  /** Resource grants the host derives from its own tables at recompute time. */
  derive?: RbacDeriveGrants;
}

/**
 * THE store a host hands the engine as `RbacServerConfig.grants`: a person's
 * grants are one read of the effective-grants table on their first question,
 * a recompute through `loadSubjectGrants` when a trigger marked a row stale,
 * and nothing at all on every later question until a notification drops them.
 */
export function createEffectiveGrantsStore(options: EffectiveGrantsStoreOptions): KeptGrants {
  const { db, table, derive, ...kept } = options;
  return createKeptGrants({
    ...kept,
    load: (subject) =>
      readEffectiveGrants(
        {
          table,
          resolve: (person, now) => loadSubjectGrants({ db }, person, now),
          ...(derive ? { derive } : {}),
          ...(options.onError ? { onError: options.onError } : {}),
        },
        subject,
      ),
  });
}
