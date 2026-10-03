import { sha256Hex } from '../shared';

/**
 * The STATIC Pix BR Code — the EMV "copia e cola" a payer's bank app reads —
 * built from nothing but the store's own key (Banco Central, "Manual de Padrões
 * para Iniciação do Pix", BR Code / EMV QRCPS-MPM).
 *
 * Static on purpose: there is no PSP behind the manual Pix provider, so no
 * `location` URL to point a dynamic code at. A static code still carries the
 * exact AMOUNT and a short identifier, which is all the store needs to match
 * the transfer on its statement — the payer's app fills both in for them.
 *
 * Each field is `ID (2) + LENGTH (2, zero-padded) + VALUE`, and the code ends in
 * a CRC16 over everything before it, including the CRC's own `6304` header.
 */

/** What a static code needs: whose key, for how much, under which identifier. */
interface StaticBrCodeInput {
  /** The Pix key as the store registered it (CPF/CNPJ, e-mail, +55 phone or EVP). */
  pixKey: string;
  /** Merchant name, tag 59 — normalised to unaccented ASCII and clipped to 25. */
  merchantName: string;
  /** Merchant city, tag 60 — normalised to unaccented ASCII and clipped to 15. */
  merchantCity: string;
  /** Amount in cents; omitted lets the payer type it (never done here, but legal). */
  amountCents?: number;
  /** Tag 62/05, 1–25 alphanumeric; anything else is sanitised (`sanitizeTxId`). */
  txid?: string;
}

const MERCHANT_NAME_MAX = 25;
const MERCHANT_CITY_MAX = 15;
const TXID_MAX = 25;
/** The txid a static code carries when the payer is not asked to quote one. */
const NO_TXID = '***';
/** Readable characters of the reference kept in front of the hash. */
const TXID_PREFIX = 9;

/** One EMV field: id, two-digit length, value. */
function field(id: string, value: string): string {
  const length = String(value.length).padStart(2, '0');
  return `${id}${length}${value}`;
}

/**
 * Unaccented, printable ASCII, so a bank app that is strict about the EMV
 * character set still reads the name: "São Paulo" becomes "Sao Paulo".
 */
function asciiOnly(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The 1–25 alphanumeric identifier the payer's app quotes back on the
 * transfer. A reference that already fits is kept readable; a longer one keeps
 * a readable prefix plus a hash of the WHOLE reference — never a truncation, or
 * two attempts of one order (`order--1`, `order--2`, `core/reference.ts`) would
 * share an identifier and the store could not tell which code was paid.
 */
export function sanitizeTxId(reference: string): string {
  const readable = reference.replace(/[^a-zA-Z0-9]/g, '');
  if (readable.length > 0 && readable.length <= TXID_MAX && readable === reference) return readable;
  const prefix = readable.slice(0, TXID_PREFIX);
  return `${prefix}${sha256Hex(reference).slice(0, TXID_MAX - prefix.length)}`;
}

/** `12.50` from 1250 cents — the decimal point and two places the field requires. */
function amountField(amountCents: number): string {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new RangeError(`a Pix amount must be a positive whole number of cents, got ${amountCents}`);
  }
  const reais = Math.floor(amountCents / 100);
  const cents = String(amountCents % 100).padStart(2, '0');
  return field('54', `${reais}.${cents}`);
}

/**
 * CRC16/CCITT-FALSE (polynomial 0x1021, initial value 0xFFFF, no reflection,
 * no final XOR), as four uppercase hex digits — the checksum the BR Code
 * specification names for tag 63.
 */
export function crc16Ccitt(payload: string): string {
  let crc = 0xffff;
  for (let index = 0; index < payload.length; index += 1) {
    crc = crcByte(crc ^ (payload.charCodeAt(index) << 8));
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** The eight polynomial steps one byte takes — linear in the payload, not quadratic. */
function crcByte(start: number): number {
  let crc = start;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

/** The full static BR Code, CRC included. */
export function staticBrCode(input: StaticBrCodeInput): string {
  const pixKey = input.pixKey.trim();
  const merchantName = asciiOnly(input.merchantName).slice(0, MERCHANT_NAME_MAX);
  const merchantCity = asciiOnly(input.merchantCity).slice(0, MERCHANT_CITY_MAX);
  if (!pixKey) throw new RangeError('a static Pix code needs a key');
  if (!merchantName) throw new RangeError('a static Pix code needs the merchant name');
  if (!merchantCity) throw new RangeError('a static Pix code needs the merchant city');
  const txid = input.txid === undefined ? NO_TXID : sanitizeTxId(input.txid);
  const body = [
    field('00', '01'),
    field('26', field('00', 'br.gov.bcb.pix') + field('01', pixKey)),
    field('52', '0000'),
    field('53', '986'),
    input.amountCents === undefined ? '' : amountField(input.amountCents),
    field('58', 'BR'),
    field('59', merchantName),
    field('60', merchantCity),
    field('62', field('05', txid)),
    '6304',
  ].join('');
  return `${body}${crc16Ccitt(body)}`;
}
