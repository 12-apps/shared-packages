"use client";

import { useState, type JSX } from "react";
import { useSearchParams } from "react-router-dom";

import AddIcon from "@mui/icons-material/Add";

import { useServerDataViews } from "@12-apps/app-shell/react";
import {
  CardActionsProvider,
  useRowConfirm,
} from "@12-apps/ui/data-display/CardKit";
import {
  DataViewsCopyProvider,
  DataViewsGrid,
  type DataViewState,
} from "@12-apps/ui/data-display/DataViews";
import type { RowAction } from "@12-apps/ui/data-display/DataViews";
import { ErrorState } from "@12-apps/ui/data-display/ErrorState";
import { LoadingState } from "@12-apps/ui/data-display/LoadingState";
import { Dialog, DialogContent } from "@12-apps/ui/feedback/Dialog";
import { HeaderButton } from "@12-apps/ui/form/HeaderButton";
import { Dashboard } from "@12-apps/ui/layout/Dashboard";
import { Text } from "@12-apps/ui/typography/Text";
import { exportRows } from "@12-apps/ui/utils";

import type { DiscountsApiClient } from "./api";
import { fill, type DiscountsWebCopy } from "./copy";
import { DiscountActionsMenu } from "./discount-actions-menu";
import { DiscountCard } from "./discount-card";
import { DiscountForm } from "./discount-form";
import type { CurrencyFieldComponent } from "./discount-form-fields";
import { DiscountListCard, discountCells } from "./discount-list-card";
import type { DiscountsFormatters } from "./format";
import { useDiscountRows, type DiscountListItem } from "./row";
import { toMenuBinding, usePagedServer } from "./screen-bindings";
import {
  discountColumns,
  discountExportColumns,
  discountFilters,
  discountsAppliedState,
  discountsSearch,
} from "./table-config";
import { useDiscountsData } from "./use-discounts-data";

/**
 * The promotions list: a grid in SERVER mode — the URL params ARE the query —
 * a create dialog in the header, and a self-contained menu per row and card.
 *
 * No saved views, deliberately: a saved-view scope is a host registry entry and
 * a database constraint, and a package cannot add either.
 */

export interface DiscountsScreenProps {
  api: DiscountsApiClient;
  copy: DiscountsWebCopy;
  formatters: DiscountsFormatters;
  /** The store's IANA zone, for the grid's live "ativa agora" dot (FUT-996). */
  timezone?: string;
  /** The store's timezone as a person says it, for the schedule editor. */
  timezoneLabel?: string;
  currencyField: CurrencyFieldComponent;
  onError: (error: unknown, context: string) => void;
  /** The crumbs above the title. The host owns its own information hierarchy. */
  breadcrumb?: readonly { label: string; href?: string }[];
}

/** The bulk delete's confirmation, described from the SELECTION. */
function useBulkDelete(
  api: DiscountsApiClient,
  copy: DiscountsWebCopy,
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

/** The header's controls: the explainer, the export, and the create button. */
function HeaderControls({
  rows,
  copy,
  onCreate,
}: {
  rows: DiscountListItem[];
  copy: DiscountsWebCopy;
  onCreate: () => void;
}): JSX.Element {
  return (
    <>
      <Dashboard.Info title={copy.screen.aboutTitle}>
        {copy.screen.aboutBody}
      </Dashboard.Info>
      <Dashboard.Spacer />
      <Dashboard.Export
        formats={[
          { id: "csv", label: "CSV (.csv)" },
          { id: "json", label: "JSON (.json)" },
        ]}
        onExport={(format) =>
          exportRows(
            format === "json" ? "json" : "csv",
            rows,
            discountExportColumns(copy),
            copy.screen.exportFileName,
          )
        }
      />
      <Dashboard.Action>
        <HeaderButton
          text={copy.screen.create}
          icon={<AddIcon fontSize="small" />}
          onClick={onCreate}
          dataTestId="new-discount-button"
        />
      </Dashboard.Action>
    </>
  );
}

/** Everything the row menu, both cards and the edit form are bound to. */
export type MenuBinding = Omit<Parameters<typeof DiscountActionsMenu>[0], "row">;

/**
 * The grid, split from the page container so neither crosses the size gate.
 *
 * The row menu, the tile and the list row all receive the SAME binding, which
 * is what keeps an edit opened from any of the three offering the same pickers.
 */
function DiscountsGrid({
  rows,
  copy,
  menu,
  appliedState,
  server,
  onVisibleRowsChange,
  bulkDelete,
}: {
  rows: DiscountListItem[];
  copy: DiscountsWebCopy;
  menu: MenuBinding;
  appliedState: DataViewState;
  server: ReturnType<typeof useServerDataViews>;
  onVisibleRowsChange: (next: DiscountListItem[]) => void;
  bulkDelete: ReturnType<typeof useBulkDelete>;
}): JSX.Element {
  return (
    <>
      <DataViewsGrid<DiscountListItem>
        inlineFilters
        rows={rows}
        columns={discountColumns(copy)}
        fields={discountFilters(copy)}
        appliedState={appliedState}
        getRowId={(row) => row.id}
        onVisibleRowsChange={onVisibleRowsChange}
        dataTestId="discounts-grid"
        testIdPrefix="discounts"
        rowActions={
          [
            {
              id: "delete",
              label: copy.actions.delete,
              color: "danger",
              onSelect: (selected) => bulkDelete.request(selected),
            },
          ] satisfies RowAction<DiscountListItem>[]
        }
        renderRowMenu={(row) => <DiscountActionsMenu row={row} {...menu} />}
        renderCard={(row, selection) => (
          <DiscountCard row={row} selection={selection} {...menu} />
        )}
        renderListRow={(row, selection) => (
          <DiscountListCard row={row} selection={selection} {...menu} />
        )}
        listGroup={{ cells: discountCells(copy) }}
        server={server}
        emptyState={
          <Text variant="body" as="p">
            {copy.screen.empty}
          </Text>
        }
      />
      {bulkDelete.dialog}
    </>
  );
}

/** The create dialog, mounted only while open so the next open re-seeds empty. */
function CreateDialog({
  open,
  onClose,
  onSaved,
  menu,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  menu: MenuBinding;
}): JSX.Element {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={menu.copy.form.createTitle}
      size="md"
      showCloseButton
      dataTestId="discount-dialog"
    >
      {open && (
        <DialogContent>
          <DiscountForm
            {...menu}
            groups={menu.groups ?? []}
            editing={null}
            onSaved={onSaved}
          />
        </DialogContent>
      )}
    </Dialog>
  );
}

/**
 * Everything below the header: the create dialog and the grid.
 *
 * Split out of {@link DiscountsScreen} only to keep that component inside the
 * size gate — this is one tree, not a second concern.
 */
function ScreenBody({
  createOpen,
  setCreateOpen,
  menu,
  refresh,
  rows,
  copy,
  appliedState,
  server,
  onVisibleRowsChange,
  bulkDelete,
}: {
  createOpen: boolean;
  setCreateOpen: (open: boolean) => void;
  menu: MenuBinding;
  refresh: () => void;
  rows: DiscountListItem[];
  copy: DiscountsWebCopy;
  appliedState: DataViewState;
  server: ReturnType<typeof useServerDataViews>;
  onVisibleRowsChange: (rows: DiscountListItem[]) => void;
  bulkDelete: ReturnType<typeof useBulkDelete>;
}): JSX.Element {
  return (
    <Dashboard.Body>
      <CreateDialog
        open={createOpen}
        menu={menu}
        onClose={() => setCreateOpen(false)}
        onSaved={() => {
          setCreateOpen(false);
          refresh();
        }}
      />
      <CardActionsProvider
        // The menus read the refresh and the error channel from here; the
        // tenant is already baked into `apiBase`, so there is nothing for a
        // slug to do but be a second place it could disagree.
        tenantSlug=""
        onRefresh={refresh}
        errorTitle={copy.actions.actionFailed}
        errorDismissLabel={copy.actions.actionFailedDismiss}
      >
        <DiscountsGrid
          rows={rows}
          copy={copy}
          menu={menu}
          appliedState={appliedState}
          server={server}
          onVisibleRowsChange={onVisibleRowsChange}
          bulkDelete={bulkDelete}
        />
      </CardActionsProvider>
    </Dashboard.Body>
  );
}

export function DiscountsScreen(props: DiscountsScreenProps): JSX.Element {
  const { api, copy, formatters, onError, breadcrumb, timezone } = props;
  const [searchParams] = useSearchParams();
  const data = useDiscountsData(api, discountsSearch(searchParams), onError);
  const [createOpen, setCreateOpen] = useState(false);
  const [visibleRows, setVisibleRows] = useState<DiscountListItem[]>([]);
  const bulkDelete = useBulkDelete(api, copy, data.refresh, onError);

  const rows = useDiscountRows(data.page?.data, formatters, copy, timezone);

  // Seeded ONCE from the URL. Re-applying it on every render would wipe the
  // operator's column-visibility choices each time the query synced back.
  const [appliedState] = useState<DataViewState>(() =>
    discountsAppliedState(searchParams, copy),
  );

  const server = usePagedServer(data.page?.pagination);
  const menu = toMenuBinding(props, data.groups);

  if (data.loading) return <LoadingState dataTestId="discounts-loading" />;
  if (data.error !== null) {
    return (
      <ErrorState
        title={copy.screen.loadFailed}
        message={data.error}
        retryLabel={copy.screen.retry}
        onRetry={data.refresh}
      />
    );
  }

  return (
    // The grid, its toolbar and its saved-view dialogs read their words from
    // here: `@12-apps/ui` ships none and throws rather than falling back.
    <DataViewsCopyProvider copy={copy.dataViews}>
      <Dashboard testIdPrefix="discounts-dashboard">
        {breadcrumb && <Dashboard.Breadcrumb items={[...breadcrumb]} />}
        <Dashboard.Header title={copy.screen.title}>
          <HeaderControls
            rows={visibleRows}
            copy={copy}
            onCreate={() => setCreateOpen(true)}
          />
        </Dashboard.Header>
        <ScreenBody
          createOpen={createOpen}
          setCreateOpen={setCreateOpen}
          menu={menu}
          refresh={data.refresh}
          rows={rows}
          copy={copy}
          appliedState={appliedState}
          server={server}
          onVisibleRowsChange={setVisibleRows}
          bulkDelete={bulkDelete}
        />
      </Dashboard>
    </DataViewsCopyProvider>
  );
}
