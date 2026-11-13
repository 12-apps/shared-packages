/**
 * `createApiFiscal` — the fiscal HTTP surface as framework-neutral route
 * descriptors (the wiring contract's `http` capability, restated here
 * structurally: this package imports nothing from the contract at runtime,
 * and its manifest suite pins the twins).
 *
 * The package owns the paths, the bodies it reads (`./documents/profile-input`,
 * unknown keys refused), the `{ data }` envelope, the permission each route
 * needs and the status a refusal earns ({@link FISCAL_ERROR_STATUS}). The host
 * owns resolving WHO is calling into the opaque `ownerId` of its tenant, the
 * guards that check the declared permission, and every word a person reads:
 * an error answers a `code` for the host to word, never a sentence for a user.
 *
 * Nothing secret leaves: the profile answers `hasCertificate` / `hasCsc`, never
 * a ciphertext, and the certificate upload answers the profile view.
 */

import { type DanfeNfceLabels } from "./danfe/labels";
import { type PaperWidth, renderDanfeNfce } from "./danfe/render";
import { FiscalDocumentError, type FiscalDocumentErrorCode } from "./documents/errors";
import type { DocumentStorage } from "./documents/ports";
import { parseCertificateUpload, parseIssuingPointInput, parseProfileInput } from "./documents/profile-input";
import { viewOf } from "./documents/profile";
import type { FiscalDocuments } from "./documents/service";
import { FISCAL_DOCUMENT_MODELS, type FiscalDocumentModel } from "./documents/types";
import { FISCAL_CANCEL, FISCAL_ISSUE, FISCAL_MANAGE, FISCAL_READ } from "./manifest/permissions";

/** The caller, as the host's adapter resolved it. */
export interface FiscalHttpActor {
  /** The emitter profile's owner: the host's tenant, mapped to an opaque id. */
  readonly ownerId: string;
}

/** Structural twin of the wiring contract's `WireRequest<FiscalHttpActor>`. */
export interface FiscalHttpRequest {
  actor: FiscalHttpActor;
  params: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
  body?: unknown;
}

/** Structural twin of the wiring contract's `WireResponse`. */
export interface FiscalHttpResponse {
  status: number;
  body: unknown;
}

/** Structural twin of the wiring contract's `WireRoute<FiscalHttpActor>`. */
export interface FiscalRoute {
  method: "GET" | "POST" | "PUT";
  path: string;
  permission: string;
  handle(request: FiscalHttpRequest): Promise<FiscalHttpResponse>;
}

export interface FiscalApiConfig {
  readonly documents: FiscalDocuments;
  /** Where the XMLs are, to render a DANFE from. */
  readonly storage: DocumentStorage;
  /** The DANFE's words: the host's, or `@12-apps/fiscal/danfe/pt-BR`. */
  readonly danfeLabels: DanfeNfceLabels;
}

export const FISCAL_ERROR_STATUS = {
  INVALID_INPUT: 400,
  NOT_FOUND: 404,
  NOT_ISSUABLE: 409,
  NOT_SUPPORTED: 501,
  TRANSITION_REFUSED: 409,
  SERIES_EXHAUSTED: 409,
  CONFLICT: 409,
} as const satisfies Record<FiscalDocumentErrorCode, number>;

const ok = (data: unknown, status = 200): FiscalHttpResponse => ({ status, body: { data } });

async function answering(run: () => Promise<FiscalHttpResponse>): Promise<FiscalHttpResponse> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof FiscalDocumentError) {
      return { status: FISCAL_ERROR_STATUS[error.code], body: { error: error.code, message: error.message } };
    }
    throw error;
  }
}

function record(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new FiscalDocumentError("INVALID_INPUT", "the body must be an object.");
  }
  return body as Record<string, unknown>;
}

function stringField(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || value === "") throw new FiscalDocumentError("INVALID_INPUT", `${key} is required.`);
  return value;
}

function param(request: FiscalHttpRequest, key: string): string {
  const value = request.params[key];
  if (value === undefined || value === "") throw new FiscalDocumentError("INVALID_INPUT", `${key} is required.`);
  return value;
}

const ISSUE_KEYS = new Set(["subjectId", "issuingPointId", "model", "offline"]);

function issueBody(body: unknown): { subjectId: string; issuingPointId: string; model: FiscalDocumentModel; offline: boolean } {
  const fields = record(body);
  const unknown = Object.keys(fields).filter((key) => !ISSUE_KEYS.has(key));
  if (unknown.length > 0) throw new FiscalDocumentError("INVALID_INPUT", `unknown keys: ${unknown.join(", ")}.`);
  const model = fields["model"];
  if (!FISCAL_DOCUMENT_MODELS.includes(model as FiscalDocumentModel)) throw new FiscalDocumentError("INVALID_INPUT", "model must be NFE or NFCE.");
  const offline = fields["offline"] ?? false;
  if (typeof offline !== "boolean") throw new FiscalDocumentError("INVALID_INPUT", "offline must be a boolean.");
  if (offline && model !== "NFCE") throw new FiscalDocumentError("INVALID_INPUT", "only an NFC-e is issued offline.");
  return { subjectId: stringField(fields, "subjectId"), issuingPointId: stringField(fields, "issuingPointId"), model: model as FiscalDocumentModel, offline };
}

function profileRoutes({ documents }: FiscalApiConfig): FiscalRoute[] {
  return [
    {
      method: "GET",
      path: "/fiscal/profile",
      permission: FISCAL_READ,
      handle: ({ actor }) =>
        answering(async () => {
          const profile = await documents.getProfile(actor.ownerId);
          return ok(profile === null ? null : viewOf(profile));
        }),
    },
    {
      method: "PUT",
      path: "/fiscal/profile",
      permission: FISCAL_MANAGE,
      handle: ({ actor, body }) => answering(async () => ok(viewOf(await documents.saveProfile(actor.ownerId, parseProfileInput(body))))),
    },
    {
      method: "PUT",
      path: "/fiscal/profile/certificate",
      permission: FISCAL_MANAGE,
      handle: ({ actor, body }) =>
        answering(async () => ok(viewOf(await documents.uploadCertificate(actor.ownerId, parseCertificateUpload(body))))),
    },
    {
      method: "GET",
      path: "/fiscal/issuing-points",
      permission: FISCAL_READ,
      handle: ({ actor }) => answering(async () => ok(await documents.listIssuingPoints(actor.ownerId))),
    },
    {
      method: "POST",
      path: "/fiscal/issuing-points",
      permission: FISCAL_MANAGE,
      handle: ({ actor, body }) =>
        answering(async () => ok(await documents.createIssuingPoint(actor.ownerId, parseIssuingPointInput(body)), 201)),
    },
  ];
}

function documentRoutes({ documents, storage, danfeLabels }: FiscalApiConfig): FiscalRoute[] {
  return [
    {
      method: "POST",
      path: "/fiscal/documents",
      permission: FISCAL_ISSUE,
      handle: ({ actor, body }) =>
        answering(async () => {
          const { offline, ...input } = issueBody(body);
          const document = offline
            ? await documents.issueOffline({ ownerId: actor.ownerId, subjectId: input.subjectId, issuingPointId: input.issuingPointId })
            : await documents.issue({ ownerId: actor.ownerId, ...input });
          return ok(document);
        }),
    },
    {
      method: "GET",
      path: "/fiscal/documents/:documentId",
      permission: FISCAL_READ,
      handle: (request) =>
        answering(async () => {
          const documentId = param(request, "documentId");
          const document = await documents.getDocument(request.actor.ownerId, documentId);
          return ok({ document, events: await documents.listEvents(request.actor.ownerId, documentId) });
        }),
    },
    {
      method: "POST",
      path: "/fiscal/documents/:documentId/cancel",
      permission: FISCAL_CANCEL,
      handle: (request) =>
        answering(async () => {
          const reason = stringField(record(request.body), "reason");
          const result = await documents.cancel({ ownerId: request.actor.ownerId, documentId: param(request, "documentId"), reason });
          return result.failure === null
            ? ok(result.document)
            : { status: 422, body: { error: "ISSUER_FAILURE", failure: result.failure, data: result.document } };
        }),
    },
    {
      method: "POST",
      path: "/fiscal/documents/:documentId/lookup",
      permission: FISCAL_READ,
      handle: (request) =>
        answering(async () => ok(await documents.lookup({ ownerId: request.actor.ownerId, documentId: param(request, "documentId") }))),
    },
    {
      method: "GET",
      path: "/fiscal/documents/:documentId/danfe",
      permission: FISCAL_READ,
      handle: (request) =>
        answering(async () => {
          const paper = Number(request.query["paper"] ?? "80");
          if (paper !== 58 && paper !== 80) throw new FiscalDocumentError("INVALID_INPUT", "paper must be 58 or 80.");
          const document = await documents.getDocument(request.actor.ownerId, param(request, "documentId"));
          const xml = document.model === "NFCE" && document.xmlKey !== null ? await storage.get(document.xmlKey) : null;
          if (xml === null) throw new FiscalDocumentError("NOT_FOUND", `document ${document.id} has no NFC-e XML to print.`);
          return ok(renderDanfeNfce({ xml, paperWidth: paper as PaperWidth, labels: danfeLabels }));
        }),
    },
  ];
}

export function createApiFiscal(config: FiscalApiConfig): { routes: readonly FiscalRoute[] } {
  if (config?.documents === undefined) throw new TypeError("createApiFiscal needs documents.");
  if (config.storage === undefined) throw new TypeError("createApiFiscal needs storage.");
  if (config.danfeLabels === undefined) throw new TypeError("createApiFiscal needs danfeLabels.");
  return { routes: [...profileRoutes(config), ...documentRoutes(config)] };
}
