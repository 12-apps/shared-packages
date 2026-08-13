import type { RealtimeLogger } from "../core/types";

/**
 * Per-subject connection accounting for the subscribe surfaces (ported from
 * future-pay FUT-438) — the ops guardrail that keeps one tenant's tablets (or
 * one person's tabs, or one seat's devices) from exhausting the process's
 * open-stream budget.
 *
 * In-process on purpose: connections live in the process that holds them, so
 * the cap is per server process. With one web container that IS the
 * deployment-wide cap; horizontal replicas each grant their own budget, which
 * still bounds the blast radius per process.
 *
 * A LEDGER INSTANCE rather than module globals, because this now lives in a
 * package: `createApiEvents` owns one ledger per factory call, so two mounted
 * surfaces share a budget exactly when they share a factory — and a test gets
 * a fresh ledger by building a fresh one instead of resetting hidden state.
 */

/**
 * How many concurrent realtime connections one subject may hold per process.
 * 20 covers a store's realistic device fleet (kitchen tablets, till, a few
 * phones) with room to spare while keeping a runaway client from pinning
 * hundreds of streams. Override per deployment via
 * `REALTIME_TENANT_CONNECTION_CAP`, or per factory via config.
 */
export const DEFAULT_CONNECTION_CAP = 20;

/** The env override when it parses to a positive int, else the fallback. */
export function connectionCapFromEnv(fallback: number = DEFAULT_CONNECTION_CAP): number {
  const raw = process.env.REALTIME_TENANT_CONNECTION_CAP;
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export interface ConnectionLedgerOptions {
  logger?: RealtimeLogger;
  /** A fixed cap; when omitted the env override (or the default) applies. */
  cap?: number;
}

export class ConnectionLedger {
  private readonly openBySubject = new Map<string, number>();
  private readonly activeStreamClosers = new Set<() => void>();
  private readonly logger: RealtimeLogger;
  private readonly cap: number | undefined;

  constructor(options: ConnectionLedgerOptions = {}) {
    this.logger = options.logger ?? console;
    this.cap = options.cap;
  }

  /** The effective cap, resolved per call so an env change needs no restart. */
  capacity(): number {
    return this.cap ?? connectionCapFromEnv();
  }

  /**
   * Reserve one connection slot for `subjectId`. Returns a release function,
   * or `null` when the subject is at its cap (the caller answers 429 — the
   * client keeps polling, the designed fallback). The release is idempotent.
   */
  acquire(subjectId: string): (() => void) | null {
    const open = this.openBySubject.get(subjectId) ?? 0;
    if (open >= this.capacity()) {
      this.logger.warn(
        `connection refused: subject ${subjectId} is at its cap (${open} open).`,
      );
      return null;
    }
    this.openBySubject.set(subjectId, open + 1);
    this.logger.info(`connection opened: subject ${subjectId} (${open + 1} open).`);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const current = this.openBySubject.get(subjectId) ?? 0;
      if (current <= 1) this.openBySubject.delete(subjectId);
      else this.openBySubject.set(subjectId, current - 1);
      this.logger.info(
        `connection closed: subject ${subjectId} (${Math.max(0, current - 1)} open).`,
      );
    };
  }

  /**
   * Track an open stream's closer, so a deploy can end streams cleanly: SSE
   * clients reconnect on their own, and a stream severed mid-frame looks like
   * a network error while a closed one is a clean EOF. Returns the
   * deregistration for the stream's own cleanup.
   */
  registerStreamCloser(close: () => void): () => void {
    this.activeStreamClosers.add(close);
    return () => this.activeStreamClosers.delete(close);
  }

  /** Close every open stream — called on SIGTERM/SIGINT by `start()`. */
  closeAllStreams(): void {
    const closing = [...this.activeStreamClosers];
    this.activeStreamClosers.clear();
    if (closing.length > 0) {
      this.logger.info(`shutdown: closing ${closing.length} open stream(s).`);
    }
    for (const close of closing) close();
  }

  /** Open-connection count for one subject, for tests and health readouts. */
  openCount(subjectId: string): number {
    return this.openBySubject.get(subjectId) ?? 0;
  }
}
