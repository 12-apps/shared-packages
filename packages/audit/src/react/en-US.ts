import { DEFAULT_LABELS, type AuditLabels } from './labels';

/**
 * The en-US labels — a NAMED export a host passes by hand
 * (`createWebAudit({ labels: EN_US_AUDIT_LABELS })`). The same sentences the
 * package falls back to, named so a host picks its language explicitly.
 */
export const EN_US_AUDIT_LABELS: AuditLabels = DEFAULT_LABELS;
