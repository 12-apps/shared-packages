"use client";

import DownloadRoundedIcon from "@mui/icons-material/DownloadRounded";
import KeyboardArrowDownRoundedIcon from "@mui/icons-material/KeyboardArrowDownRounded";
import { CircularProgress, Popover } from "@mui/material";
import { useState } from "react";

import { useDataViewsCopy } from "./data-views-copy-context";
import { Button } from "../../form/Button";
import { Box } from "../../../mui/Box";
import { Text } from "../../typography/Text";

import type { DataViewQuery } from "./data-views-types";

/**
 * EXPORT — the current QUERY, never the rendered page.
 *
 * Exporting what happens to be on screen is the single most common bug in an
 * admin table: the operator filtered 214 records, sees 25, exports, and gets
 * 25 — with nothing anywhere saying so. So this control does not touch the
 * loaded rows at all. It hands the host the same `DataViewQuery` the grid is
 * showing, unpaginated, and the HOST re-queries the backend — the same
 * division as everywhere else here: the component emits, the host fetches.
 *
 * The menu states the number it is about to export before the click, so the
 * two possible answers (the selection, or the whole filtered set) are never a
 * guess.
 */

/** What a host can be asked to produce. */
export type DataViewExportFormat = "xlsx" | "csv" | "json";

/** The request handed to the host when the operator picks a format. */
export interface DataViewExportRequest {
  format: DataViewExportFormat;
  /**
   * The live query with `page: 1` and `pageSize` set to the whole matched
   * total — i.e. "everything this filter selects", not this page.
   */
  query: DataViewQuery;
  /**
   * The selected row ids, when the operator has a selection. The host filters
   * the re-queried rows to these; absent means the whole filtered set.
   */
  selectedIds?: Array<string | number>;
  /** The visible columns, in the operator's current order. */
  columns: { id: string; label: string }[];
}

/** Injected export. Absent ⇒ no Exportar control, exactly like `renderCard`. */
export interface DataViewExport {
  /** Runs the export. Awaited, so the trigger can show it is working. */
  onExport: (request: DataViewExportRequest) => Promise<void> | void;
  /** Formats to offer, in menu order. Defaults to all three. */
  formats?: DataViewExportFormat[];
}

/** One line per format: what it is, and when to reach for it. */

const ALL_FORMATS: DataViewExportFormat[] = ["xlsx", "csv", "json"];

interface ExportMenuProps {
  config: DataViewExport;
  /** The live query — copied and unpaginated before it reaches the host. */
  query: DataViewQuery;
  /** The unpaginated total, so the label can state what "tudo" means. */
  totalCount: number;
  selectedIds: Array<string | number>;
  columns: { id: string; label: string }[];
  testIdPrefix: string;
  /** Render icon-only (measured upstream). */
  compact?: boolean;
}

/** "Exportando 214 itens filtrados" / "3 itens selecionados" — never a guess. */
function scopeLabel(selected: number, total: number): string {
  if (selected > 0) {
    return `${selected} ${selected === 1 ? "item selecionado" : "itens selecionados"}`;
  }
  return `${total} ${total === 1 ? "item filtrado" : "itens filtrados"}`;
}

/** The trigger. Shows a spinner while the host's export is still running. */
function ExportTrigger({
  busy,
  onOpen,
  testIdPrefix,
  compact,
}: {
  busy: boolean;
  onOpen: (anchor: HTMLElement) => void;
  testIdPrefix: string;
  /** Icon only — step 2 of the toolbar's degradation ladder. */
  compact?: boolean;
}): React.JSX.Element {
  const copy = useDataViewsCopy();
  return (
    <Button
      variant="outline"
      size="sm"
      color="neutral"
      disabled={busy}
      onClick={(event) => onOpen(event.currentTarget as HTMLElement)}
      dataTestId={`${testIdPrefix}-export-trigger`}
      aria-label={copy.export.trigger}
      // The label is gone, so the tooltip is the only thing naming the control.
      title={compact ? copy.export.trigger : undefined}
    >
      <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
        {busy ? <CircularProgress size={14} /> : <DownloadRoundedIcon fontSize="small" />}
        {!compact && (
          <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
            Exportar
          </Box>
        )}
        {/* Dropped with the label — see the note on the Exibir trigger. */}
        {!compact && <KeyboardArrowDownRoundedIcon fontSize="small" />}
      </Box>
    </Button>
  );
}

/** One format row: what it produces, and when to reach for it. */
function FormatRow({
  format,
  onPick,
  testIdPrefix,
}: {
  format: DataViewExportFormat;
  onPick: () => void;
  testIdPrefix: string;
}): React.JSX.Element {
  const copy = useDataViewsCopy();
  return (
    <Box
      component="button"
      type="button"
      onClick={onPick}
      data-testid={`${testIdPrefix}-export-${format}`}
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        width: "100%",
        px: 1.5,
        py: 1,
        border: 0,
        background: "none",
        cursor: "pointer",
        font: "inherit",
        textAlign: "left",
        "&:hover": { bgcolor: "action.hover" },
      }}
    >
      <Box component="span" sx={{ fontSize: "0.8125rem" }}>
        {copy.export.formats[format]?.label ?? format}
      </Box>
      <Box component="span" sx={{ fontSize: "0.6875rem", color: "text.disabled" }}>
        {copy.export.formats[format]?.hint ?? ""}
      </Box>
    </Box>
  );
}

/** The panel: what is about to be exported, then the formats. */
function ExportPanel({
  formats,
  selectedCount,
  totalCount,
  columnCount,
  onPick,
  testIdPrefix,
}: {
  formats: DataViewExportFormat[];
  selectedCount: number;
  totalCount: number;
  columnCount: number;
  onPick: (format: DataViewExportFormat) => void;
  testIdPrefix: string;
}): React.JSX.Element {
  const copy = useDataViewsCopy();
  return (
    <Box data-testid={`${testIdPrefix}-export-panel`}>
      <Box sx={{ px: 1.5, pt: 1, pb: 1, borderBottom: 1, borderColor: "divider" }}>
        <Text variant="caption" as="p">
          <Box component="span" data-testid={`${testIdPrefix}-export-scope`}>
            Exportando {scopeLabel(selectedCount, totalCount)}
          </Box>
        </Text>
        <Text variant="caption" as="p">
          <Box component="span" sx={{ color: "text.disabled" }}>
            {copy.export.visibleColumns(columnCount)}
          </Box>
        </Text>
      </Box>
      {formats.map((format) => (
        <FormatRow
          key={format}
          format={format}
          onPick={() => onPick(format)}
          testIdPrefix={testIdPrefix}
        />
      ))}
    </Box>
  );
}

/** The toolbar's Exportar control. Renders nothing when no host wired it. */
export function DataViewsExportMenu({
  config,
  query,
  totalCount,
  selectedIds,
  columns,
  testIdPrefix,
  compact,
}: ExportMenuProps): React.JSX.Element {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (format: DataViewExportFormat): Promise<void> => {
    setAnchor(null);
    setBusy(true);
    try {
      await config.onExport({
        format,
        // UNPAGINATED: page 1 of a page as large as the whole result. The host
        // re-queries with this; nothing here reads the loaded rows.
        query: { ...query, page: 1, pageSize: Math.max(1, totalCount) },
        selectedIds: selectedIds.length > 0 ? [...selectedIds] : undefined,
        columns,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ExportTrigger busy={busy} onOpen={setAnchor} testIdPrefix={testIdPrefix} compact={compact} />
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{ paper: { sx: { width: 260, maxWidth: "calc(100vw - 32px)" } } }}
      >
        <ExportPanel
          formats={config.formats ?? ALL_FORMATS}
          selectedCount={selectedIds.length}
          totalCount={totalCount}
          columnCount={columns.length}
          onPick={(format) => void run(format)}
          testIdPrefix={testIdPrefix}
        />
      </Popover>
    </>
  );
}
