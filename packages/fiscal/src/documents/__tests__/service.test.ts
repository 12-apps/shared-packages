import { describe, expect, it } from "vitest";

import type { Issuer, IssuerOutcome } from "../../issuer/port";
import type { SaleDraft } from "../ports";
import type { EmitterProfileInput } from "../profile-input";
import { draftOf } from "../context";
import { createMemoryFiscalStore } from "../memory";
import { LATE_CANCEL_CODES, createFiscalDocuments } from "../service";
import { createSigningIdentities } from "../signing";
import { RECORDED_ANSWERS } from "../../issuer/__tests__/fixtures/recorded";
import { SALE } from "./fixtures";

/**
 * The service end to end over the memory store and an issuer that answers
 * with the fiscal service's OWN recorded answers (`../../issuer/__tests__/fixtures/sidecar`).
 */

function recorded<T>(name: string): IssuerOutcome<T> {
  const { status, body } = RECORDED_ANSWERS[name]!;
  return status === 200 ? { ok: true, answer: body as T } : { ok: false, error: (body as { error: never }).error };
}

type Method = Exclude<keyof Issuer, "health">;

function scriptedIssuer(script: Partial<Record<Method, string[]>>) {
  const received: Array<{ method: Method; call: unknown }> = [];
  const answer = (method: Method) => async (call: unknown) => {
    received.push({ method, call });
    const next = script[method]?.shift();
    if (next === undefined) throw new Error(`no scripted answer for ${method}`);
    // A send SEFAZ never answers (FUT-3047's online deadline): the promise stays pending.
    if (next === "never") return new Promise(() => undefined);
    return recorded(next);
  };
  const issuer = {
    issue: answer("issue"),
    signContingency: answer("signContingency"),
    transmit: answer("transmit"),
    cancel: answer("cancel"),
    linkPayment: answer("linkPayment"),
    lookup: answer("lookup"),
    inutilize: answer("inutilize"),
    health: async () => ({ status: "ok" as const, libraries: {}, nfeSchemas: "", sefazTlsVerify: true }),
  } as unknown as Issuer;
  return { issuer, calls: received };
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

async function setup(script: Partial<Record<Method, string[]>>, profile: Partial<EmitterProfileInput> = {}, draft: SaleDraft = DRAFT) {
  const memoryStore = createMemoryFiscalStore();
  const scripted = scriptedIssuer(script);
  const objects = new Map<string, string>();
  const emitted: unknown[] = [];
  /** What the sale source answers for a return (model NFE), once a case sets it. */
  const sources: { returnDraft: SaleDraft | null } = { returnDraft: null };
  /** The service's clock, moved forward by `later`. */
  const clock = { at: Date.parse("2026-11-20T15:30:00.000Z") };
  const ids = (function* () {
    for (let n = 1; ; n += 1) yield `doc-${n}`;
  })();
  const documents = createFiscalDocuments({
    store: memoryStore,
    issuer: scripted.issuer,
    signing: createSigningIdentities({ cipher }),
    cipher,
    readCertificate: async ({ password }) => {
      if (password !== PASSWORD) throw new Error(`bad password ${password}`);
      return { expiresAt: "2027-03-01T00:00:00.000Z" };
    },
    storage: {
      put: async (key, body) => void objects.set(key, body),
      get: async (key) => objects.get(key) ?? null,
    },
    sales: { saleFor: async ({ model }): Promise<SaleDraft> => (model === "NFE" && sources.returnDraft ? sources.returnDraft : draft) },
    notify: { emit: async (event) => void emitted.push(event) },
    now: () => new Date(clock.at),
    utcOffset: () => "-03:00",
    reasons: {
      contingency: "SEFAZ indisponivel no momento da venda",
      inutilization: "Numero nao utilizado por falha na emissao",
      substitution: "Substituida por documento emitido em contingencia",
    },
    staleAfterMs: 5 * 60_000,
    nfceOnlineToleranceMs: 15 * 60_000,
    newId: () => ids.next().value as string,
  });
  await documents.saveProfile("owner-1", { ...PROFILE, ...profile });
  await documents.uploadCertificate("owner-1", { pfxBase64: PFX, password: PASSWORD });
  await documents.createIssuingPoint("owner-1", {
    id: "register-1",
    model: "NFCE",
    onlineSeries: 1,
    contingencySeries: 2,
    firstOnlineNumber: 1201,
    firstContingencyNumber: 1,
  });
  const later = (ms: number) => void (clock.at += ms);
  return { service: documents, store: memoryStore, calls: scripted.calls, issuer: scripted.issuer, stored: objects, notified: emitted, later,
    returnDraft: () => sources.returnDraft,
    setReturnDraft: (next: SaleDraft | null) => {
      sources.returnDraft = next;
    },
  };
}

const ISSUE = { ownerId: "owner-1", subjectId: "order-77", issuingPointId: "register-1", model: "NFCE" } as const;

/** The NFC-e a return quotes: the fiscal service's own fixture, as its mapper keys it. */
const NFCE_KEY = "35261111222333000181650010000012011482139076";
const RETURNS_POINT = { id: "returns", model: "NFE", onlineSeries: 5, contingencySeries: null, firstOnlineNumber: 1, firstContingencyNumber: 1 } as const;

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
    expect(store.counters.get("11222333000181|homologacao|NFCE|1")).toBe(1202);
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
    // One failure doubles the wait: 10 minutes, still inside the 15-minute online tolerance.
    later(6 * 60_000);
    expect((await service.sweep(10)).advanced).toEqual([]);
    later(5 * 60_000);
    await service.sweep(10);
    expect(await service.getDocument("owner-1", first.id)).toMatchObject({ status: "AUTHORIZED", number: 1201 });
    expect(calls.map((c) => (c.call as { document: { keyCode: string } }).document.keyCode)).toEqual([first.keyCode, first.keyCode]);
  });

  it("goes offline on CONTINGENCY: the sale moves to the contingency series, which the transmission authorises", async () => {
    const { service, store, later } = await setup({
      issue: ["nfce-issue-contingency"],
      signContingency: ["nfce-sign-contingency"],
      transmit: ["nfce-transmit-authorized"],
      inutilize: ["inutilize"],
    });
    const offline = await service.issue(ISSUE);
    expect(offline).toMatchObject({ status: "CONTINGENCY", seriesKind: "CONTINGENCY", series: 2, number: 1 });
    const [online] = await store.listBySubject("owner-1", "order-77", "NFCE");
    // It was SUBMITTED: SEFAZ may hold it, so its number is looked up before it is voided (review R2-1).
    expect(online).toMatchObject({ status: "REPLACED", replacedById: offline.id, numberVoid: "LOOKUP_FIRST" });

    expect((await service.transmitContingency(10)).advanced).toEqual([]);
    later(6 * 60_000);
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

  describe("linkPayment (event 110300, FUT-2239)", () => {
    const PIX = { transactionId: "7f3c2a91e04b4c1d9a0b11c2d3e4f5a6", meansCode: "17", pspCnpjBase: "08561701", receiverCnpj: "11222333000181" } as const;
    const BOLETO = { ...PIX, transactionId: "34191790010104351004791020150008", meansCode: "15" } as const;

    it("links each transaction once: SEFAZ is asked for the new one only, and the event and its XML are kept", async () => {
      const { service, calls, stored } = await setup({ issue: ["nfce-issue-authorized"], linkPayment: ["nfce-link-payment", "nfce-link-payment"] });
      const document = await service.issue(ISSUE);
      const first = await service.linkPayment({ ownerId: "owner-1", documentId: document.id, payments: [PIX] });
      expect(first).toMatchObject({ linked: [PIX.transactionId], alreadyLinked: [], failure: null, document: { status: "AUTHORIZED" } });
      const second = await service.linkPayment({ ownerId: "owner-1", documentId: document.id, payments: [PIX, BOLETO] });
      expect(second).toMatchObject({ linked: [BOLETO.transactionId], alreadyLinked: [PIX.transactionId] });

      const sent = calls.filter((call) => call.method === "linkPayment").map((call) => call.call as { sequence: number; payment: unknown; protocol: string });
      expect(sent.map(({ sequence, payment }) => [sequence, payment])).toEqual([[1, PIX], [2, BOLETO]]);
      expect(sent[0]?.protocol).toBe(document.protocol);
      const events = await service.listEvents("owner-1", document.id);
      expect(events.filter((event) => event.kind === "LINK_PAYMENT")).toHaveLength(2);
      expect(stored.get(`fiscal/${document.accessKey}/link-payment-1.xml`)).toContain("<procEventoNFe");
      expect(await service.linkPayment({ ownerId: "owner-1", documentId: document.id, payments: [BOLETO, PIX] })).toMatchObject({ linked: [] });
      expect(calls.filter((call) => call.method === "linkPayment")).toHaveLength(2);
    });

    it("never sends a transaction the document's own gPgtoVinc carries", async () => {
      const linkedDraft = { ...DRAFT, payments: DRAFT.payments.map((payment, index) => (index === 0 ? { ...payment, linkedTransaction: PIX } : payment)) };
      const { service, calls } = await setup({ issue: ["nfce-issue-authorized"] }, {}, linkedDraft);
      const document = await service.issue(ISSUE);
      expect(await service.linkPayment({ ownerId: "owner-1", documentId: document.id, payments: [PIX] })).toMatchObject({ linked: [], alreadyLinked: [PIX.transactionId] });
      expect(calls.some((call) => call.method === "linkPayment")).toBe(false);
    });

    it("answers SEFAZ's refusal and records nothing, so the next call tries again", async () => {
      const { service } = await setup({ issue: ["nfce-issue-authorized"], linkPayment: ["nfce-cancel-late", "nfce-link-payment"] });
      const document = await service.issue(ISSUE);
      const refused = await service.linkPayment({ ownerId: "owner-1", documentId: document.id, payments: [PIX] });
      expect(refused).toMatchObject({ linked: [], failure: { class: "REJECTED" } });
      expect(await service.linkPayment({ ownerId: "owner-1", documentId: document.id, payments: [PIX] })).toMatchObject({ linked: [PIX.transactionId] });
    });

    it("refuses a document that is not authorised, and an issuer with no event 110300", async () => {
      const { service } = await setup({ issue: ["nfce-issue-rejected"] });
      await service.issue(ISSUE).catch(() => null);
      const [document] = await service.listBySubject("owner-1", ISSUE.subjectId, "NFCE");
      expect(document?.status).not.toBe("AUTHORIZED");
      await expect(service.linkPayment({ ownerId: "owner-1", documentId: document!.id, payments: [PIX] })).rejects.toMatchObject({ code: "TRANSITION_REFUSED" });

      const fresh = await setup({ issue: ["nfce-issue-authorized"] });
      const authorised = await fresh.service.issue(ISSUE);
      delete (fresh.issuer as { linkPayment?: unknown }).linkPayment;
      await expect(fresh.service.linkPayment({ ownerId: "owner-1", documentId: authorised.id, payments: [PIX] })).rejects.toMatchObject({ code: "NOT_SUPPORTED" });
    });
  });

  describe("cancelOrReturn", () => {
    const REASON = "Cliente devolveu o pedido inteiro";

    async function authorised(script: Partial<Record<Method, string[]>>) {
      const env = await setup({ issue: ["nfce-issue-authorized", ...(script.issue ?? [])], cancel: script.cancel ?? [] });
      await env.service.createIssuingPoint("owner-1", RETURNS_POINT);
      const document = await env.service.issue(ISSUE);
      env.setReturnDraft({ ...DRAFT, purpose: "RETURN", operation: "IN", referencedDocuments: [{ accessKey: document.accessKey! }] });
      return { ...env, document };
    }

    it("cancels inside the window, and a second call asks the issuer nothing", async () => {
      const { service, document, calls } = await authorised({ cancel: ["nfce-cancel"] });
      const input = { ownerId: "owner-1", documentId: document.id, reason: REASON, returnPointId: "returns" };
      expect(await service.cancelOrReturn(input)).toMatchObject({ outcome: "CANCELLED", document: { status: "CANCELLED" }, returnDocument: null });
      const before = calls.length;
      expect(await service.cancelOrReturn(input)).toMatchObject({ outcome: "CANCELLED", document: { status: "CANCELLED" } });
      expect(calls).toHaveLength(before);
    });

    it("past the window (501) issues the return NF-e of entry quoting the document, which stays AUTHORIZED", async () => {
      const { service, document, calls, store } = await authorised({ issue: ["nfce-issue-authorized"], cancel: ["nfce-cancel-late"] });
      const input = { ownerId: "owner-1", documentId: document.id, reason: REASON, returnPointId: "returns" };
      const answer = await service.cancelOrReturn(input);
      expect(answer).toMatchObject({ outcome: "RETURNED", document: { id: document.id, status: "AUTHORIZED" }, failure: { code: "501" } });
      expect(answer.returnDocument).toMatchObject({ model: "NFE", issuingPointId: "returns", subjectId: document.subjectId });
      expect(calls.at(-1)?.call).toMatchObject({ model: "NFE", document: { purpose: "RETURN", operation: "IN", referencedDocuments: [{ accessKey: document.accessKey }] } });
      expect((await store.getDocument("owner-1", document.id))?.status).toBe("AUTHORIZED");

      const before = calls.length;
      expect(await service.cancelOrReturn(input)).toMatchObject({ outcome: "RETURNED", returnDocument: { id: answer.returnDocument?.id } });
      expect(calls).toHaveLength(before);
    });

    it("refuses, before drawing a number, a return the sale source does not quote", async () => {
      const { service, document, store, setReturnDraft } = await authorised({ cancel: ["nfce-cancel-late"] });
      setReturnDraft({ ...DRAFT, purpose: "RETURN", operation: "IN", referencedDocuments: [] });
      await expect(
        service.cancelOrReturn({ ownerId: "owner-1", documentId: document.id, reason: REASON, returnPointId: "returns" }),
      ).rejects.toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
      expect(store.counters.get("11222333000181|homologacao|NFE|5")).toBe(1);
    });

    it("an NF-e sale past the window: refused by name, and nothing is issued", async () => {
      const env = await setup({ issue: ["nfce-issue-authorized"], cancel: ["nfce-cancel-late"] });
      await env.service.createIssuingPoint("owner-1", RETURNS_POINT);
      const sale = await env.service.issue({ ...ISSUE, issuingPointId: "returns", model: "NFE" });
      await expect(
        env.service.cancelOrReturn({ ownerId: "owner-1", documentId: sale.id, reason: REASON, returnPointId: "returns" }),
      ).rejects.toThrow(expect.objectContaining({ code: "RETURN_OF_NFCE_ONLY" }));
      expect(env.calls.map((call) => call.method)).toEqual(["issue", "cancel"]);
      expect((await env.store.getDocument("owner-1", sale.id))?.status).toBe("AUTHORIZED");
    });

    it("a subject already holding another live NF-e: refused, never answered as its return", async () => {
      const { service, document, calls, store, returnDraft: currentReturnDraft, setReturnDraft } = await authorised({ issue: ["nfce-issue-authorized"], cancel: ["nfce-cancel-late"] });
      const returnDraft = currentReturnDraft();
      // A sale NF-e on the same subject (no return), issued before the late cancel.
      setReturnDraft(null);
      const other = await service.issue({ ...ISSUE, issuingPointId: "returns", model: "NFE" });
      expect(other).toMatchObject({ model: "NFE", sale: { purpose: "NORMAL" } });
      setReturnDraft(returnDraft);
      const before = calls.length;
      await expect(
        service.cancelOrReturn({ ownerId: "owner-1", documentId: document.id, reason: REASON, returnPointId: "returns" }),
      ).rejects.toThrow(expect.objectContaining({ code: "SUBJECT_HAS_DOCUMENT" }));
      expect(calls.slice(before).map((call) => call.method)).toEqual(["cancel"]);
      expect((await store.getDocument("owner-1", document.id))?.status).toBe("AUTHORIZED");
    });

    it("past the window with no return point: refused by name, and the document stays AUTHORIZED", async () => {
      expect(LATE_CANCEL_CODES).toEqual(["501"]);
      const { service, document, store } = await authorised({ cancel: ["nfce-cancel-late"] });
      await expect(
        service.cancelOrReturn({ ownerId: "owner-1", documentId: document.id, reason: REASON, returnPointId: "nowhere" }),
      ).rejects.toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
      expect((await store.getDocument("owner-1", document.id))?.status).toBe("AUTHORIZED");
    });
  });

  it("refuses to issue where the package does not issue, and PLATFORM signing is NOT_SUPPORTED", async () => {
    const elsewhere = await setup({}, { documentPolicy: "ISSUED_ELSEWHERE" });
    await expect(elsewhere.service.issue(ISSUE)).rejects.toThrow(expect.objectContaining({ code: "NOT_ISSUABLE" }));

    const platform = await setup({}, { signingIdentity: "PLATFORM" });
    await expect(platform.service.issue(ISSUE)).rejects.toThrow(expect.objectContaining({ code: "NOT_SUPPORTED" }));
    expect(platform.store.counters.get("11222333000181|homologacao|NFCE|1")).toBe(1201);
  });

  it("issues a return as an NF-e of entry quoting the NFC-e, and a sale without the new fields sends none", async () => {
    const sale = await setup({ issue: ["nfce-issue-authorized"] });
    await sale.service.issue(ISSUE);
    const sent = (sale.calls[0]!.call as { document: object }).document;
    expect(sent).toMatchObject({ purpose: "NORMAL" });
    expect(sent).not.toHaveProperty("operation");
    expect(sent).not.toHaveProperty("referencedDocuments");

    const quoted = [{ accessKey: NFCE_KEY }];
    const back = await setup({ issue: ["nfce-issue-authorized"] }, {}, { ...DRAFT, purpose: "RETURN", operation: "IN", referencedDocuments: quoted });
    await back.service.createIssuingPoint("owner-1", RETURNS_POINT);
    await back.service.issue({ ...ISSUE, subjectId: "return-77", issuingPointId: "returns", model: "NFE" });
    expect(back.calls[0]!.call).toMatchObject({
      model: "NFE",
      document: { series: 5, purpose: "RETURN", operation: "IN", referencedDocuments: quoted },
    });
  });

  it("refuses, before drawing a number, a return on an NFC-e and a return that quotes nothing", async () => {
    const onNfce = await setup({}, {}, { ...DRAFT, purpose: "RETURN", referencedDocuments: [{ accessKey: NFCE_KEY }] });
    await expect(onNfce.service.issue(ISSUE)).rejects.toThrow(expect.objectContaining({ code: "RETURN_ON_NFCE" }));
    await expect(onNfce.service.issueOffline({ ownerId: "owner-1", subjectId: "order-77", issuingPointId: "register-1" })).rejects.toThrow(
      expect.objectContaining({ code: "RETURN_ON_NFCE" }),
    );
    expect(onNfce.store.counters.get("11222333000181|homologacao|NFCE|1")).toBe(1201);
    expect(onNfce.calls).toEqual([]);

    const unquoted = await setup({}, {}, { ...DRAFT, purpose: "RETURN", operation: "IN" });
    await unquoted.service.createIssuingPoint("owner-1", RETURNS_POINT);
    await expect(unquoted.service.issue({ ...ISSUE, issuingPointId: "returns", model: "NFE" })).rejects.toThrow(
      expect.objectContaining({ code: "RETURN_NEEDS_REFERENCE" }),
    );
    expect(unquoted.store.counters.get("11222333000181|homologacao|NFE|5")).toBe(1);
    expect(unquoted.calls).toEqual([]);
  });

  it("refuses a series already held by another issuing point", async () => {
    const { service } = await setup({});
    await expect(
      service.createIssuingPoint("owner-1", { id: "register-2", model: "NFCE", onlineSeries: 2, contingencySeries: null, firstOnlineNumber: 1, firstContingencyNumber: 1 }),
    ).rejects.toThrow(/already belongs/);
  });
});

describe("the online deadline (FUT-3047): a caller whose paper cannot wait", () => {
  const BOUNDED = { ...ISSUE, onlineDeadlineMs: 20 } as const;

  it("a send SEFAZ does not answer by the deadline goes offline on the point's contingency series, the online number looked up first", async () => {
    const { service, store } = await setup({ issue: ["never"], signContingency: ["nfce-sign-contingency"] });

    const offline = await service.issue(BOUNDED);

    expect(offline).toMatchObject({ status: "CONTINGENCY", seriesKind: "CONTINGENCY", series: 2, number: 1 });
    const [online] = await store.listBySubject("owner-1", "order-77", "NFCE");
    expect(online).toMatchObject({ status: "REPLACED", replacedById: offline.id, numberVoid: "LOOKUP_FIRST", outcomeUnknown: true });
    expect(online?.accessKey).toMatch(/^\d{44}$/u);
  });

  it("an unanswered send goes offline at once under a deadline, where without one it stays SUBMITTED for the sweep", async () => {
    const bounded = await setup({ issue: ["nfce-issue-retryable"], signContingency: ["nfce-sign-contingency"] });
    expect(await bounded.service.issue(BOUNDED)).toMatchObject({ status: "CONTINGENCY", seriesKind: "CONTINGENCY" });

    const plain = await setup({ issue: ["nfce-issue-retryable"] });
    expect(await plain.service.issue(ISSUE)).toMatchObject({ status: "SUBMITTED", seriesKind: "ONLINE", lastErrorClass: "RETRYABLE" });
  });

  it("an answer inside the deadline is kept: authorised online, nothing signed offline", async () => {
    const { service, calls } = await setup({ issue: ["nfce-issue-authorized"] });

    expect(await service.issue({ ...ISSUE, onlineDeadlineMs: 10_000 })).toMatchObject({ status: "AUTHORIZED", seriesKind: "ONLINE", number: 1201 });
    expect(calls.map((call) => call.method)).toEqual(["issue"]);
  });

  it("a live online note still unanswered goes offline on a later call once the deadline since it was numbered passed — never before", async () => {
    const { service, later } = await setup({ issue: ["nfce-issue-retryable"], signContingency: ["nfce-sign-contingency"] });
    const first = await service.issue(ISSUE);
    expect(first).toMatchObject({ status: "SUBMITTED" });

    expect(await service.issue({ ...ISSUE, onlineDeadlineMs: 10_000 })).toMatchObject({ id: first.id, status: "SUBMITTED" });
    later(10_000);
    expect(await service.issue({ ...ISSUE, onlineDeadlineMs: 10_000 })).toMatchObject({ status: "CONTINGENCY", seriesKind: "CONTINGENCY" });
  });

  it("a point with no contingency series ignores the deadline, and a deadline that is not a whole number of ms is refused", async () => {
    const { service } = await setup({ issue: ["nfce-issue-retryable"] });
    await service.createIssuingPoint("owner-1", { id: "register-2", model: "NFCE", onlineSeries: 3, contingencySeries: null, firstOnlineNumber: 1, firstContingencyNumber: 1 });

    expect(await service.issue({ ...ISSUE, subjectId: "order-78", issuingPointId: "register-2", onlineDeadlineMs: 20 })).toMatchObject({ status: "SUBMITTED", seriesKind: "ONLINE" });
    await expect(service.issue({ ...ISSUE, subjectId: "order-79", onlineDeadlineMs: -1 })).rejects.toThrow(/onlineDeadlineMs/);
  });
});
