/**
 * The review's round-4 probe (FUT-2237): a number SEFAZ authorised, whose
 * re-send was refused, must always have a way forward — settled AUTHORIZED
 * with its XML, or back to SUBMITTED owing work — never stuck REJECTED.
 * Run against both stores.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DANFE_NFCE_PT_BR } from "../../../danfe/pt-BR";
import { createApiFiscal } from "../../../http";
import type { Issuer } from "../../../issuer/port";
import type { SaleForDocument } from "../../../sale/types";
import { computeAccessKey, draftOf } from "../../context";
import { MAX_FAILURES } from "../../machine";
import { createMemoryFiscalStore } from "../../memory";
import { digestOf } from "../../nfe-proc";
import type { FiscalStore } from "../../ports";
import { createFiscalDocuments } from "../../service";
import { createSigningIdentities } from "../../signing";
import { createPrismaFiscalStore } from "../../sql-store";
import { SALE } from "../../__tests__/fixtures";
import { migratedDatabase, prismaOver, warmDatabase } from "./pglite";

/** The migration is paid here, under the hook's own timeout, never inside the first case's. */
beforeAll(warmDatabase, 60_000);

const RECORDED_KEY = "35261111222333000181650010000012011482139076";
const RECORDED = join(import.meta.dirname, "../../../issuer/__tests__/fixtures/sidecar");
const RECORDED_SIGNED = (JSON.parse(readFileSync(join(RECORDED, "nfce-issue-authorized.json"), "utf8")) as { body: { signedXml: string } }).body.signedXml;
const signedXmlFor = (key: string) => RECORDED_SIGNED.split(RECORDED_KEY).join(key);
const keyOf = (document: SaleForDocument) => computeAccessKey({ sale: document, model: "NFCE", seriesKind: "ONLINE" });
const PROTOCOL = "135260000000042";

const err = (cls: string, o: Record<string, unknown> = {}) => ({
  ok: false,
  error: { class: cls, code: null, message: "x", details: [], accessKey: null, signedXml: null, sefazReply: null, outcomeUnknown: false, ...o },
});
const authorized = (key: string) => ({
  ok: true,
  answer: {
    status: "AUTHORIZED", accessKey: key, protocol: PROTOCOL, authorizedAt: "2026-11-20T12:31:00-03:00",
    signedXml: signedXmlFor(key), authorizedXml: `<nfeProc>${signedXmlFor(key)}</nfeProc>`, statusCode: "100", statusReason: "", sefazReply: "",
  },
});
const lookedUp = (key: string, withProtocolXml: boolean) => ({
  ok: true,
  answer: {
    status: "AUTHORIZED", accessKey: key, protocol: PROTOCOL, statusCode: "100", statusReason: "",
    sefazReply: withProtocolXml
      ? `<retConsSitNFe><protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><chNFe>${key}</chNFe><dhRecbto>2026-11-20T12:31:00-03:00</dhRecbto><nProt>${PROTOCOL}</nProt><digVal>${digestOf(signedXmlFor(key))}</digVal><cStat>100</cStat></infProt></protNFe></retConsSitNFe>`
      : "",
  },
});

let open: PGlite[] = [];
afterEach(async () => {
  await Promise.all(open.map((db) => db.close()));
  open = [];
});

const STORES: ReadonlyArray<readonly [string, () => Promise<FiscalStore>]> = [
  ["memory", async () => createMemoryFiscalStore()],
  [
    "prisma on Postgres",
    async () => {
      const db = await migratedDatabase();
      open.push(db);
      return createPrismaFiscalStore({ prisma: prismaOver(db) });
    },
  ],
];

type Impl = Record<string, (call: { document: SaleForDocument; accessKey: string }) => Promise<unknown>>;

describe.each(STORES)("R4-1 (%s store)", (_name, makeStore) => {
  async function setup(impl: Impl) {
    const store = await makeStore();
    const calls: string[] = [];
    const issuer = {
      health: async () => ({}),
      ...Object.fromEntries(
        ["issue", "signContingency", "transmit", "cancel", "cancelBySubstitution", "lookup", "inutilize"].map((m) => [
          m,
          async (call: { document: SaleForDocument; accessKey: string }) => {
            calls.push(m);
            const fn = impl[m];
            if (fn === undefined) throw new Error(`unexpected ${m}`);
            return fn(call);
          },
        ]),
      ),
    } as unknown as Issuer;
    let clock = Date.parse("2026-11-20T15:30:00.000Z");
    let ids = 0;
    const cipher = { encrypt: (p: string) => `enc:${p}`, decrypt: (c: string) => c.slice(4) };
    const blobs = new Map<string, string>();
    const storage = { put: async (k: string, b: string) => void blobs.set(k, b), get: async (k: string) => blobs.get(k) ?? null };
    const service = createFiscalDocuments({
      store,
      issuer,
      signing: createSigningIdentities({ cipher }),
      cipher,
      readCertificate: async () => ({ expiresAt: "2027-03-01T00:00:00.000Z" }),
      storage,
      sales: { saleFor: async () => draftOf(SALE) },
      notify: { emit: async () => undefined },
      now: () => new Date(clock),
      utcOffset: () => "-03:00",
      reasons: {
        contingency: "SEFAZ indisponivel no momento",
        inutilization: "Numero nao utilizado na emissao",
        substitution: "Substituida por documento em contingencia",
      },
      staleAfterMs: 5 * 60_000,
      nfceOnlineToleranceMs: 5 * 60_000,
      newId: () => `doc-${(ids += 1)}`,
    });
    await service.saveProfile("o", {
      cnpj: "11222333000181", stateRegistration: "123456789012", municipalRegistration: null, cnae: null, legalName: "Emitente Ltda",
      tradeName: null, taxRegime: "SIMPLES", regime: "SIMPLES", regimeEffectiveFrom: "2026-01-01", restaurantRegime: true,
      address: SALE.issuer.address, environment: "homologacao", documentPolicy: "ISSUED_HERE", signingIdentity: "STORE_CERTIFICATE",
      cscId: "000001", cscToken: "TESTCSC0123456789ABCDEF", consentRecordedAt: null,
    });
    await service.uploadCertificate("o", { pfxBase64: "A".repeat(120), password: "pw" });
    await service.createIssuingPoint("o", { id: "reg", model: "NFCE", onlineSeries: 1, contingencySeries: 2, firstOnlineNumber: 1201, firstContingencyNumber: 1 });
    const { routes } = createApiFiscal({ documents: service, storage, danfeLabels: DANFE_NFCE_PT_BR });
    const danfe = (documentId: string) =>
      routes.find((r) => r.path.endsWith("/danfe"))!.handle({ actor: { ownerId: "o" }, params: { documentId }, query: { paper: "80" } });
    return { service, store, calls, danfe, later: (ms: number) => void (clock += ms) };
  }
  const ISSUE = { ownerId: "o", subjectId: "sale-1", issuingPointId: "reg", model: "NFCE" } as const;

  it("without the XML: back to SUBMITTED owing work, then the re-send settles it AUTHORIZED — printable and cancellable", async () => {
    let sends = 0;
    const { service, store, later, calls } = await setup({
      issue: async (call) => {
        sends += 1;
        if (sends === 1) return err("RETRYABLE", { outcomeUnknown: true });
        if (sends === 2) return err("REJECTED", { code: "704", message: "late dhEmi", accessKey: "k" });
        return authorized(keyOf(call.document));
      },
      lookup: async (c) => lookedUp(c.accessKey, false),
      cancel: async (c) => ({ ok: true, answer: { status: "CANCELLED", accessKey: c.accessKey, protocol: "1", registeredAt: "x", eventXml: null, statusCode: "135", statusReason: "", sefazReply: "" } }),
    });
    const document = await service.issue(ISSUE);
    await service.lookup({ ownerId: "o", documentId: document.id }); // authorised, no XML: SUBMITTED + protocol
    later(30 * 60_000);
    await service.sweep(10); // the re-send is REJECTED (704): looked up first, still live
    expect(await store.getDocument("o", document.id)).toMatchObject({ status: "REJECTED", numberVoid: "LOOKUP_FIRST" });
    later(30 * 60_000);
    await service.sweep(10); // the lookup: SEFAZ's — back to SUBMITTED, owing work
    const back = (await store.getDocument("o", document.id))!;
    expect(back).toMatchObject({ status: "SUBMITTED", numberVoid: null, protocol: PROTOCOL });
    expect(back.nextAttemptAt).not.toBeNull();
    later(30 * 60_000);
    await service.sweep(10); // the re-send: the fiscal service settles the duplicate with the XML
    const settled = (await store.getDocument("o", document.id))!;
    expect(settled).toMatchObject({ status: "AUTHORIZED", protocol: PROTOCOL });
    expect(settled.xmlKey).not.toBeNull();
    expect(calls.filter((m) => m === "inutilize" || m === "cancelBySubstitution" || m === "signContingency")).toEqual([]);
    const cancelled = await service.cancel({ ownerId: "o", documentId: document.id, reason: "Cancelamento solicitado pelo cliente" });
    expect(cancelled.document.status).toBe("CANCELLED");
  });

  it("with the XML its protocol certifies: settled AUTHORIZED by the follow-up lookup itself, and the DANFE prints", async () => {
    let sends = 0;
    const { service, store, later, danfe } = await setup({
      issue: async (call) => {
        sends += 1;
        const key = keyOf(call.document);
        if (sends === 1) return err("RETRYABLE", { outcomeUnknown: true, accessKey: key, signedXml: signedXmlFor(key) });
        return err("REJECTED", { code: "704", message: "late dhEmi", accessKey: key });
      },
      lookup: async (c) => lookedUp(c.accessKey, sends >= 2),
    });
    const document = await service.issue(ISSUE);
    await service.lookup({ ownerId: "o", documentId: document.id }); // no protNFe in the reply yet: SUBMITTED + protocol
    later(30 * 60_000);
    await service.sweep(10); // re-send REJECTED → LOOKUP_FIRST
    later(30 * 60_000);
    await service.sweep(10); // the lookup carries the protocol: REJECTED → SUBMITTED → AUTHORIZED, two steps
    const settled = (await store.getDocument("o", document.id))!;
    expect(settled).toMatchObject({ status: "AUTHORIZED", protocol: PROTOCOL, numberVoid: null });
    expect(settled.xmlKey).toMatch(/authorized\.xml$/);
    const events = (await store.listEvents(document.id)).map((e) => `${e.fromStatus}->${e.toStatus}`);
    expect(events.slice(-2)).toEqual(["REJECTED->SUBMITTED", "SUBMITTED->AUTHORIZED"]);
    expect((await danfe(document.id)).status).toBe(200);
  });

  it("a loop of refusals reaches a person, and a release always gives the sweep a next attempt", async () => {
    let first = true;
    const { service, store, later } = await setup({
      issue: async () => {
        if (first) {
          first = false;
          return err("RETRYABLE", { outcomeUnknown: true });
        }
        return err("REJECTED", { code: "704", message: "late dhEmi", accessKey: "k" });
      },
      lookup: async (c) => lookedUp(c.accessKey, false),
    });
    const document = await service.issue(ISSUE);
    await service.lookup({ ownerId: "o", documentId: document.id }); // SUBMITTED + protocol
    for (let i = 0; i < 4 * MAX_FAILURES; i += 1) {
      later(24 * 3_600_000);
      await service.sweep(10); // re-send REJECTED (one more failure), then the lookup brings it back to SUBMITTED
    }
    const flagged = (await store.getDocument("o", document.id))!;
    expect(flagged).toMatchObject({ attention: true, protocol: PROTOCOL, nextAttemptAt: null });
    expect(flagged.failures).toBeGreaterThanOrEqual(MAX_FAILURES);
    expect(["REJECTED", "SUBMITTED"]).toContain(flagged.status);
    const released = await service.release({ ownerId: "o", documentId: document.id });
    expect(released).toMatchObject({ attention: false, failures: 0 });
    expect(released.nextAttemptAt).not.toBeNull();
  });
});
