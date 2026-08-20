import type { FeatureFlagsServerCopy } from "./copy";

/**
 * The pt-BR pack — a NAMED export a host passes by hand
 * (`copy: PT_BR_FEATURE_FLAGS_SERVER_COPY`), never a default. The filename
 * is what exempts this file from the copy-portability gate: Portuguese may
 * ship, it may not be silent.
 */
export const PT_BR_FEATURE_FLAGS_SERVER_COPY: FeatureFlagsServerCopy = {
  unauthenticated: "Não autenticado.",
  invalidUser: "Informe o usuário.",
  invalidEmail: "Informe um e-mail válido.",
  noteTooLong: "A observação é longa demais.",
  userNotFound: "Nenhum usuário com este e-mail.",
  invalidBody: "Corpo inválido.",
  grantNotFound: "Este usuário não tem acesso a este recurso.",
  unknownFlag: "Recurso desconhecido.",
  invalidEnabled: "O campo enabled deve ser booleano.",
};
