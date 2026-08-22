/**
 * How an edit reaches the server, and the guard that decides whether it may.
 *
 * Split out of `report-editor-state` so that module stays about STATE. These
 * are the write paths: validate, then either create, park beside the published
 * document, or write straight through.
 */
import { publishGuardError } from "./builder-model";
import {
  saveReportAction,
  saveWorkingCopyAction,
  publishWorkingCopyAction,
  updateReportAction,
  type ReportWorkingCopyWire,
} from "./custom-reports-api";
import type { Result } from "./lib/rest-result";
import type { PersistedEditorState } from "./report-editor-source";
import type { ReportBuilderPanelCopy, ReportEditorCopy } from "./screens-copy";
import { documentFromDraft } from "./report-model";
import type { ReportBuilderTransport } from "./transport";

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
export function documentGuardError(
  state: PersistedEditorState,
  copy: ReportEditorCopy,
  builderCopy: ReportBuilderPanelCopy,
): string | null {
  if (state.draft.name.trim() === "") return copy.needsName;
  if (state.draft.blocks.length === 0) return copy.needsBlock;
  return publishGuardError(state.publish, builderCopy);
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
export function sendSave(
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
export async function sendAutosave(
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

/**
 * The FIRST autosave of a report that has never been saved: it has to CREATE
 * the row, because there is nothing yet to park an edit against.
 *
 * This used to be excluded from autosave entirely, on the grounds that
 * creating a row behind the author's back would drop half-built reports into
 * everyone's list. That reasoning was sound; its premise is not any more. A
 * new report now starts as a PRIVATE DRAFT (`defaultPublishDraft`), so the row
 * this creates is visible to its author and nobody else, and the objection
 * goes away — an unfinished report is no longer something the store can see.
 *
 * Returns the new id so the caller can point the editor at it. Getting that
 * wrong is how you end up with a second report per keystroke.
 */
export async function createOnAutosave(
  context: WriteContext,
  state: PersistedEditorState,
): Promise<string | null> {
  const result = await sendSave(context, state);
  return result.ok ? result.data.id : null;
}
