import type { CredentialsProviderLabels } from "./credentials-provider";

/**
 * The pt-BR labels of the Credentials provider — a NAMED export a host passes
 * by hand (`credentialsProvider({ labels: PT_BR_CREDENTIALS_LABELS, … })`).
 */
export const PT_BR_CREDENTIALS_LABELS: CredentialsProviderLabels = {
  name: "E-mail e senha",
  email: "E-mail",
  password: "Senha",
};
