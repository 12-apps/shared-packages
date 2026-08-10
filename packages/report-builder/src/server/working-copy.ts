import { z } from 'zod';

import { reportDocumentSchema } from '../spec';

import { REPORT_DEFAULT_RANGES } from './range';
import { REPORT_STATUSES, REPORT_VISIBILITIES } from './visibility';

/**
 * Unpublished changes to a PUBLISHED report (FUT-755) — the author's
 * in-progress edit, kept BESIDE the live document.
 *
 * This is not `status: 'draft'`, and the two must never blur:
 *
 *  - `status: 'draft'` is a report that has NEVER been published. Only its
 *    author sees it, so editing one can simply save — there is nothing to
 *    protect.
 *  - A **working copy** belongs to a report that IS published. Its readers are
 *    looking at it right now, and flipping its status to `draft` while someone
 *    edits would unpublish it for the whole store — a far worse outcome than
 *    losing an edit. So the edit is parked here and `spec` stays live until the
 *    author publishes.
 *
 * A working copy therefore only ever exists for `status: 'published'`; see
 * {@link parksEditsInWorkingCopy}, which is the one place that rule is written.
 */

/**
 * What a working copy holds: the WHOLE editable payload, not just the spec.
 *
 * Renaming a published report, narrowing its sharing or changing the period it
 * opens on are edits with exactly the same problem as changing a block — they
 * would be visible to readers the instant they were saved. So all of them park
 * together and go live together, which also means publishing is one write
 * rather than a set of fields that could half-apply.
 *
 * `name` is deliberately allowed to be EMPTY here while the strict save body
 * requires one. An autosave fires mid-edit, and mid-edit is exactly when a name
 * is briefly blank because someone selected it and started retyping; rejecting
 * that would drop the very keystrokes this feature exists to keep. The strict
 * schema still guards the moment it goes live.
 */
export const reportWorkingCopySchema = z.object({
  name: z.string().max(120),
  description: z.string().max(500).nullish(),
  spec: reportDocumentSchema,
  status: z.enum(REPORT_STATUSES).optional(),
  visibility: z.enum(REPORT_VISIBILITIES).optional(),
  visibilityRoles: z.array(z.string().min(1).max(64)).max(20).optional(),
  defaultRange: z.enum(REPORT_DEFAULT_RANGES).nullish(),
});

export type ReportWorkingCopy = z.infer<typeof reportWorkingCopySchema>;

/**
 * The stored JSON column, read back.
 *
 * ONE function answers "does this report have unpublished changes?", for the
 * list card and for the editor alike — so a card can never advertise a state
 * the editor then fails to open. Unreadable JSON is `null`: the published
 * document is untouched either way, and claiming changes that cannot be loaded
 * is the worse of the two failures.
 */
export function readWorkingCopy(value: unknown): ReportWorkingCopy | null {
  if (typeof value !== 'object' || value === null) return null;
  const parsed = reportWorkingCopySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Whether a report at this lifecycle status parks its edits instead of writing
 * them straight through.
 *
 * Only a published report does. A never-published draft has no reader to
 * protect, and an ARCHIVED report has left circulation — the editor already
 * treats reopening one as "back to a draft", so an archived report's edits
 * likewise have nobody to protect and simply save.
 */
export function parksEditsInWorkingCopy(status: string): boolean {
  return status === 'published';
}
