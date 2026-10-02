import { describe, expect, it } from "vitest";

import { CONTACT_KINDS, detectContactInfo, type ContactKind, type ContactVocabulary } from "../core/contact";
import { PT_BR } from "./contact-fixtures";

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

const keycaps = (digits: string): string => [...digits].map((digit) => `${digit}\uFE0F\u20E3`).join("");

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
    ["9\u200B8\u200B7\u200B6\u200B5\u200B4\u200B3\u200B2\u200B1", "phone"],
    ["9\u20608\u00AD7\u200D6\uFEFF5\u200C4\u200B3\u200B2", "phone"],
    [keycaps("98765432"), "phone"],
    ["9\u20E38\u20E37\u20E36\u20E35\u20E34\u20E33\u20E32\u20E3", "phone"],
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

describe("detectContactInfo — address, money and time lines carry numbers that are not a phone", () => {
  it.each([
    "Av Paulista, 1578, apto 1204",
    "Estou na Rua Augusta 1520 apto 1204",
    "Rua das Flores, 1234, apto 1204",
    "Alameda Santos 1234 conj 1204",
    "R$ 25,00 + R$ 12,50",
    "R$ 1.250,00 e R$ 1.300,00",
    "Chego 19:30 ou 19:50",
    "são 12:30, chego 12:45 ou 13:00",
    "Apto 1204 e 1205 não atendem",
    "Chego 19h30, apto 1204",
    "nº 1520, bloco 3, apto 1204",
  ])("lets %s through", (text) => {
    expect(detectContactInfo(text, ALL, PT_BR)).toEqual([]);
  });

  it.each([
    "R$ 9876 5432",
    "apto 98765 4321",
    "19:30 98765 4321",
    "R$ 98765432",
    "apto 987654321",
  ])("does not let a neutral span swallow a phone: %s", (text) => {
    expect(detectContactInfo(text, ALL, PT_BR)).toContain("phone");
  });

  it("refuses money with no currency symbol (accepted cost)", () => {
    expect(detectContactInfo("total 100,00 + 37,90", ["phone"], PT_BR)).toEqual(["phone"]);
  });

  it("ignores neutral patterns when the host passes none", () => {
    expect(detectContactInfo("Av Paulista, 1578, apto 1204", ["phone"])).toEqual(["phone"]);
  });
});

describe("detectContactInfo — bidi overrides, look-alike letters, spaced letters", () => {
  it("reads a right-to-left override in display order", () => {
    expect(detectContactInfo("\u202Emoc.liamg@ana", ALL, PT_BR)).toContain("email");
    expect(detectContactInfo("\u202Epaz", ["handle"], { extraPatterns: [/zap/] })).toEqual(["handle"]);
    expect(detectContactInfo("oi \u2067moc.liamg@ana\u2069 tchau", ["email"], PT_BR)).toEqual(["email"]);
  });

  it.each(["\u202ECheguei. Tô aqui", "\u202Eapto 1204\u202C, chego 19:30", "\u2067Ok\u2069 já vou"])(
    "adds no refusal for an ordinary line under an override: %s",
    (text) => {
      expect(detectContactInfo(text, ALL, PT_BR)).toEqual([]);
    },
  );

  it("folds Cyrillic and Greek look-alikes to Latin", () => {
    expect(detectContactInfo("ana@gmail.cоm", ["email"], PT_BR)).toEqual(["email"]);
    expect(detectContactInfo("whаts", ["handle"], { extraPatterns: [/whats/] })).toEqual(["handle"]);
    expect(detectContactInfo("ΙNSTA", ["handle"], PT_BR)).toEqual(["handle"]);
  });

  it.each(["w h a t s", "w.h.a.t.s", "z-a-p", "me chama no z . a . p"])("joins single letters for the host's patterns: %s", (text) => {
    expect(detectContactInfo(text, ALL, PT_BR)).toEqual(["handle"]);
  });

  it.each(["faz a pizza", "e a casa", "Vou a pé e já volto"])("does not join ordinary words: %s", (text) => {
    expect(detectContactInfo(text, ALL, PT_BR)).toEqual([]);
  });
});

describe("detectContactInfo — a neutral span still counts as one digit", () => {
  it.each(["(11) 98765-$4321", "11 98765 $4321", "1198765$4321", "9876543$2", "119876$54321", "11 98765 £4321", "11 98765 € 4321"])(
    "refuses %s with no host vocabulary",
    (text) => {
      expect(detectContactInfo(text, ALL)).toContain("phone");
    },
  );

  it.each(["98765 ap 4321", "11 98765 apto 4321", "(11) 98765 casa 4321", "11 98765 e R$ 4321"])(
    "refuses %s with the host's address units",
    (text) => {
      expect(detectContactInfo(text, ALL, PT_BR)).toContain("phone");
    },
  );

  it.each([
    "Rua A, 1234 apto 5678",
    "R$ 25,00 + R$ 12,50",
    "Rua 7, 77, ap 7 bl 7 casa 7",
    "Rua 7 de Setembro, 1234 ap 56",
    "Bloco 3 apto 1204, interfone 1204",
    "Condomínio X, casa 12, rua 3",
    "troco pra 50",
    "deu 37,90, tem troco pra 100?",
    "entre 19h e 19h30",
    "hoje 02/10",
    "2 pizzas e 3 refris",
  ])("lets %s through", (text) => {
    expect(detectContactInfo(text, ALL, PT_BR)).toEqual([]);
  });
});

describe("detectContactInfo — e-mail with no top-level domain or a look-alike dot", () => {
  it.each([
    "ana@gmail",
    "ana@gmail com",
    "ana@gmail,com",
    "ana@gmail\u3002com",
    "ana@gmail\uFF61com",
    "ana@gmail\u00B7com",
    "ana@gmail\u2027com",
    "ana@gmail\u2219com",
    "ana@gmail\u2022com",
    "ana@gmail\uA4F8com",
    "ana@gmail\u0589com",
    "ana@gmail\u06D4com",
    "ana@gmail..com",
    "ana(at)gmail",
    "ana (arroba) gmail",
    "ana@gmail.",
  ])("finds %s as email", (text) => {
    expect(detectContactInfo(text, ALL, PT_BR)).toContain("email");
  });

  it.each(["www\u3002site\u3002com", "site\u3002com", "site\uFF61com"])("finds %s as url", (text) => {
    expect(detectContactInfo(text, ALL, PT_BR)).toContain("url");
  });

  it("keeps the spaced forms as they were", () => {
    expect(detectContactInfo("Estou @ 10h na porta", ALL, PT_BR)).toEqual([]);
    expect(detectContactInfo("I am at the door", ALL, VOCABULARY)).toEqual([]);
    expect(detectContactInfo("Chego 25@10h", ALL, PT_BR)).toEqual([]);
    expect(detectContactInfo("cheguei, estou aqui @ portaria", ALL, PT_BR)).toEqual(["handle"]);
  });
});

describe("detectContactInfo — letters on separate lines, short links", () => {
  it.each(["z\na\np", "w\nh\na\nt\ns", "z\n.\na\n.\np"])("joins single letters across lines: %j", (text) => {
    expect(detectContactInfo(text, ALL, PT_BR)).toEqual(["handle"]);
  });

  it.each(["e\na\ncasa", "Pode ser\na\ne\nb", "Ok\nJá vou\nA casa é a azul"])("leaves ordinary lines alone: %j", (text) => {
    expect(detectContactInfo(text, ALL, PT_BR)).toEqual([]);
  });

  it.each(["linktr.ee/ana", "goo.gl/x", "youtu.be/x", "bit.do/x", "lnkd.in/x", "instagr.am/ana", "qualquer.coisa/abc"])(
    "finds %s as url",
    (text) => {
      expect(detectContactInfo(text, ALL, PT_BR)).toContain("url");
    },
  );

  it.each(["Ok/3x", "S.Paulo/SP", "Av. Brasil/SP", "1/2 pizza", "e/ou", "Centro/SP", "Moro em Sto.Andre/SP"])(
    "lets %s through",
    (text) => {
      expect(detectContactInfo(text, ALL, PT_BR)).toEqual([]);
    },
  );
});
