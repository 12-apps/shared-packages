import type { AuthPagesCopy } from "./index";

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
