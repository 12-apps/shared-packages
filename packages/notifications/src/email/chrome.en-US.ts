import type { EmailChromeCopy } from './template';

/** US English — the twin that makes {@link PT_BR_EMAIL_CHROME} a choice. */
export const EN_US_EMAIL_CHROME: EmailChromeCopy = {
  fallbackHint: 'If the button above does not work, copy and paste this address into your browser:',
  automated: 'This is an automated message. Please do not reply to this email.',
  tagline: (brand) => `Sent by ${brand}.`,
};
