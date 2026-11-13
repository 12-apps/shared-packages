import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { Issuer, IssuerOutcome } from "../../issuer/port";
import type { SaleDraft } from "../ports";
import type { EmitterProfileInput } from "../profile-input";
import { draftOf } from "../context";
import { createMemoryFiscalStore } from "../memory";
import { createFiscalDocuments } from "../service";
import { createSigningIdentities } from "../signing";
import { SALE } from "./fixtures";

/**
 * The service end to end over the memory store and an issuer that answers
 * with the fiscal service's OWN recorded answers (`../../issuer/__tests__/fixtures/sidecar`).
 */

const RECORDED = join(import.meta.dirname, "../../issuer/__tests__/fixtures/sidecar");
function recorded<T>(name: string): IssuerOutcome<T> {
  const { status, body } = JSON.parse(readFileSync(join(RECORDED, `${name}.json`), "utf8")) as { status: number; body: unknown };
  return status === 200 ? { ok: true, answer: body as T } : { ok: false, error: (body as { error: never }).error };
}

type Method = Exclude<keyof Issuer, "health">;

function scriptedIssuer(script: Partial<Record<Method, string[]>>) {
  const calls: Array<{ method: Method; call: unknown }> = [];
  const answer = (method: Method) => async (call: unknown) => {
    calls.push({ method, call });
    const next = script[method]?.shift();
    if (next === undefined) throw new Error(`no scripted answer for ${method}`);
    return recorded(next);
  };
  const issuer = {
    issue: answer("issue"),
    signContingency: answer("signContingency"),
    transmit: answer("transmit"),
    cancel: answer("cancel"),
    lookup: answer("lookup"),
    inutilize: answer("inutilize"),
    health: async () => ({ status: "ok" as const, libraries: {}, nfeSchemas: "", sefazTlsVerify: true }),
  } as unknown as Issuer;
  return { issuer, calls };
}

/** A reversible stand-in for the host's cipher, so a test can see ciphertext is not plaintext. */
const cipher = {
  encrypt: (plain: string) => `enc:${Buffer.from(plain).toString("base64")}`,
  decrypt: (text: string) => Buffer.from(text.slice(4), "base64").toString(),
};

const PFX = "A".repeat(120);
const PASSWORD = "pfx-password-not-a-real-one";
const CSC_TOKEN = "TESTCSC0123456789ABCDEF0123456789";

const PROFILE: EmitterProfileInput = {
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
  cscToken: CSC_TOKEN,
  consentRecordedAt: null,
};

const DRAFT = draftOf(SALE);

async function setup(script: Partial<Record<Method, string[]>>, profile: Partial<EmitterProfileInput> = {}) {
  const store = createMemoryFiscalStore();
  const { issuer, calls } = scriptedIssuer(script);
  const stored = new Map<string, string>();
  const notified: unknown[] = [];
  let clock = Date.parse("2026-11-20T15:30:00.000Z");
  let ids = 0;
  const service = createFiscalDocuments({
    store,
    issuer,
    signing: createSigningIdentities({ cipher }),
    cipher,
    readCertificate: async ({ password }) => {
      if (password !== PASSWORD) throw new Error(`bad password ${password}`);
      return { expiresAt: "2027-03-01T00:00:00.000Z" };
    },
    storage: {
      put: async (key, body) => void stored.set(key, body),
      get: async (key) => stored.get(key) ?? null,
    },
    sales: { saleFor: async (): Promise<SaleDraft> => DRAFT },
    notify: { emit: async (event) => void notified.push(event) },
    now: () => new Date(clock),
    utcOffset: () => "-03:00",
    reasons: {
      contingency: "SEFAZ indisponivel no momento da venda",
      inutilization: "Numero nao utilizado por falha na emissao",
      substitution: "Substituida por documento emitido em contingencia",
    },
    staleAfterMs: 5 * 60_000,
    newId: () => `doc-${(ids += 1)}`,
  });
  await service.saveProfile("owner-1", { ...PROFILE, ...profile });
  await service.uploadCertificate("owner-1", { pfxBase64: PFX, password: PASSWORD });
  await service.createIssuingPoint("owner-1", {
    id: "register-1",
    model: "NFCE",
    onlineSeries: 1,
    contingencySeries: 2,
    firstOnlineNumber: 1201,
    firstContingencyNumber: 1,
  });
  const later = (ms: number) => void (clock += ms);
  return { service, store, calls, stored, notified, later };
}

const ISSUE = { ownerId: "owner-1", subjectId: "order-77", issuingPointId: "register-1", model: "NFCE" } as const;

describe("the document service", () => {
  it("stores only ciphertext, and answers the issuer the decrypted A1 and CSC for the call", async () => {
    const { service, store, calls } = await setup({ issue: ["nfce-issue-authorized"] });
    const profile = await store.getProfile("owner-1");
    expect(JSON.stringify(profile)).not.toContain(PASSWORD);
    expect(JSON.stringify(profile)).not.toContain(CSC_TOKEN);
    expect(profile?.certificateExpiresAt).toBe("2027-03-01T00:00:00.000Z");

    const document = await service.issue(ISSUE);
    expect(document).toMatchObject({ status: "AUTHORIZED", series: 1, number: 1201, attempts: 1 });
    expect(calls[0]!.call).toMatchObject({
      model: "NFCE",
      signing: { certificate: { pfxBase64: PFX, password: PASSWORD }, csc: { id: "000001", token: CSC_TOKEN } },
      document: { series: 1, number: 1201, issuedAt: "2026-11-20T12:30:00-03:00", issuer: { cnpj: PROFILE.cnpj } },
    });
    expect(JSON.stringify(store.events)).not.toContain(PASSWORD);
    expect(store.events.map((event) => event.kind)).toEqual(["SUBMIT", "AUTHORIZE"]);
  });

  it("is idempotent per subject: a second issue answers the live document and draws no number", async () => {
    const { service, store } = await setup({ issue: ["nfce-issue-authorized"] });
    const first = await service.issue(ISSUE);
    expect(await service.issue(ISSUE)).toEqual(first);
    expect(store.counters.get("owner-1|homologacao|NFCE|1")).toBe(1202);
  });

  it("refuses a bad certificate password without quoting it", async () => {
    const { service } = await setup({});
    await expect(service.uploadCertificate("owner-1", { pfxBase64: PFX, password: "wrong-one-xyz" })).rejects.toThrow(
      expect.objectContaining({ code: "INVALID_INPUT", message: expect.not.stringContaining("wrong-one-xyz") }),
    );
  });

  it("a rejection is final, notifies, and the sweep inutilizes the number so the series has no gap", async () => {
    const { service, notified, later, store } = await setup({ issue: ["nfce-issue-rejected"], inutilize: ["inutilize"] });
    const document = await service.issue(ISSUE);
    expect(document).toMatchObject({ status: "REJECTED", statusCode: "539", numberVoid: "INUTILIZE" });
    expect(notified).toEqual([expect.objectContaining({ type: "fiscal.document-rejected", recipient: { tenantId: "owner-1", permission: "fiscal:issue" } })]);

    later(6 * 60_000);
    const report = await service.sweep(10);
    expect(report.failures).toEqual([]);
    expect(await store.getDocument("owner-1", document.id)).toMatchObject({ status: "REJECTED", numberVoid: "INUTILIZED" });
  });

  it("a retryable failure stays SUBMITTED, and the sweep re-issues the same number", async () => {
    const { service, later, calls } = await setup({ issue: ["nfce-issue-retryable", "nfce-issue-authorized"] });
    const first = await service.issue(ISSUE);
    expect(first).toMatchObject({ status: "SUBMITTED", lastErrorClass: "RETRYABLE" });
    expect((await service.sweep(10)).advanced).toEqual([]);
    later(6 * 60_000);
    await service.sweep(10);
    expect(await service.getDocument("owner-1", first.id)).toMatchObject({ status: "AUTHORIZED", number: 1201 });
    expect(calls.map((c) => (c.call as { document: { keyCode: string } }).document.keyCode)).toEqual([first.keyCode, first.keyCode]);
  });

  it("goes offline on CONTINGENCY: the sale moves to the contingency series, which the transmission authorises", async () => {
    const { service, store } = await setup({
      issue: ["nfce-issue-contingency"],
      signContingency: ["nfce-sign-contingency"],
      transmit: ["nfce-transmit-authorized"],
      inutilize: ["inutilize"],
    });
    const offline = await service.issue(ISSUE);
    expect(offline).toMatchObject({ status: "CONTINGENCY", seriesKind: "CONTINGENCY", series: 2, number: 1 });
    const [online] = await store.listBySubject("owner-1", "order-77", "NFCE");
    expect(online).toMatchObject({ status: "REPLACED", replacedById: offline.id, numberVoid: "INUTILIZE" });

    const transmitted = await service.transmitContingency(10);
    expect(transmitted.advanced).toEqual([{ documentId: offline.id, status: "AUTHORIZED" }]);
  });

  it("an unanswered request moves offline too, and the replaced number is looked up before it is voided", async () => {
    const { service, store, later } = await setup({
      issue: ["nfce-issue-unanswered"],
      signContingency: ["nfce-sign-contingency"],
      lookup: ["nfce-lookup-not-found"],
      inutilize: ["inutilize"],
    });
    await service.issue(ISSUE);
    const [online] = await store.listBySubject("owner-1", "order-77", "NFCE");
    expect(online).toMatchObject({ status: "REPLACED", numberVoid: "LOOKUP_FIRST" });
    later(6 * 60_000);
    await service.sweep(10);
    expect((await store.getDocument("owner-1", online!.id))!.numberVoid).toBe("INUTILIZE");
    later(6 * 60_000);
    await service.sweep(10);
    expect((await store.getDocument("owner-1", online!.id))!.numberVoid).toBe("INUTILIZED");
  });

  it("cancels an authorised document, and answers a late cancel's refusal without changing it", async () => {
    const { service } = await setup({ issue: ["nfce-issue-authorized", "nfce-issue-authorized"], cancel: ["nfce-cancel", "nfce-cancel-late"] });
    const document = await service.issue(ISSUE);
    await expect(service.cancel({ ownerId: "owner-1", documentId: document.id, reason: "curto" })).rejects.toThrow(/15 to 255/);
    const done = await service.cancel({ ownerId: "owner-1", documentId: document.id, reason: "Pedido cancelado pelo cliente" });
    expect(done).toMatchObject({ failure: null, document: { status: "CANCELLED", cancelReason: "Pedido cancelado pelo cliente" } });

    const other = await service.issue({ ...ISSUE, subjectId: "order-78" });
    const late = await service.cancel({ ownerId: "owner-1", documentId: other.id, reason: "Pedido cancelado pelo cliente" });
    expect(late).toMatchObject({ failure: { class: "REJECTED", code: "501" }, document: { status: "AUTHORIZED" } });
  });

  it("refuses to issue where the package does not issue, and PLATFORM signing is NOT_SUPPORTED", async () => {
    const elsewhere = await setup({}, { documentPolicy: "ISSUED_ELSEWHERE" });
    await expect(elsewhere.service.issue(ISSUE)).rejects.toThrow(expect.objectContaining({ code: "NOT_ISSUABLE" }));

    const platform = await setup({}, { signingIdentity: "PLATFORM" });
    await expect(platform.service.issue(ISSUE)).rejects.toThrow(expect.objectContaining({ code: "NOT_SUPPORTED" }));
    expect(platform.store.counters.get("owner-1|homologacao|NFCE|1")).toBe(1201);
  });

  it("refuses a series already held by another issuing point", async () => {
    const { service } = await setup({});
    await expect(
      service.createIssuingPoint("owner-1", { id: "register-2", model: "NFCE", onlineSeries: 2, contingencySeries: null, firstOnlineNumber: 1, firstContingencyNumber: 1 }),
    ).rejects.toThrow(/already belongs/);
  });
});
