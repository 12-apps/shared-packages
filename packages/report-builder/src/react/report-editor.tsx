/**
 * Report EDIT mode (FUT-391): the same canvas the viewer renders, with every
 * block inline-editable. There is no separate "builder form" any more — the
 * report is composed where it is read, so layout decisions are made against
 * real data at the real width.
 *
 * A legacy single-spec report (one report = one query, pre-FUT-391) opens here
 * as a one-block report and is saved back as a regular multi-block document.
 *
 * The editor's state, its two save paths and the autosave that keeps work from
 * dying with the tab live in `report-editor-state`; what it opens on lives in
 * `report-editor-source` (both FUT-755). What is left here is the page.
 */
import { useState, type JSX } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { Alert } from "@12-apps/ui/data-display/Alert";
import { ErrorState } from "@12-apps/ui/data-display/ErrorState";
import { LoadingState } from "@12-apps/ui/data-display/LoadingState";
import { Box } from "@12-apps/ui/mui/Box";
import { ThemeProvider } from "@12-apps/ui/mui/styles";
import { Stack } from "@12-apps/ui/mui/Stack";
import { Text } from "@12-apps/ui/typography/Text";

import {
  useReportFields,
  useSavedReport,
  type ReportEntityFields,
} from "./custom-reports-api";
import { DockedPanelRegion } from "./lib/docked-panel";
import { RangeToggle } from "./lib/range-toggle";
import { EditorCanvas } from "./report-editor-canvas";
import { ReportEditorHeader } from "./report-editor-header";
import { editorSource, type EditorSource } from "./report-editor-source";
import { useEditorState } from "./report-editor-state";
import { ExitConfirmDialog, hasPendingWork } from "./report-editor-exit";
import { UnpublishedChangesBar } from "./report-editor-unpublished";
import { ReportSettingsDialog } from "./report-settings-dialog";
import { CONTROL_ROW_SX, EDITOR_SURFACE_SX, useReportPortalTheme } from "./lib/report-surface";
import type { ReportRange } from "./reports-api";
import { useReportCopy } from "./transport-context";

/**
 * The preview period — all that is left on the page above the canvas.
 *
 * Rolling presets only: no `custom` prop, so no `Personalizado…` pill. The two
 * dates a custom window is would have to reach `useRunReport` through
 * `EditorCanvas` and every block, and a block holds its period as a bare
 * `ReportRange`. Offering the pill before that is threaded would send
 * `preset=custom` with nothing to resolve — a 400 per block. `Este mês` needs
 * no dates and is offered here exactly as it is on the viewer.
 */
function EditorActions({
  range,
  onRangeChange,
}: {
  range: ReportRange;
  onRangeChange: (next: ReportRange) => void;
}): JSX.Element {
  const copy = useReportCopy().screens.editor;
  return (
    <Stack
      direction="row"
      spacing={2}
      sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1, ...CONTROL_ROW_SX }}
    >
      <RangeToggle value={range} onChange={onRangeChange} dataTestId="report-editor-range" />
      <Box sx={{ ml: "auto" }}>
        <Text variant="body" size="sm" color="secondary">
          {copy.previewBanner}
        </Text>
      </Box>
    </Stack>
  );
}

/**
 * The Ajustes dialog, wired to the editor's state.
 *
 * Split out because it is the one place that fans a single change across three
 * setters — the page above reads better without that arithmetic in the middle
 * of its layout.
 */
function EditorSettings({
  tenantSlug,
  editor,
  open,
  onClose,
}: {
  tenantSlug: string;
  editor: ReturnType<typeof useEditorState>;
  open: boolean;
  onClose: () => void;
}): JSX.Element {
  const { draft, setDraft, publish, setPublish, defaultRange, setDefaultRange } = editor;
  return (
    <ReportSettingsDialog
      open={open}
      tenantSlug={tenantSlug}
      value={{ name: draft.name, description: draft.description, publish, defaultRange }}
      onChange={(next) => {
        setDraft((prev) => ({ ...prev, name: next.name, description: next.description }));
        setPublish(next.publish);
        setDefaultRange(next.defaultRange);
      }}
      onClose={onClose}
    />
  );
}

/**
 * The header and the question it asks on the way out.
 *
 * They live together because they are one interaction: the header owns the
 * ways out of the editor, and the dialog is what those exits have to say when
 * there is work the store has not been shown yet.
 *
 * The exit now has more than one DESTINATION — the trail offers the report and
 * the list — so the pending href is held while the dialog is open and used to
 * resume. Navigating to a fixed target instead would answer "Sair sem
 * publicar?" by putting you somewhere you did not click, which is a worse bug
 * than the one the prompt exists to prevent: it only shows up when there ARE
 * unsaved changes, i.e. every time it matters.
 */
function EditorTopBar({
  tenantSlug,
  editId,
  editor,
  exitTarget,
  onOpenSettings,
}: {
  tenantSlug: string;
  editId?: string;
  editor: ReturnType<typeof useEditorState>;
  exitTarget: string;
  onOpenSettings: () => void;
}): JSX.Element {
  const navigate = useNavigate();
  /** The href the guard interrupted; `null` while nothing is being asked. */
  const [pendingExit, setPendingExit] = useState<string | null>(null);
  const { draft, setDraft, publish, saving, dirty, save, unpublished } = editor;

  return (
    <>
      <ReportEditorHeader
        tenantSlug={tenantSlug}
        {...(editId ? { editId } : {})}
        name={draft.name}
        publish={publish}
        blockCount={draft.blocks.length}
        saving={saving}
        dirty={dirty}
        autosave={unpublished.autosave}
        onNameChange={(name) => setDraft((prev) => ({ ...prev, name }))}
        onOpenSettings={onOpenSettings}
        onCancel={() => void navigate(exitTarget)}
        onSave={save}
        onBeforeExit={(href) => {
          if (!hasPendingWork(dirty, unpublished.present)) return true;
          setPendingExit(href);
          return false;
        }}
      />
      <ExitConfirmDialog
        open={pendingExit !== null}
        publish={publish}
        onLeave={() => {
          const href = pendingExit ?? exitTarget;
          setPendingExit(null);
          void navigate(href);
        }}
        onStay={() => setPendingExit(null)}
      />
    </>
  );
}

function ReportEditorForm({
  tenantSlug,
  editId,
  entities,
  source,
}: {
  tenantSlug: string;
  editId?: string;
  entities: ReportEntityFields[];
  source: EditorSource;
}): JSX.Element {
  const editor = useEditorState(tenantSlug, editId, source);
  const { draft, setDraft, range, setRange, error, unpublished } = editor;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const exitTarget = editId ? `/${tenantSlug}/reports/${editId}` : `/${tenantSlug}/reports`;
  // One field shape, including the panels rendered through a portal.
  const fieldTheme = useReportPortalTheme();

  return (
    // Everything the editor draws lives inside the region, so opening a block's
    // configuration panel NARROWS this column by the panel's width instead of
    // letting the panel float over the block it is configuring (FUT-755).
    <ThemeProvider theme={fieldTheme}>
    <DockedPanelRegion>
      <Stack spacing={3} sx={EDITOR_SURFACE_SX} data-testid="page-report-editor">
        <EditorTopBar
          tenantSlug={tenantSlug}
          {...(editId ? { editId } : {})}
          editor={editor}
          exitTarget={exitTarget}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        <UnpublishedChangesBar unpublished={unpublished} />

        <EditorActions range={range} onRangeChange={setRange} />

        {error ? (
          <Alert severity="error" data-testid="report-editor-error">
            {error}
          </Alert>
        ) : null}

        <EditorCanvas
          tenantSlug={tenantSlug}
          draft={draft}
          entities={entities}
          range={range}
          // `/new` opens on the picker; `/:id/edit` never does (plan entry 22).
          startWithPicker={editId === undefined}
          onChange={setDraft}
        />
      </Stack>

      <EditorSettings tenantSlug={tenantSlug} editor={editor} open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </DockedPanelRegion>
    </ThemeProvider>
  );
}

/** Which page state the loaded queries put the editor in. */
function editorGate(
  fieldsReady: boolean,
  fieldsError: boolean,
  editing: boolean,
  savedReady: boolean,
  savedError: boolean,
): "error" | "loading" | "ready" {
  if (fieldsError || (editing && savedError)) return "error";
  if (!fieldsReady || (editing && !savedReady)) return "loading";
  return "ready";
}

export function ReportEditorPage({ tenantSlug }: { tenantSlug: string }): JSX.Element {
  const copy = useReportCopy().screens.editor;
  const { reportId } = useParams();
  const editing = Boolean(reportId);
  const fieldsQuery = useReportFields(tenantSlug);
  // Edit mode loads the stored document once (range irrelevant for editing).
  const savedQuery = useSavedReport(tenantSlug, reportId ?? "", "30d");
  const gate = editorGate(
    Boolean(fieldsQuery.data),
    fieldsQuery.isError,
    editing,
    Boolean(savedQuery.data),
    savedQuery.isError,
  );

  if (gate === "error") {
    return (
      <ErrorState
        title={copy.openFailedTitle}
        message={copy.openFailedBody}
        retryLabel={copy.retry}
        onRetry={() => {
          void fieldsQuery.refetch();
          if (editing) void savedQuery.refetch();
        }}
        dataTestId="page-report-editor-error"
      />
    );
  }
  if (gate === "loading" || !fieldsQuery.data) {
    return <LoadingState dataTestId="page-report-editor-loading" />;
  }

  return (
    <ReportEditorForm
      tenantSlug={tenantSlug}
      {...(reportId ? { editId: reportId } : {})}
      entities={fieldsQuery.data.entities}
      source={editorSource(editing ? savedQuery.data : undefined)}
    />
  );
}
