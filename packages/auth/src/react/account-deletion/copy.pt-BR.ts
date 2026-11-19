import type { AccountDeletionScreenCopy } from "./copy";

/** The deletion screen's pt-BR pack. */
export const PT_BR_ACCOUNT_DELETION_SCREEN: AccountDeletionScreenCopy = {
  title: "Excluir conta",
  settleFirst: "Antes, resolva:",
  forfeitTitle: "Você perde:",
  passwordLabel: "Sua senha",
  googleLead: "Sua conta entra pelo Google. Para confirmar, entre com o Google de novo.",
  googleAction: "Entrar com o Google",
  googleFresh: "Você acabou de entrar com o Google.",
  when: (date) => `Sai do ar agora; apagada em ${date}. Até lá, entre para desistir.`,
  irreversible: (days) => `Depois de ${days} dias, não dá para desfazer.`,
  submit: "Excluir minha conta",
  failed: "Não foi possível excluir agora. Tente de novo.",
  loadFailed: "Não foi possível carregar. Tente de novo.",
  retry: "Tentar de novo",
  alreadyPending: "A exclusão da sua conta já está marcada.",
  pendingTitle: (date) => `Sua conta será excluída em ${date}`,
  pendingBody: "Seus dados ainda estão aqui. Quer continuar usando?",
  pendingCancel: "Cancelar exclusão",
  pendingSignOut: "Sair",
};
