import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { DANFE_NFCE_EN_US } from "../en-US";
import { DANFE_NFCE_PT_BR } from "../pt-BR";
import { DANFE_COLUMNS, type DanfeLine, money, renderDanfeNfce, wrap } from "../render";
import nfceIssueAuthorized from "../../issuer/__tests__/fixtures/sidecar/nfce-issue-authorized.json";
import nfceSignContingency from "../../issuer/__tests__/fixtures/sidecar/nfce-sign-contingency.json";

/** The fiscal service's own recorded answers: an authorised NFC-e, and one signed offline. */
const body = (recorded: unknown) => (recorded as { body: Record<string, string> }).body;
const AUTHORIZED = body(nfceIssueAuthorized)["authorizedXml"]!;
const OFFLINE = body(nfceSignContingency)["signedXml"]!;
/** The authorised XML re-labelled as an NF-e (model 55). */
const asModel55 = (xml: string) => xml.replace("<mod>65</mod>", "<mod>55</mod>");

const texts = (lines: readonly DanfeLine[]) => lines.map((line) => line.text);
const DIVISIONS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"];

describe("the DANFE NFC-e", () => {
  it.each([58, 80] as const)("lays the full DANFE out on %i mm in the Manual's divisions, in order", (paperWidth) => {
    const rendered = renderDanfeNfce({ xml: AUTHORIZED, paperWidth, labels: DANFE_NFCE_PT_BR });
    const order = rendered.map((line) => DIVISIONS.indexOf(line.division));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(new Set(rendered.map((line) => line.division))).toEqual(new Set(DIVISIONS));
    for (const line of rendered) expect(line.text.length, line.text).toBeLessThanOrEqual(DANFE_COLUMNS[paperWidth]);
  });

  it("prints the issuer, every item, the totals, the key, the protocol and the QR code", () => {
    const lines = renderDanfeNfce({ xml: AUTHORIZED, paperWidth: 80, labels: DANFE_NFCE_PT_BR });
    const all = texts(lines).join(" ");
    expect(all).toContain("EXAMPLE FOODS LTDA");
    expect(all).toContain("CNPJ 11222333000181 IE 123456789012");
    expect(all).toContain("SKU-2 Orange juice");
    expect(all).toMatch(/2 UN x 19,95 +39,90/);
    expect(all).toMatch(/Qtde. total de itens +2/);
    expect(all).toContain("EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO - SEM VALOR FISCAL");
    expect(all).toContain("3526 1111 2223 3300 0181 6500 1000 0012 0114 8213 9076");
    expect(all).toContain("CONSUMIDOR NÃO IDENTIFICADO");
    expect(all).toMatch(/NFC-e nº 1201 Série 1 2026-11-20 12:30:00/);
    expect(all).toMatch(/Protocolo de autorização: 135260000123456/);
    expect(all).not.toContain("EMITIDA EM CONTINGÊNCIA");
    const qr = lines.find((line) => line.qrCode !== undefined);
    expect(qr?.division).toBe("VIII");
    expect(qr?.qrCode).toMatch(/^https?:\/\//);
  });

  it("prints the contingency variant for a document signed offline: the notice, no protocol", () => {
    const all = texts(renderDanfeNfce({ xml: OFFLINE, paperWidth: 58, labels: DANFE_NFCE_PT_BR })).join(" ");
    expect(all).toContain("EMITIDA EM CONTINGÊNCIA");
    expect(all).toContain("Pendente de autorização");
    expect(all).not.toContain("Protocolo de autorização");
  });

  it("takes every word from the host: a missing label is refused, other words are printed", () => {
    const partial = Object.fromEntries(Object.entries(DANFE_NFCE_PT_BR).filter(([key]) => key !== "qrCaption"));
    expect(() => renderDanfeNfce({ xml: AUTHORIZED, paperWidth: 58, labels: partial as never })).toThrow(/qrCaption/);
    const english = Object.fromEntries(Object.entries(DANFE_NFCE_PT_BR).map(([key, value]) => [key, typeof value === "string" ? `EN ${key}` : value]));
    const all = texts(renderDanfeNfce({ xml: AUTHORIZED, paperWidth: 80, labels: english as never })).join("\n");
    expect(all).toContain("EN title");
    expect(all).not.toContain("Documento Auxiliar");
  });

  it("ships both packs with every label, the same payment codes in each", () => {
    expect(Object.keys(DANFE_NFCE_EN_US).sort()).toEqual(Object.keys(DANFE_NFCE_PT_BR).sort());
    expect(Object.keys(DANFE_NFCE_EN_US.paymentMethods)).toEqual(Object.keys(DANFE_NFCE_PT_BR.paymentMethods));
    expect(texts(renderDanfeNfce({ xml: AUTHORIZED, paperWidth: 80, labels: DANFE_NFCE_EN_US })).join(" ")).toContain("UNIDENTIFIED CONSUMER");
  });

  it("refuses an XML that is not an NFC-e", () => {
    expect(() => renderDanfeNfce({ xml: "<nfeProc/>", paperWidth: 58, labels: DANFE_NFCE_PT_BR })).toThrow(/not an NF-e/);
    expect(() => renderDanfeNfce({ xml: asModel55(AUTHORIZED), paperWidth: 58, labels: DANFE_NFCE_PT_BR })).toThrow(/model 65/);
  });

  it("formats money in reais and wraps on spaces", () => {
    expect([money("0.5"), money("1234.56"), money("1000000"), money(null)]).toEqual(["0,50", "1.234,56", "1.000.000,00", "0,00"]);
    expect(wrap("NOTA FISCAL EMITIDA EM AMBIENTE", 12)).toEqual(["NOTA FISCAL", "EMITIDA EM", "AMBIENTE"]);
    expect(wrap("see https://example.test/abcdefghij", 10)).toEqual(["see", "https://ex", "ample.test", "/abcdefghi", "j"]);
  });
});

/** The modules `./danfe` reaches outside its own folder, read once when the file loads. */
const DANFE_REACHES = (() => {
  const root = join(import.meta.dirname, "..");
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    // eslint-disable-next-line test-flakiness/no-unmocked-fs -- reads this package's own source, read-only, once at load
    for (const match of readFileSync(file, "utf8").matchAll(/^(?:import|export)[^;]*?from "(\.[^"]+)"/gms)) {
      visit(join(dirname(file), `${match[1]}.ts`));
    }
  };
  visit(join(root, "index.ts"));
  return [...seen].map((file) => relative(join(root, ".."), file)).filter((file) => !file.startsWith("danfe/"));
})();

describe("the DANFE of a note a register signed offline (FUT-4717)", () => {
  it("frames the contingency notice in a box when asked, with the key and the QR code the CSC built", () => {
    const lines = renderDanfeNfce({ xml: OFFLINE, paperWidth: 80, labels: DANFE_NFCE_PT_BR, contingencyBox: true });
    const notice = lines.filter((line) => line.division === "V").map((line) => line.text);
    const box = "=".repeat(DANFE_COLUMNS[80]);
    expect(notice.slice(notice.indexOf(box), notice.lastIndexOf(box) + 1)).toEqual([
      box, "EMITIDA EM CONTINGÊNCIA", "Pendente de autorização", "Via consumidor", box,
    ]);
    const qr = lines.find((line) => line.qrCode !== undefined);
    expect(qr?.qrCode).toContain("35261111222333000181650010000012019482139071");
    expect(texts(lines).join(" ")).toContain("3526 1111 2223 3300 0181 6500 1000 0012 0194 8213 9071");
  });

  it("prints no box unless asked, and none on a note already authorised", () => {
    const plain = texts(renderDanfeNfce({ xml: OFFLINE, paperWidth: 58, labels: DANFE_NFCE_PT_BR }));
    expect(plain.some((text) => text.startsWith("==="))).toBe(false);
    const authorised = texts(renderDanfeNfce({ xml: AUTHORIZED, paperWidth: 58, labels: DANFE_NFCE_PT_BR, contingencyBox: true }));
    expect(authorised.some((text) => text.startsWith("==="))).toBe(false);
  });

  it("reaches no database, store or network module: the danfe entry imports only itself and the error type", () => {
    expect(DANFE_REACHES).toEqual(["documents/errors.ts"]);
  });
});
