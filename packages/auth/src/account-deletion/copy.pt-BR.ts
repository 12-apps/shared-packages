import type { AccountDeletionCopy } from "./copy";

/** The deletion's refusals and mails, pt-BR. */
export const PT_BR_ACCOUNT_DELETION: AccountDeletionCopy = {
  refusals: {
    wrongPassword: "Senha incorreta.",
    tooManyAttempts: "Muitas tentativas. Espere alguns minutos e tente de novo.",
    signInAgain: "Entre com o Google de novo para confirmar.",
    blocked: "Resolva os itens acima antes de excluir a conta.",
    alreadyScheduled: "A exclusão da sua conta já está marcada.",
    notScheduled: "Sua conta não tem exclusão marcada.",
    impersonating: "Só a própria pessoa pode excluir a conta.",
  },
  mail: {
    scheduled: {
      subject: (date) => `Sua conta será excluída em ${date}`,
      lead: (date) =>
        `Recebemos seu pedido para excluir sua conta e saímos dela em todos os aparelhos. Até ${date}, basta entrar e tocar em Cancelar exclusão. Se não foi você, entre agora e cancele.`,
      action: "Desfazer",
    },
    "week-before": {
      subject: (date) => `Faltam 7 dias: sua conta será excluída em ${date}`,
      lead: (date) => `Sua conta será excluída em ${date}. Se mudou de ideia, entre e toque em Cancelar exclusão.`,
      action: "Cancelar exclusão",
    },
    "day-before": {
      subject: (date) => `Em menos de 24 horas sua conta será excluída (${date})`,
      lead: (date) =>
        `Em ${date} sua conta será excluída e não dá para recuperar depois. Para continuar usando, entre hoje e toque em Cancelar exclusão.`,
      action: "Cancelar exclusão",
    },
    cancelled: {
      subject: () => "A exclusão da sua conta foi cancelada",
      lead: () => "Sua conta continua como estava. Se não foi você que cancelou, troque sua senha.",
      action: "Entrar",
    },
  },
};
