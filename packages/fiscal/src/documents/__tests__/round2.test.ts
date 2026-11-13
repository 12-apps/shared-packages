/**
 * The review's round-2 probes (FUT-2237): regressions the round-1 fixes
 * introduced, kept as the package's own suite and run against both stores.
 * R2-2 and R2-3 are widened to the rule decided with them: an authorised
 * document is never final without its XML, and a resend may not change what
 * the buyer's DANFE prints.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

import { DANFE_NFCE_PT_BR } from "../../danfe/pt-BR";
import { createApiFiscal } from "../../http";
import type { Issuer } from "../../issuer/port";
import type { SaleForDocument } from "../../sale/types";
import { computeAccessKey, draftOf } from "../context";
import { createMemoryFiscalStore } from "../memory";
import { digestOf } from "../nfe-proc";
import type { FiscalStore, SaleDraft } from "../ports";
import { createFiscalDocuments } from "../service";
import { createSigningIdentities } from "../signing";
import { createPrismaFiscalStore } from "../sql-store";
import { SALE } from "./fixtures";
import { migratedDatabase, prismaOver } from "./pglite";

const K2 = "35261111222333000181650020000000019482139071";
const RECORDED_KEY = "35261111222333000181650010000012011482139076";
const RECORDED = join(import.meta.dirname, "../../issuer/__tests__/fixtures/sidecar");
const RECORDED_SIGNED = (JSON.parse(readFileSync(join(RECORDED, "nfce-issue-authorized.json"), "utf8")) as { body: { signedXml: string } }).body.signedXml;

const err = (cls: string, o: Record<string, unknown> = {}) => ({
  ok: false,
  error: { class: cls, code: null, message: "x", details: [], accessKey: null, signedXml: null, sefazReply: null, outcomeUnknown: false, ...o },
});
const signed = (key: string) => ({ ok: true, answer: { status: "SIGNED", accessKey: key, signedXml: "<NFe/>" } });
const keyOf = (document: SaleForDocument) => computeAccessKey({ sale: document, model: "NFCE", seriesKind: "ONLINE" });
/** The service's recorded signed XML, re-keyed to the document at hand. */
const signedXmlFor = (key: string) => RECORDED_SIGNED.split(RECORDED_KEY).join(key);
/** A lookup reply whose protocol certifies exactly the XML signed for `key` (its `digVal` is that XML's digest). */
const lookupReply = (key: string, nProt: string) =>
  `<retConsSitNFe><cStat>100</cStat><protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><chNFe>${key}</chNFe><dhRecbto>2026-11-20T12:31:00-03:00</dhRecbto><nProt>${nProt}</nProt><digVal>${digestOf(signedXmlFor(key))}</digVal><cStat>100</cStat></infProt></protNFe></retConsSitNFe>`;

const METHODS = ["issue", "signContingency", "transmit", "cancel", "cancelBySubstitution", "lookup", "inutilize"] as const;
type Impl = Partial<Record<(typeof METHODS)[number], (call: never) => Promise<unknown>>>;

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

describe.each(STORES)("round-2 regressions (%s store)", (_name, makeStore) => {
  async function setup(impl: Impl, sales?: () => SaleDraft) {
    const store = await makeStore();
    const calls: Array<{ method: string; call: Record<string, unknown> }> = [];
    const issuer = {
      health: async () => ({}),
      ...Object.fromEntries(
        METHODS.map((m) => [
          m,
          async (call: never) => {
            calls.push({ method: m, call });
            const fn = impl[m];
            if (fn === undefined) throw new Error(`unexpected ${m}`);
            return fn(call);
          },
        ]),
      ),
    } as unknown as Issuer;
    const blobs = new Map<string, string>();
    const storage = { put: async (k: string, b: string) => void blobs.set(k, b), get: async (k: string) => blobs.get(k) ?? null };
    let clock = Date.parse("2026-11-20T15:30:00.000Z");
    let ids = 0;
    const cipher = { encrypt: (p: string) => `enc:${p}`, decrypt: (c: string) => c.slice(4) };
    const service = createFiscalDocuments({
      store,
      issuer,
      signing: createSigningIdentities({ cipher }),
      cipher,
      readCertificate: async () => ({ expiresAt: "2027-03-01T00:00:00.000Z" }),
      storage,
      sales: { saleFor: async () => (sales === undefined ? draftOf(SALE) : sales()) },
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

  it("R2-1 a send that died in flight (SUBMITTED, no answer recorded) is looked up before its number is voided", async () => {
    const { service, store, later } = await setup({
      issue: async () => {
        throw new Error("process died during the call");
      },
      signContingency: async () => signed(K2),
    });
    await service.issue(ISSUE).catch(() => undefined);
    expect((await store.listBySubject("o", "sale-1", "NFCE"))[0]!.status).toBe("SUBMITTED");
    later(6 * 60_000); // past nfceOnlineToleranceMs: offline, never sent again
    await service.sweep(10);
    const [online] = await store.listBySubject("o", "sale-1", "NFCE");
    expect(online).toMatchObject({ status: "REPLACED", numberVoid: "LOOKUP_FIRST" });
  });

  it("R2-2 a lookup that finds a SUBMITTED document authorised stores its nfeProc, and the DANFE prints it", async () => {
    const { service, store, danfe } = await setup({
      issue: async (call: { document: SaleForDocument }) => {
        const key = keyOf(call.document);
        return err("RETRYABLE", { outcomeUnknown: true, accessKey: key, signedXml: signedXmlFor(key) });
      },
      lookup: async (call: { accessKey: string }) => ({
        ok: true,
        answer: { status: "AUTHORIZED", accessKey: call.accessKey, protocol: "135260000000042", statusCode: "100", statusReason: "", sefazReply: lookupReply(call.accessKey, "135260000000042") },
      }),
    });
    const document = await service.issue(ISSUE);
    await service.lookup({ ownerId: "o", documentId: document.id });
    const after = (await store.getDocument("o", document.id))!;
    expect(after).toMatchObject({ status: "AUTHORIZED", protocol: "135260000000042" });
    expect(after.xmlKey).toMatch(/authorized\.xml$/);
    const printed = await danfe(document.id);
    expect(printed.status).toBe(200);
    expect(JSON.stringify(printed.body)).toContain("135260000000042");
  });

  it("R2-2 without the XML a lookup never makes it final: it stays SUBMITTED, and the sweep fetches the XML, never going offline", async () => {
    let first = true;
    const { service, store, calls, later } = await setup({
      issue: async (call: { document: SaleForDocument }) => {
        if (first) {
          first = false;
          return err("RETRYABLE", { outcomeUnknown: true });
        }
        const key = keyOf(call.document);
        return {
          ok: true,
          answer: {
            status: "AUTHORIZED", accessKey: key, protocol: "135260000000042", authorizedAt: "2026-11-20T12:31:00-03:00",
            signedXml: signedXmlFor(key), authorizedXml: `<nfeProc>${signedXmlFor(key)}</nfeProc>`, statusCode: "100", statusReason: "", sefazReply: "",
          },
        };
      },
      lookup: async (call: { accessKey: string }) => ({
        ok: true,
        answer: { status: "AUTHORIZED", accessKey: call.accessKey, protocol: "135260000000042", statusCode: "100", statusReason: "", sefazReply: "" },
      }),
    });
    const document = await service.issue(ISSUE);
    await service.lookup({ ownerId: "o", documentId: document.id });
    expect(await store.getDocument("o", document.id)).toMatchObject({ status: "SUBMITTED", protocol: "135260000000042", xmlKey: null });
    later(30 * 60_000); // far past the online tolerance: it is SEFAZ's, so it must not go offline
    await service.sweep(10);
    expect(calls.filter((c) => c.method === "signContingency")).toHaveLength(0);
    const after = (await store.getDocument("o", document.id))!;
    expect(after.status).toBe("AUTHORIZED");
    expect(after.xmlKey).not.toBeNull();
  });

  describe("R2-3 a resent contingency NFC-e", () => {
    const base = draftOf(SALE);
    async function rejectedOffline(correction: () => SaleDraft) {
      let corrected = false;
      const ctx = await setup(
        {
          issue: async () => err("CONTINGENCY"),
          signContingency: async () => signed(K2),
          transmit: async () => err("REJECTED", { code: "225" }),
        },
        () => (corrected ? correction() : base),
      );
      await ctx.service.issue(ISSUE);
      ctx.later(6 * 60_000);
      await ctx.service.transmitContingency(10);
      const rejected = (await ctx.store.listBySubject("o", "sale-1", "NFCE")).find((d) => d.seriesKind === "CONTINGENCY")!;
      corrected = true;
      return { ...ctx, rejected };
    }

    it("carries the corrected sale's tax figures and totals when it changes no printed field", async () => {
      const { service, rejected } = await rejectedOffline(() => ({
        ...base,
        lines: base.lines.map((line) => ({ ...line, ncm: "21069090", approximateTaxCents: (line.approximateTaxCents ?? 0) + 7 })),
      }));
      const resent = await service.resendContingency({ ownerId: "o", documentId: rejected.id });
      expect(resent).toMatchObject({ status: "CONTINGENCY", number: rejected.number, totals: rejected.totals, buyerTaxId: rejected.buyerTaxId });
      expect(resent.sale.lines.every((line) => line.ncm === "21069090")).toBe(true);
    });

    it("is refused when the correction changes the total the DANFE prints", async () => {
      const { service, store, rejected } = await rejectedOffline(() => ({
        ...base,
        lines: base.lines.map((line) => ({ ...line, discountCents: line.discountCents + 100 })),
      }));
      await expect(service.resendContingency({ ownerId: "o", documentId: rejected.id })).rejects.toMatchObject({ code: "RESEND_CHANGES_PRINTED_FIELDS" });
      expect(await store.getDocument("o", rejected.id)).toMatchObject({ status: "REJECTED", totals: rejected.totals });
    });

    it("is refused when the correction changes the buyer's document", async () => {
      const { service, rejected } = await rejectedOffline(() => ({
        ...base,
        buyer: { document: { kind: "CPF", number: "12345678909" }, name: null, stateRegistrationStatus: "NON_CONTRIBUTOR", stateRegistration: null, email: null, address: null },
      }));
      await expect(service.resendContingency({ ownerId: "o", documentId: rejected.id })).rejects.toMatchObject({ code: "RESEND_CHANGES_PRINTED_FIELDS" });
    });
  });
});
