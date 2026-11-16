/**
 * The words that opt a contact out, by default: the Portuguese and English
 * stop words a WhatsApp user is told to send. A host replaces the list through
 * the adapter's config.
 */
export const DEFAULT_OPT_OUT_KEYWORDS: readonly string[] = ["PARAR", "SAIR", "STOP", "CANCELAR"];

/** Upper case, accents stripped, surrounding space, punctuation and emoji trimmed. */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    .toUpperCase();
}

/**
 * Is this text an opt-out? Only when the WHOLE message is one keyword —
 * case- and accent-insensitive, ignoring punctuation and emoji around it — so
 * "parar", "PARAR." and "Parar!" opt out, and "parar de enviar" (a sentence,
 * maybe about something else) does not.
 */
export function isOptOutText(text: string, keywords: readonly string[] = DEFAULT_OPT_OUT_KEYWORDS): boolean {
  const folded = fold(text);
  return folded.length > 0 && keywords.some((keyword) => fold(keyword) === folded);
}
