/**
 * The bulk actions' wire (FUT-4420), as plain types.
 *
 * Shared by the server route that answers them and the screen that sends them,
 * and kept free of zod and React for the reason `./timezone` is: a browser
 * bundle imports this file, and the validators live in `./server/bulk-wire`.
 *
 * ## One route, three operations
 *
 * `POST /discounts/bulk` takes an `operation`: `setActive`, `extendWindow` and
 * `undo`. One route is one MCP tool (the discounts' ONE bulk tool, whose next
 * action becomes a fourth operation, never a tool of its own) and one file for
 * the host to mount.
 *
 * ## The four outcomes of a row
 *
 * - `ok`        - the row changed. Only these rows are ever offered to Desfazer.
 * - `unchanged` - the row already held the value. Not a change, so not undone.
 * - `skipped`   - the rule does not apply to this row, and saying it again will
 *                 not change that (no end date, a date that is not later). Never
 *                 retryable.
 * - `failed`    - something went wrong or the row moved under the batch. Retryable.
 */

/** The most discounts one batch may name; more is refused whole with a 422. */
export const DISCOUNT_BULK_MAX_IDS = 500;

/** Exactly what Desfazer restores: the flag and the window as stored. */
export interface DiscountBulkState {
  active: boolean;
  /** ISO instant, or null. */
  startsAt: string | null;
  /** ISO instant, or null. */
  endsAt: string | null;
  windowInZone: boolean;
}

export type DiscountBulkStatus = "ok" | "unchanged" | "skipped" | "failed";

/**
 * The machine-readable reason behind a row, so a host can branch (a report
 * offers "Tentar novamente" only for `retryable` rows) without parsing a
 * sentence. The sentence itself is in `message`, in the caller's language.
 */
export type DiscountBulkCode =
  | "activated"
  | "deactivated"
  | "extended"
  | "revived"
  | "restored"
  | "alreadyActive"
  | "alreadyInactive"
  | "alreadyEndsThen"
  | "alreadyRestored"
  | "noEndDate"
  | "notLater"
  | "stillEnded"
  | "zoneUnknown"
  | "notFound"
  | "changedSince"
  | "changedDuringBatch"
  | "failed";

export interface DiscountBulkRow {
  id: string;
  name: string | null;
  status: DiscountBulkStatus;
  code: DiscountBulkCode;
  /** The sentence for this row, in the caller's language. */
  message: string;
  /** True only where sending the same row again can succeed (`failed`). */
  retryable: boolean;
  /** The row as it was and as the batch left it; present on `ok` rows. */
  before?: DiscountBulkState;
  after?: DiscountBulkState;
  /** The last day the window runs on after an extension (`YYYY-MM-DD`); null when unknown. */
  endsOn?: string | null;
  /** The extension re-activated an ended discount: the row says it is valid again. */
  revived?: boolean;
}

export interface DiscountBulkCounts {
  ok: number;
  unchanged: number;
  skipped: number;
  failed: number;
}

export interface DiscountBulkResult {
  operation: DiscountBulkOperation["operation"];
  /** True when nothing was written: the rows say what WOULD happen. */
  validateOnly: boolean;
  counts: DiscountBulkCounts;
  /** One entry per requested id, in the order asked, duplicates removed. */
  rows: DiscountBulkRow[];
}

/** What Desfazer sends back for one row the batch changed. */
export interface DiscountBulkUndoRow {
  id: string;
  before: DiscountBulkState;
  after: DiscountBulkState;
}

export type DiscountBulkOperation =
  | { operation: "setActive"; ids: string[]; active: boolean; validateOnly?: boolean }
  | {
      operation: "extendWindow";
      ids: string[];
      /** Whole days to add: from the current end day, or from today for an ended discount. */
      days?: number;
      /** Or the new last day (`YYYY-MM-DD`) for every row. Exactly one of the two. */
      endsOn?: string;
      validateOnly?: boolean;
    }
  | { operation: "undo"; rows: DiscountBulkUndoRow[]; validateOnly?: boolean };
