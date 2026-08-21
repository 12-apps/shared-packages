import type { OnboardingMessages } from "./context";

/**
 * The pt-BR pack — verbatim what the origin host's route answered before copy
 * became required config (product copy never gets "translated" while tidying
 * code). The filename is what exempts this file from the copy-portability
 * gate: Portuguese may ship, it may not be silent.
 */
export const PT_BR_ONBOARDING_MESSAGES: OnboardingMessages = {
  resetUnavailable: "Reset de onboarding indisponível em produção.",
  invalidOperation: "Operação de onboarding inválida.",
  unknownFeature: "Recurso de onboarding desconhecido.",
};

/** The 401 the mounted router answers when the host resolves no actor. */
export const PT_BR_ONBOARDING_UNAUTHENTICATED = "Não autenticado.";
