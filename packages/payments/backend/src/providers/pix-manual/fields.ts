import type { ProbeCheck } from '../../core/types';
import type { PixManualCopy } from './copy';

/**
 * Reading the store's own settings — the only input a manual Pix has. Pure,
 * so the probe and the charge agree on what "valid" means by construction.
 */

/** Minutes an order waits for the store's confirmation when the owner left it blank. */
const DEFAULT_CONFIRM_MINUTES = 30;
const MIN_CONFIRM_MINUTES = 5;
const MAX_CONFIRM_MINUTES = 1440;
export const MERCHANT_NAME_MAX = 25;
export const MERCHANT_CITY_MAX = 15;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+55\d{10,11}$/;
const EVP = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PUNCTUATED_DOCUMENT = /^[\d.\-/\s]+$/;
const EMAIL_MAX = 77;

/**
 * The key as a BR Code must carry it, or null when it is no Pix key shape.
 *
 * A CPF or CNPJ typed with its punctuation ("123.456.789-09") is accepted and
 * stripped to digits, because that is how owners copy it from a document; the
 * DICT key itself is digits only. A phone keeps its `+55`, an e-mail is
 * lower-cased (DICT keys are case-insensitive) and a random key is lower-cased.
 */
export function normalizePixKey(raw: string | undefined): string | null {
  const key = (raw ?? '').trim();
  if (!key) return null;
  if (PHONE.test(key)) return key;
  if (EVP.test(key)) return key.toLowerCase();
  if (EMAIL.test(key) && key.length <= EMAIL_MAX) return key.toLowerCase();
  if (PUNCTUATED_DOCUMENT.test(key)) {
    const digits = key.replace(/\D/g, '');
    if (digits.length === 11 || digits.length === 14) return digits;
  }
  return null;
}

/** The confirmation window in minutes, or null when the owner typed something out of range. */
export function confirmWindowMinutes(raw: string | undefined): number | null {
  const typed = (raw ?? '').trim();
  if (!typed) return DEFAULT_CONFIRM_MINUTES;
  if (!/^\d+$/.test(typed)) return null;
  const minutes = Number(typed);
  return minutes >= MIN_CONFIRM_MINUTES && minutes <= MAX_CONFIRM_MINUTES ? minutes : null;
}

function filledWithin(raw: string | undefined, max: number): boolean {
  const value = (raw ?? '').trim();
  return value.length > 0 && value.length <= max;
}

/** Every field the store set, read once. `problems` lists the keys that are wrong. */
interface PixManualSettings {
  pixKey: string | null;
  merchantName: string;
  merchantCity: string;
  windowMinutes: number | null;
  problems: string[];
}

export function readSettings(fields: Readonly<Record<string, string>>): PixManualSettings {
  const pixKey = normalizePixKey(fields['pixKey']);
  const windowMinutes = confirmWindowMinutes(fields['confirmWithinMinutes']);
  const problems: string[] = [];
  if (pixKey === null) problems.push('pixKey');
  if (!filledWithin(fields['merchantName'], MERCHANT_NAME_MAX)) problems.push('merchantName');
  if (!filledWithin(fields['merchantCity'], MERCHANT_CITY_MAX)) problems.push('merchantCity');
  if (windowMinutes === null) problems.push('confirmWithinMinutes');
  return {
    pixKey,
    merchantName: (fields['merchantName'] ?? '').trim(),
    merchantCity: (fields['merchantCity'] ?? '').trim(),
    windowMinutes,
    problems,
  };
}

/** One PASS/FAIL line per field, for the settings screen to place under each. */
export function settingsChecks(settings: PixManualSettings, checks: PixManualCopy['checks']): ProbeCheck[] {
  const wrong = new Set(settings.problems);
  const line = (key: string, pass: string, fail: string): ProbeCheck =>
    wrong.has(key) ? { key, status: 'FAIL', message: fail } : { key, status: 'PASS', message: pass };
  return [
    line('pixKey', checks.pixKeyValid, checks.pixKeyInvalid),
    line('merchantName', checks.merchantNameValid, checks.merchantNameInvalid),
    line('merchantCity', checks.merchantCityValid, checks.merchantCityInvalid),
    line('confirmWithinMinutes', checks.windowValid(settings.windowMinutes ?? DEFAULT_CONFIRM_MINUTES), checks.windowInvalid),
  ];
}
