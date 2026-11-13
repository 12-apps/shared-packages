/**
 * The review's database probes (FUT-2237, round 1) and what they generalise
 * to: every (status, numberVoid) pair the state machine can reach is a row the
 * migration's CHECKs accept, written through the package's own store.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { PGlite } from "@electric-sql/pglite";

import { computeAccessKey } from "../../helpers";
import { type DocumentInput, transition } from "../../machine";
import { createPrismaFiscalStore } from "../../sql-store";
import type { FiscalDocument } from "../../types";
import { AUTHORIZED, CANCELLED, DENIED, INUTILIZED, SALE, SIGNED, aDocument, lookedUp, sidecarError } from "../../__tests__/fixtures";
import { migratedDatabase, prismaOver, warmDatabase } from "./pglite";

/** The migration is paid here, under the hook's own timeout, never inside the first case's. */
beforeAll(warmDatabase, 60_000);

let db: PGlite | undefined;
afterEach(async () => {
  await db?.close();
  db = undefined;
});

async function storeWithPoint() {
  const opened = await migratedDatabase();
  db = opened;
  const store = createPrismaFiscalStore({ prisma: prismaOver(opened) });
  await store.createIssuingPoint(
    { id: "point-1", ownerId: "owner-1", model: "NFCE", onlineSeries: 1, contingencySeries: 2, createdAt: "2026-11-20T15:00:00.000Z" },
    "11222333000181",
    { online: 1, contingency: 1 },
  );
  return store;
}

const AT = "2026-11-20T16:00:00.000Z";

it("M1 a REPLACED row whose lookup answers DENIED is a row the migration accepts", async () => {
  const store = await storeWithPoint();
  const replaced = aDocument({ status: "REPLACED", replacedById: "doc-2", numberVoid: "LOOKUP_FIRST", accessKey: "K" });
  const { document } = transition(replaced, { kind: "LOOKUP", answer: { ...lookedUp("DENIED"), protocol: "1" } }, AT);
  expect(document.numberVoid).toBe("DENIED");
  await expect(
    store.createDocument({ ownerId: "owner-1", issuerCnpj: "11222333000181", issuingPointId: "point-1", environment: "homologacao", model: "NFCE", seriesKind: "ONLINE", series: 1 }, (number) => ({ ...document, number })),
  ).resolves.toMatchObject({ status: "REPLACED", numberVoid: "DENIED" });
});

it("M2 the schema refuses a second live document for the same subject, and draws no number for it", async () => {
  const store = await storeWithPoint();
  const request = { ownerId: "owner-1", issuerCnpj: "11222333000181", issuingPointId: "point-1", environment: "homologacao", model: "NFCE", seriesKind: "ONLINE", series: 1 } as const;
  await store.createDocument(request, (number) => aDocument({ id: "a", subjectId: "sale-1", number, accessKey: null }));
  await expect(store.createDocument(request, (number) => aDocument({ id: "b", subjectId: "sale-1", number, accessKey: null }))).rejects.toMatchObject({
    code: "SUBJECT_HAS_DOCUMENT",
  });
  const third = await store.createDocument(request, (number) => aDocument({ id: "c", subjectId: "sale-2", number, accessKey: null }));
  expect(third.number).toBe(2);
});

/** Random walks of the machine, the property suite's generator, collecting every (status, numberVoid) reached. */
function draw(seed: number, index: number): number {
  let t = (Math.imul(seed, 0x9e3779b1) + Math.imul(index + 1, 0x6d2b79f5)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const INPUTS: readonly DocumentInput[] = [
  { kind: "SUBMIT" },
  { kind: "AUTHORIZE", answer: AUTHORIZED, xmlKey: "x" },
  { kind: "DENY", answer: DENIED, xmlKey: "x" },
  { kind: "REJECT", error: sidecarError("REJECTED") },
  { kind: "RETRY", error: sidecarError("RETRYABLE", { outcomeUnknown: true }) },
  { kind: "RETRY", error: sidecarError("CONTINGENCY") },
  { kind: "SIGN_OFFLINE", answer: SIGNED, contingency: { since: "2026-11-20T12:30:00-03:00", reason: "SEFAZ fora do ar no momento" }, xmlKey: "x" },
  { kind: "REPLACE", replacedById: "doc-2" },
  { kind: "CANCEL", answer: CANCELLED, reason: "pedido cancelado pelo cliente", eventXmlKey: null },
  { kind: "LOOKUP", answer: lookedUp("NOT_FOUND") },
  { kind: "LOOKUP", answer: { ...lookedUp("AUTHORIZED"), protocol: "135260000000009" } },
  { kind: "LOOKUP", answer: lookedUp("CANCELLED") },
  { kind: "LOOKUP", answer: { ...lookedUp("DENIED"), protocol: "135260000000010" } },
  { kind: "INUTILIZE", answer: INUTILIZED, eventXmlKey: null },
  { kind: "DEFER", reason: "refused", error: sidecarError("REJECTED", { code: "241" }), attention: true },
  { kind: "RELEASE" },
  { kind: "WARN" },
  { kind: "RESIGN", answer: SIGNED, sale: SALE, totals: aDocument().totals, buyerTaxId: null, xmlKey: "y" },
];

function reachable(): Map<string, FiscalDocument> {
  const found = new Map<string, FiscalDocument>();
  for (let seed = 1; seed <= 400; seed += 1) {
    let document = aDocument({ seriesKind: draw(seed, 0) < 0.5 ? "ONLINE" : "CONTINGENCY", series: 1 });
    for (let step = 1; step <= 30; step += 1) {
      try {
        document = transition(document, INPUTS[Math.floor(draw(seed, step) * INPUTS.length)]!, AT).document;
        found.set(`${document.status}/${document.numberVoid}/${document.seriesKind}`, document);
      } catch {
        // a refused input changes nothing
      }
    }
  }
  return found;
}

describe("every (status, numberVoid) pair the machine reaches", () => {
  it("is a row the migration's CHECKs accept, written and read back through the package's store", async () => {
    const store = await storeWithPoint();
    const pairs = reachable();
    expect(pairs.size).toBeGreaterThan(12);
    let i = 0;
    for (const [pair, document] of pairs) {
      i += 1;
      const series = document.seriesKind === "ONLINE" ? 1 : 2;
      const written = await store.createDocument(
        { ownerId: "owner-1", issuerCnpj: "11222333000181", issuingPointId: "point-1", environment: "homologacao", model: "NFCE", seriesKind: document.seriesKind, series },
        (number) => ({ ...document, id: `doc-${i}`, subjectId: `sale-${i}`, series, number, accessKey: document.accessKey === null ? null : `KEY-${i}` }),
      );
      expect(await store.getDocument("owner-1", written.id), pair).toEqual(written);
    }
  });
});

describe("the access key", () => {
  it("is computed as SEFAZ writes it: the fiscal service's recorded key for the same sale", () => {
    // The recorded authorisation of nfce-simples (series 1, number 1201, cNF 48213907).
    expect(computeAccessKey({ sale: SALE, model: "NFCE", seriesKind: "ONLINE" })).toBe("35261111222333000181650010000012011482139076");
    expect(computeAccessKey({ sale: SALE, model: "NFCE", seriesKind: "CONTINGENCY" }).charAt(34)).toBe("9");
  });
});
