import { useState, type Dispatch, type SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

import { publishGuardError } from "./builder-model";
import {
  discardWorkingCopyAction,
  publishWorkingCopyAction,
  saveReportAction,
  saveWorkingCopyAction,
  updateReportAction,
  type ReportWorkingCopyWire,
} from "./custom-reports-api";
import { useAutosave, type AutosaveState } from "./lib/use-autosave";
import { useUnsavedChanges } from "./lib/use-unsaved-changes";
import type { PublishDraft } from "./lib/publish-section";
import type { Result } from "./lib/rest-result";
import type { EditorSource, PersistedEditorState } from "./report-editor-source";
import { documentFromDraft, type ReportDraft } from "./report-model";
import type { ReportRange, ReportRollingRange } from "./reports-api";
import type { ReportBuilderTransport } from "./transport";
import { useTransport } from "./transport-context";

/**
 * The report editor's mutable state, and the two ways an edit reaches the
 * server (FUT-755).
 *
 * Extracted from `report-editor` so the page stays a rendering function, and
 * because the rule that matters is easier to see with the two paths side by
 * side:
 *
 *  - a report that has never been published (`status: 'draft'`, or an archived
 *    one being revived) has no reader to protect, so an edit is written
 *    straight through;
 *  - a PUBLISHED report's readers are looking at it right now, so the edit is
 *    parked as a WORKING COPY and `spec` stays live until the author saves.
 *
 * The unsaved-changes baseline moves ONLY on a save the server accepted —
 * manual or autosaved. That is what leaves a failed save dirty and its
 * tab-close guard armed, which is the moment it protects work.
 */

/** The save payload — the same shape a working copy is stored as. */
function toSaveInput(state: PersistedEditorState): ReportWorkingCopyWire {
  const description = state.draft.description.trim();
  return {
    name: state.draft.name.trim(),
    ...(description === "" ? {} : { description }),
    spec: documentFromDraft(state.draft),
    status: state.publish.status,
    visibility: state.publish.visibility,
    visibilityRoles: state.publish.visibility === "roles" ? state.publish.visibilityRoles : [],
    defaultRange: state.defaultRange,
  };
}

/**
 * Why this document cannot go live yet, in the author's words — or null.
 *
 * Shared by the Salvar button (which shows it) and by the autosave (which uses
 * it to stay QUIET): a half-built report is not an error to shout about, it is
 * a report that is not finished, so autosave simply does not run until it can
 * succeed rather than flashing a red alert at every keystroke.
 */
function documentGuardError(state: PersistedEditorState): string | null {
  if (state.draft.name.trim() === "") return "Dê um nome ao relatório antes de salvar.";
  if (state.draft.blocks.length === 0) return "Adicione ao menos um bloco ao relatório.";
  return publishGuardError(state.publish);
}

/** Who a write is for: which tenant, which report, and which promise it makes. */
interface WriteContext {
  transport: ReportBuilderTransport;
  tenantSlug: string;
  /** Absent on a report that has never been saved. */
  editId?: string;
  /** True when this report's edits are parked rather than written through. */
  parksEdits: boolean;
}

/**
 * One MANUAL save.
 *
 * Saving a published report PUBLISHES the parked edit and drops it, in one
 * server-side write: the button that says Salvar is the one that makes a change
 * visible to readers, and it must not leave behind a phantom "alterações não
 * publicadas" pointing at what it just published.
 */
function sendSave(
  context: WriteContext,
  state: PersistedEditorState,
): Promise<Result<{ id: string }>> {
  const { transport, tenantSlug, editId, parksEdits } = context;
  const input = toSaveInput(state);
  if (editId === undefined) return saveReportAction(transport, tenantSlug, input);
  return parksEdits
    ? publishWorkingCopyAction(transport, tenantSlug, editId, input)
    : updateReportAction(transport, tenantSlug, editId, input);
}

/**
 * One AUTOSAVE round trip: park it beside the published document, or — for a
 * report nobody is reading yet — write it straight through.
 */
async function sendAutosave(
  context: WriteContext & { editId: string },
  state: PersistedEditorState,
): Promise<boolean> {
  const { transport, tenantSlug, editId, parksEdits } = context;
  const input = toSaveInput(state);
  const result = parksEdits
    ? await saveWorkingCopyAction(transport, tenantSlug, editId, input)
    : await updateReportAction(transport, tenantSlug, editId, input);
  return result.ok;
}

/** Validate + persist the state, landing on the saved report's viewer. */
function useSaveDocument(
  tenantSlug: string,
  editId: string | undefined,
  source: EditorSource,
): {
  error: string | null;
  setError: (message: string | null) => void;
  saving: boolean;
  save: (state: PersistedEditorState) => Promise<boolean>;
} {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const transport = useTransport();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(state: PersistedEditorState): Promise<boolean> {
    setError(null);
    const invalid = documentGuardError(state);
    if (invalid) {
      setError(invalid);
      return false;
    }
    setSaving(true);
    const result = await sendSave(
      { transport, tenantSlug, ...(editId ? { editId } : {}), parksEdits: source.parksEdits },
      state,
    );
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    void queryClient.invalidateQueries({ queryKey: ["admin", tenantSlug, "reports"] });
    void navigate(`/${tenantSlug}/reports/${result.data.id}`);
    return true;
  }

  return { error, setError, saving, save };
}

/** What the editor shows and offers about unpublished changes. */
export interface UnpublishedChanges {
  /** The server is holding an edit the readers have not been shown. */
  present: boolean;
  /** Autosave's own state, so a FAILED autosave is visible rather than silent. */
  autosave: AutosaveState;
  discarding: boolean;
  /** Throw the parked edit away and put the published version back on screen. */
  discard: () => void;
}

interface ReportEditorState {
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
  unpublished: UnpublishedChanges;
}

/** The document being edited, plus the preview period that is not part of it. */
interface DocumentState {
  draft: ReportDraft;
  setDraft: Dispatch<SetStateAction<ReportDraft>>;
  publish: PublishDraft;
  setPublish: Dispatch<SetStateAction<PublishDraft>>;
  range: ReportRange;
  setRange: (next: ReportRange) => void;
  defaultRange: ReportRollingRange;
  setDefaultRange: (next: ReportRollingRange) => void;
  /** Put a whole state back on screen — what discarding an edit lands on. */
  reset: (state: PersistedEditorState) => void;
}

function useDocumentState(initial: PersistedEditorState): DocumentState {
  const [draft, setDraft] = useState<ReportDraft>(initial.draft);
  const [publish, setPublish] = useState<PublishDraft>(initial.publish);
  const [defaultRange, setDefaultRange] = useState<ReportRollingRange>(initial.defaultRange);
  // The preview STARTS on the report's own default: the editor should open on
  // the period the reader will (FUT-755). It is then free to differ — moving
  // the toggle previews another window without changing what is stored.
  const [range, setRange] = useState<ReportRange>(initial.defaultRange);

  return {
    draft,
    setDraft,
    publish,
    setPublish,
    range,
    setRange,
    defaultRange,
    setDefaultRange,
    reset: (state) => {
      setDraft(state.draft);
      setPublish(state.publish);
      setDefaultRange(state.defaultRange);
    },
  };
}

/**
 * The parked edit: keeping it current, and the one way it is thrown away.
 *
 * Autosave and discard live together because they are the two halves of the
 * same promise — one puts work somewhere safe without touching the published
 * document, the other removes it without touching the published document
 * either.
 */
function useWorkingCopy(context: {
  tenantSlug: string;
  editId: string | undefined;
  source: EditorSource;
  persisted: PersistedEditorState;
  dirty: boolean;
  saving: boolean;
  markSaved: (state: PersistedEditorState) => void;
  reset: (state: PersistedEditorState) => void;
  setError: (message: string | null) => void;
}): UnpublishedChanges {
  const { tenantSlug, editId, source, persisted } = context;
  const transport = useTransport();
  const queryClient = useQueryClient();
  const [present, setPresent] = useState(source.hasUnpublishedChanges);
  const [discarding, setDiscarding] = useState(false);

  const autosave = useAutosave({
    value: persisted,
    dirty: context.dirty,
    // A brand-new report has no row to park against, and creating one behind
    // the author's back would drop half-built reports into everyone's list.
    // The tab-close guard still covers that case.
    //
    // Off during a DISCARD as well as during a manual save: a timer that fired
    // while the DELETE was in flight would re-park the very edit being thrown
    // away, and the editor would then show the published version while the
    // server quietly kept a copy of what it was told to discard.
    enabled:
      editId !== undefined &&
      !context.saving &&
      !discarding &&
      (source.parksEdits || !documentGuardError(persisted)),
    onSave: async (state) => {
      const stored = await sendAutosave(
        { transport, tenantSlug, editId: editId ?? "", parksEdits: source.parksEdits },
        state,
      );
      if (!stored) return false;
      context.markSaved(state);
      if (source.parksEdits) setPresent(true);
      return true;
    },
  });

  function discard(): void {
    if (editId === undefined) return;
    setDiscarding(true);
    void discardWorkingCopyAction(transport, tenantSlug, editId).then((result) => {
      setDiscarding(false);
      if (!result.ok) {
        context.setError(result.error);
        return;
      }
      // Back to what the readers have been seeing all along, and CLEAN: the
      // baseline moves with it, so the guard does not then claim the reset
      // itself is unsaved work.
      context.reset(source.published);
      context.markSaved(source.published);
      setPresent(false);
      void queryClient.invalidateQueries({ queryKey: ["admin", tenantSlug, "reports"] });
    });
  }

  return { present, autosave, discarding, discard };
}

export function useEditorState(
  tenantSlug: string,
  editId: string | undefined,
  source: EditorSource,
): ReportEditorState {
  const document = useDocumentState(source.initial);
  const { error, setError, saving, save } = useSaveDocument(tenantSlug, editId, source);

  // Only what a save persists: `range` is a preview control, so choosing a
  // different period must not arm the unsaved-changes guard — while
  // `defaultRange`, which IS stored, must.
  const persisted: PersistedEditorState = {
    draft: document.draft,
    publish: document.publish,
    defaultRange: document.defaultRange,
  };
  const { dirty, markSaved } = useUnsavedChanges({
    current: persisted,
    enabled: !saving,
    onSave: async () => {
      // A rejected save leaves the report dirty and the guard armed, which is
      // exactly when it protects work.
      if (await save(persisted)) markSaved(persisted);
    },
  });

  const unpublished = useWorkingCopy({
    tenantSlug,
    editId,
    source,
    persisted,
    dirty,
    saving,
    markSaved,
    reset: document.reset,
    setError,
  });

  return {
    ...document,
    error,
    saving,
    dirty,
    save: () => {
      void save(persisted).then((saved) => {
        if (saved) markSaved(persisted);
      });
    },
    unpublished,
  };
}

