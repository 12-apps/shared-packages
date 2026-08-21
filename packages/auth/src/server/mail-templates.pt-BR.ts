import type { MailPack } from "./mail-templates";

/** Brazilian Portuguese. The first pack, and today the only one. */
export const PT_BR_MAIL: MailPack = {
  fallbackHint: "Se o botão não funcionar, copie e cole este endereço no navegador:",
  validFor: (hours) => {
    if (hours >= 24) {
      const days = Math.round(hours / 24);
      return days === 1 ? "24 horas" : `${days} dias`;
    }
    return hours === 1 ? "1 hora" : `${hours} horas`;
  },
  verification: {
    subject: "Confirme seu e-mail",
    greeting: (name) => (name?.trim() ? `Olá, ${name.trim()}` : "Olá"),
    lead: ({ validFor }) =>
      `Confirme seu e-mail para ativar sua conta. O link vale por ${validFor} e só pode ser usado uma vez.`,
    cta: "Confirmar meu e-mail",
    footer: "Se não foi você, pode ignorar esta mensagem com segurança.",
  },
  passwordReset: {
    subject: "Redefinir sua senha",
    greeting: (name) => (name?.trim() ? `Olá, ${name.trim()}` : "Olá"),
    lead: ({ validFor }) =>
      `Você pediu para redefinir sua senha. O link vale por ${validFor} e só pode ser usado uma vez.`,
    cta: "Criar uma nova senha",
    footer:
      "Se não foi você, pode ignorar esta mensagem com segurança. Sua senha atual continua valendo.",
  },
  alreadyRegistered: {
    subject: "Você já tem uma conta",
    greeting: (name) => (name?.trim() ? `Olá, ${name.trim()}` : "Olá"),
    /**
     * The link in THIS message is a RESET link, not a sign-in one — see
     * `signup.ts`: the overwhelmingly common cause is a returning user who
     * forgot they had an account, and the second most common is one who forgot
     * the password. So it words a lifetime like the other token mails, and its
     * button says what the button actually does. Calling it "Entrar" would send
     * somebody to a choose-a-new-password form expecting a sign-in.
     */
    lead: ({ validFor }) =>
      `Alguém tentou criar uma conta com este e-mail, e você já tem uma. Se foi você, entre normalmente — ou use o link abaixo para definir uma nova senha. Ele vale por ${validFor}.`,
    cta: "Definir uma nova senha",
    footer:
      "Se não foi você, pode ignorar esta mensagem com segurança. Nenhuma conta nova foi criada.",
  },
  passwordChanged: {
    subject: "Sua senha foi alterada",
    greeting: (name) => (name?.trim() ? `Olá, ${name.trim()}` : "Olá"),
    lead: () =>
      "Sua senha foi alterada agora há pouco. Se foi você, não precisa fazer nada.",
    cta: "Entrar",
    footer:
      "Se NÃO foi você, peça uma nova senha imediatamente — quem fez a alteração pode estar com acesso à sua conta.",
  },
};
