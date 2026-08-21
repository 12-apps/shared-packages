import type { RbacMessages } from './context';

/**
 * The pt-BR pack — the origin host's exact copy, now a NAMED export a host
 * passes by hand (`messages: PT_BR_RBAC_MESSAGES`), never a default. The
 * filename is what exempts this file from the copy-portability gate:
 * Portuguese may ship, it may not be silent.
 */
export const PT_BR_RBAC_MESSAGES: RbacMessages = {
  forbidden: 'Você não tem permissão para esta ação.',
  notAMember: 'Este usuário não faz parte da equipe.',
  memberNotFound: 'Membro não encontrado.',
  roleNotFound: 'Papel não encontrado.',
  duplicateRoleName: 'Já existe um papel com esse nome.',
  reservedRoleName:
    'Esse nome é reservado para um papel do sistema. Edite o papel do sistema.',
  lastOwner: 'É necessário manter ao menos um proprietário.',
  onlyOwnerRemovesOwner: 'Apenas o proprietário pode remover outro proprietário.',
  ownerNotDisableable: 'Não é possível desativar um proprietário.',
  templateNotEditable: 'Este papel do sistema não pode ser editado.',
  invalidEmail: 'Informe um e-mail válido.',
  invalidBody: 'Dados inválidos',
  notFound: 'Não encontrado.',
  invitesNotConfigured: 'Convites não estão configurados.',
  unauthenticated: 'Não autenticado.',
  baseRoleNotAssignable: 'Este papel não pode ser definido como papel principal.',
  governance: {
    escalation: 'Você não pode conceder um papel com permissões que você mesmo não possui.',
    scopeCeiling: 'Este papel não pode ser atribuído neste nível de acesso.',
    separationOfDuties: 'Este papel viola a separação de funções e não pode ser atribuído.',
    ownerProtected: 'Este papel é protegido e não pode ser atribuído por aqui.',
    unknownRole: 'Papel desconhecido.',
    fallback: 'Não foi possível atribuir este papel.',
  },
};
