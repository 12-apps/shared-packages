/**
 * The review's contract probes (FUT-2237, round 1), kept as the package's own
 * suite and run against BOTH stores: the memory reference and the package's
 * Prisma store on a real Postgres (PGlite, the package's migration). Each case
 * is an invariant of the numbering contract; the review found each broken.
 */
import { afterEach, describe, expect, it } from "vitest";

import type { PGlite } from "@electric-sql/pglite";

import { DANFE_NFCE_PT_BR } from "../../danfe/pt-BR";
import { renderDanfeNfce } from "../../danfe/render";
import type { Issuer, IssuerOutcome } from "../../issuer/port";
import { draftOf } from "../context";
import { createMemoryFiscalStore } from "../memory";
import type { FiscalStore } from "../ports";
import { createFiscalDocuments } from "../service";
import { createSigningIdentities } from "../signing";
import { createPrismaFiscalStore } from "../sql-store";
import type { FiscalDocument } from "../types";
import { SALE } from "./fixtures";
import { migratedDatabase, prismaOver } from "./pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const K1 = "35261111222333000181650010000012011482139076";
const K2 = "35261111222333000181650020000000019482139071";
const RECORDED = join(import.meta.dirname, "../../issuer/__tests__/fixtures/sidecar");
const recorded = (name: string) => JSON.parse(readFileSync(join(RECORDED, `${name}.json`), "utf8")) as { body: Record<string, string> };

const err = (cls: string, o: Record<string, unknown> = {}) => ({
  ok: false,
  error: { class: cls, code: null, message: "x", details: [], accessKey: null, signedXml: null, sefazReply: null, outcomeUnknown: false, ...o },
});
const authorized = (key: string) => ({
  ok: true,
  answer: {
    status: "AUTHORIZED", accessKey: key, protocol: "135260000000001", authorizedAt: "2026-11-20T12:30:05-03:00",
    signedXml: "<NFe/>", authorizedXml: "<nfeProc/>", statusCode: "100", statusReason: "ok", sefazReply: "<s/>",
  },
});
const signed = (key: string) => ({ ok: true, answer: { status: "SIGNED", accessKey: key, signedXml: "<NFe/>" } });
const cancelled = (key: string) => ({
  ok: true,
  answer: { status: "CANCELLED", accessKey: key, protocol: "1", registeredAt: "x", eventXml: null, statusCode: "135", statusReason: "", sefazReply: "" },
});

type Fn = (call: never) => Promise<unknown>;
const METHODS = ["issue", "signContingency", "transmit", "cancel", "cancelBySubstitution", "lookup", "inutilize"] as const;

function stubIssuer(impl: Partial<Record<(typeof METHODS)[number], Fn>>) {
  const calls: Array<{ method: string; call: Record<string, unknown> }> = [];
  const wrap = (method: (typeof METHODS)[number]) => async (call: never) => {
    calls.push({ method, call });
    const fn = impl[method];
    if (fn === undefined) throw new Error(`unexpected ${method}`);
    return fn(call) as Promise<IssuerOutcome<never>>;
  };
  const issuer = { ...Object.fromEntries(METHODS.map((m) => [m, wrap(m)])), health: async () => ({}) } as unknown as Issuer;
  return { issuer, calls };
}

const cipher = { encrypt: (p: string) => `enc:${p}`, decrypt: (c: string) => c.slice(4) };
const ISSUE = { ownerId: "o", subjectId: "sale-1", issuingPointId: "reg", model: "NFCE" } as const;
const live = (docs: readonly FiscalDocument[]) => docs.filter((d) => !["REJECTED", "REPLACED"].includes(d.status) || (d.status === "REJECTED" && d.seriesKind === "CONTINGENCY"));

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

describe.each(STORES)("the numbering contract (%s store)", (_name, makeStore) => {
  async function setup(
    impl: Partial<Record<(typeof METHODS)[number], Fn>>,
    wrapStore?: (store: FiscalStore) => FiscalStore,
    nfceOnlineToleranceMs = 5 * 60_000,
  ) {
    const base = await makeStore();
    const store = wrapStore === undefined ? base : wrapStore(base);
    const { issuer, calls } = stubIssuer(impl);
    const blobs = new Map<string, string>();
    const notified: Array<{ type: string }> = [];
    let clock = Date.parse("2026-11-20T15:30:00.000Z");
    let ids = 0;
    const service = createFiscalDocuments({
      store,
      issuer,
      signing: createSigningIdentities({ cipher }),
      cipher,
      readCertificate: async () => ({ expiresAt: "2027-03-01T00:00:00.000Z" }),
      storage: { put: async (k, b) => void blobs.set(k, b), get: async (k) => blobs.get(k) ?? null },
      sales: { saleFor: async () => draftOf(SALE) },
      notify: { emit: async (event) => void notified.push(event) },
      now: () => new Date(clock),
      utcOffset: () => "-03:00",
      reasons: {
        contingency: "SEFAZ indisponivel no momento",
        inutilization: "Numero nao utilizado na emissao",
        substitution: "Substituida por documento em contingencia",
      },
      staleAfterMs: 5 * 60_000,
      nfceOnlineToleranceMs,
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
    const later = (ms: number) => void (clock += ms);
    const docs = () => base.listBySubject("o", "sale-1", "NFCE");
    return { service, store: base, calls, later, notified, docs };
  }

  it("C1 a number found AUTHORIZED after its sale moved offline is cancelled by substitution, naming its twin", async () => {
    const { service, calls, later, docs } = await setup({
      issue: async () => err("CONTINGENCY", { outcomeUnknown: true, accessKey: K1 }),
      signContingency: async () => signed(K2),
      lookup: async () => ({ ok: true, answer: { status: "AUTHORIZED", accessKey: K1, protocol: "135260000000009", statusCode: "100", statusReason: "", sefazReply: "" } }),
      cancelBySubstitution: async () => cancelled(K1),
    });
    await service.issue(ISSUE);
    later(6 * 60_000);
    await service.sweep(10); // the lookup: found authorised, a cancel owed, its protocol kept
    expect((await docs())[0]).toMatchObject({ numberVoid: "CANCEL", protocol: "135260000000009" });
    later(6 * 60_000);
    await service.sweep(10);
    const sent = calls.filter((c) => c.method === "cancelBySubstitution");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.call).toMatchObject({ accessKey: (await docs())[0]!.accessKey, protocol: "135260000000009", substituteAccessKey: K2 });
    expect((await docs())[0]!.numberVoid).toBe("CANCELLED");
  });

  it("C2 an unknown outcome stays unknown: a later CONTINGENCY answer does not void the first send blindly", async () => {
    let n = 0;
    const { service, later, docs } = await setup({
      issue: async () => (n++ === 0 ? err("RETRYABLE", { outcomeUnknown: true }) : err("CONTINGENCY", { accessKey: K1 })),
      signContingency: async () => signed(K2),
    });
    await service.issue(ISSUE);
    later(4 * 60_000);
    await service.sweep(10); // nothing due yet
    later(7 * 60_000);
    await service.sweep(10);
    const original = (await docs())[0]!;
    expect(original.status).toBe("REPLACED");
    expect(original.numberVoid).toBe("LOOKUP_FIRST");
  });

  it("C3 the same sale issued twice at once yields ONE document", async () => {
    const { service, docs } = await setup({
      issue: async (call: { document: { number: number } }) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return authorized(`3526111122233300018165001${String(call.document.number).padStart(9, "0")}1482139076`);
      },
    });
    const [a, b] = await Promise.all([service.issue(ISSUE), service.issue(ISSUE)]);
    expect(live(await docs())).toHaveLength(1);
    expect(a.id).toBe(b.id);
  });

  it("C4 a crash after the sale moved offline never yields two live or two authorised documents", async () => {
    let crashed = false;
    const { service, later, docs } = await setup(
      {
        issue: async () => err("CONTINGENCY", { accessKey: K1 }),
        signContingency: async () => signed(K2),
        transmit: async () => authorized(K2),
      },
      (s) => ({
        ...s,
        saveTransition: async (prev, t) => {
          if (t.event.kind === "SIGN_OFFLINE" && !crashed) {
            crashed = true;
            throw new Error("process died");
          }
          return s.saveTransition(prev, t);
        },
      }),
    );
    await service.issue(ISSUE).catch(() => undefined);
    expect(live(await docs())).toHaveLength(1); // the online one was replaced with the insert
    later(6 * 60_000);
    await service.sweep(10); // signs the pending contingency document, never re-sends the online one
    later(6 * 60_000);
    await service.transmitContingency(10);
    const after = await docs();
    expect(after.filter((d) => d.status === "AUTHORIZED")).toHaveLength(1);
    expect(live(after)).toHaveLength(1);
  });

  it("C5 a contingency NFC-e rejected after transmission is kept for the store, never inutilized, and resent under its number", async () => {
    let transmits = 0;
    const { service, calls, later, docs } = await setup({
      issue: async () => err("CONTINGENCY", { accessKey: K1 }),
      signContingency: async () => signed(K2),
      transmit: async () => (transmits++ === 0 ? err("REJECTED", { code: "225" }) : authorized(K2)),
      inutilize: async () => ({ ok: true, answer: { status: "INUTILIZED", protocol: "1", registeredAt: "x", inutilizationXml: null, statusCode: "102", statusReason: "", sefazReply: "" } }),
    });
    await service.issue(ISSUE);
    later(6 * 60_000);
    await service.transmitContingency(10);
    for (let i = 0; i < 3; i += 1) {
      later(30 * 60_000);
      await service.sweep(10);
    }
    const offline = (await docs()).find((d) => d.seriesKind === "CONTINGENCY")!;
    expect(offline).toMatchObject({ status: "REJECTED", statusCode: "225", numberVoid: null });
    expect(calls.filter((c) => c.method === "inutilize" && c.call["series"] === 2)).toHaveLength(0);

    const resent = await service.resendContingency({ ownerId: "o", documentId: offline.id });
    expect(resent).toMatchObject({ status: "CONTINGENCY", series: 2, number: offline.number, keyCode: offline.keyCode });
    later(6 * 60_000);
    await service.transmitContingency(10);
    expect((await docs()).find((d) => d.id === offline.id)!.status).toBe("AUTHORIZED");
  });

  it("C6 a settlement SEFAZ refuses goes to a person at once, and never starves the rest of the queue", async () => {
    let crash = true;
    const { service, store, calls, later, notified } = await setup(
      {
        issue: async (call: { document: { number: number } }) => (call.document.number === 1201 ? err("REJECTED", { code: "539" }) : authorized(K2)),
        inutilize: async () => err("REJECTED", { code: "241" }),
        signContingency: async () => signed(K2),
      },
      (s) => ({
        ...s,
        saveTransition: async (prev, t) => {
          if (t.event.kind === "SUBMIT" && prev.subjectId === "sale-2" && crash) {
            crash = false;
            throw new Error("process died");
          }
          return s.saveTransition(prev, t);
        },
      }),
    );
    await service.issue(ISSUE); // 1201 rejected: its number is owed an inutilization SEFAZ will refuse (241)
    await service.issue({ ...ISSUE, subjectId: "sale-2" }).catch(() => undefined); // 1202 left PENDING by a crash
    expect((await store.listBySubject("o", "sale-2", "NFCE"))[0]!.status).toBe("PENDING");
    for (let i = 0; i < 5; i += 1) {
      later(6 * 60_000);
      await service.sweep(1); // a batch of one stands in for a queue full of refused rows
    }
    // Each refused number is tried ONCE (1201, and the crashed sale's replaced 1202), then handed to a person.
    expect(calls.filter((c) => c.method === "inutilize").map((c) => c.call["from"])).toEqual([1201, 1202]);
    const first = (await store.listBySubject("o", "sale-1", "NFCE"))[0]!;
    expect(first).toMatchObject({ attention: true, nextAttemptAt: null, statusCode: "241" });
    expect(notified.map((n) => n.type)).toContain("fiscal.document-needs-attention");
    // The crashed sale was reached, past the online tolerance, so it went offline rather than late online.
    expect(live(await store.listBySubject("o", "sale-2", "NFCE")).map((d) => d.status)).toEqual(["CONTINGENCY"]);
  });

  it("C6b a failing step backs off and moves to the end of the queue, and a person can release it", async () => {
    let fails = true;
    const { service, store, calls, later } = await setup(
      {
        issue: async (call: { document: { number: number } }) =>
          call.document.number === 1201 && fails ? err("RETRYABLE") : authorized(`3526111122233300018165001${String(call.document.number).padStart(9, "0")}1482139076`),
      },
      undefined,
      60 * 60_000,
    );
    await service.issue(ISSUE); // 1201: RETRYABLE, one failure
    await service.issue({ ...ISSUE, subjectId: "sale-2" }); // 1202: authorised at once
    const before = calls.length;
    later(6 * 60_000);
    expect((await service.sweep(10)).advanced).toEqual([]); // backed off to 10 minutes
    later(5 * 60_000);
    fails = false;
    await service.sweep(10);
    expect(calls.length).toBe(before + 1);
    expect((await store.listBySubject("o", "sale-1", "NFCE"))[0]!.status).toBe("AUTHORIZED");
  });

  it("C6c a document handed to a person waits until released, then is tried again", async () => {
    const { service, store, later } = await setup({
      issue: async () => err("CONTINGENCY", { accessKey: K1 }),
      signContingency: async () => err("AUTH", { code: "281" }),
    });
    await service.issue(ISSUE);
    const offline = (await store.listBySubject("o", "sale-1", "NFCE")).find((d) => d.seriesKind === "CONTINGENCY")!;
    expect(offline).toMatchObject({ status: "PENDING", attention: true, nextAttemptAt: null });
    later(60 * 60_000);
    expect((await service.sweep(10)).advanced).toEqual([]);
    const released = await service.release({ ownerId: "o", documentId: offline.id });
    expect(released).toMatchObject({ attention: false, failures: 0 });
    expect(released.nextAttemptAt).not.toBeNull();
  });

  it("B7 a stale online NFC-e is never re-sent past the tolerance: it goes offline", async () => {
    const { service, calls, later, docs } = await setup({
      issue: async () => err("RETRYABLE", { outcomeUnknown: true }),
      signContingency: async () => signed(K2),
    });
    await service.issue(ISSUE);
    later(20 * 60_000);
    await service.sweep(10);
    expect(calls.filter((c) => c.method === "issue")).toHaveLength(1);
    const [online, offline] = await docs();
    expect(online).toMatchObject({ status: "REPLACED", numberVoid: "LOOKUP_FIRST" });
    expect(offline).toMatchObject({ status: "CONTINGENCY", seriesKind: "CONTINGENCY" });
  });

  it("warns once when an NFC-e is 20 hours into contingency", async () => {
    const { service, later, notified } = await setup({
      issue: async () => err("CONTINGENCY", { accessKey: K1 }),
      signContingency: async () => signed(K2),
      transmit: async () => err("RETRYABLE"),
    });
    await service.issue(ISSUE);
    later(19 * 3_600_000);
    await service.transmitContingency(10);
    expect(notified.filter((n) => n.type === "fiscal.contingency-deadline")).toHaveLength(0);
    later(2 * 3_600_000);
    await service.transmitContingency(10);
    later(3_600_000);
    await service.transmitContingency(10);
    expect(notified.filter((n) => n.type === "fiscal.contingency-deadline")).toHaveLength(1);
  });
});

describe("the DANFE probes", () => {
  const authorizedXml = recorded("nfce-issue-authorized").body["authorizedXml"]!;
  const contingencyXml = recorded("nfce-sign-contingency").body["signedXml"]!;

  it("D1 every line fits the roll, 58 and 80 mm, even with a long xPag", () => {
    const longPag = authorizedXml.replace(/<tPag>(\d+)<\/tPag>/, "<tPag>99</tPag><xPag>Pagamento por carteira digital de terceiros</xPag>");
    for (const [paperWidth, cols] of [[58, 32], [80, 48]] as const) {
      const over = renderDanfeNfce({ xml: longPag, paperWidth, labels: DANFE_NFCE_PT_BR }).filter((l) => l.text.length > cols);
      expect(over.map((l) => l.text)).toEqual([]);
    }
  });

  it("D2 a contingency NFC-e reprinted after its authorisation prints its protocol, not 'Pendente de autorização'", () => {
    const proc = `<nfeProc versao="4.00">${contingencyXml}<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><chNFe>${K2}</chNFe><dhRecbto>2026-11-20T13:00:00-03:00</dhRecbto><nProt>135260000000077</nProt><cStat>100</cStat></infProt></protNFe></nfeProc>`;
    const text = renderDanfeNfce({ xml: proc, paperWidth: 80, labels: DANFE_NFCE_PT_BR }).map((l) => l.text).join("\n");
    expect(text).not.toContain("Pendente de autorização");
    expect(text).not.toContain("Via consumidor");
    expect(text).toContain("135260000000077");
  });

  it("D3 a contingency NFC-e not yet authorised prints ONE copy, the consumer's", () => {
    const text = renderDanfeNfce({ xml: contingencyXml, paperWidth: 58, labels: DANFE_NFCE_PT_BR }).map((l) => l.text).join("\n");
    expect(text.match(/Via consumidor/g)).toHaveLength(1);
    expect(text).toContain("Pendente de autorização");
  });
});
