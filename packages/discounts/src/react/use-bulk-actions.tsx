"use client";

import { useCallback, useMemo, useRef, useState, type ComponentType, type JSX, type ReactNode } from "react";

import type { RowAction } from "@12-apps/ui/data-display/DataViews";

import type { DiscountsApiClient } from "./api";
import { BulkExtendDialog } from "./bulk-extend-dialog";
import type { CompleteDiscountsWebCopy } from "./copy";
import type { DiscountListItem } from "./row";
import {
  useDiscountsBulk,
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
  /** Wraps the grid in the host's slot and mounts the extend dialog. */
  frame: (grid: ReactNode) => JSX.Element;
}

export function useBulkActions(
  api: DiscountsApiClient,
  copy: CompleteDiscountsWebCopy,
  refresh: () => void,
  onError: (error: unknown, context: string) => void,
  Slot: ComponentType<DiscountsBulkSlotProps> | undefined,
): BulkActions {
  const { run, slot } = useDiscountsBulk(api, copy, refresh, onError);
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

  const actions = useMemo<RowAction<DiscountListItem>[]>(() => {
    if (Slot === undefined) return [];
    const ids = (rows: DiscountListItem[]): string[] => rows.map((row) => row.id);
    return [
      {
        id: "bulk-activate",
        label: copy.bulk.activateAll,
        row: false,
        onSelect: (rows) => run({ operation: "setActive", ids: ids(rows), active: true }),
      },
      {
        id: "bulk-deactivate",
        label: copy.bulk.deactivateAll,
        row: false,
        onSelect: (rows) => run({ operation: "setActive", ids: ids(rows), active: false }),
      },
      {
        id: "bulk-extend",
        label: copy.bulk.extend,
        row: false,
        onSelect: (rows) =>
          new Promise<void>((resolve, reject) => {
            pending.current = { resolve, reject };
            setExtending(ids(rows));
          }),
      },
    ];
  }, [Slot, copy.bulk, run]);

  const frame = useCallback(
    (grid: ReactNode): JSX.Element => {
      if (Slot === undefined) return <>{grid}</>;
      return (
        <>
          <Slot {...slot}>{grid}</Slot>
          <BulkExtendDialog
            ids={extending}
            copy={copy.bulk}
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

  return { actions, frame };
}
