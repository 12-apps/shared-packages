/**
 * Values read once per server process and kept until the database says they
 * changed: the memory behind slug resolution, and any other host reading that
 * is invalidated the same way.
 *
 * - **Invalidation comes from the database.** The host's triggers call
 *   `pg_notify(<channel>, <scope>)` after the write commits. The payload names
 *   the scope to drop (a tenant's id, say), or `*` for every scope. The
 *   package owns no trigger: it only listens, through the host's `listen`, on
 *   the channel it is given.
 * - **Nothing is kept while the listener is down**: a disconnect drops
 *   everything and keeps nothing until the reconnect, which drops everything
 *   again, because a notification sent while it was down is lost.
 * - **A load a notification overtakes is not kept**: the scope's epoch, and
 *   the epoch of every scope, are read before the load and compared after it.
 *   A drop of ANOTHER scope does not cost this one its load, so a busy tenant
 *   cannot keep a quiet one from being kept.
 * - **A backstop lifetime** bounds a delivery that never arrives.
 * - **A listener that cannot start** is tried again after a pause, not on every
 *   read: until then every read goes to the database.
 * - **One load for a burst** of reads of the same value.
 * - **A write this process made** can quiet the memory (`quiet`): on
 *   PostgreSQL the notification reaches the listener a moment after the
 *   writer's `COMMIT` returns, and the writer's own read-back must not be
 *   answered from the copy it is about to lose.
 *
 * A value is kept under a SCOPE (what one notification drops) and a SLOT (one
 * reader's answer within it), so a tenant's whole configuration goes in one
 * drop. What a reader keeps it gets back as it was kept: the caller copies, or
 * keeps a value it will not edit.
 *
 * Every number is the host's: nothing here has a default.
 */
import { validateKeptMemoryOptions } from './memory-options';

export { validateKeptMemoryOptions } from './memory-options';

/** Every scope, as a notification payload. */
export const EVERY_SCOPE = '*';

/** What the host's listener reports back: the shape `LISTEN` helpers already have. */
export interface TenantChangeHandlers {
  onNotify(payload: string): void;
  /** The connection (re)connected: anything sent while it was down is lost. */
  onConnected(): void;
  /** The connection dropped: nothing can reach the memory until `onConnected`. */
  onDisconnected?(): void;
  onError?(error: unknown): void;
}

/**
 * The host's `LISTEN`: start listening on `channel` and call `handlers` as the
 * database speaks. Resolves once the first connection is up (resolving counts
 * as connected); rejects when it cannot start.
 */
export type TenantChangeListener = (channel: string, handlers: TenantChangeHandlers) => Promise<unknown>;

/** What the memory reports when its listener fails: the host logs it in its own words. */
export interface KeptMemoryErrorEvent {
  /** `start`: the listener could not start, nothing is kept until a retry. `dropped`: it dropped and is reconnecting. */
  phase: 'start' | 'dropped';
  channel: string;
  error: unknown;
}

export interface KeptMemoryOptions {
  /** The `NOTIFY` channel the host's triggers send on (`/^[a-z_][a-z0-9_]*$/`). */
  channel: string;
  /** The host's `LISTEN`. */
  listen: TenantChangeListener;
  /** Told when the listener cannot start or drops. */
  onError(event: KeptMemoryErrorEvent): void;
  /** How long a kept value is trusted with no notification at all. */
  backstopMs: number;
  /** How long after a listener failed to start before it is tried again. */
  retryMs: number;
  /** A bound on the scopes kept, oldest dropped first. A dropped scope just loads again. */
  maxScopes: number;
  /** A bound on one scope's slots, oldest dropped first. */
  maxSlots: number;
  /**
   * The database the listener hears. Asked before every read, and a different
   * one than last time drops everything and listens afresh (a test that swaps
   * its in-process database must not be answered from the previous one). One
   * that throws means there is none to bind to: nothing is kept. Absent,
   * nothing is compared.
   */
  database?: () => object | null;
}

export interface KeptReadOptions<T> {
  /** Whether this answer may be kept. Every answer is, unless this says no. */
  keep?(value: T): boolean;
  /**
   * The client or transaction `load` reads through. A read joins a load
   * already running for the same slot only through the same one: a reader
   * inside a transaction must not wait on a load that, on a single
   * connection, waits for that transaction to end. A read through one never
   * starts the listener.
   */
  via?: object;
  /**
   * An epoch ({@link KeptMemory.epoch}) the answer must still be at to be
   * kept, older than the load's own: a snapshot transaction's, taken before
   * its snapshot was, so a change committed after the snapshot and heard
   * already is not kept as current.
   */
  since?: number;
}

export interface KeptMemory {
  /** The value `slot` of `scope` holds, from memory when kept, else from `load`. */
  read<T>(scope: string, slot: string, load: () => Promise<T>, options?: KeptReadOptions<T>): Promise<T>;
  /**
   * The value `slot` of `scope` holds when this process already kept it, else
   * `undefined`: never a load, never the listener's start. For a path that must
   * not pay a statement for what it can do without.
   */
  peek<T>(scope: string, slot: string): T | undefined;
  /**
   * Drop `scope` (every scope when absent) and keep nothing of it for `ms`:
   * this process just wrote what the memory holds, and the notification is
   * still on its way.
   */
  quiet(ms: number, scope?: string): void;
  /** Drop `scope` now, as a notification naming it would. */
  drop(scope: string): void;
  /** The count of drops so far: an answer is kept only if none happened since its read began. */
  epoch(): number;
  /** Tests only: start from an empty memory and a fresh listener. */
  resetForTests(): void;
}

/**
 * A memory kept by notification. Validates its options at once (a missing
 * one fails at startup, named); listens lazily, on the first read.
 */
export function createKeptMemory(options: KeptMemoryOptions): KeptMemory {
  validateKeptMemoryOptions(options);
  return new NotifiedMemory({ ...options });
}

interface Kept {
  value: unknown;
  until: number;
}

class NotifiedMemory implements KeptMemory {
  private readonly kept = new Map<string, Map<string, Kept>>();
  private readonly inFlight = new Map<string, { loading: Promise<unknown>; via: object | undefined }>();
  private drops = 0;
  /** Drops of every scope at once (`*`, a reconnect, a reset). */
  private everyDrops = 0;
  /** Drops of one scope, since the last drop of every scope. */
  private readonly scopeDrops = new Map<string, number>();
  private listening: Promise<boolean> | null = null;
  private retryAfter = 0;
  private quietUntil = 0;
  private readonly quietScopes = new Map<string, number>();
  /** Whether the listener's connection is up: a notification can reach the memory. */
  private connected = false;
  private database: object | null = null;

  constructor(private readonly options: KeptMemoryOptions) {}

  async read<T>(scope: string, slot: string, load: () => Promise<T>, readOptions?: KeptReadOptions<T>): Promise<T> {
    if (!(await this.mayKeep(scope, readOptions?.via))) return load();
    const hit = this.kept.get(scope)?.get(slot);
    if (hit && hit.until > Date.now()) return hit.value as T;
    return this.loadOnce(scope, slot, load, readOptions);
  }

  peek<T>(scope: string, slot: string): T | undefined {
    if (!this.boundToDatabase() || !this.connected || this.isQuiet(scope)) return undefined;
    const hit = this.kept.get(scope)?.get(slot);
    return hit !== undefined && hit.until > Date.now() ? (hit.value as T) : undefined;
  }

  /** Whether a read of `scope` may be answered from, and kept in, memory right now. */
  private async mayKeep(scope: string, via: object | undefined): Promise<boolean> {
    if (!this.boundToDatabase()) return false;
    // Starting the listener issues a `LISTEN`, which on a single connection
    // would wait for the caller's own transaction: a read through one does not
    // start it, it only reads.
    if (!this.listening && via !== undefined) return false;
    return (await this.ensureListening()) && this.connected && !this.isQuiet(scope);
  }

  /** One load for a burst of reads of the same slot through the same client or transaction. */
  private loadOnce<T>(scope: string, slot: string, load: () => Promise<T>, readOptions?: KeptReadOptions<T>): Promise<T> {
    const key = `${scope}\u0000${slot}`;
    const via = readOptions?.via;
    const pending = this.inFlight.get(key);
    if (pending && pending.via === via) return pending.loading as Promise<T>;
    const loading = this.loadAndKeep(scope, slot, load, readOptions).finally(() => {
      if (this.inFlight.get(key)?.loading === loading) this.inFlight.delete(key);
    });
    // A load through another client or transaction is already out: this one runs beside it.
    if (!pending) this.inFlight.set(key, { loading, via });
    return loading;
  }

  epoch(): number {
    return this.drops;
  }

  drop(scope: string): void {
    this.forget(scope);
  }

  quiet(ms: number, scope?: string): void {
    const until = Date.now() + ms;
    if (scope === undefined) {
      this.forget(EVERY_SCOPE);
      this.quietUntil = Math.max(this.quietUntil, until);
      return;
    }
    this.forget(scope);
    this.quietScopes.set(scope, Math.max(this.quietScopes.get(scope) ?? 0, until));
  }

  private isQuiet(scope: string): boolean {
    const now = Date.now();
    if (now < this.quietUntil) return true;
    const until = this.quietScopes.get(scope);
    if (until === undefined) return false;
    if (now < until) return true;
    this.quietScopes.delete(scope);
    return false;
  }

  resetForTests(): void {
    this.reset();
  }

  private reset(): void {
    this.kept.clear();
    this.inFlight.clear();
    this.drops += 1;
    this.everyDrops += 1;
    this.scopeDrops.clear();
    this.listening = null;
    this.retryAfter = 0;
    this.quietUntil = 0;
    this.quietScopes.clear();
    this.connected = false;
  }

  /** Follow the database the listener hears; `false` when there is none to bind to. */
  private boundToDatabase(): boolean {
    let database: object | null;
    try {
      database = this.options.database ? this.options.database() : null;
    } catch {
      return false;
    }
    if (database !== this.database) {
      this.reset();
      this.database = database;
    }
    return true;
  }

  private forget(payload: string): void {
    this.drops += 1;
    if (payload === EVERY_SCOPE || payload === '') {
      this.everyDrops += 1;
      this.scopeDrops.clear();
      this.kept.clear();
      this.inFlight.clear();
      return;
    }
    this.scopeDrops.set(payload, (this.scopeDrops.get(payload) ?? 0) + 1);
    this.kept.delete(payload);
    const prefix = `${payload}\u0000`;
    for (const key of [...this.inFlight.keys()]) if (key.startsWith(prefix)) this.inFlight.delete(key);
  }

  /** Start the listener once. `false` while it is not up: then nothing is kept. */
  private ensureListening(): Promise<boolean> {
    if (this.listening) return this.listening;
    // A database that refused once is not asked again on every read.
    if (Date.now() < this.retryAfter) return Promise.resolve(false);
    const { channel } = this.options;
    let started: Promise<unknown>;
    try {
      // A drop reported before `listen` resolves must not be undone by its resolving.
      const dropped = { since: false };
      started = this.options
        .listen(channel, {
          onNotify: (payload) => this.forget(payload),
          onConnected: () => {
            this.forget(EVERY_SCOPE);
            dropped.since = false;
            this.connected = true;
          },
          onDisconnected: () => {
            dropped.since = true;
            this.connected = false;
            this.forget(EVERY_SCOPE);
          },
          onError: (error) => this.report({ phase: 'dropped', channel, error }),
        })
        .then(() => {
          // Up: the first connection is made before `listen` resolves.
          if (!dropped.since) this.connected = true;
        });
    } catch (error) {
      started = Promise.reject(error);
    }
    const up: Promise<boolean> = started.then(
      () => true,
      (error: unknown) => {
        // Not up: answer from the database, and try again on a later read. The
        // state is reset BEFORE the host is told, so a host reporter that throws
        // cannot leave a rejected start stored for every later read.
        if (this.listening === up) this.listening = null;
        this.retryAfter = Date.now() + this.options.retryMs;
        this.report({ phase: 'start', channel, error });
        return false;
      },
    );
    this.listening = up;
    return up;
  }

  /** Tell the host; a reporter that throws must not break the memory. */
  private report(event: KeptMemoryErrorEvent): void {
    try {
      this.options.onError(event);
    } catch {
      // The host's reporter failed: the memory carries on as if it had logged.
    }
  }

  private keep(scope: string, slot: string, value: unknown, now: number): void {
    const slots = this.kept.get(scope) ?? new Map<string, Kept>();
    // Most recently used last, so the oldest scope is the first key.
    this.kept.delete(scope);
    this.kept.set(scope, slots);
    slots.delete(slot);
    slots.set(slot, { value, until: now + this.options.backstopMs });
    if (slots.size > this.options.maxSlots) {
      const oldestSlot = slots.keys().next().value;
      if (oldestSlot !== undefined) slots.delete(oldestSlot);
    }
    if (this.kept.size > this.options.maxScopes) {
      const oldest = this.kept.keys().next().value;
      if (oldest !== undefined) this.kept.delete(oldest);
    }
  }

  private async loadAndKeep<T>(scope: string, slot: string, load: () => Promise<T>, readOptions?: KeptReadOptions<T>): Promise<T> {
    const stillCurrent = this.overtakenBy(scope, readOptions?.since);
    const now = Date.now();
    const value = await load();
    if (stillCurrent() && (readOptions?.keep?.(value) ?? true)) this.keep(scope, slot, value, now);
    return value;
  }

  /**
   * Whether nothing that could have changed `scope` was dropped since now: no
   * drop of the scope, none of every scope. A snapshot's epoch (`since`) is the
   * memory's whole count, taken before the snapshot: any drop since then may
   * be a change the snapshot cannot see.
   */
  private overtakenBy(scope: string, since: number | undefined): () => boolean {
    if (since !== undefined) return () => since === this.drops;
    const atEvery = this.everyDrops;
    const atScope = this.scopeDrops.get(scope) ?? 0;
    return () => atEvery === this.everyDrops && atScope === (this.scopeDrops.get(scope) ?? 0);
  }
}
