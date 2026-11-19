import { EN_US_ACCOUNT_DELETION } from "./copy.en-US";
import { PT_BR_ACCOUNT_DELETION } from "./copy.pt-BR";
import type { DeletionMailKind } from "./types";

/**
 * The deletion's words: the refusals a route answers with and the four mails,
 * the package's own pt-BR and en-US packs. They promise nothing about what a
 * host keeps or erases — that is the host's to say (its screen `facts`, its
 * mail layout). pt-BR says "excluir conta", never "encerrar".
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

export { EN_US_ACCOUNT_DELETION, PT_BR_ACCOUNT_DELETION };

export const ACCOUNT_DELETION_COPY = { "pt-BR": PT_BR_ACCOUNT_DELETION, "en-US": EN_US_ACCOUNT_DELETION } as const;

/** The purge date as the reader says it — "3 de dezembro", "December 3". */
export function purgeDateWords(purgeAt: Date, locale: "pt-BR" | "en-US", timeZone: string): string {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone }).format(purgeAt);
}

/** One mail's words, ready for the host's layout: subject, lead line and the button. */
export function accountDeletionMail(
  kind: DeletionMailKind,
  purgeAt: Date,
  locale: "pt-BR" | "en-US",
  timeZone: string,
): { subject: string; lead: string; action: string } {
  const words = ACCOUNT_DELETION_COPY[locale].mail[kind];
  const date = purgeDateWords(purgeAt, locale, timeZone);
  return { subject: words.subject(date), lead: words.lead(date), action: words.action };
}
