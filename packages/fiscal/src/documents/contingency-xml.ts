/**
 * Reading an NFC-e a holder signed offline (`tpEmis = 9`, no `nfeProc`) for
 * `recordSigned`: the fields the document record keeps, each read from the
 * XML, and every reason to refuse it. The XML is the fiscal service's own
 * layout, so the DANFE's reader (`../danfe/xml`) reads it.
 *
 * The access key is checked against the fields it encodes, not only its
 * check digit: a key whose number or series disagrees with `ide` would let a
 * holder record a number outside its block under a key inside it.
 */

import type { SefazEnvironment } from "../sidecar/types";
import { accessKeyOf, element, text } from "../danfe/xml";
import { FiscalDocumentError } from "./errors";
import { isValidAccessKey } from "./helpers";

/** What a station-signed NFC-e says about itself. */
export interface SignedContingencyNote {
  readonly accessKey: string;
  readonly issuerCnpj: string;
  readonly environment: SefazEnvironment;
  readonly series: number;
  readonly number: number;
  /** `cNF`. */
  readonly keyCode: string;
  /** `dhEmi`. */
  readonly issuedAt: string;
  /** `dhCont` and `xJust`. */
  readonly contingency: { readonly since: string; readonly reason: string };
  readonly totalCents: number;
  readonly discountCents: number;
  /** The consumer's CPF/CNPJ (or foreign id), or `null`. */
  readonly buyerTaxId: string | null;
}

function refuse(why: string): never {
  throw new FiscalDocumentError("CONTINGENCY_XML_REFUSED", why);
}

function cents(value: string | null): number {
  return Math.round(Number(value ?? "0") * 100);
}

function required(scope: string | null, tag: string): string {
  const value = text(scope, tag);
  if (value === null || value.trim() === "") refuse(`the XML has no ${tag}.`);
  return value.trim();
}

/** The key's own fields: cUF(2) AAMM(4) CNPJ(14) mod(2) serie(3) nNF(9) tpEmis(1) cNF(8) cDV(1). */
function assertKeyMatches(key: string, ide: string, cnpj: string): void {
  const expected = [
    required(ide, "cUF"),
    required(ide, "dhEmi").slice(2, 4) + required(ide, "dhEmi").slice(5, 7),
    cnpj,
    required(ide, "mod"),
    required(ide, "serie").padStart(3, "0"),
    required(ide, "nNF").padStart(9, "0"),
    required(ide, "tpEmis"),
    required(ide, "cNF"),
    required(ide, "cDV"),
  ].join("");
  if (expected !== key) refuse("the access key does not match the fields it encodes.");
}

/**
 * Parse and check a station-signed NFC-e. Refuses (`CONTINGENCY_XML_REFUSED`)
 * anything but a model 65 signed in offline contingency (`tpEmis = 9`, with
 * `dhCont` and `xJust`), a key whose check digit or fields are wrong, and an
 * XML with no signature. The issuer's CNPJ and the block are the caller's to
 * check against its profile and its blocks.
 */
interface Parts {
  readonly infNFe: string;
  readonly ide: string;
  readonly emit: string;
  readonly accessKey: string;
}

/** The blocks every check reads, or a refusal naming what is missing. */
function assertSignedNote(signedXml: string): void {
  if (typeof signedXml !== "string" || signedXml.trim() === "") refuse("signedXml is empty.");
  if (element(signedXml, "nfeProc") !== null || element(signedXml, "protNFe") !== null) refuse("the XML is authorised already, not a signed note.");
  if (element(signedXml, "Signature") === null) refuse("the XML is not signed.");
}

function partsOf(signedXml: string): Parts {
  assertSignedNote(signedXml);
  const infNFe = element(signedXml, "infNFe");
  const ide = infNFe === null ? null : element(infNFe, "ide");
  const emit = infNFe === null ? null : element(infNFe, "emit");
  const accessKey = accessKeyOf(signedXml);
  if (infNFe === null || ide === null || emit === null || accessKey === null) refuse("the XML is not an NF-e: no infNFe, ide, emit or access key.");
  return { infNFe, ide, emit, accessKey };
}

/** An NFC-e (65) signed offline (`tpEmis` 9) under a key whose check digit and fields hold. */
function assertOfflineNfce({ ide, accessKey }: Parts, issuerCnpj: string): void {
  if (required(ide, "mod") !== "65") refuse("the XML is not an NFC-e (model 65).");
  if (required(ide, "tpEmis") !== "9") refuse("the XML is not signed in offline contingency (tpEmis 9).");
  if (!isValidAccessKey(accessKey)) refuse("the access key's check digit is wrong.");
  assertKeyMatches(accessKey, ide, issuerCnpj);
}

function buyerOf(infNFe: string): string | null {
  const dest = element(infNFe, "dest");
  return text(dest, "CPF") ?? text(dest, "CNPJ") ?? text(dest, "idEstrangeiro");
}

/**
 * Parse and check a station-signed NFC-e. Refuses (`CONTINGENCY_XML_REFUSED`)
 * anything but a model 65 signed in offline contingency (`tpEmis = 9`, with
 * `dhCont` and `xJust`), a key whose check digit or fields are wrong, and an
 * XML with no signature. The issuer's CNPJ and the block are the caller's to
 * check against its profile and its blocks.
 */
export function parseSignedContingencyNote(signedXml: string): SignedContingencyNote {
  const parts = partsOf(signedXml);
  const { infNFe, ide, emit, accessKey } = parts;
  const issuerCnpj = required(emit, "CNPJ");
  assertOfflineNfce(parts, issuerCnpj);
  const total = element(infNFe, "ICMSTot");
  return {
    accessKey,
    issuerCnpj,
    environment: required(ide, "tpAmb") === "1" ? "producao" : "homologacao",
    series: Number(required(ide, "serie")),
    number: Number(required(ide, "nNF")),
    keyCode: required(ide, "cNF"),
    issuedAt: required(ide, "dhEmi"),
    contingency: { since: required(ide, "dhCont"), reason: required(ide, "xJust") },
    totalCents: cents(text(total, "vNF")),
    discountCents: cents(text(total, "vDesc")),
    buyerTaxId: buyerOf(infNFe),
  };
}
