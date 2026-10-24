import type { AuditMessages } from './config';

/**
 * The pt-BR API messages — a NAMED export a host passes by hand
 * (`createApiAudit({ messages: PT_BR_AUDIT_MESSAGES })`), never a default.
 */
export const PT_BR_AUDIT_MESSAGES: AuditMessages = {
  unauthenticated: 'Não autenticado.',
  forbidden: 'Você não tem permissão para ver a trilha de auditoria.',
  invalidQuery: 'Filtros inválidos',
};
