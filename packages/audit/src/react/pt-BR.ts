import type { AuditLabels } from './labels';

/**
 * The pt-BR labels — a NAMED export a host passes by hand
 * (`createWebAudit({ labels: PT_BR_AUDIT_LABELS })`), never a default. Its
 * exact path is what excuses it from the removed-copy ban in
 * `packed-artifact.test.ts`: Portuguese may ship, it may not be silent.
 */
export const PT_BR_AUDIT_LABELS: AuditLabels = {
  title: 'Trilha de auditoria',
  aboutTitle: 'Sobre a trilha de auditoria',
  about:
    'Tudo o que é registrado aqui é permanente: quem fez, o que mudou e quando. ' +
    'Os registros não podem ser editados nem excluídos.',
  columnDate: 'Data',
  columnActor: 'Autor',
  columnOnBehalfOf: 'Em nome de',
  columnAction: 'Ação',
  columnResource: 'Recurso',
  columnResourceId: 'Identificador',
  columnChange: 'Alteração',
  filterAction: 'Ação',
  filterResource: 'Recurso',
  filterActor: 'Autor',
  filterPeriod: 'Período',
  systemActor: 'Sistema',
  onBehalfOf: '{actor} em nome de {subject}',
  unknownActor: 'Usuário excluído',
  loading: 'Carregando…',
  empty: 'Nenhum registro para os filtros escolhidos.',
  errorTitle: 'Não foi possível carregar a trilha de auditoria',
  requestFailed: 'Não foi possível carregar a trilha de auditoria.',
  retry: 'Tentar novamente',
  exportAction: 'Exportar',
  exportCsv: 'CSV (.csv)',
  exportJson: 'JSON (.json)',
  exportFileName: 'trilha-de-auditoria',
  exportTruncated: 'Apenas os primeiros {count} registros foram exportados.',
  viewsUnavailable: 'Visões salvas não estão disponíveis nesta tela.',
};
