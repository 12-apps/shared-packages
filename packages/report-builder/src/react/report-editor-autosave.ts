/**
 * One autosave round: what it needs, and whether it may run.
 *
 * Split out of `report-editor-state` when that file crossed the size gate.
 * The seam is real rather than arbitrary — none of this touches React, and
 * all of it is the rule about *saving*, not about the component holding the
 * refs.
 */
import { discardWorkingCopyAction } from "./custom-reports-api";
import type { PersistedEditorState } from "./report-editor-source";
import { createOnAutosave, sendAutosave } from "./report-editor-writes";
import type { ReportBuilderTransport } from "./transport";

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
export async function runAutosave(deps: AutosaveDeps, state: PersistedEditorState): Promise<boolean> {
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
export function autosaveDeps(input: {
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
export async function runDiscard(
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
/**
 * Whether the autosave timer may fire right now.
 *
 * Off during a manual save, and off during a DISCARD — a timer that fired
 * while the DELETE was in flight would re-park the very edit being thrown
 * away, and the editor would then show the published version while the server
 * quietly kept a copy of what it was told to discard.
 *
 * A report that has never been saved is autosaved TOO, by creating it, but it
 * has to be VALID first: the create endpoint validates the document and a
 * half-built one would 400 on every tick. A report that already exists and
 * parks its edits does not need that check — the park takes anything.
 */
export function mayAutosave({
  saving,
  discarding,
  knownId,
  parksEdits,
  valid,
}: {
  saving: boolean;
  discarding: boolean;
  knownId: string | undefined;
  parksEdits: boolean;
  valid: boolean;
}): boolean {
  if (saving || discarding) return false;
  if (knownId === undefined) return valid;
  return parksEdits || valid;
}
