/**
 * The review's round-3 probes (FUT-2237): regressions round 2 introduced,
 * kept as the package's own suite. R3-2 runs against both stores and is
 * followed through to the settlement: a number SEFAZ authorised is never
 * voided nor cancelled, and the sale keeps it as its live document.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

import type { Issuer } from "../../issuer/port";
import { draftOf } from "../context";
import { createMemoryFiscalStore } from "../memory";
import { assembleNfeProc, digestOf } from "../nfe-proc";
import type { FiscalStore } from "../ports";
import { createFiscalDocuments } from "../service";
import { createSigningIdentities } from "../signing";
import { createPrismaFiscalStore } from "../sql-store";
import { isLive } from "../types";
import { SALE } from "./fixtures";
import { migratedDatabase, prismaOver } from "./pglite";

const RECORDED = join(import.meta.dirname, "../../issuer/__tests__/fixtures/sidecar");
const FIX = (JSON.parse(readFileSync(join(RECORDED, "nfce-issue-authorized.json"), "utf8")) as { body: { authorizedXml: string; accessKey: string } }).body;
const err = (cls: string, o: Record<string, unknown> = {}) => ({
  ok: false,
  error: { class: cls, code: null, message: "x", details: [], accessKey: null, signedXml: null, sefazReply: null, outcomeUnknown: false, ...o },
});

describe("R3-1 the nfeProc", () => {
  const proc = FIX.authorizedXml;
  const nfe = /<NFe\b[^>]*>[\s\S]*<\/NFe>/.exec(proc)![0];
  const prot = /<protNFe\b[^>]*>[\s\S]*?<\/protNFe>/.exec(proc)![0];

  it("is assembled when the protocol's digVal is the signed XML's DigestValue", () => {
    expect(prot).toContain(`<digVal>${digestOf(nfe)}</digVal>`);
    expect(assembleNfeProc({ signedXml: nfe, sefazReply: `<retConsSitNFe>${prot}</retConsSitNFe>`, accessKey: FIX.accessKey })).not.toBeNull();
  });

  it("is never assembled from an XML the protocol does not certify (another digest under the same key)", () => {
    const otherDigest = prot.replace(/<digVal>[^<]*<\/digVal>/, "<digVal>AAAAAAAAAAAAAAAAAAAAAAAAAAA=</digVal>");
    expect(assembleNfeProc({ signedXml: nfe, sefazReply: `<retConsSitNFe>${otherDigest}</retConsSitNFe>`, accessKey: FIX.accessKey })).toBeNull();
    const noDigest = prot.replace(/<digVal>[^<]*<\/digVal>/, "");
    expect(assembleNfeProc({ signedXml: nfe, sefazReply: `<retConsSitNFe>${noDigest}</retConsSitNFe>`, accessKey: FIX.accessKey })).toBeNull();
  });
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

describe.each(STORES)("R3-2 (%s store)", (_name, makeStore) => {
  it("a SUBMITTED document a lookup found authorised is never voided when its re-send is REJECTED, and stays the sale's", async () => {
    const store = await makeStore();
    let first = true;
    const calls: string[] = [];
    const impl: Record<string, (call: { accessKey: string }) => Promise<unknown>> = {
      issue: async () => {
        if (first) {
          first = false;
          return err("RETRYABLE", { outcomeUnknown: true }); // the adapter timed out: no signedXml
        }
        // The service's own answer when SEFAZ holds a different XML under the key.
        return err("REJECTED", { code: "100", message: "SEFAZ holds a DIFFERENT document under this key", accessKey: "k" });
      },
      lookup: async (c) => ({ ok: true, answer: { status: "AUTHORIZED", accessKey: c.accessKey, protocol: "135260000000042", statusCode: "100", statusReason: "", sefazReply: "" } }),
    };
    const issuer = {
      health: async () => ({}),
      ...Object.fromEntries(
        ["issue", "signContingency", "transmit", "cancel", "cancelBySubstitution", "lookup", "inutilize"].map((m) => [
          m,
          async (call: { accessKey: string }) => {
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
    const service = createFiscalDocuments({
      store,
      issuer,
      signing: createSigningIdentities({ cipher }),
      cipher,
      readCertificate: async () => ({ expiresAt: "2027-03-01T00:00:00.000Z" }),
      storage: { put: async (k, b) => void blobs.set(k, b), get: async (k) => blobs.get(k) ?? null },
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
    const ISSUE = { ownerId: "o", subjectId: "sale-1", issuingPointId: "reg", model: "NFCE" } as const;

    const document = await service.issue(ISSUE);
    await service.lookup({ ownerId: "o", documentId: document.id });
    expect(await store.getDocument("o", document.id)).toMatchObject({ status: "SUBMITTED", protocol: "135260000000042", outcomeUnknown: false });

    clock += 30 * 60_000;
    await service.sweep(10); // the re-send for the XML is REJECTED
    const rejected = (await store.getDocument("o", document.id))!;
    expect(rejected).toMatchObject({ status: "REJECTED", numberVoid: "LOOKUP_FIRST", protocol: "135260000000042" });
    expect(isLive(rejected)).toBe(true);
    // The subject still stands on it: a second issue answers it, drawing no number.
    expect((await service.issue(ISSUE)).id).toBe(document.id);

    clock += 30 * 60_000;
    await service.sweep(10); // the lookup: still SEFAZ's — back to SUBMITTED, owing work; nothing voided, nothing cancelled (review R4-1)
    const settled = (await store.getDocument("o", document.id))!;
    expect(settled).toMatchObject({ status: "SUBMITTED", numberVoid: null, protocol: "135260000000042" });
    expect(settled.nextAttemptAt).not.toBeNull();
    expect(calls.filter((m) => m === "inutilize" || m === "cancel" || m === "cancelBySubstitution" || m === "signContingency")).toEqual([]);
  });
});
