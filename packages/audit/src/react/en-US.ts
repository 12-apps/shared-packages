import type { AuditLabels } from './labels';

/**
 * The en-US labels — a NAMED export a host passes by hand
 * (`createWebAudit({ labels: EN_US_AUDIT_LABELS })`). The same sentences the
 * package falls back to (`DEFAULT_LABELS` is this object), named so a host
 * picks its language explicitly.
 */
export const EN_US_AUDIT_LABELS: AuditLabels = {
  title: 'Audit trail',
  aboutTitle: 'About the audit trail',
  about:
    'Everything recorded here is permanent: who did it, what changed and when. ' +
    'Entries cannot be edited or deleted.',
  columnDate: 'Date',
  columnActor: 'Actor',
  columnOnBehalfOf: 'On behalf of',
  columnAction: 'Action',
  columnResource: 'Resource',
  columnResourceId: 'Identifier',
  columnChange: 'Change',
  filterAction: 'Action',
  filterResource: 'Resource',
  filterActor: 'Actor',
  filterPeriod: 'Period',
  systemActor: 'System',
  onBehalfOf: '{actor} on behalf of {subject}',
  unknownActor: 'Deleted user',
  loading: 'Loading…',
  empty: 'No entries recorded for the chosen filters.',
  errorTitle: 'Could not load the audit trail',
  requestFailed: 'Could not load the audit trail.',
  retry: 'Try again',
  exportAction: 'Export',
  exportCsv: 'CSV (.csv)',
  exportJson: 'JSON (.json)',
  exportFileName: 'audit-trail',
  exportTruncated: 'Only the first {count} entries were exported.',
  viewsUnavailable: 'Saved views are not available on this screen.',
};
