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
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

import { Alert } from "@12-apps/ui/data-display/Alert";
import { ErrorState } from "@12-apps/ui/data-display/ErrorState";
import { LoadingState } from "@12-apps/ui/data-display/LoadingState";
import { Button } from "@12-apps/ui/form/Button";
import { Input } from "@12-apps/ui/form/Input";
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
import { defaultPublishDraft, PublishSection, type PublishDraft } from "./lib/publish-section";
import { RangeToggle } from "./lib/range-toggle";
import { useUnsavedChanges } from "./lib/use-unsaved-changes";
import { EditorCanvas } from "./report-editor-canvas";
import {
  documentFromDraft,
  draftFromDocument,
  emptyReportDraft,
  type ReportDraft,
} from "./report-model";
import type { ReportRange } from "./reports-api";

/** Validate + persist the draft, landing on the saved report's viewer. */
function useReportSave(
  tenantSlug: string,
  editId: string | undefined,
  draft: ReportDraft,
  publish: PublishDraft,
): { error: string | null; saving: boolean; onSave: () => Promise<boolean> } {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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
    };
    const result = editId
      ? await updateReportAction(tenantSlug, editId, input)
      : await saveReportAction(tenantSlug, input);
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

/** Name + description + publish controls — the report's own metadata. */
function EditorMeta({
  tenantSlug,
  draft,
  publish,
  setDraft,
  setPublish,
}: {
  tenantSlug: string;
  draft: ReportDraft;
  publish: PublishDraft;
  setDraft: (next: (draft: ReportDraft) => ReportDraft) => void;
  setPublish: (next: PublishDraft) => void;
}): JSX.Element {
  return (
    <Stack spacing={2} sx={{ maxWidth: 560 }}>
      <Input
        label="Nome"
        value={draft.name}
        onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
        data-testid="report-editor-name"
      />
      <Input
        label="Descrição (opcional)"
        value={draft.description}
        onChange={(event) => setDraft((prev) => ({ ...prev, description: event.target.value }))}
        data-testid="report-editor-description"
      />
      <PublishSection tenantSlug={tenantSlug} value={publish} onChange={setPublish} />
    </Stack>
  );
}

/** Preview period + the save/cancel pair, above the canvas. */
function EditorActions({
  range,
  onRangeChange,
  saving,
  dirty,
  onCancel,
  onSave,
}: {
  range: ReportRange;
  onRangeChange: (next: ReportRange) => void;
  saving: boolean;
  /** Unsaved work exists — derived from the draft, not raised by an edit. */
  dirty: boolean;
  onCancel: () => void;
  onSave: () => void;
}): JSX.Element {
  return (
    <Stack direction="row" spacing={2} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}>
      <RangeToggle value={range} onChange={onRangeChange} dataTestId="report-editor-range" />
      <Stack direction="row" spacing={1} sx={{ ml: "auto", alignItems: "center" }}>
        {/* Announced politely: a status that only changes colour is invisible
            to a screen reader, and "unsaved" is the one state a person must
            not have to look for. */}
        {dirty ? (
          <Text
            variant="body"
            size="sm"
            color="secondary"
            role="status"
            data-testid="report-editor-dirty"
          >
            Alterações não salvas
          </Text>
        ) : null}
        <Button variant="outline" size="sm" onClick={onCancel} dataTestId="report-editor-cancel">
          Cancelar
        </Button>
        <Button
          variant="solid"
          size="sm"
          onClick={onSave}
          disabled={saving}
          dataTestId="report-editor-save"
        >
          {saving ? "Salvando…" : "Salvar relatório"}
        </Button>
      </Stack>
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
): {
  draft: ReportDraft;
  // The updater form, because EditorMeta patches fields off the previous draft.
  setDraft: Dispatch<SetStateAction<ReportDraft>>;
  publish: PublishDraft;
  setPublish: Dispatch<SetStateAction<PublishDraft>>;
  range: ReportRange;
  setRange: (next: ReportRange) => void;
  error: string | null;
  saving: boolean;
  dirty: boolean;
  save: () => void;
} {
  const [draft, setDraft] = useState<ReportDraft>(initial);
  const [publish, setPublish] = useState<PublishDraft>(initialPublish);
  const [range, setRange] = useState<ReportRange>("30d");
  const { error, saving, onSave } = useReportSave(tenantSlug, editId, draft, publish);

  // Only what a save persists: `range` is a preview control, so choosing a
  // different period must not arm the unsaved-changes guard.
  const { dirty, markSaved } = useUnsavedChanges({
    current: { draft, publish },
    enabled: !saving,
    onSave: async () => {
      const saved = await onSave();
      // A rejected save leaves the report dirty and the guard armed, which is
      // exactly when it protects work.
      if (saved) markSaved({ draft, publish });
    },
  });

  return {
    draft,
    setDraft,
    publish,
    setPublish,
    range,
    setRange,
    error,
    saving,
    dirty,
    save: () => {
      void onSave().then((saved) => {
        if (saved) markSaved({ draft, publish });
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
}: {
  tenantSlug: string;
  editId?: string;
  entities: ReportEntityFields[];
  initial: ReportDraft;
  initialPublish: PublishDraft;
}): JSX.Element {
  const navigate = useNavigate();
  const editor = useEditorState(tenantSlug, editId, initial, initialPublish);
  const { draft, setDraft, publish, setPublish, range, setRange } = editor;
  const { error, saving, dirty, save } = editor;

  return (
    <Stack spacing={3} data-testid="page-report-editor">
      <Stack spacing={0.5}>
        <Link to={`/${tenantSlug}/reports`} data-testid="report-editor-back">
          <Text variant="body" size="sm" color="secondary">
            ← Relatórios
          </Text>
        </Link>
        <Text variant="heading" size="lg" as="h1">
          {editId ? "Editar relatório" : "Novo relatório"}
        </Text>
        <Text variant="body" size="sm" color="secondary">
          Monte o relatório arrastando os blocos; cada bloco mostra os dados reais do período.
        </Text>
      </Stack>

      <EditorMeta
        tenantSlug={tenantSlug}
        draft={draft}
        publish={publish}
        setDraft={setDraft}
        setPublish={setPublish}
      />

      <EditorActions
        range={range}
        onRangeChange={setRange}
        saving={saving}
        dirty={dirty}
        onCancel={() =>
          void navigate(editId ? `/${tenantSlug}/reports/${editId}` : `/${tenantSlug}/reports`)
        }
        onSave={save}
      />

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
        onChange={setDraft}
      />
    </Stack>
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
    />
  );
}
