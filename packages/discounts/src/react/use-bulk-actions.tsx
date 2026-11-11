"use client";

import { useCallback, useMemo, useRef, useState, type ComponentType, type JSX, type ReactNode } from "react";

import type { RowAction } from "@12-apps/ui/data-display/DataViews";

import { calendarDayAt, isKnownTimeZone } from "../timezone";

import type { DiscountsApiClient } from "./api";
import { BulkExtendDialog } from "./bulk-extend-dialog";
import type { CompleteDiscountsWebCopy } from "./copy";
import type { DiscountListItem } from "./row";
import {
  useDiscountsBulk,
  type DiscountsBulkRequest,
  type DiscountsBulkSlotProps,
} from "./use-discounts-bulk";

/**
 * The three bulk entries of "Ações" and their frame (FUT-4420), split from the
 * screen for the size gate.
 *
 * Absent a host slot, NOTHING is offered: the report and Desfazer are the
 * host's, and an action that ran with nowhere to say what it did would be the
 * silent batch this feature exists to end. The screen is then exactly what it
 * was (contract E1) - the same rule `RolesScreen.bulkSlot` follows.
 */

export interface BulkActions {
  /** The entries to append to the grid's `rowActions`; empty with no slot. */
  actions: RowAction<DiscountListItem>[];
  /** A batch is in flight: the grid hides every bulk entry, Excluir included. */
  running: boolean;
  /** Wraps the grid in the host's slot and mounts the extend dialog. */
  frame: (grid: ReactNode) => JSX.Element;
}

export function useBulkActions(
  api: DiscountsApiClient,
  copy: CompleteDiscountsWebCopy,
  refresh: () => void,
  onError: (error: unknown, context: string) => void,
  Slot: ComponentType<DiscountsBulkSlotProps> | undefined,
  timezone?: string,
): BulkActions {
  const { run, slot, state } = useDiscountsBulk(api, copy, refresh, onError);
  const running = state.phase === "running";
  const [extending, setExtending] = useState<readonly string[] | null>(null);
  // The promise `onSelect` returned: it settles with the dialog, so the grid
  // keeps the selection when the dialog is cancelled and clears it when confirmed.
  const pending = useRef<{ resolve: () => void; reject: (reason?: unknown) => void } | null>(null);

  const settle = useCallback((confirmed: boolean) => {
    setExtending(null);
    const waiting = pending.current;
    pending.current = null;
    if (confirmed) waiting?.resolve();
    else waiting?.reject(new Error("cancelled"));
  }, []);

  const actions = useMemo<RowAction<DiscountListItem>[]>(
    () =>
      Slot === undefined || api.bulk === undefined
        ? []
        : bulkEntries(copy.bulk, running, run, (rows) => {
            pending.current = null;
            return new Promise<void>((resolve, reject) => {
              pending.current = { resolve, reject };
              setExtending(rows.map((row) => row.id));
            });
          }),
    [Slot, api.bulk, copy.bulk, run, running],
  );

  const frame = useCallback(
    (grid: ReactNode): JSX.Element => {
      if (Slot === undefined) return <>{grid}</>;
      return (
        <>
          <Slot {...slot}>{grid}</Slot>
          <BulkExtendDialog
            ids={extending}
            copy={copy.bulk}
            today={todayIn(timezone)}
            onCancel={() => settle(false)}
            onConfirm={(request) => {
              settle(true);
              void run(request);
            }}
          />
        </>
      );
    },
    [Slot, slot, extending, copy.bulk, run, settle],
  );

  return { actions, frame, running };
}

/**
 * The three entries. Offered with TWO or more rows selected (the Produtos
 * pattern) and not while a batch runs. The grid filters the selection with
 * `isVisible`, which `Array#filter` hands the whole selection as its third
 * argument - the only place the count is visible to an entry.
 */
function bulkEntries(
  words: CompleteDiscountsWebCopy["bulk"],
  running: boolean,
  run: (request: DiscountsBulkRequest) => Promise<void>,
  askExtension: (rows: DiscountListItem[]) => Promise<void>,
): RowAction<DiscountListItem>[] {
  const visible = (_row: DiscountListItem, _index?: number, selection?: readonly unknown[]): boolean =>
    !running && (selection?.length ?? 2) >= 2;
  const ids = (rows: DiscountListItem[]): string[] => rows.map((row) => row.id);
  const entry = (id: string, label: string, onSelect: RowAction<DiscountListItem>["onSelect"]): RowAction<DiscountListItem> => ({
    id,
    label,
    row: false,
    isVisible: visible,
    onSelect,
  });
  return [
    entry("bulk-activate", words.activateAll, (rows) => run({ operation: "setActive", ids: ids(rows), active: true })),
    entry("bulk-deactivate", words.deactivateAll, (rows) => run({ operation: "setActive", ids: ids(rows), active: false })),
    entry("bulk-extend", words.extend, askExtension),
  ];
}

/** Today in the store's calendar, or in the browser's when the host passed no zone. */
function todayIn(timezone: string | undefined): string {
  if (timezone !== undefined && isKnownTimeZone(timezone)) return calendarDayAt(new Date(), timezone);
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
