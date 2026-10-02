import { describe, expect, it } from "vitest";

import { CONTACT_KINDS, detectContactInfo, detectContactInfoAcross, type ContactKind } from "../core/contact";
import { PT_BR } from "./contact-fixtures";

/**
 * A number or address cut across several messages. Only the chain of
 * messages that runs contiguously into the draft is read, and a kind the
 * earlier messages already carried never refuses the draft.
 */

const ALL = CONTACT_KINDS;

describe("detectContactInfoAcross", () => {
  it("refuses a number split across two messages", () => {
    expect(detectContactInfo("4321", ALL, PT_BR)).toEqual([]);
    expect(detectContactInfoAcross(["98765"], "4321", ALL, PT_BR)).toEqual(["phone"]);
  });

  it("refuses a number trickled one digit a message behind ordinary chatter", () => {
    const recent = ["Oi", "Cheguei", "Tô na portaria", "Já vou", "9", "8", "7", "6", "5", "4", "3"];
    expect(recent).toHaveLength(11);
    expect(detectContactInfoAcross(recent, "2", ALL, PT_BR)).toEqual(["phone"]);
  });

  it.each<[readonly string[], string, ContactKind]>([
    [["meu numero e 98765"], "4321", "phone"],
    [["98765,"], "4321", "phone"],
    [["(11) 98765-"], "-4321", "phone"],
    [["nove oito sete seis"], "cinco quatro tres dois", "phone"],
    [["11", "98765"], "4321", "phone"],
    [["ana", "@"], "gmail.com", "email"],
    [["ana@"], "gmail.com", "email"],
    [["ana", "@gmail"], ".com", "email"],
    [["ana arroba gmail."], "com", "email"],
    [["ana@", "gmail."], "com", "email"],
    [["meusite."], "com", "url"],
    [["meusite. "], "com.br", "url"],
    [["meusite."], "com/promo", "url"],
    [["ana arroba gmail"], "ponto com", "email"],
  ])("finds %j then %s as %s", (recent, draft, kind) => {
    expect(detectContactInfoAcross(recent, draft, ALL, PT_BR)).toContain(kind);
  });

  it("still checks the draft alone", () => {
    expect(detectContactInfoAcross([], "11987654321", ALL, PT_BR)).toEqual(["phone"]);
    expect(detectContactInfoAcross(["Ok"], "ana@gmail.com", ALL, PT_BR)).toContain("email");
  });

  it("checks only the kinds the role blocks", () => {
    expect(detectContactInfoAcross(["98765"], "4321", ["email"], PT_BR)).toEqual([]);
    expect(detectContactInfoAcross(["98765"], "4321", [], PT_BR)).toEqual([]);
  });

  it.each<[readonly string[], string]>([
    [["Apto 1204"], "Chego 19:30"],
    [["Cheguei"], "1204"],
    [["Bloco B apto 34", "Número 1520, casa dos fundos", "Chego em 5 min"], "Valor deu 25,90"],
    [["Estou na esquina da rua 7 com a 12"], "Portão azul ao lado do 230"],
    [["Av Paulista, 1578"], "apto 1204"],
    [["98765"], "Cheguei, pode descer"],
    [["Cheguei."], "Com certeza, já desço"],
    [["Estou no ponto."], "Com a moto"],
    [["Apto 1204."], "Com interfone quebrado"],
  ])("lets %j then %s through", (recent, draft) => {
    expect(detectContactInfoAcross(recent, draft, ALL, PT_BR)).toEqual([]);
  });

  it("reads only the chain that runs into the draft: a message ending in a letter cuts it", () => {
    expect(detectContactInfoAcross(["987654", "3"], "2", ALL, PT_BR)).toEqual(["phone"]);
    expect(detectContactInfoAcross(["987654", "Oi", "3"], "2", ALL, PT_BR)).toEqual([]);
  });

  it("does not let something already sent poison an innocent draft", () => {
    expect(detectContactInfoAcross(["ana@gmail.com", "11987654321"], "Cheguei.", ALL, PT_BR)).toEqual([]);
  });
});

describe("contact scanners on long input", () => {
  const long = 20_000;

  it.each<[string, string]>([
    ["dotted labels", "a.".repeat(long / 2)],
    ["one long word", "a".repeat(long)],
    ["spaces", ` ${" ".repeat(long)}x`],
    ["e-mail with no top-level domain", `ana@${"b.".repeat(long / 2)}`],
    ["spaced e-mail parts", "a @ ".repeat(long / 4)],
    ["brackets and spaces", `${" ".repeat(long)}(`],
    ["at signs and spaces", "@ ".repeat(long / 2)],
    ["single letters", "a ".repeat(long / 2)],
    ["digits and letters", "1a".repeat(long / 2)],
    ["clock times", "12:30 ".repeat(long / 6)],
    ["bidi overrides", "\u202Eab".repeat(long / 3)],
    ["currency after digits", "1$1 ".repeat(long / 4)],
    ["address units", "apto 1 ".repeat(long / 7)],
    ["glued at signs", "a@".repeat(long / 2)],
    ["dot look-alikes", "a\u3002".repeat(long / 2)],
    ["long paths", "a.bc/".repeat(long / 5)],
  ])("finishes on 20k characters of %s", (_shape, text) => {
    expect(Array.isArray(detectContactInfo(text, ALL, PT_BR))).toBe(true);
    expect(Array.isArray(detectContactInfoAcross([text, text], text, ALL, PT_BR))).toBe(true);
  });
});
