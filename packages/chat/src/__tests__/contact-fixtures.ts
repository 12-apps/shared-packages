import type { ContactVocabulary } from "../core/contact";

/**
 * The vocabulary a Brazilian host passes to the contact-info filter — test
 * data in the shape the reviewers probed with, not package vocabulary.
 */
export const PT_BR: ContactVocabulary = {
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
  neutralPatterns: [/\b(?:ap(?:to|artamento)?|bl(?:oco)?|conj(?:unto)?|sala|casa|torre|lote|quadra|qd|n[º°o]?)\.?\s*\d{1,5}\b/],
};
