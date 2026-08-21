import type { LifecycleMessages } from './context';

/**
 * The pt-BR pack — the origin host's exact copy, now a NAMED export a host
 * passes by hand, never a default. The filename is what exempts this file
 * from the copy-portability gate: Portuguese may ship, it may not be silent.
 */
export const PT_BR_LIFECYCLE_MESSAGES: LifecycleMessages = {
  entityNotFound: 'Este item não existe mais — ele pode ter sido excluído.',
  versionNotFound: 'Esta versão não existe mais.',
  entryNotFound: 'Este item não está mais na lixeira.',
  draftNotFound: 'Este rascunho não existe mais.',
  requestNotFound: 'Esta solicitação não existe mais.',
  requestAlreadyDecided: 'Esta solicitação já foi decidida.',
  featureDisabled: 'Este recurso não está ativo para esta loja.',
  notAuthorized: 'Você não tem permissão para aprovar alterações.',
  routeNotAllowed: 'Você não tem permissão para gerenciar esta loja.',
  operationFailed: 'Não foi possível concluir a operação.',
  unknownEntityType: 'Este tipo de item não está habilitado para o ciclo de vida.',
  invalidBody: 'Dados inválidos.',
  unauthenticated: 'Não autenticado.',
};
