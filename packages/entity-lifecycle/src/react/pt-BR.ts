import { PT_BR_CONFIRM_ACTION_COPY } from '@12-apps/ui/pt-BR';
import type { LifecycleWebCopy } from './copy';

/**
 * The pt-BR pack — the exact sentences the five screens compiled in until
 * copy became required config. The filename is what exempts this file from
 * the copy-portability gate: Portuguese may ship, it may not be silent.
 */
export const PT_BR_LIFECYCLE_WEB_COPY: LifecycleWebCopy = {
  operationFailed: 'Não foi possível concluir a operação.',
  systemActor: 'Sistema',
  tabs: { recycleBin: 'Lixeira', approvals: 'Aprovações' },
  approvals: {
    statusFilters: { pending: 'Pendentes', approved: 'Aprovadas', rejected: 'Rejeitadas' },
    actions: { create: 'Criação', update: 'Alteração', delete: 'Exclusão' },
    emptyByStatus: {
      pending: 'Nenhuma solicitação pendente.',
      approved: 'Nenhuma solicitação aprovada.',
      rejected: 'Nenhuma solicitação rejeitada.',
    },
    rejectDialogTitle: (label) => `Rejeitar "${label}"`,
    rejectDialogTitleNoTarget: 'Rejeitar solicitação',
    rejectNoteLabel: 'Motivo (opcional)',
    approveAction: 'Aprovar',
    rejectAction: 'Rejeitar',
    cancelAction: 'Cancelar',
    requestedBy: (name) => `Solicitado por ${name} em`,
    decisionFailedTitle: 'Não foi possível concluir a decisão',
    featureOffBody: 'O recurso de aprovações não está ativo para esta loja.',
    loadFailedTitle: 'Não foi possível carregar as aprovações',
    retryAction: 'Tentar novamente',
  },
  recycleBin: {
    restoreAction: 'Restaurar',
    purgeAction: 'Excluir definitivamente',
    purgeDialogTitle: 'Excluir definitivamente',
    purgeConfirmText: 'Excluir definitivamente',
    purgeBody: (label) =>
      `"${label}" será excluído para sempre, junto com seus itens vinculados. Esta ação não pode ser desfeita.`,
    purgeTypeToConfirmLabel: (label) => `Digite "${label}" para confirmar.`,
    purgeFailed: 'Não foi possível excluir definitivamente.',
    confirmAction: PT_BR_CONFIRM_ACTION_COPY,
    deletedAtPrefix: 'Excluído em',
    deletedBy: (name) => ` por ${name}`,
    emptyTitle: 'A lixeira está vazia.',
    emptyBody: 'Itens excluídos aparecem aqui e podem ser restaurados.',
    actionFailedTitle: 'Não foi possível concluir a ação',
    loadFailedTitle: 'Não foi possível carregar a lixeira',
    retryAction: 'Tentar novamente',
  },
  versionHistory: {
    title: (itemLabel) => `Histórico de versões — ${itemLabel}`,
    actions: { create: 'Criação', update: 'Alteração', restore: 'Restauração' },
    currentBadge: 'Versão atual',
    restoreAction: 'Restaurar',
    compareAria: (version) => `Comparar a versão v${version}`,
    restored: (version) => `Versão v${version} restaurada.`,
    sentToApproval: 'Alteração enviada para aprovação.',
    restoreDialogTitle: 'Restaurar versão',
    restoreDialogBody: (version) =>
      `O conteúdo atual será substituído pela versão v${version}. Uma nova versão será registrada no histórico.`,
    restoreConfirm: 'Restaurar',
    cancelAction: 'Cancelar',
    emptyBody: 'Nenhuma versão registrada.',
    featureOffBody: 'O histórico de versões não está ativo para esta loja.',
    loadFailedTitle: 'Não foi possível carregar o histórico',
    retryAction: 'Tentar novamente',
  },
  comparison: {
    roles: { previous: 'Anterior', selected: 'Selecionada', next: 'Seguinte', current: 'Atual' },
    booleanTrue: 'Sim',
    booleanFalse: 'Não',
    heading: (version) => `Comparando a v${version}`,
    singleVersionBody: 'Esta é a única versão registrada — não há outra para comparar.',
    noDifferences: 'Nenhuma diferença entre estas versões.',
    loadFailedBody: 'Não foi possível carregar a comparação desta versão.',
  },
  draftBanner: {
    title: 'Este item tem um rascunho não publicado.',
    updatedAtPrefix: 'Atualizado em',
    load: 'Carregar rascunho',
    publish: 'Publicar',
    discard: 'Descartar',
  },
};
