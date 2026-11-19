/** The screen's words (FUT-5322): the package's own packs, as the other auth screens'. */
export interface AccountDeletionScreenCopy {
  readonly title: string;
  readonly goes: readonly string[];
  readonly stays: readonly string[];
  readonly settleFirst: string;
  readonly forfeitTitle: string;
  readonly passwordLabel: string;
  readonly googleLead: string;
  readonly googleAction: string;
  readonly googleFresh: string;
  readonly when: (date: string) => string;
  readonly irreversible: (days: number) => string;
  readonly submit: string;
  readonly failed: string;
  readonly loadFailed: string;
  readonly pendingTitle: (date: string) => string;
  readonly pendingBody: string;
  readonly pendingCancel: string;
  readonly pendingSignOut: string;
}

export const PT_BR_ACCOUNT_DELETION_SCREEN: AccountDeletionScreenCopy = {
  title: "Excluir conta",
  goes: ["Perfil, endereços, cartões salvos e avisos", "Conexões com assistentes de IA"],
  stays: ["Pedidos ficam com as lojas, sem seu nome", "Notas fiscais pelo prazo da lei"],
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
  pendingTitle: (date) => `Sua conta será excluída em ${date}`,
  pendingBody: "Seus dados ainda estão aqui. Quer continuar usando?",
  pendingCancel: "Cancelar exclusão",
  pendingSignOut: "Sair",
};

export const EN_US_ACCOUNT_DELETION_SCREEN: AccountDeletionScreenCopy = {
  title: "Delete account",
  goes: ["Profile, addresses, saved cards and notifications", "AI assistant connections"],
  stays: ["Orders stay with the stores, without your name", "Invoices for as long as the law requires"],
  settleFirst: "First, settle:",
  forfeitTitle: "You lose:",
  passwordLabel: "Your password",
  googleLead: "Your account signs in with Google. To confirm, sign in with Google again.",
  googleAction: "Sign in with Google",
  googleFresh: "You just signed in with Google.",
  when: (date) => `Signed out now; deleted on ${date}. Until then, sign in to change your mind.`,
  irreversible: (days) => `After ${days} days, it cannot be undone.`,
  submit: "Delete my account",
  failed: "Could not delete right now. Try again.",
  loadFailed: "Could not load. Try again.",
  pendingTitle: (date) => `Your account will be deleted on ${date}`,
  pendingBody: "Your data is still here. Want to keep using it?",
  pendingCancel: "Cancel deletion",
  pendingSignOut: "Sign out",
};
