import type { EmailAuthFailure } from "../email-credentials/types";

/**
 * What a refusal SAYS, and what it answers with.
 *
 * The two halves are deliberately separated. The HTTP status is mechanism —
 * `rate-limited` is 429 in every app that ever mounts this — so the package
 * owns it and no host can get it wrong. The sentence is copy, so the host
 * chooses it, by picking a bundled locale or writing its own.
 */

/** One sentence per refusal, in the language the deployment speaks. */
export type EmailAuthMessages = Record<EmailAuthFailure, string>;

/**
 * The status each refusal answers with.
 *
 * Not configurable, on purpose: a host that answered 200 for `rate-limited`
 * would break every client's error handling, and there is no deployment for
 * which a different number is right.
 *
 * `no-account` is 200 rather than 404, and that is the single most important
 * line here — see the note on the sign-up and reset flows. Telling a caller
 * "no such address" turns either endpoint into a directory anyone can walk.
 */
export const EMAIL_AUTH_STATUS: Record<EmailAuthFailure, number> = {
  "method-disabled": 403,
  "invalid-email": 400,
  "weak-password": 400,
  "email-taken": 409,
  "invalid-credentials": 401,
  "email-not-verified": 403,
  "token-invalid": 400,
  "rate-limited": 429,
  "current-password-required": 400,
  "current-password-invalid": 401,
  "no-account": 200,
};

/**
 * Brazilian Portuguese, the first locale this ships with.
 *
 * One bundled pack rather than none, because "supply eleven sentences before
 * anything works" is a poor first five minutes; and one rather than five,
 * because a translation nobody has read is worse than an obvious gap. A host
 * needing another language passes its own record — the type makes a missing
 * case a compile error, not a silently English string in a Portuguese screen.
 */
export const PT_BR_MESSAGES: EmailAuthMessages = {
  "method-disabled": "Entrar com e-mail e senha está indisponível no momento.",
  "invalid-email": "Informe um e-mail válido.",
  "weak-password": "Escolha uma senha mais forte.",
  "email-taken": "Este e-mail já está em uso.",
  "invalid-credentials": "E-mail ou senha incorretos.",
  "email-not-verified": "Confirme seu e-mail para continuar.",
  "token-invalid": "Este link não é mais válido. Peça um novo.",
  "rate-limited": "Muitas tentativas. Aguarde um instante e tente de novo.",
  "current-password-required": "Informe sua senha atual.",
  "current-password-invalid": "Senha atual incorreta.",
  "no-account": "Se existir uma conta, enviamos as instruções por e-mail.",
};
