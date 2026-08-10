import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

import { discardWorkingCopyAction } from "./custom-reports-api";
import type { ReportBuilderTransport } from "./transport";
import { useAutosave, type AutosaveState } from "./lib/use-autosave";
import { useUnsavedChanges } from "./lib/use-unsaved-changes";
import type { PublishDraft } from "./lib/publish-section";
import type { EditorSource, PersistedEditorState } from "./report-editor-source";
import type { ReportDraft } from "./report-model";
import {
  createOnAutosave,
  documentGuardError,
  sendAutosave,
  sendSave,
} from "./report-editor-writes";
import type { ReportRange, ReportRollingRange } from "./reports-api";
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

/** Everything one autosave round needs that is not the state being saved. */
interface AutosaveDeps {
  transport: ReportBuilderTransport;
  tenantSlug: string;
  parksEdits: boolean;
  /** The report's id, or undefined for one that has never been saved. */
  knownId: string | undefined;
  /** Guards against a second create while the first POST is still in flight. */
  creating: { current: boolean };
  onCreated: (id: string) => void;
  onStored: () => void;
  markSaved: (state: PersistedEditorState) => void;
}

/**
 * One autosave: create the report if it has never been saved, otherwise park
 * or write through.
 *
 * Extracted from the hook because the CREATE branch is the delicate one — it
 * must run at most once, and every early return here is a case where the
 * baseline must NOT move, so the work stays dirty and the guard stays armed.
 */
async function runAutosave(deps: AutosaveDeps, state: PersistedEditorState): Promise<boolean> {
  const { transport, tenantSlug, parksEdits, knownId, creating } = deps;
  if (knownId === undefined) {
    if (creating.current) return false;
    creating.current = true;
    const created = await createOnAutosave({ transport, tenantSlug, parksEdits }, state);
    creating.current = false;
    if (created === null) return false;
    deps.markSaved(state);
    deps.onCreated(created);
    return true;
  }
  const stored = await sendAutosave(
    { transport, tenantSlug, editId: knownId, parksEdits },
    state,
  );
  if (!stored) return false;
  deps.markSaved(state);
  if (parksEdits) deps.onStored();
  return true;
}

/**
 * Assemble one round's dependencies.
 *
 * A factory rather than an object literal in the hook, because remembering the
 * newly-created id is a rule about autosave and not about the component that
 * happens to hold the ref: `onCreated` must record the id BEFORE anything
 * navigates, or the next timer sees no id and creates a twin.
 */
function autosaveDeps(input: {
  transport: ReportBuilderTransport;
  tenantSlug: string;
  parksEdits: boolean;
  knownId: string | undefined;
  creating: { current: boolean };
  createdId: { current: string | null };
  markSaved: (state: PersistedEditorState) => void;
  onStored: () => void;
  afterCreate: (id: string) => void;
}): AutosaveDeps {
  return {
    transport: input.transport,
    tenantSlug: input.tenantSlug,
    parksEdits: input.parksEdits,
    knownId: input.knownId,
    creating: input.creating,
    markSaved: input.markSaved,
    onStored: input.onStored,
    onCreated: (id) => {
      input.createdId.current = id;
      input.afterCreate(id);
    },
  };
}

/**
 * Throwing the parked edit away.
 *
 * Restoring is deliberately CLEAN: the baseline moves to the published state
 * along with the screen, so the unsaved-changes guard does not then claim the
 * reset itself is unsaved work and re-offer to save what was just discarded.
 */
async function runDiscard(
  target: { transport: ReportBuilderTransport; tenantSlug: string; editId: string },
  outcome: {
    published: PersistedEditorState;
    done: () => void;
    failed: (message: string) => void;
    restored: () => void;
  },
): Promise<void> {
  const result = await discardWorkingCopyAction(
    target.transport,
    target.tenantSlug,
    target.editId,
  );
  outcome.done();
  if (!result.ok) {
    outcome.failed(result.error);
    return;
  }
  outcome.restored();
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
  const navigate = useNavigate();
  const [present, setPresent] = useState(source.hasUnpublishedChanges);
  const [discarding, setDiscarding] = useState(false);

  // The id of a report this hook CREATED, held for the render or two between
  // the POST resolving and the route param catching up. Without it the next
  // timer would see `editId === undefined` and create a second report.
  const createdId = useRef<string | null>(null);
  // Set for the whole duration of a create, so a timer that fires while the
  // POST is still in flight waits rather than starting a twin.
  const creating = useRef(false);
  const knownId = editId ?? createdId.current ?? undefined;
  const runnerDeps = autosaveDeps({
    transport,
    tenantSlug,
    parksEdits: source.parksEdits,
    knownId,
    creating,
    createdId,
    markSaved: context.markSaved,
    onStored: () => setPresent(true),
    afterCreate: (id) => {
      void queryClient.invalidateQueries({ queryKey: ["admin", tenantSlug, "reports"] });
      void navigate(`/${tenantSlug}/reports/${id}/edit`, { replace: true });
    },
  });

  const autosave = useAutosave({
    value: persisted,
    dirty: context.dirty,
    // A report that has never been saved is autosaved TOO, by creating it —
    // see `createOnAutosave` for why that is safe now and was not before. It
    // has to be valid first, though: the create endpoint validates the
    // document, and a half-built one would 400 on every tick.
    //
    // Off during a DISCARD as well as during a manual save: a timer that fired
    // while the DELETE was in flight would re-park the very edit being thrown
    // away, and the editor would then show the published version while the
    // server quietly kept a copy of what it was told to discard.
    enabled:
      !context.saving &&
      !discarding &&
      (knownId === undefined
        ? !documentGuardError(persisted)
        : source.parksEdits || !documentGuardError(persisted)),
    onSave: (state) => runAutosave(runnerDeps, state),
  });

  function discard(): void {
    if (editId === undefined) return;
    setDiscarding(true);
    void runDiscard({ transport, tenantSlug, editId }, {
      published: source.published,
      done: () => setDiscarding(false),
      failed: context.setError,
      restored: () => {
        context.reset(source.published);
        context.markSaved(source.published);
        setPresent(false);
        void queryClient.invalidateQueries({ queryKey: ["admin", tenantSlug, "reports"] });
      },
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

