/**
 * The `nfeProc` — what an authorised document is stored as — assembled from
 * the signed XML the service built and the `protNFe` a lookup answered, for a
 * document whose sending went unanswered and was then found authorised.
 */

import { element } from "../danfe/xml";

const PROTOCOL = /<protNFe\b[^>]*>[\s\S]*?<\/protNFe>/;
const NFE = /<NFe\b[^>]*>[\s\S]*<\/NFe>/;
/** The `cStat`s of a protocol that authorises (100, 150 late) or denies (110, 301–303) the use of the key. */
const SETTLING = new Set(["100", "150", "110", "301", "302", "303"]);

/**
 * `null` unless the reply carries a protocol for exactly this key with a
 * settling status, and the signed XML is the document's: never a guess.
 */
export function assembleNfeProc(input: { readonly signedXml: string; readonly sefazReply: string; readonly accessKey: string }): string | null {
  const protocol = PROTOCOL.exec(input.sefazReply)?.[0];
  const nfe = NFE.exec(input.signedXml)?.[0];
  if (protocol === undefined || nfe === undefined) return null;
  const infProt = element(protocol, "infProt");
  if (infProt === null || element(infProt, "chNFe") !== input.accessKey) return null;
  if (!SETTLING.has(element(infProt, "cStat") ?? "")) return null;
  if (!nfe.includes(`Id="NFe${input.accessKey}"`)) return null;
  return `<?xml version="1.0" encoding="UTF-8"?><nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">${nfe}${protocol}</nfeProc>`;
}
