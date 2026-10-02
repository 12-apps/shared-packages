import { describe, expect, it } from "vitest";

import {
  CONTACT_KINDS,
  detectContactInfo,
  detectContactInfoAcross,
  type ContactKind,
  type ContactVocabulary,
} from "../core/contact";

/**
 * The contact-info filter: a role it binds must not pass a way to be reached
 * outside the thread, however the number or address is dressed up. Generic
 * patterns here; the host's words (spelled digits, app names) widen them.
 */

const ALL = CONTACT_KINDS;

/** A host's dodge-words, as a host would pass them — data for the test, not package vocabulary. */
const VOCABULARY: ContactVocabulary = {
  numberWords: { zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9" },
  atWords: ["at"],
  dotWords: ["dot"],
  extraPatterns: [/\bwhats ?app\b/, /\binsta(gram)?\b/],
};

/** The vocabulary a Brazilian host passes — the shape the reviewer probed with. */
const PT_BR: ContactVocabulary = {
  numberWords: {
    zero: "0",
    um: "1",
    dois: "2",
    "três": "3",
    quatro: "4",
    cinco: "5",
    seis: "6",
    sete: "7",
    oito: "8",
    nove: "9",
    meia: "6",
  },
  atWords: ["arroba"],
  dotWords: ["ponto", "dot"],
  extraPatterns: [
    /\bwhats\b/,
    /\bwpp\b/,
    /\bzap\b/,
    /\binsta\b/,
    /\bface\b/,
    /\btik ?tok\b/,
    /\btelegram\b/,
    /\bmeu numero\b/,
    /\bme liga\b/,
  ],
};

const keycaps = (digits: string): string => [...digits].map((digit) => `${digit}️⃣`).join("");

describe("detectContactInfo", () => {
  it.each([
    ["call me 11987654321", "phone"],
    ["(11) 98765-4321", "phone"],
    ["1 1 9 8 7 6 5 4 3 2 1", "phone"],
    ["+55 11 9.8765.4321", "phone"],
    ["me at ana.souza@example.com", "email"],
    ["ana.souza @ example . com", "email"],
    ["see https://example.com/x", "url"],
    ["www.example.org", "url"],
    ["example.com.br/promo", "url"],
    ["follow @ana_souza", "handle"],
  ])("finds %s as %s", (text, kind) => {
    expect(detectContactInfo(text, ALL)).toContain(kind);
  });

  it.each([
    "I am at the door",
    "Two minutes away",
    "Gate 12, block B, apartment 302",
    "Change for 50.00 please",
    "Your total is 37.90",
    "OK, thanks!",
  ])("lets an ordinary line through: %s", (text) => {
    expect(detectContactInfo(text, ALL)).toEqual([]);
  });

  it("checks only the kinds the role blocks", () => {
    expect(detectContactInfo("11987654321", ["email"])).toEqual([]);
    expect(detectContactInfo("anything at all", [])).toEqual([]);
  });

  it("reads the host's words: spelled digits, words for @ and ., app names", () => {
    expect(detectContactInfo("one one nine eight seven six five four three two", ["phone"], VOCABULARY)).toEqual(["phone"]);
    expect(detectContactInfo("ana at example dot com", ["email"], VOCABULARY)).toEqual(["email"]);
    expect(detectContactInfo("add me on WhatsApp", ["handle"], VOCABULARY)).toEqual(["handle"]);
    expect(detectContactInfo("my INSTA is cool", ["handle"], VOCABULARY)).toEqual(["handle"]);
  });

  it("ignores accents and case when folding the host's words", () => {
    const accented: ContactVocabulary = { numberWords: { "nóve": "9" } };
    expect(detectContactInfo("NOVE nove nove nove nove nove nove nove", ["phone"], accented)).toEqual(["phone"]);
  });
});

describe("detectContactInfo — dressed-up contact info is still found", () => {
  it.each<[string, ContactKind]>([
    // Unicode digits and invisible tricks
    ["９８７６５４３２１０", "phone"],
    ["𝟗𝟖𝟕𝟔𝟓𝟒𝟑𝟐", "phone"],
    ["١٢٣٤٥٦٧٨٩", "phone"],
    ["9​8​7​6​5​4​3​2​1", "phone"],
    ["9⁠8­7‍6﻿5‌4​3​2", "phone"],
    [keycaps("98765432"), "phone"],
    ["9⃣8⃣7⃣6⃣5⃣4⃣3⃣2⃣", "phone"],
    // Separators and words between the groups
    ["9,8,7,6,5,4,3,2", "phone"],
    ["9;8;7;6;5;4;3;2", "phone"],
    ["9|8|7|6|5|4|3|2", "phone"],
    ["9 , 8 , 7 , 6 , 5 , 4 , 3 , 2", "phone"],
    ["meu numero 98765 e 4321", "phone"],
    ["11 9 8765 e 4321", "phone"],
    ["9a8b7c6d5e4f3g2h1i", "phone"],
    // Landline (8) and mobile (9 / 11 with DDD) in assorted spacing
    ["3456-7890", "phone"],
    ["3 4 5 6 7 8 9 0", "phone"],
    ["11 98765 4321", "phone"],
    ["(11)98765-4321", "phone"],
    ["liga 3456.7890 depois das 6", "phone"],
    // Number words glued, shouted, comma-separated, with the host's slang digit
    ["noveoitoseteseiscincoquatrotresdois", "phone"],
    ["NOVEOITOSETESEISCINCOQUATROTRESDOIS", "phone"],
    ["nove, oito, sete, seis, cinco, quatro, três, dois", "phone"],
    ["nove-oito-sete-seis-cinco-quatro-tres-dois", "phone"],
    ["onze nove meia meia meia sete um dois tres quatro", "phone"],
    ["nove8sete6cinco4tres2", "phone"],
    // A CEP is eight digits too: refusing it is the accepted cost
    ["01310-100", "phone"],
    // E-mail behind brackets, full-width symbols, the host's words
    ["ana(at)gmail(dot)com", "email"],
    ["ana＠gmail．com", "email"],
    ["ana [at] gmail [dot] com", "email"],
    ["ana {at} gmail {dot} com", "email"],
    ["ana arroba gmail ponto com", "email"],
    ["ana (arroba) gmail (ponto) com", "email"],
    ["ANA@GMAIL.COM", "email"],
    ["ana@empresa.de", "email"],
    // Handles
    ["ig:@ana_s", "handle"],
    ["@ ana_souza", "handle"],
    ["@ana", "handle"],
    ["@al me segue", "handle"],
    ["(@ana.souza)", "handle"],
    // Links with one-letter labels, paths, spelled dots
    ["t.me/ana", "url"],
    ["wa.me/5511987654321", "url"],
    ["anasouza ponto com", "url"],
    ["instagram.com/ana", "url"],
    ["ｔ．ｍｅ/ana", "url"],
  ])("finds %s as %s", (text, kind) => {
    expect(detectContactInfo(text, ALL, PT_BR)).toContain(kind);
  });
});

describe("detectContactInfo — an ordinary line at the door goes through", () => {
  it.each([
    "Cheguei. Tô aqui embaixo",
    "Estou chegando. Me espere na portaria",
    "Ok. Já vou",
    "I am here. On my way",
    "Estou no ponto de ônibus",
    "Estou no ponto com a moto",
    "Pode descer, por favor?",
    "Estou na esquina da rua 7 com a 12",
    "Bloco B apto 34",
    "Número 1520, casa dos fundos",
    "Chego em 5 min",
    "Valor deu 25,90",
    "São 3 sacolas",
    "Portão azul ao lado do 230",
    "Rua 25 de Março 1520, apto 34",
    "Troco para 100, total 37,90",
    "Troco para 100,00, total 37,90",
    "Chego dia nove de novembro",
    "Dezesseis sacolas, seiscentos gramas, setembro",
    "Biscoito e meia dúzia de ovos",
    "Algum problema? Nenhum, obrigado",
    "Chego em um minuto",
    "Estou @ 10h na porta",
    "Cheguei.",
    "",
  ])("lets %s through", (text) => {
    expect(detectContactInfo(text, ALL, PT_BR)).toEqual([]);
  });
});

describe("detectContactInfo — the host's extra patterns", () => {
  it("keeps the host's flags, adding case-insensitivity", () => {
    const vocabulary: ContactVocabulary = { extraPatterns: [/\bwhats\p{L}+/u] };
    expect(detectContactInfo("Chama no WhatsApp", ["handle"], vocabulary)).toEqual(["handle"]);
  });

  it("is stable across calls when the host passes a global pattern", () => {
    const vocabulary: ContactVocabulary = { extraPatterns: [/\bzap\b/g] };
    expect(detectContactInfo("me chama no zap", ["handle"], vocabulary)).toEqual(["handle"]);
    expect(detectContactInfo("me chama no zap", ["handle"], vocabulary)).toEqual(["handle"]);
    expect(detectContactInfo("me chama no zap", ["handle"], vocabulary)).toEqual(["handle"]);
  });

  it("matches an accented host pattern on the raw text and a plain one on the folded text", () => {
    const accented: ContactVocabulary = { extraPatterns: [/\bmeu número\b/] };
    const plain: ContactVocabulary = { extraPatterns: [/\bmeu numero\b/] };
    expect(detectContactInfo("Meu número é esse", ["handle"], accented)).toEqual(["handle"]);
    expect(detectContactInfo("Meu número é esse", ["handle"], plain)).toEqual(["handle"]);
    expect(detectContactInfo("ｗｈａｔｓ", ["handle"], { extraPatterns: [/whats/] })).toEqual(["handle"]);
  });
});

describe("detectContactInfoAcross", () => {
  it("refuses a number split across two messages", () => {
    expect(detectContactInfo("4321", ALL, PT_BR)).toEqual([]);
    expect(detectContactInfoAcross(["98765"], "4321", ALL, PT_BR)).toEqual(["phone"]);
  });

  it.each<[readonly string[], string, ContactKind]>([
    [["meu numero 98765"], "e 4321", "phone"],
    [["nove oito sete seis"], "cinco quatro tres dois", "phone"],
    [["11", "98765"], "4321", "phone"],
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
  });

  it("lets a run of ordinary address lines through", () => {
    const recent = ["Bloco B apto 34", "Número 1520, casa dos fundos", "Chego em 5 min"];
    expect(detectContactInfoAcross(recent, "Valor deu 25,90", ALL, PT_BR)).toEqual([]);
    expect(detectContactInfoAcross(["Estou na esquina da rua 7 com a 12"], "Portão azul ao lado do 230", ALL, PT_BR)).toEqual([]);
  });

  it("does not let something already sent poison an innocent draft", () => {
    expect(detectContactInfoAcross(["ana@gmail.com", "11987654321"], "Cheguei.", ALL, PT_BR)).toEqual([]);
  });
});
