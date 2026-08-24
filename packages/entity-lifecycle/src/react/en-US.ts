import { EN_US_CONFIRM_ACTION_COPY } from '@12-apps/ui/en-US';
import type { LifecycleWebCopy } from './copy';

/**
 * The en-US pack — the same five screens for an English-reading audience. The
 * filename is what exempts this file from the copy-portability gate.
 *
 * `recycleBin.confirmAction` is composed from `@12-apps/ui`'s own pack rather
 * than restated here, exactly as the pt-BR side composes the Portuguese one:
 * the confirm dialog is that package's component, its words are that package's
 * to own, and a second copy here would be one more place to forget when it
 * changes.
 */
export const EN_US_LIFECYCLE_WEB_COPY: LifecycleWebCopy = {
  operationFailed: 'That action could not be completed.',
  systemActor: 'System',
  tabs: { recycleBin: 'Recycle bin', approvals: 'Approvals' },
  approvals: {
    dismissNotice: 'Dismiss',
    statusFilters: { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' },
    actions: { create: 'Creation', update: 'Change', delete: 'Deletion' },
    emptyByStatus: {
      pending: 'No pending requests.',
      approved: 'No approved requests.',
      rejected: 'No rejected requests.',
    },
    rejectDialogTitle: (label) => `Reject "${label}"`,
    rejectDialogTitleNoTarget: 'Reject request',
    rejectNoteLabel: 'Reason (optional)',
    approveAction: 'Approve',
    rejectAction: 'Reject',
    cancelAction: 'Cancel',
    // The screen renders the timestamp immediately after this, so the sentence
    // has to END on the preposition rather than read as a complete clause.
    requestedBy: (name) => `Requested by ${name} on`,
    decisionFailedTitle: 'Could not record the decision',
    featureOffBody: 'Approvals are not enabled for this store.',
    loadFailedTitle: 'Could not load the approvals',
    retryAction: 'Try again',
  },
  recycleBin: {
    dismissNotice: 'Dismiss',
    restoreAction: 'Restore',
    purgeAction: 'Delete permanently',
    purgeDialogTitle: 'Delete permanently',
    // What the operator must TYPE to confirm, and what the dialog matches on.
    // The two must stay one string: a dialog that asks for one word and checks
    // another can never be confirmed.
    purgeConfirmText: 'Delete permanently',
    purgeBody: (label) =>
      `"${label}" will be deleted forever, along with everything linked to it. This cannot be undone.`,
    purgeTypeToConfirmLabel: (label) => `Type "${label}" to confirm.`,
    purgeFailed: 'Could not delete permanently.',
    confirmAction: EN_US_CONFIRM_ACTION_COPY,
    // Followed by the timestamp, then `deletedBy` — three fragments the screen
    // concatenates, so each keeps its leading or trailing space.
    deletedAtPrefix: 'Deleted on',
    deletedBy: (name) => ` by ${name}`,
    emptyTitle: 'The recycle bin is empty.',
    emptyBody: 'Deleted items appear here and can be restored.',
    actionFailedTitle: 'Could not complete the action',
    loadFailedTitle: 'Could not load the recycle bin',
    retryAction: 'Try again',
  },
  versionHistory: {
    dismissNotice: 'Dismiss',
    title: (itemLabel) => `Version history — ${itemLabel}`,
    actions: { create: 'Creation', update: 'Change', restore: 'Restore' },
    currentBadge: 'Current version',
    restoreAction: 'Restore',
    compareAria: (version) => `Compare version v${version}`,
    restored: (version) => `Version v${version} restored.`,
    sentToApproval: 'Change sent for approval.',
    restoreDialogTitle: 'Restore version',
    restoreDialogBody: (version) =>
      `The current content will be replaced by version v${version}. A new version is recorded in the history.`,
    restoreConfirm: 'Restore',
    cancelAction: 'Cancel',
    emptyBody: 'No versions recorded.',
    featureOffBody: 'Version history is not enabled for this store.',
    loadFailedTitle: 'Could not load the history',
    retryAction: 'Try again',
  },
  comparison: {
    fieldColumn: 'Field',
    roles: { previous: 'Previous', selected: 'Selected', next: 'Next', current: 'Current' },
    booleanTrue: 'Yes',
    booleanFalse: 'No',
    heading: (version) => `Comparing v${version}`,
    singleVersionBody: 'This is the only version recorded — there is nothing to compare it with.',
    noDifferences: 'No differences between these versions.',
    loadFailedBody: 'Could not load the comparison for this version.',
  },
  draftBanner: {
    dismissNotice: 'Dismiss',
    title: 'This item has an unpublished draft.',
    updatedAtPrefix: 'Updated on',
    load: 'Load draft',
    publish: 'Publish',
    discard: 'Discard',
  },
};
