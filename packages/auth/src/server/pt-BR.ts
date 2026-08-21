import type { EmailAuthMessages } from "./messages";

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
  violations: {
    "too-short": "Use pelo menos 8 caracteres.",
    "too-long": "A senha é longa demais.",
    "needs-letter": "Inclua pelo menos uma letra.",
    "needs-number": "Inclua pelo menos um número.",
    "too-common": "Esta senha é muito comum. Escolha outra.",
  },
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
  // Deliberately vague: the visitor cannot act on a missing provider, and
  // naming a deployment's absent credentials on a public sign-up screen tells
  // an attacker which box is half-built.
  "verification-unavailable":
    "Não foi possível concluir o cadastro agora. Tente novamente mais tarde ou fale com o suporte.",
};
