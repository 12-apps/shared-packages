import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DANFE_NFCE_EN_US } from "../en-US";
import { DANFE_NFCE_PT_BR } from "../pt-BR";
import { DANFE_COLUMNS, type DanfeLine, money, renderDanfeNfce, wrap } from "../render";

/** The fiscal service's own recorded answers: an authorised NFC-e, and one signed offline. */
const RECORDED = join(import.meta.dirname, "../../issuer/__tests__/fixtures/sidecar");
const body = (name: string) => (JSON.parse(readFileSync(join(RECORDED, `${name}.json`), "utf8")) as { body: Record<string, string> }).body;
const AUTHORIZED = body("nfce-issue-authorized")["authorizedXml"]!;
const OFFLINE = body("nfce-sign-contingency")["signedXml"]!;

const texts = (lines: readonly DanfeLine[]) => lines.map((line) => line.text);
const DIVISIONS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"];

describe("the DANFE NFC-e", () => {
  it.each([58, 80] as const)("lays the full DANFE out on %i mm in the Manual's divisions, in order", (paperWidth) => {
    const lines = renderDanfeNfce({ xml: AUTHORIZED, paperWidth, labels: DANFE_NFCE_PT_BR });
    const order = lines.map((line) => DIVISIONS.indexOf(line.division));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(new Set(lines.map((line) => line.division))).toEqual(new Set(DIVISIONS));
    for (const line of lines) expect(line.text.length, line.text).toBeLessThanOrEqual(DANFE_COLUMNS[paperWidth]);
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
    expect(() => renderDanfeNfce({ xml: AUTHORIZED.replace("<mod>65</mod>", "<mod>55</mod>"), paperWidth: 58, labels: DANFE_NFCE_PT_BR })).toThrow(/model 65/);
  });

  it("formats money in reais and wraps on spaces", () => {
    expect([money("0.5"), money("1234.56"), money("1000000"), money(null)]).toEqual(["0,50", "1.234,56", "1.000.000,00", "0,00"]);
    expect(wrap("NOTA FISCAL EMITIDA EM AMBIENTE", 12)).toEqual(["NOTA FISCAL", "EMITIDA EM", "AMBIENTE"]);
    expect(wrap("see https://example.test/abcdefghij", 10)).toEqual(["see", "https://ex", "ample.test", "/abcdefghi", "j"]);
  });
});
