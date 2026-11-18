/**
 * How card data gets from the buyer's browser to the provider without
 * touching the host's servers:
 *
 *   NONE        no client-side step (PIX/boleto only, or hosted checkout)
 *   PUBLIC_KEY  encrypt the card in-browser with the provider's public key
 *   SDK         load the provider's JS SDK / elements to mint a token
 *   REDIRECT    hosted checkout page; no card data in the host at all
 *
 * Its own module so `core/types.ts` stays under its size gate; re-exported
 * there, the one door every adapter and host imports it from.
 */
export type ClientTokenization = 'NONE' | 'PUBLIC_KEY' | 'SDK' | 'REDIRECT';
