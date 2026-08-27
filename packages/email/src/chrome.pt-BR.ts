import type { EmailChromeCopy } from './template';

/**
 * Brazilian Portuguese, as a NAMED pack.
 *
 * A host passes this by name — `chrome: PT_BR_EMAIL_CHROME`, or
 * `localeCopy(EMAIL_CHROME)` for a host whose readers do not share one
 * language. It is never a default: a pack a host CHOOSES is a decision in a
 * diff, and a pack a package applies silently is another product's voice in
 * somebody's inbox.
 *
 * The tagline names the brand and stops. It is deliberately not a description
 * of what the product does — that sentence is the host's, it belongs to a
 * vocabulary this package cannot know, and a package that guessed one would be
 * putting words in every adopter's footer.
 */
export const PT_BR_EMAIL_CHROME: EmailChromeCopy = {
  fallbackHint: 'Se o botão acima não funcionar, copie e cole este endereço no seu navegador:',
  automated: 'Esta é uma mensagem automática. Não responda a este e-mail.',
  tagline: (brand) => `Enviado por ${brand}.`,
};
