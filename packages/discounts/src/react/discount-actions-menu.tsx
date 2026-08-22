"use client";

import { useState, type JSX } from "react";

import { CardKebab, useCardActions, useRemoveConfirm } from "@12-apps/ui/data-display/CardKit";
import { Dialog, DialogContent } from "@12-apps/ui/feedback/Dialog";
import type { DropdownMenuItem } from "@12-apps/ui/navigation/DropdownMenu";

import type { DiscountsApiClient, WireTargetGroup } from "./api";
import type { DiscountsWebCopy } from "./copy";
import { DiscountForm } from "./discount-form";
import type { CurrencyFieldComponent } from "./discount-form-fields";
import type { DiscountsFormatters } from "./format";
import type { DiscountListItem } from "./row";

/**
 * One rule's self-contained "⋮" menu: it owns its edit dialog inline and its
 * delete write, reading the refresh and the error channel from
 * `CardActionsProvider`.
 *
 * Reused by BOTH the grid row and the card, so the two can never offer a
 * different set of actions — which is the whole reason it is one component
 * rather than a menu per surface.
 *
 * There is deliberately no version-history entry. A discount is not versioned
 * catalog content: restoring "version 3" of a coupon whose redemption counter
 * has since moved is meaningless, so the surface does not offer it.
 */

export interface DiscountActionsMenuProps {
  row: DiscountListItem;
  api: DiscountsApiClient;
  copy: DiscountsWebCopy;
  formatters: DiscountsFormatters;
  currencyField: CurrencyFieldComponent;
  /**
   * The registered collections, for the edit form's target pickers.
   *
   * Optional, and the absence is a real state rather than an oversight: while
   * they are still loading, only DELETE is offered — an edit form opened
   * without them would show empty pickers, and saving would silently clear a
   * target list it never had the chance to display.
   */
  groups?: readonly WireTargetGroup[];
  onError: (error: unknown, context: string) => void;
}

export function DiscountActionsMenu({
  row,
  api,
  copy,
  formatters,
  currencyField,
  groups,
  onError,
}: DiscountActionsMenuProps): JSX.Element {
  const { onRefresh } = useCardActions();
  const [editOpen, setEditOpen] = useState(false);
  const canEdit = groups !== undefined;

  const remove = useRemoveConfirm({
    write: async () => {
      const result = await api.remove(row.id);
      if (!result.ok) onError(result, "discounts.delete");
      return result;
    },
    title: copy.actions.deleteTitle,
    entityName: row.name,
    description: copy.actions.deleteDescription,
    confirmText: copy.actions.delete,
    fallbackError: copy.actions.deleteFailed,
    copy: copy.confirmAction,
    dataTestId: "discount-delete-confirm",
  });

  const items: DropdownMenuItem[] = [];
  if (canEdit) {
    items.push({ id: "edit", label: copy.actions.edit, onClick: () => setEditOpen(true) });
  }
  items.push({
    id: "delete",
    label: copy.actions.delete,
    color: "danger",
    onClick: remove.request,
  });

  return (
    <>
      <CardKebab
        items={items}
        menuLabel={copy.actions.menu}
        dataTestId={`discount-actions-${row.id}`}
      />
      {remove.dialog}
      {canEdit && (
        <Dialog
          open={editOpen}
          onClose={() => setEditOpen(false)}
          title={copy.form.editTitle}
          size="md"
          showCloseButton
          dataTestId="discount-dialog"
        >
          {/* Mounted only while open, so the next open re-seeds from the row
              instead of keeping the last attempt's values. */}
          {editOpen && (
            <DialogContent>
              <DiscountForm
                key={row.id}
                api={api}
                copy={copy}
                formatters={formatters}
                currencyField={currencyField}
                groups={groups}
                editing={row.record}
                onError={onError}
                onSaved={() => {
                  setEditOpen(false);
                  onRefresh();
                }}
              />
            </DialogContent>
          )}
        </Dialog>
      )}
    </>
  );
}
