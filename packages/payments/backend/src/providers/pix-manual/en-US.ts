import type { PixManualCopy } from './copy';

export const EN_US_PIX_MANUAL_COPY: PixManualCopy = {
  displayName: 'Manual Pix',
  unreachable: 'The setup could not be checked right now. Try again in a moment.',
  fields: {
    pixKey: 'Store Pix key',
    pixKeyHelp: 'CPF, CNPJ, e-mail, mobile number with +55 or a random key. The money lands in this key’s account.',
    merchantName: 'Recipient name',
    merchantNameHelp: 'Shown in the buyer’s bank app before they pay. Up to 25 characters.',
    merchantCity: 'City',
    merchantCityHelp: 'City of the Pix key’s account. Up to 15 characters.',
    confirmWithinMinutes: 'Time to confirm (minutes)',
    confirmWithinMinutesHelp:
      'How long an order waits for you to confirm the Pix arrived. After that the order expires and the buyer is told. Empty: 30 minutes.',
  },
  checks: {
    pixKeyValid: 'Pix key format is valid.',
    pixKeyInvalid:
      'That does not look like a Pix key. Use a CPF (11 digits), CNPJ (14 digits), e-mail, mobile number with +55 or the random key.',
    merchantNameValid: 'Recipient name filled in.',
    merchantNameInvalid: 'Fill in the recipient name, up to 25 characters.',
    merchantCityValid: 'City filled in.',
    merchantCityInvalid: 'Fill in the city, up to 15 characters.',
    windowValid: (minutes) => `Orders wait up to ${minutes} minutes for your confirmation.`,
    windowInvalid: 'The time must be a number of minutes between 5 and 1440.',
  },
  invalid: 'Check the marked fields before enabling manual Pix.',
  ready: 'Ready: the buyer sees a Pix QR code for the order amount, and you confirm when the money arrives.',
};
