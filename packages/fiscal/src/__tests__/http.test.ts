import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DANFE_NFCE_PT_BR } from "../danfe/pt-BR";
import { draftOf } from "../documents/context";
import { createMemoryFiscalStore } from "../documents/memory";
import type { SaleForDocument } from "../sale/types";
import { createFiscalDocuments } from "../documents/service";
import { createSigningIdentities } from "../documents/signing";
import { createApiFiscal, type FiscalRoute } from "../http";
import type { Issuer } from "../issuer/port";
import nfceSimples from "../../sidecar/tests/fixtures/documents/nfce-simples.json";

/** The routes over the real service, the memory store and the fiscal service's recorded answers. */

const RECORDED = join(import.meta.dirname, "../issuer/__tests__/fixtures/sidecar");
const recorded = (name: string) => {
  const { status, body } = JSON.parse(readFileSync(join(RECORDED, `${name}.json`), "utf8")) as { status: number; body: { error?: unknown } };
  return status === 200 ? { ok: true, answer: body } : { ok: false, error: body.error };
};

const SALE = nfceSimples as unknown as SaleForDocument;
const cipher = { encrypt: (plain: string) => `enc:${plain.length}:${plain}`, decrypt: (text: string) => text.split(":").slice(2).join(":") };
const PFX = "B".repeat(120);
const PASSWORD = "pfx-password-not-a-real-one";

function api(cancelAnswer = "nfce-cancel") {
  const stored = new Map<string, string>();
  const storage = { put: async (key: string, body: string) => void stored.set(key, body), get: async (key: string) => stored.get(key) ?? null };
  const issuer = {
    issue: async () => recorded("nfce-issue-authorized"),
    cancel: async () => recorded(cancelAnswer),
  } as unknown as Issuer;
  const documents = createFiscalDocuments({
    store: createMemoryFiscalStore(),
    issuer,
    signing: createSigningIdentities({ cipher }),
    cipher,
    readCertificate: async () => ({ expiresAt: "2027-03-01T00:00:00.000Z" }),
    storage,
    sales: { saleFor: async () => draftOf(SALE) },
    notify: { emit: async () => ({}) },
    now: () => new Date("2026-11-20T15:30:00.000Z"),
    utcOffset: () => "-03:00",
    reasons: { contingency: "SEFAZ indisponivel no momento", inutilization: "Numero nao utilizado na emissao", substitution: "Substituida por documento em contingencia" },
    staleAfterMs: 300_000,
    newId: (() => {
      let n = 0;
      return () => `doc-${(n += 1)}`;
    })(),
  });
  const { routes } = createApiFiscal({ documents, storage, danfeLabels: DANFE_NFCE_PT_BR });
  const route = (method: string, path: string): FiscalRoute => routes.find((r) => r.method === method && r.path === path)!;
  const call = (method: string, path: string, request: { body?: unknown; params?: Record<string, string>; query?: Record<string, string> } = {}) =>
    route(method, path).handle({ actor: { ownerId: "owner-1" }, params: request.params ?? {}, query: request.query ?? {}, body: request.body });
  return { call };
}

const PROFILE = {
  cnpj: "11222333000181",
  stateRegistration: "123456789012",
  municipalRegistration: null,
  cnae: "5611201",
  legalName: "Emitente de Teste Ltda",
  tradeName: null,
  taxRegime: "SIMPLES",
  regime: "SIMPLES",
  regimeEffectiveFrom: "2026-01-01",
  restaurantRegime: true,
  address: SALE.issuer.address,
  environment: "homologacao",
  documentPolicy: "ISSUED_HERE",
  signingIdentity: "STORE_CERTIFICATE",
  cscId: "000001",
  cscToken: "TESTCSC0123456789ABCDEF0123456789",
  consentRecordedAt: null,
};

async function ready(cancelAnswer?: string) {
  const fiscal = api(cancelAnswer);
  await fiscal.call("PUT", "/fiscal/profile", { body: PROFILE });
  await fiscal.call("PUT", "/fiscal/profile/certificate", { body: { pfxBase64: PFX, password: PASSWORD } });
  await fiscal.call("POST", "/fiscal/issuing-points", {
    body: { id: "register-1", model: "NFCE", onlineSeries: 1, contingencySeries: 2, firstOnlineNumber: 1201, firstContingencyNumber: 1 },
  });
  return fiscal;
}

describe("the fiscal routes", () => {
  it("answer the profile without a single secret", async () => {
    const fiscal = await ready();
    const { status, body } = await fiscal.call("GET", "/fiscal/profile");
    expect(status).toBe(200);
    expect(body).toMatchObject({ data: { hasCertificate: true, hasCsc: true, certificateExpiresAt: "2027-03-01T00:00:00.000Z" } });
    const text = JSON.stringify(body);
    for (const secret of [PASSWORD, PFX, PROFILE.cscToken, "Ciphertext"]) expect(text).not.toContain(secret);
  });

  it("refuse an unknown key or a bad field with a code and the field's name, never its value", async () => {
    const fiscal = api();
    const unknown = await fiscal.call("PUT", "/fiscal/profile", { body: { ...PROFILE, plan: "pro" } });
    expect(unknown).toEqual({ status: 400, body: { error: "INVALID_INPUT", message: expect.stringContaining("unknown keys: plan") } });
    const certificate = await fiscal.call("PUT", "/fiscal/profile/certificate", { body: { pfxBase64: "short", password: PASSWORD } });
    expect(certificate.status).toBe(400);
    expect(JSON.stringify(certificate.body)).not.toContain(PASSWORD);
  });

  it("issue, read with its events, print the DANFE, and cancel", async () => {
    const fiscal = await ready();
    const issued = await fiscal.call("POST", "/fiscal/documents", { body: { subjectId: "order-1", issuingPointId: "register-1", model: "NFCE" } });
    expect(issued).toMatchObject({ status: 200, body: { data: { status: "AUTHORIZED", number: 1201 } } });
    const documentId = (issued.body as { data: { id: string } }).data.id;

    const read = await fiscal.call("GET", "/fiscal/documents/:documentId", { params: { documentId } });
    expect((read.body as { data: { events: Array<{ kind: string }> } }).data.events.map((e) => e.kind)).toEqual(["SUBMIT", "AUTHORIZE"]);

    const danfe = await fiscal.call("GET", "/fiscal/documents/:documentId/danfe", { params: { documentId }, query: { paper: "58" } });
    expect(danfe.status).toBe(200);
    expect((danfe.body as { data: Array<{ text: string }> }).data.every((line) => line.text.length <= 32)).toBe(true);
    expect((await fiscal.call("GET", "/fiscal/documents/:documentId/danfe", { params: { documentId }, query: { paper: "57" } })).status).toBe(400);

    const cancelled = await fiscal.call("POST", "/fiscal/documents/:documentId/cancel", { params: { documentId }, body: { reason: "Pedido cancelado pelo cliente" } });
    expect(cancelled).toMatchObject({ status: 200, body: { data: { status: "CANCELLED" } } });
    const again = await fiscal.call("POST", "/fiscal/documents/:documentId/cancel", { params: { documentId }, body: { reason: "Pedido cancelado pelo cliente" } });
    expect(again).toMatchObject({ status: 409, body: { error: "TRANSITION_REFUSED" } });
  });

  it("answer a late cancel as the issuer's failure, 422, with the document unchanged", async () => {
    const fiscal = await ready("nfce-cancel-late");
    const issued = await fiscal.call("POST", "/fiscal/documents", { body: { subjectId: "order-1", issuingPointId: "register-1", model: "NFCE" } });
    const documentId = (issued.body as { data: { id: string } }).data.id;
    const late = await fiscal.call("POST", "/fiscal/documents/:documentId/cancel", { params: { documentId }, body: { reason: "Pedido cancelado pelo cliente" } });
    expect(late).toMatchObject({ status: 422, body: { error: "ISSUER_FAILURE", failure: { class: "REJECTED", code: "501" }, data: { status: "AUTHORIZED" } } });
  });

  it("answer 404 for a document of another owner, and refuse an NF-e issued offline", async () => {
    const fiscal = await ready();
    expect((await fiscal.call("GET", "/fiscal/documents/:documentId", { params: { documentId: "nope" } })).status).toBe(404);
    const offline = await fiscal.call("POST", "/fiscal/documents", { body: { subjectId: "order-1", issuingPointId: "register-1", model: "NFE", offline: true } });
    expect(offline.status).toBe(400);
  });
});
