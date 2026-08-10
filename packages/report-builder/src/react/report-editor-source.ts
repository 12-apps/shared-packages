import { defaultPublishDraft, type PublishDraft } from "./lib/publish-section";
import type { ReportWorkingCopyWire, SavedReportView } from "./custom-reports-api";
import { draftFromDocument, emptyReportDraft, type ReportDraft } from "./report-model";
import type { ReportRollingRange } from "./reports-api";

/**
 * What the report editor OPENS on (FUT-755), resolved from the document the
 * server handed back.
 *
 * The distinction this module exists to keep straight: a report with
 * `status: 'draft'` has never been published and simply saves, while a
 * PUBLISHED report's in-progress edit is parked beside the live document as a
 * WORKING COPY — so reopening the editor resumes that edit, and the published
 * version has to travel alongside it because discarding needs somewhere to
 * land.
 */

/** Everything a save persists. NOT the preview period, which is a control. */
export interface PersistedEditorState {
  draft: ReportDraft;
  publish: PublishDraft;
  defaultRange: ReportRollingRange;
}

/** What the editor opens on, and what "discard" goes back to. */
export interface EditorSource {
  /** The working copy when the server holds one, else the stored document. */
  initial: PersistedEditorState;
  /** The PUBLISHED document — where discarding unpublished changes lands. */
  published: PersistedEditorState;
  /** Whether this report parks its edits instead of writing them through. */
  parksEdits: boolean;
  /** Whether the server is already holding unpublished changes. */
  hasUnpublishedChanges: boolean;
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

/**
 * The parked edit, as editor state — falling back to the published document
 * field by field, so a working copy written before a field existed resumes with
 * the report's own value rather than with a blank.
 */
function fromWorkingCopy(
  copy: ReportWorkingCopyWire,
  published: PersistedEditorState,
): PersistedEditorState {
  return {
    draft: draftFromDocument(copy.name, copy.description ?? null, copy.spec),
    publish: {
      status: copy.status ?? published.publish.status,
      visibility: copy.visibility ?? published.publish.visibility,
      visibilityRoles: copy.visibilityRoles ?? published.publish.visibilityRoles,
    },
    defaultRange: copy.defaultRange ?? published.defaultRange,
  };
}

/**
 * What the editor opens on, and what discarding goes back to (FUT-755).
 *
 * **Reopening resumes the parked edit**, not the published document — that is
 * the whole point of having stored one. The published version is carried along
 * beside it because "descartar alterações" has to have somewhere to land, and
 * re-fetching it later would race the discard that is happening.
 */
export function editorSource(saved: SavedReportView | undefined): EditorSource {
  const published: PersistedEditorState = {
    draft: saved
      ? draftFromDocument(saved.name, saved.description, saved.spec)
      : emptyReportDraft(),
    publish: initialPublishDraft(saved),
    defaultRange: saved?.defaultRange ?? "30d",
  };
  const parked = saved?.workingCopy ?? null;
  return {
    initial: parked ? fromWorkingCopy(parked, published) : published,
    published,
    // Only a PUBLISHED report has readers to protect. A never-published draft
    // (and an archived report, which the editor revives as one) simply saves.
    parksEdits: saved?.status === "published",
    hasUnpublishedChanges: parked !== null,
  };
}

