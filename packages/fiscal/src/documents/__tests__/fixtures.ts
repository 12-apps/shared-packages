import nfceSimples from "../../../sidecar/tests/fixtures/documents/nfce-simples.json";
import type { SaleForDocument } from "../../sale/types";
import type {
  CancelledDocument,
  ContingencySignedDocument,
  InutilizedRange,
  IssuedDocument,
  LookedUpDocument,
  SidecarErrorBody,
} from "../../sidecar/types";
import type { FiscalDocument } from "../types";

/** The fiscal service's own NFC-e fixture, the document every suite here starts from. */
export const SALE = nfceSimples as unknown as SaleForDocument;

export const KEY = "35261112345678000195650010000000011123456780";

export function aDocument(overrides: Partial<FiscalDocument> = {}): FiscalDocument {
  return {
    id: "doc-1",
    ownerId: "owner-1",
    issuerCnpj: "11222333000181",
    subjectId: "subject-1",
    issuingPointId: "point-1",
    model: "NFCE",
    environment: "homologacao",
    seriesKind: "ONLINE",
    series: 1,
    number: 1,
    keyCode: "12345678",
    status: "PENDING",
    sale: SALE,
    totals: { totalCents: 1000, discountCents: 0, cbsCents: 9, ibsUfCents: 1, ibsMunCents: 0 },
    buyerTaxId: null,
    accessKey: null,
    protocol: null,
    statusCode: null,
    statusReason: null,
    lastErrorClass: null,
    outcomeUnknown: false,
    issuedAt: "2026-11-20T12:30:00-03:00",
    authorizedAt: null,
    contingency: null,
    cancelledAt: null,
    cancelReason: null,
    cancelProtocol: null,
    replacedById: null,
    numberVoid: null,
    xmlKey: null,
    eventXmlKey: null,
    attempts: 0,
    failures: 0,
    nextAttemptAt: null,
    attention: false,
    deadlineWarnedAt: null,
    createdAt: "2026-11-20T15:30:00.000Z",
    updatedAt: "2026-11-20T15:30:00.000Z",
    ...overrides,
  };
}

export const AUTHORIZED: IssuedDocument = {
  status: "AUTHORIZED",
  accessKey: KEY,
  protocol: "135260000000001",
  authorizedAt: "2026-11-20T12:30:05-03:00",
  signedXml: "<NFe/>",
  authorizedXml: "<nfeProc/>",
  statusCode: "100",
  statusReason: "Autorizado o uso da NF-e",
  sefazReply: "<soap/>",
};

export const DENIED: IssuedDocument = { ...AUTHORIZED, status: "DENIED", statusCode: "302" };

export const SIGNED: ContingencySignedDocument = { status: "SIGNED", accessKey: KEY, signedXml: "<NFe/>" };

export const CANCELLED: CancelledDocument = {
  status: "CANCELLED",
  accessKey: KEY,
  protocol: "135260000000002",
  registeredAt: "2026-11-20T13:00:00-03:00",
  eventXml: "<procEventoNFe/>",
  statusCode: "135",
  statusReason: "Evento registrado",
  sefazReply: "<soap/>",
};

export const INUTILIZED: InutilizedRange = {
  status: "INUTILIZED",
  protocol: "135260000000003",
  registeredAt: "2026-11-20T13:00:00-03:00",
  inutilizationXml: "<procInutNFe/>",
  statusCode: "102",
  statusReason: "Inutilizacao de numero homologado",
  sefazReply: "<soap/>",
};

export function lookedUp(status: LookedUpDocument["status"]): LookedUpDocument {
  return { status, accessKey: KEY, protocol: null, statusCode: "100", statusReason: "", sefazReply: "<soap/>" };
}

export function sidecarError(
  errorClass: SidecarErrorBody["error"]["class"],
  overrides: Partial<SidecarErrorBody["error"]> = {},
): SidecarErrorBody["error"] {
  return {
    class: errorClass,
    code: errorClass === "REJECTED" ? "539" : null,
    message: "refused",
    details: [],
    accessKey: null,
    signedXml: null,
    sefazReply: null,
    outcomeUnknown: false,
    ...overrides,
  };
}
