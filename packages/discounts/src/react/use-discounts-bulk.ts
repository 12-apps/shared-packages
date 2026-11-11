"use client";

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";

import {
  DISCOUNT_BULK_MAX_IDS,
  type DiscountBulkCounts,
  type DiscountBulkOperation,
  type DiscountBulkResult,
  type DiscountBulkRow,
  type DiscountBulkUndoRow,
} from "../bulk";
import type { DiscountsApiClient } from "./api";
import { fill, type CompleteDiscountsWebCopy } from "./copy";
import type { DiscountsBulkCopy } from "./copy-bulk";

/**
 * The bulk actions' state (FUT-4420), owned by the PACKAGE and drawn by the
 * HOST.
 *
 * The package knows what a batch is - the request, the per-row answers, the
 * rows that can be undone - and the host knows what its reports look like. So
 * the screen keeps this state machine and hands it to the host's
 * {@link DiscountsBulkSlotProps slot}, which renders "Aplicando em N itens…",
 * the count and the reasons, "Tentar novamente", "Desfazer (N)" and "Baixar as
 * falhas" in its own chrome.
 */

/** A request the slot can show: any operation but the undo, which has its own state. */
export type DiscountsBulkRequest = Exclude<DiscountBulkOperation, { operation: "undo" }>;

export type DiscountsBulkState =
  | { phase: "idle" }
  | { phase: "running"; request: DiscountsBulkRequest; total: number }
  /** The request itself failed: nothing was applied that the answer can name. */
  | { phase: "failed"; request: DiscountsBulkRequest; message: string }
  | {
      phase: "done";
      request: DiscountsBulkRequest;
      /** Every row of the batch, retries folded in. */
      result: DiscountBulkResult;
      /** True while Desfazer or a retry is in flight. */
      busy: boolean;
      /** Desfazer's answer, once it ran. Offered once, so absent means not yet. */
      undone: DiscountBulkResult | null;
    };

/** What the host's slot is handed, and renders around the grid. */
export interface DiscountsBulkSlotProps {
  state: DiscountsBulkState;
  /** The sentences of the bulk group, for the report's own labels. */
  copy: DiscountsBulkCopy;
  /** Rows Desfazer would restore: the `ok` rows, with their before and after. */
  undoable: readonly DiscountBulkUndoRow[];
  /** Rows "Tentar novamente" would send again: only the `failed` ones. */
  retryable: readonly DiscountBulkRow[];
  /** Restore the `ok` rows. A row changed since is left as it is and the answer says why. */
  undo: () => Promise<void>;
  /** Send the failed rows again, folding the answers into the same report. */
  retry: () => Promise<void>;
  /** Close the report. */
  dismiss: () => void;
  /** The grid. */
  children: ReactNode;
}

/** The three requests of the "Ações" entries, as the screen builds them. */
export type DiscountsBulkRunner = (request: DiscountsBulkRequest) => Promise<void>;

const countsOf = (rows: readonly DiscountBulkRow[]): DiscountBulkCounts => {
  const counts: DiscountBulkCounts = { ok: 0, unchanged: 0, skipped: 0, failed: 0 };
  for (const row of rows) counts[row.status] += 1;
  return counts;
};

/** The earlier answer with the rows of a retry swapped in, in place. */
export function foldRetry(
  previous: DiscountBulkResult,
  retried: DiscountBulkResult,
): DiscountBulkResult {
  const byId = new Map(retried.rows.map((row) => [row.id, row]));
  const rows = previous.rows.map((row) => byId.get(row.id) ?? row);
  return { ...previous, rows, counts: countsOf(rows) };
}

export function undoableOf(rows: readonly DiscountBulkRow[]): DiscountBulkUndoRow[] {
  return rows.flatMap((row) =>
    row.status === "ok" && row.before !== undefined && row.after !== undefined
      ? [{ id: row.id, before: row.before, after: row.after }]
      : [],
  );
}

/** What the handlers share: the client, the report's setters and the reload. */
interface BulkDeps {
  api: DiscountsApiClient;
  refresh: () => void;
  onError: (error: unknown, context: string) => void;
  latest: { current: DiscountsBulkState };
  set: (next: DiscountsBulkState) => void;
}

type Done = Extract<DiscountsBulkState, { phase: "done" }>;

/** Desfazer: the `ok` rows back to their `before`, once. */
async function undoBatch({ api, refresh, onError, latest, set }: BulkDeps): Promise<void> {
  const current = latest.current;
  if (current.phase !== "done" || current.undone !== null || current.busy) return;
  const rows = undoableOf(current.result.rows);
  if (rows.length === 0) return;
  set({ ...current, busy: true });
  const answer = await api.bulk({ operation: "undo", rows });
  if (!answer.ok) {
    onError(answer, "discounts.bulk.undo");
    set({ ...current, busy: false });
    return;
  }
  set({ ...current, busy: false, undone: answer.data });
  refresh();
}

/** "Tentar novamente" on a finished batch: only its failed rows, folded into the same report. */
async function retryRows({ api, refresh, onError, latest, set }: BulkDeps, current: Done): Promise<void> {
  const ids = current.result.rows.filter((row) => row.retryable).map((row) => row.id);
  if (current.busy || ids.length === 0) return;
  set({ ...current, busy: true });
  const answer = await api.bulk({ ...current.request, ids });
  if (!answer.ok) {
    onError(answer, `discounts.bulk.${current.request.operation}`);
    set({ ...current, busy: false });
    return;
  }
  const latestDone = latest.current.phase === "done" ? latest.current : current;
  set({ ...latestDone, busy: false, result: foldRetry(latestDone.result, answer.data) });
  refresh();
}

export function useDiscountsBulk(
  api: DiscountsApiClient,
  copy: CompleteDiscountsWebCopy,
  refresh: () => void,
  onError: (error: unknown, context: string) => void,
): { state: DiscountsBulkState; run: DiscountsBulkRunner; slot: Omit<DiscountsBulkSlotProps, "children"> } {
  const [state, setState] = useState<DiscountsBulkState>({ phase: "idle" });
  // The latest state for handlers that run after an await: a closure over `state`
  // would retry against the batch as it was when the button was drawn.
  const latest = useRef(state);
  latest.current = state;
  const set = useCallback((next: DiscountsBulkState) => {
    latest.current = next;
    setState(next);
  }, []);
  const deps = useMemo<BulkDeps>(() => ({ api, refresh, onError, latest, set }), [api, refresh, onError, set]);

  const run = useCallback<DiscountsBulkRunner>(
    async (request) => {
      if (request.ids.length > DISCOUNT_BULK_MAX_IDS) {
        set({ phase: "failed", request, message: fill(copy.bulk.tooMany, { max: DISCOUNT_BULK_MAX_IDS }) });
        return;
      }
      set({ phase: "running", request, total: request.ids.length });
      const answer = await api.bulk(request);
      if (!answer.ok) {
        onError(answer, `discounts.bulk.${request.operation}`);
        set({ phase: "failed", request, message: answer.error || copy.bulk.requestFailed });
        return;
      }
      set({ phase: "done", request, result: answer.data, busy: false, undone: null });
      refresh();
    },
    [api, copy.bulk, onError, refresh, set],
  );

  const retry = useCallback(async () => {
    const current = latest.current;
    if (current.phase === "failed") await run(current.request);
    else if (current.phase === "done") await retryRows(deps, current);
  }, [deps, run]);
  const undo = useCallback(() => undoBatch(deps), [deps]);
  const dismiss = useCallback(() => set({ phase: "idle" }), [set]);

  const rows = state.phase === "done" ? state.result.rows : [];
  return {
    state,
    run,
    slot: {
      state,
      copy: copy.bulk,
      undoable: state.phase === "done" && state.undone === null ? undoableOf(rows) : [],
      retryable: rows.filter((row) => row.retryable),
      undo,
      retry,
      dismiss,
    },
  };
}
