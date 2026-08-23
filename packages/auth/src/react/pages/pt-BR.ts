import type { AuthPagesCopy } from "./index";
import type { AuthErrorCopy } from "./errors";

/**
 * Brazilian Portuguese page chrome.
 *
 * Exported but never applied by default: `AuthPagesConfig.copy` stays required,
 * so a deployment wanting other words writes its own object and never imports
 * this. What this saves is a host with nothing to say about the phrasing having
 * to invent eight sentences anyway.
 */
export const PT_BR_PAGES: AuthPagesCopy = {
  login: {
    title: "Entrar",
    subtitle: "Entre na sua conta",
    providerDivider: "ou entre com",
    signupPrompt: "Não tem uma conta?",
    signupLink: "Cadastre-se",
  },
  signup: {
    title: "Criar conta",
    subtitle: "Crie sua conta",
    providerDivider: "ou cadastre-se com",
    loginPrompt: "Já tem uma conta?",
    loginLink: "Entrar",
  },
};

/**
 * The Auth.js error codes in Brazilian Portuguese.
 *
 * These replace two host-side maps that had already drifted apart: the same
 * `Configuration` code explained itself differently in the storefront and the
 * backoffice, and the backoffice knew four of the nine codes it could actually
 * receive — the other five fell through to "erro inesperado", which tells
 * somebody locked out precisely nothing.
 *
 * `fallback` still exists, because Auth.js may add a code this pack predates.
 * It is the floor, not the common case.
 */
export const PT_BR_AUTH_ERRORS: AuthErrorCopy = {
  AccessDenied: "Cadastre-se e aceite os termos para continuar.",
  Configuration:
    "Não foi possível concluir o login agora (o provedor não respondeu). Tente novamente em instantes.",
  Verification: "O link de verificação expirou ou já foi usado.",
  OAuthSignin: "Não foi possível iniciar o login. Tente novamente.",
  OAuthCallback: "Não foi possível concluir o login. Tente novamente.",
  OAuthAccountNotLinked: "Este e-mail já está associado a outra conta.",
  OAuthCreateAccount: "Não foi possível criar a conta com esse provedor.",
  EmailCreateAccount: "Não foi possível criar a conta com esse e-mail.",
  Callback: "Não foi possível concluir o login. Tente novamente.",
  CredentialsSignin: "E-mail ou senha incorretos.",
  SessionRequired: "Entre na sua conta para continuar.",
  fallback: "Ocorreu um erro inesperado. Tente novamente.",
  dismiss: "Fechar o aviso",
  /**
   * The headings the two hosts used. `AccessDenied` is not a failure — it is an
   * instruction to sign up first — so it keeps its own, and everything else
   * falls back to the one the backoffice showed for every code.
   */
  titles: {
    AccessDenied: "Cadastro necessário",
    Verification: "Link expirado",
    SessionRequired: "Entre para continuar",
  },
  titleFallback: "Falha ao entrar",
};
