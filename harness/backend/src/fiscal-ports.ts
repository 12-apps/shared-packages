/**
 * The HOST's half of the `@12-apps/fiscal` adoption: every port the document
 * service asks for by name, as an in-process fake that never leaves the
 * process. `fiscal-host.ts` binds them; this file only says what they are.
 *
 * - the Issuer: answers `AUTHORIZED` with a fixed protocol for every issue (and
 *   every transmit), recording each call. Nothing else is modelled, and a call
 *   the harness never makes answers a classified `INTERNAL` failure rather
 *   than pretending SEFAZ said something;
 * - the Cipher: a reversible encoding, because this harness holds no key worth
 *   protecting (the marketplace adoption's precedent);
 * - the DocumentStorage: a Map;
 * - the SaleSource: one fixed sale, whatever subject is asked for;
 * - the certificate reader: an A1 the harness never opens, expiring a fixed
 *   thirty days after the clock;
 * - the notifier: an array, each event rendered through the package's own
 *   blueprints over this host's words.
 *
 * The package's behaviour is tested in the package; these exist so the
 * adoption is real, not so they can be clever.
 */
import { computeAccessKey, type Cipher, type DocumentStorage, type FiscalNotifyPort, type SaleDraft, type SaleSource } from '@12-apps/fiscal/documents';
import type { Issuer, IssuerFailure } from '@12-apps/fiscal/issuer';
import { createFiscalNotificationBlueprints, type FiscalNotificationContent } from '@12-apps/fiscal/notifications';

/** The protocol every authorisation here carries. */
export const FISCAL_PROTOCOL = '135260000000001';

/** One call the document service made to the issuer. */
export interface IssuerCall {
  method: keyof Issuer;
  model: string | null;
  accessKey: string | null;
}

/** One notification the service or a job emitted, with the words a person would read. */
export interface FiscalNotified {
  type: string;
  recipient: { tenantId: string; permission: string };
  payload: unknown;
  content: FiscalNotificationContent | null;
}

/** The one sale this host sells: one line, paid in cash. */
export const FISCAL_SALE: SaleDraft = {
  version: 1,
  operationNature: 'Venda de mercadoria',
  purpose: 'NORMAL',
  destination: 'INTERNAL',
  presence: 'IN_PERSON',
  finalConsumer: true,
  intermediary: null,
  buyer: null,
  lines: [
    {
      id: 'line-1',
      code: 'SKU-1',
      gtin: null,
      description: 'Item da casa',
      ncm: '21069090',
      cest: null,
      cfop: '5102',
      unit: 'UN',
      quantity: 1,
      valueCents: 2500,
      discountCents: 0,
      approximateTaxCents: null,
      additionalInfo: null,
      icms: { regime: 'SIMPLES', origin: 0, csosn: '102' },
      pis: { cst: '49', baseCents: 0, rateBp: 0, amountCents: 0 },
      cofins: { cst: '49', baseCents: 0, rateBp: 0, amountCents: 0 },
      ibsCbs: null,
    },
  ],
  freight: 'NONE',
  payments: [{ method: 'CASH', amountCents: 2500, card: null, description: null }],
  changeCents: 0,
  additionalInfo: { forTaxpayer: null, forTaxAuthority: null },
  technicalResponsible: null,
};

/** A reversible encoding: this harness holds no key worth protecting. */
export const harnessCipher: Cipher = {
  encrypt: (plaintext) => `harness:${Buffer.from(plaintext).toString('base64')}`,
  decrypt: (sealed) => Buffer.from(sealed.replace(/^harness:/u, ''), 'base64').toString(),
};

export function memoryStorage(objects: Map<string, string>): DocumentStorage {
  return {
    put: async (key, body) => {
      objects.set(key, body);
    },
    get: async (key) => objects.get(key) ?? null,
  };
}

export const fixedSales: SaleSource = { saleFor: async () => FISCAL_SALE };

const NOT_MODELLED: IssuerFailure = {
  class: 'INTERNAL',
  code: null,
  message: 'not modelled by the harness issuer',
  details: [],
  accessKey: null,
  signedXml: null,
  sefazReply: null,
  outcomeUnknown: false,
};

/** SEFAZ's answer to a document, authorised — the same for an issue and a transmit. */
function authorized(accessKey: string, at: Date) {
  return {
    ok: true as const,
    answer: {
      status: 'AUTHORIZED' as const,
      statusCode: '100',
      statusReason: 'Autorizado o uso da NF-e',
      sefazReply: '<retEnviNFe/>',
      accessKey,
      protocol: FISCAL_PROTOCOL,
      authorizedAt: at.toISOString(),
      signedXml: `<NFe chave="${accessKey}"/>`,
      authorizedXml: `<nfeProc chave="${accessKey}"/>`,
    },
  };
}

/** The in-process issuer: every document is authorised, every call recorded. */
export function fakeIssuer(calls: IssuerCall[], clock: { at: Date }): Issuer {
  const refuse = (method: keyof Issuer) => async (call: object) => {
    const { model, accessKey } = call as { model?: string; accessKey?: string };
    calls.push({ method, model: model ?? null, accessKey: accessKey ?? null });
    return { ok: false as const, error: NOT_MODELLED };
  };
  return {
    issue: async (call) => {
      const accessKey = computeAccessKey({ sale: call.document, model: call.model, seriesKind: 'ONLINE' });
      calls.push({ method: 'issue', model: call.model, accessKey });
      return authorized(accessKey, clock.at);
    },
    transmit: async (call) => {
      const accessKey = /chave="(\d{44})"/u.exec(call.signedXml)?.[1] ?? '';
      calls.push({ method: 'transmit', model: call.model, accessKey });
      return authorized(accessKey, clock.at);
    },
    signContingency: refuse('signContingency'),
    cancel: refuse('cancel'),
    cancelBySubstitution: refuse('cancelBySubstitution'),
    lookup: refuse('lookup'),
    inutilize: refuse('inutilize'),
    health: async () => ({ status: 'ok', libraries: {}, nfeSchemas: 'harness', sefazTlsVerify: true }),
  };
}

/** The A1 is never opened here: it expires thirty days after the clock, so the expiry job has someone to tell. */
export const CERTIFICATE_DAYS_LEFT = 30;

export function readCertificateAt(clock: { at: Date }) {
  return async () => ({ expiresAt: new Date(clock.at.getTime() + CERTIFICATE_DAYS_LEFT * 86_400_000).toISOString() });
}

/** This host's words for the package's four alerts. */
const FISCAL_COPY = createFiscalNotificationBlueprints({
  certificateExpiring: (payload) => ({
    title: 'Certificado digital vencendo',
    body: `Seu certificado A1 vence em ${payload.daysLeft} dia(s).`,
    link: '/fiscal/profile',
  }),
  documentRejected: (payload) => ({
    title: 'Nota fiscal rejeitada',
    body: `A nota ${payload.series}/${payload.number} foi rejeitada: ${payload.reason}`,
    link: `/fiscal/documents/${payload.documentId}`,
  }),
  documentNeedsAttention: (payload) => ({
    title: 'Nota fiscal precisa de atenção',
    body: `A nota ${payload.series}/${payload.number} parou de ser reenviada.`,
    link: `/fiscal/documents/${payload.documentId}`,
  }),
  contingencyDeadline: (payload) => ({
    title: 'Nota em contingência perto do prazo',
    body: `A nota ${payload.series}/${payload.number} ainda não foi transmitida.`,
    link: `/fiscal/documents/${payload.documentId}`,
  }),
});

/** The notifier: never throws, records what it was told, in this host's words. */
export function recordingNotify(notified: FiscalNotified[]): FiscalNotifyPort {
  return {
    emit: async (event) => {
      const blueprint = FISCAL_COPY.find((candidate) => candidate.type === event.type);
      notified.push({
        type: event.type,
        recipient: { ...event.recipient },
        payload: event.payload,
        content: blueprint ? blueprint.generate(event.payload as never) : null,
      });
      return { delivered: true };
    },
  };
}
