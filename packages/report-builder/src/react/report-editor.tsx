/**
 * Report EDIT mode (FUT-391): the same canvas the viewer renders, with every
 * block inline-editable. There is no separate "builder form" any more — the
 * report is composed where it is read, so layout decisions are made against
 * real data at the real width.
 *
 * A legacy single-spec report (one report = one query, pre-FUT-391) opens here
 * as a one-block report and is saved back as a regular multi-block document.
 */
import { useState, type Dispatch, type JSX, type SetStateAction } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

import { Alert } from "@12-apps/ui/data-display/Alert";
import { ErrorState } from "@12-apps/ui/data-display/ErrorState";
import { LoadingState } from "@12-apps/ui/data-display/LoadingState";
import { Box } from "@12-apps/ui/mui/Box";
import { ThemeProvider } from "@12-apps/ui/mui/styles";
import { Stack } from "@12-apps/ui/mui/Stack";
import { Text } from "@12-apps/ui/typography/Text";

import { publishGuardError } from "./builder-model";
import {
  saveReportAction,
  updateReportAction,
  useReportFields,
  useSavedReport,
  type ReportEntityFields,
  type SavedReportView,
} from "./custom-reports-api";
import { DockedPanelRegion } from "./lib/docked-panel";
import { defaultPublishDraft, type PublishDraft } from "./lib/publish-section";
import { RangeToggle } from "./lib/range-toggle";
import { useUnsavedChanges } from "./lib/use-unsaved-changes";
import { EditorCanvas } from "./report-editor-canvas";
import { ReportEditorHeader } from "./report-editor-header";
import { ReportSettingsDialog } from "./report-settings-dialog";
import { CONTROL_ROW_SX, EDITOR_SURFACE_SX, useReportPortalTheme } from "./lib/report-surface";
import {
  documentFromDraft,
  draftFromDocument,
  emptyReportDraft,
  type ReportDraft,
} from "./report-model";
import type { ReportRange, ReportRollingRange } from "./reports-api";
import { useTransport } from "./transport-context";

/** Validate + persist the draft, landing on the saved report's viewer. */
function useReportSave(
  tenantSlug: string,
  editId: string | undefined,
  draft: ReportDraft,
  publish: PublishDraft,
  defaultRange: ReportRollingRange,
): { error: string | null; saving: boolean; onSave: () => Promise<boolean> } {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const transport = useTransport();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSave(): Promise<boolean> {
    setError(null);
    const invalid =
      draft.name.trim() === ""
        ? "Dê um nome ao relatório antes de salvar."
        : draft.blocks.length === 0
          ? "Adicione ao menos um bloco ao relatório."
          : publishGuardError(publish);
    if (invalid) {
      setError(invalid);
      return false;
    }
    setSaving(true);
    const input = {
      name: draft.name.trim(),
      ...(draft.description.trim() === "" ? {} : { description: draft.description.trim() }),
      spec: documentFromDraft(draft),
      status: publish.status,
      visibility: publish.visibility,
      visibilityRoles: publish.visibility === "roles" ? publish.visibilityRoles : [],
      defaultRange,
    };
    const result = editId
      ? await updateReportAction(transport, tenantSlug, editId, input)
      : await saveReportAction(transport, tenantSlug, input);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    void queryClient.invalidateQueries({ queryKey: ["admin", tenantSlug, "reports"] });
    void navigate(`/${tenantSlug}/reports/${result.data.id}`);
    return true;
  }

  return { error, saving, onSave };
}

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
  return (
    <Stack
      direction="row"
      spacing={2}
      sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1, ...CONTROL_ROW_SX }}
    >
      <RangeToggle value={range} onChange={onRangeChange} dataTestId="report-editor-range" />
      <Box sx={{ ml: "auto" }}>
        <Text variant="body" size="sm" color="secondary">
          Pré-visualização com dados reais
        </Text>
      </Box>
    </Stack>
  );
}

/**
 * The editor's whole mutable state: the draft, the publish settings, the
 * preview period, and the save that ties them together.
 *
 * Extracted so the form stays a rendering function. It also puts the
 * unsaved-changes wiring in one place, where the rule that matters is visible:
 * the baseline moves ONLY on a successful save.
 */
function useEditorState(
  tenantSlug: string,
  editId: string | undefined,
  initial: ReportDraft,
  initialPublish: PublishDraft,
  initialRange: ReportRollingRange,
): {
  draft: ReportDraft;
  // The updater form, because EditorMeta patches fields off the previous draft.
  setDraft: Dispatch<SetStateAction<ReportDraft>>;
  publish: PublishDraft;
  setPublish: Dispatch<SetStateAction<PublishDraft>>;
  range: ReportRange;
  setRange: (next: ReportRange) => void;
  /** The period the SAVED report will open on — persisted, unlike `range`. */
  defaultRange: ReportRollingRange;
  setDefaultRange: (next: ReportRollingRange) => void;
  error: string | null;
  saving: boolean;
  dirty: boolean;
  save: () => void;
} {
  const [draft, setDraft] = useState<ReportDraft>(initial);
  const [publish, setPublish] = useState<PublishDraft>(initialPublish);
  const [defaultRange, setDefaultRange] = useState<ReportRollingRange>(initialRange);
  // The preview STARTS on the report's own default: the editor should open on
  // the period the reader will (FUT-755). It is then free to differ — moving
  // the toggle previews another window without changing what is stored.
  const [range, setRange] = useState<ReportRange>(initialRange);
  const { error, saving, onSave } = useReportSave(
    tenantSlug,
    editId,
    draft,
    publish,
    defaultRange,
  );

  // Only what a save persists: `range` is a preview control, so choosing a
  // different period must not arm the unsaved-changes guard — while
  // `defaultRange`, which IS stored, must.
  const persisted = { draft, publish, defaultRange };
  const { dirty, markSaved } = useUnsavedChanges({
    current: persisted,
    enabled: !saving,
    onSave: async () => {
      const saved = await onSave();
      // A rejected save leaves the report dirty and the guard armed, which is
      // exactly when it protects work.
      if (saved) markSaved(persisted);
    },
  });

  return {
    draft,
    setDraft,
    publish,
    setPublish,
    range,
    setRange,
    defaultRange,
    setDefaultRange,
    error,
    saving,
    dirty,
    save: () => {
      void onSave().then((saved) => {
        if (saved) markSaved(persisted);
      });
    },
  };
}

function ReportEditorForm({
  tenantSlug,
  editId,
  entities,
  initial,
  initialPublish,
  initialRange,
}: {
  tenantSlug: string;
  editId?: string;
  entities: ReportEntityFields[];
  initial: ReportDraft;
  initialPublish: PublishDraft;
  initialRange: ReportRollingRange;
}): JSX.Element {
  const navigate = useNavigate();
  const editor = useEditorState(tenantSlug, editId, initial, initialPublish, initialRange);
  const { draft, setDraft, publish, setPublish, range, setRange } = editor;
  const { defaultRange, setDefaultRange, error, saving, dirty, save } = editor;
  const [settingsOpen, setSettingsOpen] = useState(false);
  // One field shape, including the panels rendered through a portal.
  const fieldTheme = useReportPortalTheme();

  return (
    // Everything the editor draws lives inside the region, so opening a block's
    // configuration panel NARROWS this column by the panel's width instead of
    // letting the panel float over the block it is configuring (FUT-755).
    <ThemeProvider theme={fieldTheme}>
    <DockedPanelRegion>
      <Stack spacing={3} sx={EDITOR_SURFACE_SX} data-testid="page-report-editor">
        <ReportEditorHeader
          tenantSlug={tenantSlug}
          {...(editId ? { editId } : {})}
          name={draft.name}
          publish={publish}
          blockCount={draft.blocks.length}
          saving={saving}
          dirty={dirty}
          onNameChange={(name) => setDraft((prev) => ({ ...prev, name }))}
          onOpenSettings={() => setSettingsOpen(true)}
          onCancel={() =>
            void navigate(editId ? `/${tenantSlug}/reports/${editId}` : `/${tenantSlug}/reports`)
          }
          onSave={save}
        />

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

      <ReportSettingsDialog
        open={settingsOpen}
        tenantSlug={tenantSlug}
        value={{ name: draft.name, description: draft.description, publish, defaultRange }}
        onChange={(next) => {
          setDraft((prev) => ({ ...prev, name: next.name, description: next.description }));
          setPublish(next.publish);
          setDefaultRange(next.defaultRange);
        }}
        onClose={() => setSettingsOpen(false)}
      />
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

/** The stored lifecycle/sharing values, or the go-live defaults when new. */
function initialPublishDraft(saved: SavedReportView | undefined): PublishDraft {
  if (!saved) return defaultPublishDraft();
  return {
    // An ARCHIVED report being edited goes back to the shelf as a draft: a save
    // is an intent to keep working on it, not a silent un-archive.
    status: saved.status === "archived" ? "draft" : saved.status,
    visibility: saved.visibility,
    visibilityRoles: saved.visibilityRoles,
  };
}

export function ReportEditorPage({ tenantSlug }: { tenantSlug: string }): JSX.Element {
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
        title="Não foi possível abrir o editor"
        message="Verifique sua permissão ou tente novamente."
        retryLabel="Tentar novamente"
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

  const saved = editing ? savedQuery.data : undefined;
  const initial = saved
    ? draftFromDocument(saved.name, saved.description, saved.spec)
    : emptyReportDraft();

  return (
    <ReportEditorForm
      tenantSlug={tenantSlug}
      {...(reportId ? { editId: reportId } : {})}
      entities={fieldsQuery.data.entities}
      initial={initial}
      initialPublish={initialPublishDraft(saved)}
      initialRange={saved?.defaultRange ?? "30d"}
    />
  );
}
