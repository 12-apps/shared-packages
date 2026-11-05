/**
 * `@12-apps/payments-frontend/tax-id` — CPF and CNPJ checks a host runs on its
 * own fields (a profile form, a sign-up), with the card form's own messages
 * (FUT-1055).
 *
 * Its own entry rather than the root barrel's: a host validating a document
 * number at boot must not reach the card form. Plain functions and types, the
 * same ones the root exports; the module graph is pinned by
 * `__tests__/narrow-entries.test.ts`.
 */
export { formatCpf, validateCpf } from '../card/cpf';
export { formatCpfOrCnpj, isValidCpfOrCnpj, validateCpfOrCnpj } from '../card/tax-id';
export type { CardFieldCopy } from '../card/copy';
