/**
 * The vocabulary of the station↔terminal LAN link, and its strict reading.
 *
 * Every message is one JSON object: the envelope (`v`, `type`, `n`, `at`,
 * `mac`), the session (`sid`, on every message but `hello`) and the type's own
 * fields. Reading refuses anything else: an unknown type, an unknown key, a
 * missing key, a field of the wrong type or out of range. The mac, the counter
 * and the session are checked afterwards by the peer (`./peer.ts`), because
 * they need the link's key and state.
 *
 * Card data never crosses: only the sale, the amount, the method and the
 * capture's acquirer trace.
 */

export const LINK_PROTOCOL_VERSION = 1;

/** The station listens here unless the store overrides it. */
export const DEFAULT_LINK_PORT = 7380;

/** The providers a link may carry: one terminal per provider per station. */
export const LINK_PROVIDERS = ["PAGBANK"] as const;
export type LinkProvider = (typeof LINK_PROVIDERS)[number];

/** What the station may push: a card or a Pix leg. Cash never reaches the terminal. */
export const CHARGE_METHODS = ["CREDIT", "DEBIT", "PIX"] as const;
export type ChargeMethod = (typeof CHARGE_METHODS)[number];

/** Changing the payment method may land on any method the merchant offers; CASH sends the leg back to the station. */
export const CHANGED_METHODS = ["CREDIT", "DEBIT", "PIX", "CASH"] as const;
export type ChangedMethod = (typeof CHANGED_METHODS)[number];

export const CHARGE_STATES = ["processing", "declined", "cancelled", "approved", "method_changed"] as const;
export type ChargeState = (typeof CHARGE_STATES)[number];

/** The most parts one split charge may be pushed in: a protocol limit. */
export const MAX_SPLIT_PARTS = 6;
/** The most typed captures one message hands over. */
export const MAX_TYPED_CAPTURES = 50;
/** 100,000,000 cents: no single leg is larger. */
const MAX_LEG_CENTS = 100_000_000;

/** One terminal capture's acquirer trace: what the capture ledger records (`../terminal`). */
export interface CaptureTrace {
  readonly transactionCode: string;
  readonly transactionId: string | null;
  readonly authorizationCode: string | null;
  readonly brand: string | null;
  readonly installments: number;
  readonly serial: string;
  readonly entryMode: string | null;
  readonly amountCents: number;
  readonly kind: ChargeMethod;
  /** ISO-8601. */
  readonly capturedAt: string;
}

// ── station → terminal ───────────────────────────────────────────────────────

/** The station's answer to the terminal's hello: its id, the session it opens (`nonce`), and the terminal's nonce echoed. */
export interface StationHello {
  readonly type: "hello";
  readonly stationId: string;
  readonly nonce: string;
  readonly reply: string;
}

export interface ChargeBody {
  readonly type: "charge";
  readonly chargeId: string;
  /** The sale's reference as the operator says it (a sale number, say). */
  readonly saleRef: string;
  /** Who is charging, as the terminal shows it. */
  readonly operator: string;
  readonly amountCents: number;
  readonly method: ChargeMethod;
  /** A split's part (part 1 of 2): both or neither. */
  readonly part?: number;
  readonly parts?: number;
  /** What the station still collects itself after this part. Only with a split. */
  readonly remainingCents?: number;
}

export interface CancelBody {
  readonly type: "cancel";
  readonly chargeId: string;
}

export interface PingBody {
  readonly type: "ping";
}

/**
 * The typed captures the station's page BOOKED as a sale: the terminal may
 * stop resending these codes. The station sends it only when the page says
 * the sale that binds them went through — never on receipt of
 * `typed_captures`, so a capture the page failed to book is resent.
 */
export interface TypedAckBody {
  readonly type: "typed_ack";
  readonly transactionCodes: readonly string[];
}

export type StationBody = StationHello | ChargeBody | CancelBody | PingBody | TypedAckBody;

// ── terminal → station ───────────────────────────────────────────────────────

/** The terminal's first message: which device it is, and a fresh nonce the station must echo. */
export interface TerminalHello {
  readonly type: "hello";
  readonly deviceId: string;
  readonly nonce: string;
}

export interface StatusBody {
  readonly type: "status";
  readonly chargeId: string;
  readonly state: ChargeState;
  /** Only with `method_changed`, and required there. */
  readonly method?: ChangedMethod;
  /** Only with `approved`, and required there. */
  readonly capture?: CaptureTrace;
}

/** Captures the terminal took with no link (an amount typed on it), handed over when the link returns. */
export interface TypedCapturesBody {
  readonly type: "typed_captures";
  readonly captures: readonly CaptureTrace[];
}

export interface PongBody {
  readonly type: "pong";
}

export type TerminalBody = TerminalHello | StatusBody | TypedCapturesBody | PongBody;

/** Who sent a message: the vocabulary differs per direction. */
export type LinkSide = "station" | "terminal";
export type BodyFrom<S extends LinkSide> = S extends "station" ? StationBody : TerminalBody;

/** The envelope every message carries. `sid` is absent on `hello` only. */
export interface Envelope {
  readonly v: typeof LINK_PROTOCOL_VERSION;
  /** Grows by at least one per message, per direction, within a session. */
  readonly n: number;
  /** The sender's clock, epoch milliseconds. */
  readonly at: number;
  readonly sid?: string;
  /** HMAC-SHA256(secret, canonical JSON of every other key), lowercase hex. */
  readonly mac: string;
}

export type Message<S extends LinkSide> = BodyFrom<S> & Envelope;

/** Why a message was refused. */
export type LinkRefusal =
  | "malformed"
  | "version"
  | "unknown-type"
  | "unknown-key"
  | "missing-key"
  | "bad-field"
  | "bad-mac"
  | "stale"
  | "replayed"
  | "session";

export type ReadResult<S extends LinkSide> =
  | { readonly ok: true; readonly message: Message<S> }
  | { readonly ok: false; readonly refusal: LinkRefusal; readonly detail?: string };

// ── field checks ─────────────────────────────────────────────────────────────

type Check = (value: unknown) => boolean;

const ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const NONCE = /^[0-9a-f]{32,64}$/;
const MAC = /^[0-9a-f]{64}$/;
// eslint-disable-next-line no-control-regex -- the point is to refuse control characters
const CONTROL = /[\u0000-\u001f\u007f]/;
/** A lone UTF-16 surrogate: not text, and not encodable as UTF-8 (the mac would cover U+FFFD instead). */
const LONE_SURROGATE = /\p{Cs}/u;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

const id: Check = (value) => typeof value === "string" && ID.test(value);
const nonce: Check = (value) => typeof value === "string" && NONCE.test(value);
const text =
  (max: number): Check =>
  (value) =>
    typeof value === "string" && value.trim().length > 0 && value.length <= max && !CONTROL.test(value) && !LONE_SURROGATE.test(value);
const nullable =
  (check: Check): Check =>
  (value) =>
    value === null || check(value);
const int =
  (min: number, max: number): Check =>
  (value) =>
    typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
const oneOf =
  (options: readonly string[]): Check =>
  (value) =>
    typeof value === "string" && options.includes(value);
const isoDate: Check = (value) => typeof value === "string" && ISO.test(value) && Number.isFinite(Date.parse(value));

const cents = int(1, MAX_LEG_CENTS);

interface Shape {
  readonly required: Readonly<Record<string, Check>>;
  readonly optional?: Readonly<Record<string, Check>>;
}

const CAPTURE_SHAPE: Shape = {
  required: {
    transactionCode: text(64),
    transactionId: nullable(text(64)),
    authorizationCode: nullable(text(32)),
    brand: nullable(text(32)),
    installments: int(1, 24),
    serial: text(64),
    entryMode: nullable(text(32)),
    amountCents: cents,
    kind: oneOf(CHARGE_METHODS),
    capturedAt: isoDate,
  },
};

type Problem = { refusal: LinkRefusal; detail: string };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * A key the shape does not name. OWN keys only, on both sides: `in` would walk
 * the prototype, so `constructor`, `toString`, `hasOwnProperty` or a raw JSON
 * `"__proto__"` key would pass as known and never be checked.
 */
function unknownKey(record: Record<string, unknown>, shape: Shape): Problem | null {
  const key = Object.keys(record).find((name) => !Object.hasOwn(shape.required, name) && !Object.hasOwn(shape.optional ?? {}, name));
  return key === undefined ? null : { refusal: "unknown-key", detail: key };
}

/** A required key missing or wrong, or an optional one present and wrong (own keys only, as above). */
function fieldProblem(record: Record<string, unknown>, shape: Shape): Problem | null {
  for (const [key, check] of Object.entries(shape.required)) {
    if (!Object.hasOwn(record, key)) return { refusal: "missing-key", detail: key };
    if (!check(record[key])) return { refusal: "bad-field", detail: key };
  }
  const wrong = Object.entries(shape.optional ?? {}).find(([key, check]) => Object.hasOwn(record, key) && !check(record[key]));
  return wrong === undefined ? null : { refusal: "bad-field", detail: wrong[0] };
}

/** The first problem with `value` against `shape`, or `null`. */
function shapeProblem(value: unknown, shape: Shape): Problem | null {
  if (!isRecord(value)) return { refusal: "bad-field", detail: "not an object" };
  return unknownKey(value, shape) ?? fieldProblem(value, shape);
}

const capture: Check = (value) => shapeProblem(value, CAPTURE_SHAPE) === null;
const captures: Check = (value) => Array.isArray(value) && value.length >= 1 && value.length <= MAX_TYPED_CAPTURES && value.every(capture);
const transactionCodes: Check = (value) => Array.isArray(value) && value.length >= 1 && value.length <= MAX_TYPED_CAPTURES && value.every(text(64));

const ENVELOPE = { v: (value: unknown) => value === LINK_PROTOCOL_VERSION, n: int(1, Number.MAX_SAFE_INTEGER), at: int(0, Number.MAX_SAFE_INTEGER), mac: (value: unknown) => typeof value === "string" && MAC.test(value), type: (value: unknown) => typeof value === "string" };
const SESSION = { sid: nonce };

const STATION_SHAPES: Readonly<Record<StationBody["type"], Shape>> = {
  hello: { required: { ...ENVELOPE, stationId: id, nonce, reply: nonce } },
  charge: {
    required: { ...ENVELOPE, ...SESSION, chargeId: id, saleRef: text(40), operator: text(80), amountCents: cents, method: oneOf(CHARGE_METHODS) },
    optional: { part: int(1, MAX_SPLIT_PARTS), parts: int(2, MAX_SPLIT_PARTS), remainingCents: int(0, MAX_LEG_CENTS) },
  },
  cancel: { required: { ...ENVELOPE, ...SESSION, chargeId: id } },
  ping: { required: { ...ENVELOPE, ...SESSION } },
  typed_ack: { required: { ...ENVELOPE, ...SESSION, transactionCodes } },
};

const TERMINAL_SHAPES: Readonly<Record<TerminalBody["type"], Shape>> = {
  hello: { required: { ...ENVELOPE, deviceId: id, nonce } },
  status: {
    required: { ...ENVELOPE, ...SESSION, chargeId: id, state: oneOf(CHARGE_STATES) },
    optional: { method: oneOf(CHANGED_METHODS), capture },
  },
  typed_captures: { required: { ...ENVELOPE, ...SESSION, captures } },
  pong: { required: { ...ENVELOPE, ...SESSION } },
};

/** The rules one field cannot say alone. */
function crossFieldProblem(record: Record<string, unknown>): string | null {
  if (record.type === "charge") {
    const hasPart = Object.hasOwn(record, "part");
    if (hasPart !== Object.hasOwn(record, "parts")) return "part";
    if (hasPart && (record.part as number) > (record.parts as number)) return "part";
    if (Object.hasOwn(record, "remainingCents") && !hasPart) return "remainingCents";
  }
  if (record.type === "status") {
    if ((record.state === "approved") !== Object.hasOwn(record, "capture")) return "capture";
    if ((record.state === "method_changed") !== Object.hasOwn(record, "method")) return "method";
  }
  return null;
}

/** A JSON object, or `null`. */
function parseObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Read one raw frame sent by `from`. Structure only: the mac, the counter, the
 * clock and the session are the peer's checks.
 */
export function readMessage<S extends LinkSide>(raw: string, from: S): ReadResult<S> {
  const record = parseObject(raw);
  if (record === null) return { ok: false, refusal: "malformed" };
  if (record.v !== LINK_PROTOCOL_VERSION) return { ok: false, refusal: "version" };
  const shapes: Readonly<Record<string, Shape>> = from === "station" ? STATION_SHAPES : TERMINAL_SHAPES;
  const type = record.type;
  if (typeof type !== "string" || !Object.hasOwn(shapes, type)) return { ok: false, refusal: "unknown-type", detail: String(type) };
  const problem = shapeProblem(record, shapes[type]!);
  if (problem !== null) return { ok: false, ...problem };
  const cross = crossFieldProblem(record);
  if (cross !== null) return { ok: false, refusal: "bad-field", detail: cross };
  return { ok: true, message: record as unknown as Message<S> };
}

/** Whether `value` is a capture trace, read as strictly as inside a message. */
export function isCaptureTrace(value: unknown): value is CaptureTrace {
  return capture(value);
}
