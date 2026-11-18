/**
 * Contingency blocks (FUT-4717), against both of the package's stores: a
 * block is drawn from the ONE counter the server's own contingency draws
 * from, a note a holder signed offline becomes the subject's CONTINGENCY
 * document (and is transmitted from its own XML, never rebuilt), and the
 * known rest of a block is voided once — an unknown range never is.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { Issuer } from "../../../issuer/port";
import type { InutilizeCall, TransmitCall } from "../../../issuer/port";
import { computeAccessKey, draftOf } from "../../context";
import { FiscalDocumentError } from "../../errors";
import { createMemoryFiscalStore } from "../../memory";
import type { ContingencyBlockSource, ContingencyBlockStore, FiscalStore } from "../../ports";
import { createFiscalDocuments } from "../../service";
import { createSigningIdentities } from "../../signing";
import { createPrismaFiscalStore } from "../../sql-store";
import { AUTHORIZED, INUTILIZED, SALE, sidecarError } from "../../__tests__/fixtures";
import { migratedDatabase, prismaOver, warmDatabase } from "./pglite";

beforeAll(warmDatabase, 60_000);

const FIXTURE = join(import.meta.dirname, "../../../issuer/__tests__/fixtures/sidecar/nfce-sign-contingency.json");
const SIGNED = (JSON.parse(readFileSync(FIXTURE, "utf8")) as { body: { signedXml: string; accessKey: string } }).body;

/** The fiscal service's own signed contingency NFC-e, moved to another series, number and cNF (the key recomputed). */
function stationNote(number: number, options: { series?: number; keyCode?: string; mutate?: (xml: string) => string } = {}) {
  const series = options.series ?? 2;
  const keyCode = options.keyCode ?? "48213907";
  const key = computeAccessKey({
    sale: { issuer: SALE.issuer, issuedAt: "2026-11-20T12:30:00-03:00", series, number, keyCode },
    model: "NFCE",
    seriesKind: "CONTINGENCY",
  });
  const xml = SIGNED.signedXml.split(SIGNED.accessKey)
    .join(key)
    .replace("<serie>1</serie>", `<serie>${series}</serie>`)
    .replace("<nNF>1201</nNF>", `<nNF>${number}</nNF>`)
    .replace("<cNF>48213907</cNF>", `<cNF>${keyCode}</cNF>`)
    .replace(/<cDV>\d<\/cDV>/, `<cDV>${key.slice(43)}</cDV>`);
  return { key, xml: options.mutate === undefined ? xml : options.mutate(xml) };
}

const cipher = { encrypt: (plain: string) => `enc:${plain}`, decrypt: (text: string) => text.slice(4) };

function fakeIssuer() {
  const transmitted: TransmitCall[] = [];
  const inutilized: InutilizeCall[] = [];
  const signed: unknown[] = [];
  const script = { transmit: "authorize" as "authorize" | "reject", inutilize: "ok" as "ok" | "fail" };
  const issuer = {
    issue: async () => ({ ok: false, error: sidecarError("CONTINGENCY") }),
    signContingency: async (call: unknown) => {
      signed.push(call);
      return { ok: false, error: sidecarError("AUTH") };
    },
    transmit: async (call: TransmitCall) => {
      transmitted.push(call);
      const key = /Id="NFe(\d{44})"/.exec(call.signedXml)?.[1] ?? "";
      if (script.transmit === "reject") return { ok: false, error: sidecarError("REJECTED", { code: "225" }) };
      return { ok: true, answer: { ...AUTHORIZED, accessKey: key, signedXml: call.signedXml, authorizedXml: `<nfeProc>${call.signedXml}</nfeProc>` } };
    },
    inutilize: async (call: InutilizeCall) => {
      inutilized.push(call);
      return script.inutilize === "ok" ? { ok: true, answer: INUTILIZED } : { ok: false, error: sidecarError("RETRYABLE") };
    },
    cancel: async () => ({ ok: false, error: sidecarError("INTERNAL") }),
    cancelBySubstitution: async () => ({ ok: false, error: sidecarError("INTERNAL") }),
    lookup: async () => ({ ok: false, error: sidecarError("INTERNAL") }),
    health: async () => ({ status: "ok" as const, libraries: {}, nfeSchemas: "", sefazTlsVerify: true }),
  } as unknown as Issuer;
  return { issuer, transmitted, inutilized, signed, script };
}

let open: PGlite[] = [];
afterEach(async () => {
  await Promise.all(open.map((db) => db.close()));
  open = [];
});

const STORES: Array<[string, () => Promise<FiscalStore & ContingencyBlockStore>]> = [
  ["memory", async () => createMemoryFiscalStore()],
  [
    "prisma (PGlite)",
    async () => {
      const db = await migratedDatabase();
      open.push(db);
      return createPrismaFiscalStore({ prisma: prismaOver(db) });
    },
  ],
];

async function setup(makeStore: () => Promise<FiscalStore & ContingencyBlockStore>) {
  const store = await makeStore();
  const fake = fakeIssuer();
  const objects = new Map<string, string>();
  const saleFor: string[] = [];
  const clock = { at: Date.parse("2026-11-20T15:30:00.000Z") };
  let id = 0;
  const service = createFiscalDocuments({
    store,
    issuer: fake.issuer,
    signing: createSigningIdentities({ cipher }),
    cipher,
    readCertificate: async () => ({ expiresAt: "2027-03-01T00:00:00.000Z" }),
    storage: { put: async (key, body) => void objects.set(key, body), get: async (key) => objects.get(key) ?? null },
    sales: {
      saleFor: async ({ subjectId }) => {
        saleFor.push(subjectId);
        return draftOf(SALE);
      },
    },
    notify: { emit: async () => undefined },
    now: () => new Date(clock.at),
    utcOffset: () => "-03:00",
    reasons: {
      contingency: "SEFAZ indisponivel no momento da venda",
      inutilization: "Numero nao utilizado por falha na emissao",
      substitution: "Substituida por documento emitido em contingencia",
    },
    staleAfterMs: 5 * 60_000,
    nfceOnlineToleranceMs: 15 * 60_000,
    newId: () => `id-${(id += 1)}`,
  });
  await service.saveProfile("owner-1", {
    cnpj: SALE.issuer.cnpj, stateRegistration: SALE.issuer.stateRegistration, municipalRegistration: null, cnae: null,
    legalName: SALE.issuer.legalName, tradeName: null, taxRegime: "SIMPLES", regime: "SIMPLES", regimeEffectiveFrom: "2026-01-01",
    restaurantRegime: true, address: SALE.issuer.address, environment: "homologacao", documentPolicy: "ISSUED_HERE",
    signingIdentity: "STORE_CERTIFICATE", cscId: "000001", cscToken: "TESTCSC0123456789ABCDEF0123456789", consentRecordedAt: null,
  });
  await service.uploadCertificate("owner-1", { pfxBase64: "A".repeat(120), password: "pfx-password" });
  await service.createIssuingPoint("owner-1", {
    id: "register-1", model: "NFCE", onlineSeries: 1, contingencySeries: 2, firstOnlineNumber: 1201, firstContingencyNumber: 1,
  });
  const later = (ms: number) => void (clock.at += ms);
  // The service is the package's ContingencyBlockSource.
  const source: ContingencyBlockSource = service;
  void source;
  return { service, store, objects, saleFor, later, ...fake };
}

const refusedAs = async (promise: Promise<unknown>, code: string) => {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(FiscalDocumentError);
  expect((error as FiscalDocumentError).code).toBe(code);
};

describe.each(STORES)("contingency blocks on the %s store", (_name, makeStore) => {
  it("draws a block from the point's contingency counter, the one the server's own contingency draws from", async () => {
    const { service } = await setup(makeStore);
    const first = await service.reserveBlock({ ownerId: "owner-1", issuingPointId: "register-1", holder: "station-a" });
    expect(first).toMatchObject({ series: 2, from: 1, to: 50, holder: "station-a", fate: "OPEN", usedUpTo: null, issuingPointId: "register-1" });
    const offline = await service.issueOffline({ ownerId: "owner-1", subjectId: "order-server", issuingPointId: "register-1" });
    expect(offline).toMatchObject({ seriesKind: "CONTINGENCY", series: 2, number: 51 });
    const second = await service.reserveBlock({ ownerId: "owner-1", issuingPointId: "register-1", holder: "station-b", size: 10 });
    expect(second).toMatchObject({ from: 52, to: 61 });
    expect((await service.listBlocks({ ownerId: "owner-1", holder: "station-a" })).map((b) => b.id)).toEqual([first.id]);
  });

  it("refuses a block size out of range and a point with no contingency series", async () => {
    const { service } = await setup(makeStore);
    await refusedAs(service.reserveBlock({ ownerId: "owner-1", issuingPointId: "register-1", holder: "station-a", size: 0 }), "INVALID_INPUT");
    await refusedAs(service.reserveBlock({ ownerId: "owner-1", issuingPointId: "register-1", holder: " " }), "INVALID_INPUT");
    await service.createIssuingPoint("owner-1", {
      id: "web", model: "NFCE", onlineSeries: 7, contingencySeries: null, firstOnlineNumber: 1, firstContingencyNumber: 1,
    });
    await refusedAs(service.reserveBlock({ ownerId: "owner-1", issuingPointId: "web", holder: "station-a" }), "INVALID_INPUT");
  });

  it("records a station-signed note as the subject's CONTINGENCY document, read from its XML, due now; a replay records nothing", async () => {
    const { service, store, objects } = await setup(makeStore);
    await service.reserveBlock({ ownerId: "owner-1", issuingPointId: "register-1", holder: "station-a" });
    const note = stationNote(3);
    const document = await service.recordSigned({ ownerId: "owner-1", subjectId: "order-1", signedXml: note.xml, holder: "station-a" });
    expect(document).toMatchObject({
      status: "CONTINGENCY", seriesKind: "CONTINGENCY", series: 2, number: 3, keyCode: "48213907", accessKey: note.key,
      issuedAt: "2026-11-20T12:30:00-03:00", contingency: { since: "2026-11-20T12:10:00-03:00", reason: "SEFAZ unreachable from the store" },
      nextAttemptAt: "2026-11-20T15:30:00.000Z", numberVoid: null, issuingPointId: "register-1",
    });
    expect(document.totals.totalCents).toBe(Math.round(Number(/<vNF>([\d.]+)<\/vNF>/.exec(note.xml)?.[1]) * 100));
    expect(objects.get(document.xmlKey ?? "")).toBe(note.xml);
    const again = await service.recordSigned({ ownerId: "owner-1", subjectId: "order-1", signedXml: note.xml, holder: "station-a" });
    expect(again.id).toBe(document.id);
    expect((await store.listEvents(document.id)).map((e) => e.kind)).toEqual(["SIGN_OFFLINE"]);
    expect(await service.listBySubject("owner-1", "order-1", "NFCE")).toHaveLength(1);
  });

  it("refuses a note outside the holder's block, of another holder, or recorded for another subject", async () => {
    const { service } = await setup(makeStore);
    await service.reserveBlock({ ownerId: "owner-1", issuingPointId: "register-1", holder: "station-a", size: 10 });
    await service.reserveBlock({ ownerId: "owner-1", issuingPointId: "register-1", holder: "station-b", size: 10 });
    const record = (number: number, holder: string, subjectId = `order-${number}`) =>
      service.recordSigned({ ownerId: "owner-1", subjectId, signedXml: stationNote(number).xml, holder });
    await refusedAs(record(12, "station-a"), "CONTINGENCY_XML_REFUSED");
    await refusedAs(record(40, "station-a"), "CONTINGENCY_XML_REFUSED");
    await record(2, "station-a");
    await refusedAs(record(2, "station-a", "order-other"), "CONTINGENCY_XML_REFUSED");
    // The same number under another cNF: another key for a number already recorded.
    await refusedAs(
      service.recordSigned({ ownerId: "owner-1", subjectId: "order-x", signedXml: stationNote(2, { keyCode: "11112222" }).xml, holder: "station-a" }),
      "CONTINGENCY_XML_REFUSED",
    );
  });

  it("refuses a note of another CNPJ, an online or model 55 note, and a key whose check digit or fields are wrong", async () => {
    const { service } = await setup(makeStore);
    await service.reserveBlock({ ownerId: "owner-1", issuingPointId: "register-1", holder: "station-a" });
    const refused = (mutate: (xml: string) => string) =>
      refusedAs(service.recordSigned({ ownerId: "owner-1", subjectId: "order-1", signedXml: stationNote(3, { mutate }).xml, holder: "station-a" }), "CONTINGENCY_XML_REFUSED");
    await refused((xml) => xml.replace("<tpEmis>9</tpEmis>", "<tpEmis>1</tpEmis>"));
    await refused((xml) => xml.replace("<mod>65</mod>", "<mod>55</mod>"));
    await refused((xml) => xml.replace(/<cDV>(\d)<\/cDV>/, (_, d: string) => `<cDV>${(Number(d) + 1) % 10}</cDV>`));
    await refused((xml) => xml.replace("<nNF>3</nNF>", "<nNF>4</nNF>"));
    await refused((xml) => xml.replace("<tpAmb>2</tpAmb>", "<tpAmb>1</tpAmb>"));
    await refused((xml) => xml.replace(/<Signature[\s\S]*<\/Signature>/, ""));
    const other = stationNote(3);
    await refusedAs(
      service.recordSigned({ ownerId: "owner-1", subjectId: "order-1", signedXml: other.xml.split(SALE.issuer.cnpj).join("99888777000166"), holder: "station-a" }),
      "CONTINGENCY_XML_REFUSED",
    );
    expect(await service.listBySubject("owner-1", "order-1", "NFCE")).toEqual([]);
  });

  it("transmits a station note from its own XML, authorised under the same key, never re-signed (S2)", async () => {
    const { service, transmitted, signed } = await setup(makeStore);
    await service.reserveBlock({ ownerId: "owner-1", issuingPointId: "register-1", holder: "station-a" });
    const note = stationNote(1);
    const recorded = await service.recordSigned({ ownerId: "owner-1", subjectId: "order-1", signedXml: note.xml, holder: "station-a" });
    const report = await service.transmitContingency(10);
    expect(report.advanced).toEqual([{ documentId: recorded.id, status: "AUTHORIZED" }]);
    expect(transmitted.map((call) => call.signedXml)).toEqual([note.xml]);
    expect(signed).toEqual([]);
    expect(await service.getDocument("owner-1", recorded.id)).toMatchObject({ status: "AUTHORIZED", accessKey: note.key });
  });

  it("keeps a rejected station note live with its number, for the store to correct and resend", async () => {
    const { service, script } = await setup(makeStore);
    script.transmit = "reject";
    await service.reserveBlock({ ownerId: "owner-1", issuingPointId: "register-1", holder: "station-a" });
    const recorded = await service.recordSigned({ ownerId: "owner-1", subjectId: "order-1", signedXml: stationNote(1).xml, holder: "station-a" });
    await service.transmitContingency(10);
    expect(await service.getDocument("owner-1", recorded.id)).toMatchObject({ status: "REJECTED", numberVoid: null, statusCode: "225" });
    // Still the sale's live note: issuing again answers it, nothing new is numbered.
    expect((await service.issue({ ownerId: "owner-1", subjectId: "order-1", issuingPointId: "register-1", model: "NFCE" })).id).toBe(recorded.id);
  });

  it("voids the known gaps once: below the highest handed in, and the rest of a block its holder closed", async () => {
    const { service, inutilized, later } = await setup(makeStore);
    await service.reserveBlock({ ownerId: "owner-1", issuingPointId: "register-1", holder: "station-a", size: 10 });
    for (const number of [1, 2, 4]) {
      await service.recordSigned({ ownerId: "owner-1", subjectId: `order-${number}`, signedXml: stationNote(number).xml, holder: "station-a" });
    }
    later(60_000);
    const before = new Date(Date.parse("2026-11-20T15:31:00.000Z")).toISOString();
    expect((await service.listKnownGaps({ before })).map(({ from, to }) => [from, to])).toEqual([[3, 3]]);
    expect(await service.listUnknownRanges({})).toEqual([]);
    const closed = await service.closeBlock({ ownerId: "owner-1", holder: "station-a", series: 2, from: 1, sequenceUsed: 6 });
    expect(closed).toMatchObject({ fate: "CLOSED", usedUpTo: 6 });
    expect((await service.listKnownGaps({ before })).map(({ from, to }) => [from, to])).toEqual([[3, 3], [7, 10]]);
    expect((await service.listUnknownRanges({ ownerId: "owner-1" })).map(({ from, to }) => [from, to])).toEqual([[5, 6]]);

    const report = await service.voidKnownGaps({ before });
    expect(report.failures).toEqual([]);
    expect(inutilized.map(({ series, from, to, year, cnpj, model }) => ({ series, from, to, year, cnpj, model }))).toEqual([
      { series: 2, from: 3, to: 3, year: 2026, cnpj: SALE.issuer.cnpj, model: "NFCE" },
      { series: 2, from: 7, to: 10, year: 2026, cnpj: SALE.issuer.cnpj, model: "NFCE" },
    ]);
    await service.voidKnownGaps({ before });
    expect(inutilized).toHaveLength(2);

    // The signed-but-late numbers arrive: nothing is left, the block is settled and read no more.
    for (const number of [5, 6]) {
      await service.recordSigned({ ownerId: "owner-1", subjectId: `order-${number}`, signedXml: stationNote(number).xml, holder: "station-a" });
    }
    await service.voidKnownGaps({ before });
    expect((await service.listBlocks({ ownerId: "owner-1" }))[0]?.settledAt).not.toBeNull();
    expect(inutilized).toHaveLength(2);
  });

  it("never voids what a lost install may have signed, and leaves a block reserved after `before` alone", async () => {
    const { service, inutilized, script } = await setup(makeStore);
    await service.reserveBlock({ ownerId: "owner-1", issuingPointId: "register-1", holder: "install-1", size: 10 });
    await service.recordSigned({ ownerId: "owner-1", subjectId: "order-1", signedXml: stationNote(1).xml, holder: "install-1" });
    await service.recordSigned({ ownerId: "owner-1", subjectId: "order-3", signedXml: stationNote(3).xml, holder: "install-1" });
    expect(await service.abandonBlocks({ ownerId: "owner-1", holder: "install-1" })).toHaveLength(1);
    expect((await service.listUnknownRanges({})).map(({ from, to }) => [from, to])).toEqual([[4, 10]]);
    script.inutilize = "fail";
    const failed = await service.voidKnownGaps({ before: "2026-11-21T00:00:00.000Z" });
    expect(failed.failures.map(({ from, to }) => [from, to])).toEqual([[2, 2]]);
    script.inutilize = "ok";
    await service.voidKnownGaps({ before: "2026-11-21T00:00:00.000Z" });
    expect(inutilized.map(({ from, to }) => [from, to])).toEqual([[2, 2], [2, 2]]);
    expect(await service.voidKnownGaps({ before: "2026-11-20T00:00:00.000Z" })).toEqual({ voided: [], failures: [] });
    // The lost install's own late upload is still its note.
    await service.recordSigned({ ownerId: "owner-1", subjectId: "order-5", signedXml: stationNote(5).xml, holder: "install-1" });
    expect((await service.listUnknownRanges({})).map(({ from, to }) => [from, to])).toEqual([[6, 10]]);
  });

  it("refuses a late note on a number voided at SEFAZ already: record 2, void, then record 1 is refused and records nothing", async () => {
    const { service, inutilized, objects } = await setup(makeStore);
    await service.reserveBlock({ ownerId: "owner-1", issuingPointId: "register-1", holder: "station-a", size: 10 });
    await service.recordSigned({ ownerId: "owner-1", subjectId: "order-2", signedXml: stationNote(2).xml, holder: "station-a" });
    await service.voidKnownGaps({ before: "2026-11-21T00:00:00.000Z" });
    expect(inutilized.map(({ from, to }) => [from, to])).toEqual([[1, 1]]);
    const late = stationNote(1);
    await refusedAs(service.recordSigned({ ownerId: "owner-1", subjectId: "order-1", signedXml: late.xml, holder: "station-a" }), "CONTINGENCY_XML_REFUSED");
    expect(await service.listBySubject("owner-1", "order-1", "NFCE")).toEqual([]);
    expect([...objects.keys()].some((key) => key.includes(late.key))).toBe(false);
    expect((await service.listBlocks({ ownerId: "owner-1" }))[0]?.documented).toEqual([2]);
  });

  it("refuses a note whose total or buyer is not the booked sale's, and records nothing", async () => {
    const { service } = await setup(makeStore);
    await service.reserveBlock({ ownerId: "owner-1", issuingPointId: "register-1", holder: "station-a" });
    const refused = (mutate: (xml: string) => string) =>
      refusedAs(service.recordSigned({ ownerId: "owner-1", subjectId: "order-1", signedXml: stationNote(3, { mutate }).xml, holder: "station-a" }), "CONTINGENCY_XML_REFUSED");
    await refused((xml) => xml.replace("<vNF>50.90</vNF>", "<vNF>49.90</vNF>"));
    await refused((xml) => xml.replace("</emit>", "</emit><dest><CPF>12345678909</CPF></dest>"));
    expect(await service.listBySubject("owner-1", "order-1", "NFCE")).toEqual([]);
  });

  it("reads every page of blocks: a gap behind more never-settling blocks than one page holds is still voided and flagged", async () => {
    const { service, store, inutilized } = await setup(makeStore);
    const pages: Array<{ after?: unknown }> = [];
    const list = store.listContingencyBlocks.bind(store);
    // A store that answers at most 2 blocks a page, as a full page of 1000 would.
    (store as { listContingencyBlocks: ContingencyBlockStore["listContingencyBlocks"] }).listContingencyBlocks = (input) => {
      pages.push({ after: input.after });
      return list({ ...input, limit: Math.min(input.limit, 2) });
    };
    for (let block = 0; block < 5; block += 1) {
      await service.reserveBlock({ ownerId: "owner-1", issuingPointId: "register-1", holder: "station-a", size: 2 });
    }
    // Blocks 1-8 stay OPEN with nothing handed in (never settled); the fifth block's 9 is a known gap.
    await service.recordSigned({ ownerId: "owner-1", subjectId: "order-10", signedXml: stationNote(10).xml, holder: "station-a" });
    const before = "2026-11-21T00:00:00.000Z";
    expect((await service.listKnownGaps({ before })).map(({ from, to }) => [from, to])).toEqual([[9, 9]]);
    pages.length = 0;
    const report = await service.voidKnownGaps({ before });
    expect(report.voided.map(({ from, to }) => [from, to])).toEqual([[9, 9]]);
    expect(inutilized.map(({ from, to }) => [from, to])).toEqual([[9, 9]]);
    expect(pages.length).toBeGreaterThanOrEqual(3);
    expect(pages.filter((page) => page.after !== undefined).length).toBeGreaterThanOrEqual(2);
    await service.abandonBlocks({ ownerId: "owner-1", holder: "station-a" });
    expect((await service.listUnknownRanges({})).map(({ from, to }) => [from, to])).toEqual([[1, 2], [3, 4], [5, 6], [7, 8]]);
    expect(await service.listBlocks({ ownerId: "owner-1" })).toHaveLength(5);
  });

  it("refuses to close a block the holder does not hold, or with a count outside it", async () => {
    const { service } = await setup(makeStore);
    await service.reserveBlock({ ownerId: "owner-1", issuingPointId: "register-1", holder: "station-a", size: 10 });
    await refusedAs(service.closeBlock({ ownerId: "owner-1", holder: "station-b", series: 2, from: 1, sequenceUsed: 3 }), "NOT_FOUND");
    await refusedAs(service.closeBlock({ ownerId: "owner-1", holder: "station-a", series: 2, from: 1, sequenceUsed: 11 }), "INVALID_INPUT");
    await service.closeBlock({ ownerId: "owner-1", holder: "station-a", series: 2, from: 1, sequenceUsed: 0 });
    // Closing again with the same count answers the block; another count is refused.
    await service.closeBlock({ ownerId: "owner-1", holder: "station-a", series: 2, from: 1, sequenceUsed: 0 });
    await refusedAs(service.closeBlock({ ownerId: "owner-1", holder: "station-a", series: 2, from: 1, sequenceUsed: 4 }), "TRANSITION_REFUSED");
  });
});

describe("a store without blocks", () => {
  it("answers NOT_SUPPORTED from the block methods and nothing else changes", async () => {
    const full = createMemoryFiscalStore();
    const { reserveContingencyBlock: _r, ...withoutBlocks } = full;
    void _r;
    const service = createFiscalDocuments({
      store: withoutBlocks as FiscalStore,
      issuer: fakeIssuer().issuer,
      signing: createSigningIdentities({ cipher }),
      cipher,
      readCertificate: async () => ({ expiresAt: "2027-03-01T00:00:00.000Z" }),
      storage: { put: async () => undefined, get: async () => null },
      sales: { saleFor: async () => draftOf(SALE) },
      notify: { emit: async () => undefined },
      now: () => new Date("2026-11-20T15:30:00.000Z"),
      utcOffset: () => "-03:00",
      reasons: { contingency: "x".repeat(20), inutilization: "y".repeat(20), substitution: "z".repeat(20) },
      staleAfterMs: 1000,
      nfceOnlineToleranceMs: 1000,
      newId: () => "id",
    });
    await refusedAs(service.reserveBlock({ ownerId: "owner-1", issuingPointId: "register-1", holder: "a" }), "NOT_SUPPORTED");
  });
});
