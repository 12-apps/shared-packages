import { CAPTURE_KINDS, type CaptureKind } from './model';

/**
 * The two wire shapes a capture arrives in, read by hand and STRICT: an
 * unknown key is refused, never dropped. No card data: a terminal hands out
 * none, and none may cross the wire.
 *
 * - The DEVICE REPORT is what the terminal posts itself. The tenant, the
 *   terminal and the source are the server's to decide (the device's
 *   credential names them), so a body naming a device is malformed, not a
 *   hint. `capturedAt` may be absent: then it is now.
 * - The STATION WIRE is what the station that drove the terminal sends with a
 *   sale: the same fields, plus the terminal that took it, by id, and a
 *   `capturedAt` it must always know.
 *
 * Text fields are trimmed, then held to their lengths, as the host's schemas
 * did; an absent optional field stays absent.
 */

/** A capture as the terminal reports it. */
export interface DeviceCaptureReport {
  transactionCode: string;
  kind: CaptureKind;
  /** Integer cents the acquirer took — never the sale's total. */
  amountCents: number;
  /** When the terminal took it, ISO 8601 with an offset. Absent: now. */
  capturedAt?: string;
  transactionId?: string | null;
  hostNsu?: string | null;
  authorizationCode?: string | null;
  cardBrand?: string | null;
  installments?: number | null;
  terminalSerial?: string | null;
  entryMode?: string | null;
}

/** A capture as the station sends it with a sale's leg. */
export interface StationCaptureWire extends Omit<DeviceCaptureReport, 'capturedAt'> {
  /** When the terminal took it. */
  capturedAt: string;
  /** The paired terminal that took it, when the station knows it. Must be this tenant's. */
  deviceId?: string | null;
}

export interface CaptureReadLimits {
  /** The most one capture may carry, in cents: the host's own ceiling. */
  maxAmountCents: number;
}

export type CaptureReadResult<T> = { ok: true; value: T } | { ok: false; issues: string[] };

const TRACE_TEXT: ReadonlyArray<readonly [keyof DeviceCaptureReport, number]> = [
  ['transactionId', 128],
  ['hostNsu', 64],
  ['authorizationCode', 64],
  ['cardBrand', 32],
  ['terminalSerial', 64],
  ['entryMode', 32],
];

const DEVICE_KEYS = new Set<string>([
  'transactionCode',
  'kind',
  'amountCents',
  'capturedAt',
  'installments',
  ...TRACE_TEXT.map(([key]) => key),
]);
const STATION_KEYS = new Set<string>([...DEVICE_KEYS, 'deviceId']);

// ISO 8601 date-time with a `Z` or `±hh:mm` offset: the same grammar the
// host's `z.string().datetime({ offset: true })` accepted, leap days included.
const DATE =
  '(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))';
const TIME = '(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?';
const OFFSET_DATE_TIME = new RegExp(`^${DATE}T${TIME}(?:Z|[+-](?:[01]\\d|2[0-3]):[0-5]\\d)$`);

type Fields = Record<string, unknown>;

/** Collects the issues of one read and the value it builds. */
class Reading {
  readonly issues: string[] = [];
  readonly value: Fields = {};

  constructor(private readonly input: Fields) {}

  has(key: string): boolean {
    return this.input[key] !== undefined;
  }

  text(key: string, max: number, nullable: boolean): void {
    const raw = this.input[key];
    if (raw === undefined) return;
    if (raw === null && nullable) {
      this.value[key] = null;
      return;
    }
    const trimmed = typeof raw === 'string' ? raw.trim() : null;
    if (trimmed === null || trimmed.length < 1 || trimmed.length > max) {
      this.issues.push(`${key}: expected text of 1 to ${max} characters`);
      return;
    }
    this.value[key] = trimmed;
  }

  integer(key: string, min: number, max: number, nullable: boolean): void {
    const raw = this.input[key];
    if (raw === undefined) return;
    if (raw === null && nullable) {
      this.value[key] = null;
      return;
    }
    if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < min || raw > max) {
      this.issues.push(`${key}: expected an integer from ${min} to ${max}`);
      return;
    }
    this.value[key] = raw;
  }

  required(key: string): void {
    if (!this.has(key)) this.issues.push(`${key}: required`);
  }
}

function isPlainObject(input: unknown): input is Fields {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function readCommon(input: unknown, keys: ReadonlySet<string>, limits: CaptureReadLimits): Reading | string[] {
  if (!isPlainObject(input)) return ['expected an object'];
  const reading = new Reading(input);
  for (const key of Object.keys(input)) {
    if (!keys.has(key)) reading.issues.push(`${key}: unknown key`);
  }
  for (const key of ['transactionCode', 'kind', 'amountCents']) reading.required(key);
  reading.text('transactionCode', 64, false);
  const kind = input.kind;
  if (kind !== undefined) {
    if ((CAPTURE_KINDS as readonly unknown[]).includes(kind)) reading.value.kind = kind;
    else reading.issues.push(`kind: expected one of ${CAPTURE_KINDS.join(', ')}`);
  }
  reading.integer('amountCents', 1, limits.maxAmountCents, false);
  for (const [key, max] of TRACE_TEXT) reading.text(key, max, true);
  reading.integer('installments', 1, 99, true);
  readCapturedAt(reading, input.capturedAt);
  return reading;
}

function readCapturedAt(reading: Reading, raw: unknown): void {
  if (raw === undefined) return;
  if (typeof raw !== 'string' || !OFFSET_DATE_TIME.test(raw)) {
    reading.issues.push('capturedAt: expected an ISO 8601 date-time with an offset');
    return;
  }
  reading.value.capturedAt = raw;
}

function settle<T>(reading: Reading | string[]): CaptureReadResult<T> {
  if (Array.isArray(reading)) return { ok: false, issues: reading };
  if (reading.issues.length > 0) return { ok: false, issues: reading.issues };
  return { ok: true, value: reading.value as unknown as T };
}

/** Read the terminal's own report of one capture. */
export function readDeviceCaptureReport(input: unknown, limits: CaptureReadLimits): CaptureReadResult<DeviceCaptureReport> {
  return settle(readCommon(input, DEVICE_KEYS, limits));
}

/** Read the capture a station sends on a sale's leg. */
export function readStationCaptureWire(input: unknown, limits: CaptureReadLimits): CaptureReadResult<StationCaptureWire> {
  const reading = readCommon(input, STATION_KEYS, limits);
  if (!Array.isArray(reading)) {
    reading.required('capturedAt');
    reading.text('deviceId', 64, true);
  }
  return settle(reading);
}

/** A leg as a sale's body carries it; `capture` is present only on a terminal leg. */
export interface LegWithCapture<TCapture extends { transactionCode: string } = StationCaptureWire> {
  tender: string;
  amountCents?: number | undefined;
  capture?: TCapture | undefined;
}

/**
 * A terminal leg is exactly its capture: the tender IS the captured kind, and
 * the leg names the captured amount — never "the rest".
 */
export function captureFitsLeg(leg: LegWithCapture): boolean {
  if (leg.capture === undefined) return true;
  return leg.tender === leg.capture.kind && leg.amountCents === leg.capture.amountCents;
}

/** One capture is one leg: the same transaction code twice in one request is malformed. */
export function distinctCaptures(legs: readonly LegWithCapture<{ transactionCode: string }>[]): boolean {
  const codes = legs.flatMap((leg) => (leg.capture === undefined ? [] : [leg.capture.transactionCode]));
  return new Set(codes).size === codes.length;
}
