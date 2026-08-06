"use client";

import KeyboardArrowDownRoundedIcon from "@mui/icons-material/KeyboardArrowDownRounded";
import RestartAltRoundedIcon from "@mui/icons-material/RestartAltRounded";
import SaveOutlinedIcon from "@mui/icons-material/SaveOutlined";
import TuneRoundedIcon from "@mui/icons-material/TuneRounded";
import { Popover } from "@mui/material";
import { useState } from "react";

import { Button } from "../../form/Button";
import { Box } from "../../../mui/Box";
import { Text } from "../../typography/Text";

import { ColumnsTab } from "./data-views-columns-tab";
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

const TABS: { key: DisplayTabKey; label: string }[] = [
  { key: "sort", label: "Ordenar" },
  { key: "columns", label: "Colunas" },
  { key: "display", label: "Exibição" },
];

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
   * The saved-views dropdown itself, rendered in the panel's VISÃO header. The
   * panel stays data-free: the host owns the menu and its mutations, this only
   * decides where it sits — inside Exibir rather than loose on the toolbar.
   */
  selector?: React.ReactNode;
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
  testIdPrefix,
}: {
  tab: DisplayTabKey;
  onChange: (tab: DisplayTabKey) => void;
  testIdPrefix: string;
}): React.JSX.Element {
  return (
    <Box sx={{ display: "flex", gap: 0.5, p: 0.75, bgcolor: "action.hover", borderBottom: 1, borderColor: "divider" }}>
      {TABS.map((entry) => (
        <Box
          key={entry.key}
          component="button"
          type="button"
          onClick={() => onChange(entry.key)}
          data-testid={`${testIdPrefix}-display-tab-${entry.key}`}
          aria-current={tab === entry.key}
          sx={{
            flex: 1,
            px: 1,
            py: 0.75,
            border: 0,
            borderRadius: 1,
            cursor: "pointer",
            font: "inherit",
            fontSize: "0.8125rem",
            bgcolor: tab === entry.key ? "background.paper" : "transparent",
            boxShadow: tab === entry.key ? 1 : 0,
            fontWeight: tab === entry.key ? 600 : 400,
            color: tab === entry.key ? "text.primary" : "text.secondary",
          }}
        >
          {entry.label}
        </Box>
      ))}
    </Box>
  );
}

/** The view's name + unsaved dot, pinned above the tabs. */
function ViewHeader({ view, testIdPrefix }: { view: DisplayPanelView; testIdPrefix: string }): React.JSX.Element {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 1, borderBottom: 1, borderColor: "divider" }}>
      <Text variant="caption" as="span">
        <Box component="span" sx={{ textTransform: "uppercase", letterSpacing: 0.5, color: "text.disabled" }}>
          Visão
        </Box>
      </Text>
      <Box sx={{ ml: "auto", display: "flex", alignItems: "center", gap: 0.75, minWidth: 0 }}>
        {/* The dropdown when the host supplies one, otherwise the plain name —
            a panel with no menu still has to say which view is applied. */}
        {view.selector ?? (
          <Text variant="caption" as="span">
            <Box component="span" sx={{ fontWeight: 600 }} data-testid={`${testIdPrefix}-display-view-name`}>
              {view.activeViewName ?? "Visão principal"}
            </Box>
          </Text>
        )}
        {view.dirty && (
          <Box
            component="span"
            aria-label="Alterações não salvas"
            data-testid={`${testIdPrefix}-display-dirty`}
            sx={{ height: 6, width: 6, borderRadius: "50%", bgcolor: "primary.main" }}
          />
        )}
      </Box>
    </Box>
  );
}

/** Redefinir / Salvar como nova / Atualizar, pinned below the tabs. */
function ViewFooter({
  view,
  onDone,
  testIdPrefix,
}: {
  view: DisplayPanelView;
  onDone: () => void;
  testIdPrefix: string;
}): React.JSX.Element {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 1,
        px: 1.5,
        py: 1,
        borderTop: 1,
        borderColor: "divider",
        bgcolor: "action.hover",
      }}
    >
      <Button
        variant="text"
        size="sm"
        color="neutral"
        disabled={!view.dirty}
        startIcon={<RestartAltRoundedIcon fontSize="small" />}
        onClick={view.onReset}
        dataTestId={`${testIdPrefix}-display-reset`}
      >
        Redefinir
      </Button>
      {/* ONE save, not two. "Salvar como nova" alongside it made the primary
          action ambiguous at a glance; which of the two this is depends on
          whether a view is applied, which the label already says. */}
      {/* Enabled only when something in Ordenar / Colunas / Exibição (or the
          filters the view also stores) actually differs from the applied view:
          the filled button is a STATE — "there is something to save" — not a
          permanent fixture. */}
      <Button
        size="sm"
        disabled={!view.dirty}
        startIcon={<SaveOutlinedIcon fontSize="small" />}
        onClick={() => {
          (view.onUpdate ?? view.onSaveAs)();
          onDone();
        }}
        dataTestId={`${testIdPrefix}-display-save`}
      >
        {view.onUpdate ? "Atualizar visão" : "Salvar visão"}
      </Button>
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
  const close = (): void => setAnchor(null);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        color="neutral"
        onClick={(event) => setAnchor(event.currentTarget as HTMLElement)}
        dataTestId={`${testIdPrefix}-display-trigger`}
        aria-label="Exibir"
        title={compact ? "Exibir" : undefined}
      >
        <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
          <TuneRoundedIcon fontSize="small" />
          {!compact && (
            <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
              Exibir
            </Box>
          )}
          {view?.dirty && (
            <Box component="span" sx={{ height: 6, width: 6, borderRadius: "50%", bgcolor: "primary.main" }} />
          )}
          <KeyboardArrowDownRoundedIcon fontSize="small" />
        </Box>
      </Button>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={close}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{ paper: { sx: { width: 320, maxWidth: "calc(100vw - 32px)" } } }}
      >
        <Box data-testid={`${testIdPrefix}-display-panel`}>
          {view && <ViewHeader view={view} testIdPrefix={testIdPrefix} />}
          <PanelTabs tab={tab} onChange={setTab} testIdPrefix={testIdPrefix} />
          {/* Constrained + scrolled: the columns list is unbounded, and a panel
              taller than the viewport puts its own save button off screen. */}
          <Box sx={{ maxHeight: 320, minHeight: 220, overflowY: "auto" }}>
            <PanelBody tab={tab} c={c} sortKinds={sortKinds} testIdPrefix={testIdPrefix} />
          </Box>
          {view && <ViewFooter view={view} onDone={close} testIdPrefix={testIdPrefix} />}
        </Box>
      </Popover>
    </>
  );
}
