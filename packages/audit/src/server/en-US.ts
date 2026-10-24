import { DEFAULT_MESSAGES, type AuditMessages } from './config';

/**
 * The en-US API messages — a NAMED export a host passes by hand
 * (`createApiAudit({ messages: EN_US_AUDIT_MESSAGES })`). The same sentences
 * the package falls back to, named so a host picks its language explicitly.
 */
export const EN_US_AUDIT_MESSAGES: AuditMessages = DEFAULT_MESSAGES;
