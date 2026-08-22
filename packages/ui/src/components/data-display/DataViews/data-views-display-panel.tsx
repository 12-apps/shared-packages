"use client";

import type { DataViewsCopy } from "./data-views-copy";
import KeyboardArrowDownRoundedIcon from "@mui/icons-material/KeyboardArrowDownRounded";
// Says "display settings" rather than the generic tune sliders it used to
// share with the "Mais" FILTER trigger — see the note there.
import DisplaySettingsRoundedIcon from "@mui/icons-material/DisplaySettingsRounded";
import { Popover } from "@mui/material";
import { useState } from "react";

import { useDataViewsCopy } from "./data-views-copy-context";
import { Button } from "../../form/Button";
import { Box } from "../../../mui/Box";

import { ColumnsTab } from "./data-views-columns-tab";
import {
  ViewActions,
  ViewFooter,
  ViewHeader,
  ViewsList,
  type ViewNavHandlers,
} from "./data-views-view-nav";
import type { SavedViewSummary } from "./data-views-types";
import { DisplayTab, SortTab } from "./data-views-display-tabs";
import type { DataViewsController } from "./use-data-views-state";

/**
 * "EXIBIR" — one panel for every question about how the list is READ.
 *
 * Sort, columns and format used to be three separate toolbar dropdowns, which
 * asked the operator to already know which one held what. They are one decision
 * ("how do I want to read this?") so they are one control with three tabs.
 *
 * A view BRACKETS the panel: its name pinned at the top, the save actions
 * pinned at the bottom, both visible on every tab — so a change made in Colunas
 * is one glance away from the button that saves it. A separate "Visão" button
 * in the toolbar would be the same concept twice, in two places, disagreeing
 * about whether there are unsaved changes.
 */

/** Which tab is showing. `columns` first: it is what an operator opens this for. */
type DisplayTabKey = "sort" | "columns" | "display";

function displayTabs(copy: DataViewsCopy): { key: DisplayTabKey; label: string }[] {
  return [
    { key: "sort", label: copy.display.sortTab },
    { key: "columns", label: copy.display.columnsTab },
    { key: "display", label: copy.display.panelTab },
  ];
}

/** The saved-view chrome the panel brackets its tabs with, when a host supplies it. */
export interface DisplayPanelView {
  /** The applied view's name, or undefined for the built-in "Visão principal". */
  activeViewName?: string;
  /** True when the live state differs from the applied view (or from pristine). */
  dirty: boolean;
  /** Restore the applied view (or the pristine default) — discards local changes. */
  onReset: () => void;
  /** Persist the live state over the applied view. Absent ⇒ no update affordance. */
  onUpdate?: () => void;
  /** Persist the live state as a NEW view. */
  onSaveAs: () => void;
  /**
   * The saved views themselves, rendered INLINE in this panel's body when the
   * VISÃO header is opened — not as a dropdown of their own. The panel stays
   * data-free: the host owns the views and every mutation, this only decides
   * where they appear.
   */
  nav?: ViewNavHandlers;
}

interface DisplayPanelProps<T extends Record<string, unknown>> {
  c: DataViewsController<T>;
  testIdPrefix: string;
  /** Per-sort-field value kind, so directions read in the column's own terms. */
  sortKinds?: Record<string, string>;
  view?: DisplayPanelView;
  /** Icon only — step 2 of the toolbar's measured degradation ladder. */
  compact?: boolean;
}

/** The tab strip inside the panel. */
function PanelTabs({
  tab,
  onChange,
  muted,
  testIdPrefix,
}: {
  tab: DisplayTabKey;
  onChange: (tab: DisplayTabKey) => void;
  /** The views own the body — no tab is showing, so none reads as selected. */
  muted?: boolean;
  testIdPrefix: string;
}): React.JSX.Element {
  const copy = useDataViewsCopy();
  return (
    <Box sx={{ display: "flex", gap: 0.5, p: 0.75, bgcolor: "action.hover", borderBottom: 1, borderColor: "divider" }}>
      {displayTabs(copy).map((entry) => {
        const active = tab === entry.key && !muted;
        return (
        <Box
          key={entry.key}
          component="button"
          type="button"
          onClick={() => onChange(entry.key)}
          data-testid={`${testIdPrefix}-display-tab-${entry.key}`}
          aria-current={active}
          sx={{
            flex: 1,
            px: 1,
            py: 0.75,
            border: 0,
            borderRadius: 1,
            cursor: "pointer",
            font: "inherit",
            fontSize: "0.8125rem",
            bgcolor: active ? "background.paper" : "transparent",
            boxShadow: active ? 1 : 0,
            fontWeight: active ? 600 : 400,
            color: active ? "text.primary" : "text.secondary",
          }}
        >
          {entry.label}
        </Box>
        );
      })}
    </Box>
  );
}

/** The active tab's body. */
function PanelBody<T extends Record<string, unknown>>({
  tab,
  c,
  sortKinds,
  testIdPrefix,
}: {
  tab: DisplayTabKey;
  c: DataViewsController<T>;
  sortKinds?: Record<string, string>;
  testIdPrefix: string;
}): React.JSX.Element {
  if (tab === "sort") {
    return (
      <SortTab
        fields={c.resolvedSortFields}
        activeField={c.activeSortField}
        activeOrder={c.activeSortOrder}
        onChange={(field, order) => c.patch({ sortBy: [{ id: field, dir: order }] })}
        sortKinds={sortKinds}
        testIdPrefix={testIdPrefix}
      />
    );
  }
  if (tab === "columns") {
    return (
      <ColumnsTab
        columns={c.hideableColumns}
        order={c.columnOrder}
        visibleColumns={c.state.visibleColumns}
        onToggle={c.toggleColumn}
        onReorder={(order) => c.patch({ order })}
        onShowAll={() => c.patch({ visibleColumns: c.columnOrder })}
        // "Padrão" restores BOTH: the declared order and every column visible.
        onReset={() => c.patch({ visibleColumns: c.columnOrder, order: undefined })}
        testIdPrefix={testIdPrefix}
      />
    );
  }
  return <DisplayTab testIdPrefix={testIdPrefix} />;
}

/** Everything inside the popover: VISÃO header, tabs, body, save footer. */
function PanelSurface<T extends Record<string, unknown>>({
  c, view, nav, tab, onTab, viewsOpen, onToggleViews, actionsFor, onOpenActions,
  onBack, sortKinds, onDone, testIdPrefix,
}: {
  c: DataViewsController<T>;
  view?: DisplayPanelView;
  nav?: ViewNavHandlers;
  tab: DisplayTabKey;
  onTab: (tab: DisplayTabKey) => void;
  viewsOpen: boolean;
  onToggleViews: () => void;
  actionsFor: SavedViewSummary | null;
  onOpenActions: (view: SavedViewSummary) => void;
  onBack: () => void;
  sortKinds?: Record<string, string>;
  onDone: () => void;
  testIdPrefix: string;
}): React.JSX.Element {
  return (
    <Box data-testid={`${testIdPrefix}-display-panel`}>
          {view && (
            <ViewHeader
              view={view}
              open={viewsOpen}
              onToggle={onToggleViews}
              testIdPrefix={testIdPrefix}
            />
          )}
          <PanelTabs
            tab={tab}
            onChange={onTab}
            muted={Boolean(nav)}
            testIdPrefix={testIdPrefix}
          />
          {/* Constrained + scrolled: the columns list is unbounded, and a panel
              taller than the viewport puts its own save button off screen. */}
          <Box sx={{ maxHeight: 320, minHeight: 220, overflowY: "auto" }}>
            {nav ? (
              <ViewsBody
                nav={nav}
                actionsFor={actionsFor}
                onOpenActions={onOpenActions}
                onBack={onBack}
                testIdPrefix={testIdPrefix}
              />
            ) : (
              <PanelBody tab={tab} c={c} sortKinds={sortKinds} testIdPrefix={testIdPrefix} />
            )}
          </Box>
          {view && <ViewFooter view={view} onDone={onDone} testIdPrefix={testIdPrefix} />}
    </Box>
  );
}


/** The views as the panel's body: the list, or one view's actions. */
function ViewsBody({
  nav,
  actionsFor,
  onOpenActions,
  onBack,
  testIdPrefix,
}: {
  nav: ViewNavHandlers;
  actionsFor: SavedViewSummary | null;
  onOpenActions: (view: SavedViewSummary) => void;
  onBack: () => void;
  testIdPrefix: string;
}): React.JSX.Element {
  // Resolve against the LIVE list, not the object captured when the kebab was
  // clicked: toggling "Fixar" or "Compartilhar" replaces the view in `views`,
  // and a held snapshot would keep showing the state from before the click.
  const live = actionsFor ? nav.views.find((view) => view.id === actionsFor.id) : undefined;
  if (live) {
    return <ViewActions view={live} handlers={nav} onBack={onBack} testIdPrefix={testIdPrefix} />;
  }
  return <ViewsList handlers={nav} onOpenActions={onOpenActions} testIdPrefix={testIdPrefix} />;
}

/** The "Exibir" button, with the dot that says the view has unsaved changes. */
function DisplayTrigger({
  dirty,
  compact,
  onOpen,
  testIdPrefix,
}: {
  dirty: boolean;
  compact: boolean;
  onOpen: (anchor: HTMLElement) => void;
  testIdPrefix: string;
}): React.JSX.Element {
  return (
    <Button
      variant="outline"
      size="sm"
      color="neutral"
      onClick={(event) => onOpen(event.currentTarget as HTMLElement)}
      dataTestId={`${testIdPrefix}-display-trigger`}
      aria-label="Exibir"
      title={compact ? "Exibir" : undefined}
    >
      <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
        <DisplaySettingsRoundedIcon fontSize="small" />
        {!compact && (
          <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
            Exibir
          </Box>
        )}
        {dirty && (
          <Box component="span" sx={{ height: 6, width: 6, borderRadius: "50%", bgcolor: "primary.main" }} />
        )}
        {/* The chevron goes with the label. Once the control is a bare icon it
            is already unmistakably a button, and on the rung where that happens
            the ~24px it costs is the difference between a row that fits and one
            that scrolls. */}
        {!compact && <KeyboardArrowDownRoundedIcon fontSize="small" />}
      </Box>
    </Button>
  );
}

/**
 * The toolbar's "Exibir" control: one button, one popover, three tabs, and the
 * view bracketing all of it.
 */
export function DataViewsDisplayPanel<T extends Record<string, unknown>>({
  c,
  testIdPrefix,
  sortKinds,
  view,
  compact,
}: DisplayPanelProps<T>): React.JSX.Element {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [tab, setTab] = useState<DisplayTabKey>("columns");
  // The views REPLACE the tab body rather than opening over it — see
  // `data-views-view-nav`. `actionsFor` is the second level of that drill-down.
  const [viewsOpen, setViewsOpen] = useState(false);
  const [actionsFor, setActionsFor] = useState<SavedViewSummary | null>(null);
  // Non-null only while the views are the body — the one place that decides
  // whether this panel is showing tabs or views.
  const nav = viewsOpen ? view?.nav : undefined;
  const close = (): void => setAnchor(null);
  const leaveViews = (): void => {
    setViewsOpen(false);
    setActionsFor(null);
  };
  return (
    <>
      <DisplayTrigger
        dirty={Boolean(view?.dirty)}
        compact={Boolean(compact)}
        onOpen={setAnchor}
        testIdPrefix={testIdPrefix}
      />
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={close}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{ paper: { sx: { width: 320, maxWidth: "calc(100vw - 32px)" } } }}
      >
        <PanelSurface
          c={c}
          view={view}
          nav={nav}
          tab={tab}
          onTab={(next) => {
            setTab(next);
            leaveViews();
          }}
          viewsOpen={viewsOpen}
          onToggleViews={() => {
            setViewsOpen((prev) => !prev);
            setActionsFor(null);
          }}
          actionsFor={actionsFor}
          onOpenActions={setActionsFor}
          onBack={() => setActionsFor(null)}
          sortKinds={sortKinds}
          onDone={close}
          testIdPrefix={testIdPrefix}
        />
      </Popover>
    </>
  );
}
