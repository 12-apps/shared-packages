import type {
  BrowserCardResult,
  DebitTestData,
  EvidenceBuyer,
  ThreeDSecureSession,
} from '@12-apps/payments-backend';

import { authenticatePagBankDebit } from '../../card/three-ds';
import { encryptPagBankCard } from '../../card/tokenize';
import { THREEDS_FAILURES } from './HomologacaoEvidenceCard';

/**
 * The data half of the PRODUCTION evidence card (FUT-4198): the cardholder
 * the operator types, the two real cards, and turning them into what the
 * server takes — the buyer, and cards encrypted in this browser. A PAN or a
 * CVV never leaves this module except through `PagSeguro.encryptCard`.
 */

/** The cardholder form, as typed. Every field is text; `buyerOf` decides what is valid. */
export interface BuyerForm {
  name: string;
  taxId: string;
  email: string;
  phone: string;
  postalCode: string;
  street: string;
  number: string;
  complement: string;
  city: string;
  regionCode: string;
}

export const EMPTY_BUYER: BuyerForm = {
  name: '',
  taxId: '',
  email: '',
  phone: '',
  postalCode: '',
  street: '',
  number: '',
  complement: '',
  city: '',
  regionCode: '',
};

/** One card, as typed. */
export interface CardForm {
  number: string;
  expiry: string;
  securityCode: string;
}

export const EMPTY_CARD: CardForm = { number: '', expiry: '', securityCode: '' };

const digits = (value: string): string => value.replace(/\D/g, '');

/**
 * The buyer the server takes, or null while anything is missing or malformed.
 * A CPF has 11 digits and a CNPJ 14; the phone goes in E.164 with Brazil's code
 * when the operator typed only the national number.
 */
export function buyerOf(form: BuyerForm): EvidenceBuyer | null {
  const taxId = digits(form.taxId);
  const phone = digits(form.phone);
  const postalCode = digits(form.postalCode);
  const regionCode = form.regionCode.trim().toUpperCase();
  const required = [form.name, form.email, form.street, form.number, form.city].map((value) => value.trim());
  if (required.some((value) => value === '')) return null;
  if (![11, 14].includes(taxId.length) || phone.length < 10 || postalCode.length !== 8) return null;
  if (!/^[A-Z]{2}$/.test(regionCode) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) return null;
  const complement = form.complement.trim();
  return {
    name: form.name.trim(),
    email: form.email.trim(),
    taxId,
    phone: `+${phone.length <= 11 ? `55${phone}` : phone}`,
    billingAddress: {
      street: form.street.trim(),
      number: form.number.trim(),
      ...(complement ? { complement } : {}),
      regionCode,
      city: form.city.trim(),
      postalCode,
    },
  };
}

interface ParsedCard {
  number: string;
  expMonth: string;
  expYear: string;
  securityCode: string;
}

/** The card's parts, or null while the number, expiry or CVV cannot be a card's. */
export function cardOf(form: CardForm): ParsedCard | null {
  const number = digits(form.number);
  const expiry = /^(\d{2})\s*\/\s*(\d{2}|\d{4})$/.exec(form.expiry.trim());
  const securityCode = digits(form.securityCode);
  if (number.length < 13 || number.length > 19 || !expiry || securityCode.length < 3 || securityCode.length > 4) return null;
  const month = Number(expiry[1]);
  if (month < 1 || month > 12) return null;
  const year = expiry[2]!.length === 2 ? `20${expiry[2]}` : expiry[2]!;
  return { number, expMonth: expiry[1]!, expYear: year, securityCode };
}

/** Whether a card form was left blank — the debit card may be. */
export function isBlank(form: CardForm): boolean {
  return digits(form.number) === '' && form.expiry.trim() === '' && digits(form.securityCode) === '';
}

/** The network a number's first digits name, as the file prints it; never the number. */
function brandOf(number: string): string {
  if (/^4/.test(number)) return 'VISA';
  if (/^(5[1-5]|2[2-7])/.test(number)) return 'MASTERCARD';
  if (/^3[47]/.test(number)) return 'AMEX';
  return 'OTHER';
}

/** Only the last four: a real card's first six stay in this browser too. */
function maskRealCard(number: string): string {
  return `**** **** **** ${number.slice(-4)}`;
}

/** A real card, encrypted with the seller's public key — or the code saying why it is not. */
export async function encryptRealCard(
  scenario: BrowserCardResult['scenario'],
  card: ParsedCard,
  holder: string,
  publicKey: string | null,
): Promise<BrowserCardResult> {
  const base = { scenario, brand: brandOf(card.number), masked: maskRealCard(card.number) };
  if (!publicKey) return { ...base, encrypted: null, failure: 'NO_PUBLIC_KEY' };
  const encrypted = await encryptPagBankCard({ publicKey, holder, ...card });
  return 'encrypted' in encrypted
    ? { ...base, encrypted: encrypted.encrypted }
    : { ...base, encrypted: null, failure: encrypted.failure };
}

/**
 * The real debit card, encrypted and authenticated with PagBank's 3DS for the
 * amount the server will charge. No timeout: a real issuer may challenge, and
 * the person answering it takes the time they take.
 */
export async function authenticateRealDebit(
  card: ParsedCard,
  holder: string,
  publicKey: string | null,
  session: ThreeDSecureSession | null,
  test: DebitTestData | undefined,
): Promise<BrowserCardResult> {
  const encrypted = await encryptRealCard('debit', card, holder, publicKey);
  if (!encrypted.encrypted) return encrypted;
  if (!session || !test) return { ...encrypted, failure: 'NO_THREEDS_SESSION' };
  const outcome = await authenticatePagBankDebit({
    session: session.session,
    environment: session.environment,
    encryptedCard: encrypted.encrypted,
    amountCents: test.amountCents,
    customer: test.customer,
    billingAddress: test.billingAddress,
  });
  return outcome.ok
    ? { ...encrypted, authenticationId: outcome.authenticationId, authenticated: outcome.authenticated }
    : { ...encrypted, failure: THREEDS_FAILURES[outcome.failure] };
}

const STORAGE_KEY = 'payments.homologacao.production.buyer';

/**
 * The last cardholder used in this browser — a per-operator convenience, so
 * the next run starts filled. Never a card. Storage may be absent or refuse
 * (a private window): then the form starts empty.
 */
export function rememberedBuyer(): BuyerForm {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_BUYER;
    const parsed = JSON.parse(raw) as Partial<BuyerForm>;
    return Object.fromEntries(
      Object.keys(EMPTY_BUYER).map((key) => [key, String(parsed[key as keyof BuyerForm] ?? '')]),
    ) as unknown as BuyerForm;
  } catch {
    return EMPTY_BUYER;
  }
}

export function rememberBuyer(form: BuyerForm): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(form));
  } catch {
    // A refused write only costs the next run its prefill.
  }
}
