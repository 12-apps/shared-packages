import type { TransportRecipient } from '../types';

/**
 * A GUEST row's recipient: its phone, and nothing else to reach them by (no
 * e-mail, no push). `userId` is the empty string — `guest` says why.
 */
export function guestRecipient(
  phone: string,
  clientId: string | null,
  side: string | null,
  locale?: string | null,
): TransportRecipient {
  return {
    userId: '',
    guest: true,
    email: null,
    phone,
    ...(locale === undefined ? {} : { locale }),
    clientId,
    side,
    pushSubscriptionCount: 0,
  };
}
