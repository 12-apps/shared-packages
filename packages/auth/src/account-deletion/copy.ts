import type { DeletionMailKind } from "./types";

/**
 * The deletion's words: the refusals a route answers with and the four mails.
 * The package's own packs, pt-BR and en-US (`../locales.ts` re-exports them),
 * as every other auth surface's copy is. Product copy says "excluir conta",
 * never "encerrar".
 */
export interface AccountDeletionRefusals {
  readonly wrongPassword: string;
  readonly tooManyAttempts: string;
  readonly signInAgain: string;
  readonly blocked: string;
  readonly alreadyScheduled: string;
  readonly notScheduled: string;
  readonly impersonating: string;
}

export interface AccountDeletionMailWords {
  readonly subject: (date: string) => string;
  readonly lead: (date: string) => string;
  readonly action: string;
}

export interface AccountDeletionCopy {
  readonly refusals: AccountDeletionRefusals;
  readonly mail: Readonly<Record<DeletionMailKind, AccountDeletionMailWords>>;
}

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
      subject: (date) => `Amanhã sua conta será excluída (${date})`,
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

export const EN_US_ACCOUNT_DELETION: AccountDeletionCopy = {
  refusals: {
    wrongPassword: "Wrong password.",
    tooManyAttempts: "Too many attempts. Wait a few minutes and try again.",
    signInAgain: "Sign in with Google again to confirm.",
    blocked: "Settle the items above before deleting the account.",
    alreadyScheduled: "Your account's deletion is already scheduled.",
    notScheduled: "Your account has no deletion scheduled.",
    impersonating: "Only the person themselves can delete the account.",
  },
  mail: {
    scheduled: {
      subject: (date) => `Your account will be deleted on ${date}`,
      lead: (date) =>
        `We received your request to delete your account and signed you out on every device. Until ${date}, just sign in and tap Cancel deletion. If it was not you, sign in now and cancel.`,
      action: "Undo",
    },
    "week-before": {
      subject: (date) => `7 days left: your account will be deleted on ${date}`,
      lead: (date) => `Your account will be deleted on ${date}. If you changed your mind, sign in and tap Cancel deletion.`,
      action: "Cancel deletion",
    },
    "day-before": {
      subject: (date) => `Your account will be deleted tomorrow (${date})`,
      lead: (date) =>
        `On ${date} your account will be deleted and it cannot be recovered afterwards. To keep using it, sign in today and tap Cancel deletion.`,
      action: "Cancel deletion",
    },
    cancelled: {
      subject: () => "Your account's deletion was cancelled",
      lead: () => "Your account is as it was. If you did not cancel it, change your password.",
      action: "Sign in",
    },
  },
};

export const ACCOUNT_DELETION_COPY = { "pt-BR": PT_BR_ACCOUNT_DELETION, "en-US": EN_US_ACCOUNT_DELETION } as const;

/** The purge date as the reader says it — "3 de dezembro", "December 3". */
export function purgeDateWords(purgeAt: Date, locale: "pt-BR" | "en-US", timeZone = "America/Sao_Paulo"): string {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone }).format(purgeAt);
}

/** One mail's words, ready for the host's layout: subject, lead line and the button. */
export function accountDeletionMail(
  kind: DeletionMailKind,
  purgeAt: Date,
  locale: "pt-BR" | "en-US",
  timeZone?: string,
): { subject: string; lead: string; action: string } {
  const words = ACCOUNT_DELETION_COPY[locale].mail[kind];
  const date = purgeDateWords(purgeAt, locale, timeZone);
  return { subject: words.subject(date), lead: words.lead(date), action: words.action };
}
