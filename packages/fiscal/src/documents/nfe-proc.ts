/**
 * The `nfeProc` — what an authorised document is stored as — assembled from
 * the signed XML the service built and the `protNFe` a lookup answered, for a
 * document whose sending went unanswered and was then found authorised.
 */

import { element } from "../danfe/xml";

const PROTOCOL = /<protNFe\b[^>]*>[\s\S]*?<\/protNFe>/;
const NFE = /<NFe\b[^>]*>[\s\S]*<\/NFe>/;
/** The signed XML's own digest (`DigestValue`), which SEFAZ quotes back as the protocol's `digVal`. */
export function digestOf(signedXml: string): string | null {
  return /<DigestValue>([^<]+)<\/DigestValue>/.exec(signedXml)?.[1]?.trim() ?? null;
}

/** The protocol a SEFAZ reply carries, with its `digVal`, or `null`. */
export function protocolDigestOf(sefazReply: string): string | null {
  const protocol = PROTOCOL.exec(sefazReply)?.[0];
  const infProt = protocol === undefined ? null : element(protocol, "infProt");
  return infProt === null ? null : (element(infProt, "digVal")?.trim() ?? null);
}

/** The `cStat`s of a protocol that authorises (100, 150 late) or denies (110, 301–303) the use of the key. */
const SETTLING = new Set(["100", "150", "110", "301", "302", "303"]);

/**
 * `null` unless the reply carries a protocol for exactly this key with a
 * settling status, the signed XML is the document's, AND the protocol's
 * `digVal` is that XML's `DigestValue` — the protocol certifies THAT XML and
 * no other built under the same key (the fiscal service's own `issued()`
 * refuses the same mismatch). Never a guess.
 */
/** Whether this protocol certifies this signed XML under this key, with a settling status. */
function certifies(infProt: string, nfe: string, accessKey: string): boolean {
  const digest = digestOf(nfe);
  return (
    element(infProt, "chNFe") === accessKey &&
    SETTLING.has(element(infProt, "cStat") ?? "") &&
    nfe.includes(`Id="NFe${accessKey}"`) &&
    digest !== null &&
    element(infProt, "digVal")?.trim() === digest
  );
}

export function assembleNfeProc(input: { readonly signedXml: string; readonly sefazReply: string; readonly accessKey: string }): string | null {
  const protocol = PROTOCOL.exec(input.sefazReply)?.[0];
  const nfe = NFE.exec(input.signedXml)?.[0];
  const infProt = protocol === undefined ? null : element(protocol, "infProt");
  if (protocol === undefined || nfe === undefined || infProt === null || !certifies(infProt, nfe, input.accessKey)) return null;
  return `<?xml version="1.0" encoding="UTF-8"?><nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">${nfe}${protocol}</nfeProc>`;
}
