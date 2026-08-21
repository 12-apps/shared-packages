import type { RbacWebCopy } from './copy';

/**
 * The pt-BR pack — the exact sentences the two screens compiled in until copy
 * became required config. The filename is what exempts this file from the
 * copy-portability gate: Portuguese may ship, it may not be silent.
 */
export const PT_BR_RBAC_WEB_COPY: RbacWebCopy = {
  operationFailed: 'Não foi possível concluir a operação.',
  loading: 'Carregando…',
  permissionsLoadFailed: 'Não foi possível carregar suas permissões.',
  tabs: { roles: 'Papéis', team: 'Equipe' },
  permissionLabels: {
    domains: { roles: 'Papéis', team: 'Equipe' },
    actions: { read: 'Ver', manage: 'Gerenciar' },
  },
  rolesList: {
    title: 'Papéis',
    newRoleAction: 'Novo papel',
    searchPlaceholder: 'Buscar papel',
    loadFailed: 'Não foi possível carregar os papéis.',
    dialogTitles: {
      create: 'Novo papel',
      edit: (name) => `Editar ${name}`,
      override: (name) => `Editar papel do sistema ${name}`,
    },
    deleteConfirm: {
      title: 'Excluir o papel?',
      body: 'Quem tem este papel perde os acessos dele imediatamente.',
      confirmLabel: 'Excluir',
    },
    resetConfirm: {
      title: 'Restaurar padrão do papel?',
      body: 'As permissões voltam ao padrão do sistema. Esta ação não pode ser desfeita.',
      confirmLabel: 'Restaurar padrão',
    },
    cancelAction: 'Cancelar',
  },
  rolesTable: {
    headers: {
      name: 'Nome',
      description: 'Descrição',
      kind: 'Tipo',
      permissions: 'Permissões',
      actions: 'Ações',
    },
    kinds: { system: 'Sistema', custom: 'Personalizado' },
    allPermissions: 'todas',
    editAction: 'Editar',
    resetAction: 'Restaurar padrão',
    deleteAction: 'Excluir',
  },
  roleForm: {
    nameLabel: 'Nome do papel',
    descriptionPlaceholder: 'Descrição (opcional)',
    descriptionLabel: 'Descrição',
    selectionCount: (count) => `Permissões (${count} selecionada${count === 1 ? '' : 's'})`,
    kinds: { class: 'classe', instance: 'instância' },
    cancelAction: 'Cancelar',
    saveAction: 'Salvar',
    createAction: 'Criar papel',
  },
  teamScreen: {
    title: 'Equipe',
    searchPlaceholder: 'Buscar membro',
    loadFailed: 'Não foi possível carregar a equipe.',
    removeConfirm: {
      title: 'Remover da equipe?',
      body: 'A pessoa perde o acesso ao painel imediatamente.',
      confirmLabel: 'Remover',
    },
    cancelAction: 'Cancelar',
    pendingInvitesTitle: 'Convites pendentes',
    pendingInviteLine: (email, role) => `${email} — ${role} (Pendente)`,
  },
  teamTable: {
    headers: { name: 'Nome', email: 'E-mail', roles: 'Papéis', status: 'Status' },
    status: { active: 'Ativo', disabled: 'Desativado' },
  },
  teamRoleDialog: {
    title: (member) => `Papéis de ${member}`,
    fallbackTitle: 'Editar papéis',
    systemGroupTitle: 'Papel do sistema (escolha um)',
    customGroupTitle: 'Papéis personalizados (opcional)',
    exactlyOneSystemRole: 'Selecione exatamente um papel do sistema.',
    cancelAction: 'Cancelar',
    saveAction: 'Salvar',
  },
  teamRowMenu: {
    editRoles: 'Editar papéis',
    activate: 'Ativar',
    deactivate: 'Desativar',
    remove: 'Remover',
    noActions: 'Sem ações disponíveis',
  },
};
