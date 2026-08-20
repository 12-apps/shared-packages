import type { FeatureFlagsCopy } from "./copy";

/**
 * The pt-BR pack — a NAMED export a host passes by hand
 * (`copy: PT_BR_FEATURE_FLAGS_COPY`), never a default. The filename is what
 * exempts this file from the copy-portability gate: Portuguese may ship, it
 * may not be silent.
 */
export const PT_BR_FEATURE_FLAGS_COPY: FeatureFlagsCopy = {
  title: "Recursos beta",
  subtitle: "Conceda recursos em teste a usuários específicos.",
  flagsEmpty: "Nenhum recurso beta no catálogo.",
  selectPrompt: "Selecione um recurso para gerenciar os testadores.",
  grantsEmpty: "Nenhum usuário neste recurso.",
  loadError: "Não foi possível carregar.",
  addEmailLabel: "E-mail do usuário",
  addNoteLabel: "Observação (opcional)",
  addSubmit: "Conceder acesso",
  adding: "Concedendo...",
  enable: "Ativar",
  disable: "Desativar",
  revoke: "Revogar",
  statusOn: "Ativo",
  statusOff: "Desativado",
  thUser: "Usuário",
  thNote: "Observação",
  thStatus: "Situação",
  thActions: "Ações",
  grantedByPrefix: "concedido por",
  prev: "Anterior",
  next: "Próxima",
  pageOf: "Página {page} de {pages} — {total} concessões",
  orphansTitle: "Concessões órfãs",
  orphansHint: "Concessões de recursos que saíram do catálogo. Revogue-as ao aposentar um recurso.",
  tally: "{enabled} de {total} ativos",
};
