import type { FormsMessages } from './messages';

/**
 * The pt-BR sentences for this package's English fallbacks — a NAMED export a
 * host passes by hand, never a default:
 *
 * - `createServerAction(schema, handler, { genericError: PT_BR_FORMS_MESSAGES.genericError })`
 * - `required(PT_BR_FORMS_MESSAGES.required)`, `email(PT_BR_FORMS_MESSAGES.email)`,
 *   `minLength(n, PT_BR_FORMS_MESSAGES.minLength(n))`
 */
export const PT_BR_FORMS_MESSAGES: FormsMessages = {
  genericError: 'Algo deu errado. Tente novamente.',
  required: 'Campo obrigatório',
  email: 'Informe um e-mail válido',
  minLength: (length: number): string => `Deve ter pelo menos ${length} caracteres`,
};
