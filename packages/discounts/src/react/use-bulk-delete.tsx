"use client";

import { useRowConfirm } from "@12-apps/ui/data-display/CardKit";

import type { DiscountsApiClient } from "./api";
import { fill, type CompleteDiscountsWebCopy } from "./copy";
import type { DiscountListItem } from "./row";

/** The bulk delete's confirmation, described from the SELECTION. */
export function useBulkDelete(
  api: DiscountsApiClient,
  copy: CompleteDiscountsWebCopy,
  refresh: () => void,
  onError: (error: unknown, context: string) => void,
) {
  return useRowConfirm<DiscountListItem>({
    write: async (rows) => {
      const results = await Promise.all(rows.map((row) => api.remove(row.id)));
      const failed = results.find((result) => !result.ok);
      if (failed && !failed.ok) {
        onError(failed, "discounts.delete");
        // Throwing is what keeps the popup open carrying the message; the
        // selection is still there to retry.
        throw new Error(failed.error);
      }
      refresh();
    },
    describe: (rows) =>
      rows.length === 1
        ? {
            title: copy.actions.deleteTitle,
            entityName: rows[0]?.name,
            description: copy.actions.deleteDescription,
            confirmText: copy.actions.delete,
          }
        : {
            title: fill(copy.actions.deleteManyTitle, { count: rows.length }),
            description: copy.actions.deleteManyDescription,
            confirmText: copy.actions.delete,
          },
    errorText: copy.actions.deleteFailed,
    copy: copy.confirmAction,
    dataTestId: "discount-bulk-delete-confirm",
  });
}
