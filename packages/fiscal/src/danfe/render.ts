/**
 * The DANFE NFC-e as ESC/POS-ready lines, read from the document's XML —
 * the authorised `nfeProc`, or the signed XML of a document issued offline,
 * which prints the contingency variant. No provider returns ESC/POS and a
 * register offline has nothing else to print, so the package renders it.
 *
 * The paper follows the Manual do DANFE NFC-e's divisions, in order (the
 * FULL DANFE, items included):
 *
 *   I    the issuer: name, CNPJ, IE, address
 *   II   the document's title
 *   III  the items: code, description, quantity, unit, unit value, total
 *   IV   the totals: item count, total, discounts, amount due, payments, change
 *   V    the fiscal message: homologation, contingency, where to look the key up, the key
 *   VI   the consumer
 *   VII  the number, series, issue time, and the authorisation protocol
 *   VIII the QR code, then the taxpayer's message and the approximate taxes
 *
 * Each line is `{ text, align, emphasis }`, the shape `@12-apps/thermal-printing`
 * encodes, laid out for the column count of the roll (Font A: 32 columns on
 * 58 mm, 48 on 80 mm); the QR line carries `qrCode` for the host to rasterise.
 */

import { FiscalDocumentError } from "../documents/errors";
import type { DanfeNfceLabels } from "./labels";
import { DANFE_LABEL_KEYS } from "./labels";
import { accessKeyOf, element, elements, text } from "./xml";

export type DanfeDivision = "I" | "II" | "III" | "IV" | "V" | "VI" | "VII" | "VIII";

export interface DanfeLine {
  readonly division: DanfeDivision;
  readonly text: string;
  readonly align: "left" | "center";
  readonly emphasis: "normal" | "bold";
  /** Present on the QR line only: the URL the code encodes. */
  readonly qrCode?: string;
}

export type PaperWidth = 58 | 80;

export const DANFE_COLUMNS: Readonly<Record<PaperWidth, number>> = { 58: 32, 80: 48 };

export interface DanfeNfceInput {
  /** The `nfeProc` of an authorised document, or the signed XML of one issued offline. */
  readonly xml: string;
  readonly paperWidth: PaperWidth;
  readonly labels: DanfeNfceLabels;
}

/** `1234` cents → `12,34`; thousands with a dot, as the DANFE prints money. */
export function money(value: string | null): string {
  const cents = Math.round(Number(value ?? "0") * 100);
  const whole = Math.trunc(Math.abs(cents) / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${cents < 0 ? "-" : ""}${whole},${String(Math.abs(cents) % 100).padStart(2, "0")}`;
}

function quantity(value: string | null): string {
  return Number(value ?? "0").toLocaleString("en-US", { maximumFractionDigits: 4, useGrouping: false }).replace(".", ",");
}

/** A word longer than the width (a URL) cut into width-long pieces: nothing is dropped. */
function pieces(word: string, width: number): string[] {
  const out: string[] = [];
  for (let at = 0; at < word.length; at += width) out.push(word.slice(at, at + width));
  return out;
}

/** Wrap a text at the width, breaking on spaces where it can. */
export function wrap(value: string, width: number): string[] {
  const words = value
    .trim()
    .split(/\s+/)
    .filter((word) => word !== "")
    .flatMap((word) => pieces(word, width));
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current === "" ? word : `${current} ${word}`;
    if (candidate.length <= width) {
      current = candidate;
      continue;
    }
    if (current !== "") lines.push(current);
    current = word;
  }
  if (current !== "") lines.push(current);
  return lines.length > 0 ? lines : [""];
}

/** `label ……… value` across the width. */
function spread(label: string, value: string, width: number): string {
  const gap = width - label.length - value.length;
  return gap >= 1 ? `${label}${" ".repeat(gap)}${value}` : `${label} ${value}`;
}

function groupKey(key: string): string {
  return key.replace(/(.{4})/g, "$1 ").trim();
}

class Paper {
  readonly lines: DanfeLine[] = [];
  constructor(readonly width: number) {}

  add(division: DanfeDivision, value: string, align: DanfeLine["align"] = "left", emphasis: DanfeLine["emphasis"] = "normal"): void {
    for (const piece of wrap(value, this.width)) this.lines.push({ division, text: piece, align, emphasis });
  }

  /**
   * `label ……… value` on one line when it fits; otherwise the label wraps and
   * the value closes its last line, or takes a line of its own, right-aligned.
   * Nothing passes the roll's width.
   */
  pair(division: DanfeDivision, label: string, value: string, emphasis: DanfeLine["emphasis"] = "normal"): void {
    const labelLines = wrap(label, this.width);
    const last = labelLines.pop() ?? "";
    for (const piece of labelLines) this.lines.push({ division, text: piece, align: "left", emphasis });
    const closing = last.length + 1 + value.length <= this.width ? [spread(last, value, this.width)] : [last, value.padStart(this.width)];
    for (const piece of closing) this.lines.push({ division, text: piece, align: "left", emphasis });
  }

  rule(division: DanfeDivision): void {
    this.lines.push({ division, text: "-".repeat(this.width), align: "left", emphasis: "normal" });
  }
}

interface Parsed {
  readonly infNFe: string;
  readonly ide: string;
  readonly emit: string;
  readonly total: string;
  /** `infNFeSupl`, beside `infNFe`: the QR code and the lookup URL. */
  readonly supl: string;
  readonly accessKey: string;
  readonly contingency: boolean;
  /** The authorisation protocol, once SEFAZ has answered (the `nfeProc`). */
  readonly infProt: string | null;
  readonly homologation: boolean;
}

function parse(xml: string): Parsed {
  const infNFe = element(xml, "infNFe");
  const ide = infNFe === null ? null : element(infNFe, "ide");
  const emit = infNFe === null ? null : element(infNFe, "emit");
  const accessKey = accessKeyOf(xml);
  if (infNFe === null || ide === null || emit === null || accessKey === null) {
    throw new FiscalDocumentError("INVALID_INPUT", "the XML is not an NF-e: no infNFe, ide, emit or access key.");
  }
  if (text(ide, "mod") !== "65") throw new FiscalDocumentError("INVALID_INPUT", "the XML is not an NFC-e (model 65).");
  return {
    infNFe,
    ide,
    emit,
    total: element(infNFe, "ICMSTot") ?? "",
    supl: element(xml, "infNFeSupl") ?? "",
    accessKey,
    contingency: text(ide, "tpEmis") === "9",
    infProt: element(xml, "infProt"),
    homologation: text(ide, "tpAmb") === "2",
  };
}

function issuerPart(paper: Paper, doc: Parsed, labels: DanfeNfceLabels): void {
  const address = element(doc.emit, "enderEmit");
  paper.add("I", text(doc.emit, "xNome") ?? "", "center", "bold");
  paper.add("I", `${labels.cnpj} ${text(doc.emit, "CNPJ") ?? ""} ${labels.stateRegistration} ${text(doc.emit, "IE") ?? ""}`, "center");
  const street = [text(address, "xLgr"), text(address, "nro"), text(address, "xBairro"), text(address, "xMun"), text(address, "UF")];
  paper.add("I", street.filter((part) => part !== null && part !== "").join(", "), "center");
  paper.add("II", labels.title, "center", "bold");
  paper.rule("II");
}

function itemsPart(paper: Paper, doc: Parsed, labels: DanfeNfceLabels): number {
  paper.add("III", labels.itemsHeader);
  const items = elements(doc.infNFe, "det");
  for (const det of items) {
    const prod = element(det, "prod");
    paper.add("III", `${text(prod, "cProd") ?? ""} ${text(prod, "xProd") ?? ""}`);
    const amount = `${quantity(text(prod, "qCom"))} ${text(prod, "uCom") ?? ""} x ${money(text(prod, "vUnCom"))}`;
    paper.pair("III", amount, money(text(prod, "vProd")));
  }
  paper.rule("III");
  return items.length;
}

function totalsPart(paper: Paper, doc: Parsed, labels: DanfeNfceLabels, count: number): void {
  paper.pair("IV", labels.itemCount, String(count));
  paper.pair("IV", labels.totalValue, money(text(doc.total, "vProd")));
  const discount = text(doc.total, "vDesc");
  if (discount !== null && Number(discount) > 0) paper.pair("IV", labels.discounts, money(discount));
  paper.pair("IV", labels.amountDue, money(text(doc.total, "vNF")), "bold");
  paper.add("IV", labels.paymentHeader);
  for (const detPag of elements(doc.infNFe, "detPag")) {
    const code = text(detPag, "tPag") ?? "";
    paper.pair("IV", text(detPag, "xPag") ?? labels.paymentMethods[code] ?? code, money(text(detPag, "vPag")));
  }
  const change = text(element(doc.infNFe, "pag"), "vTroco");
  if (change !== null && Number(change) > 0) paper.pair("IV", labels.change, money(change));
  paper.rule("IV");
}

function fiscalMessagePart(paper: Paper, doc: Parsed, labels: DanfeNfceLabels): void {
  if (doc.homologation) paper.add("V", labels.homologation, "center", "bold");
  if (doc.contingency) paper.add("V", labels.contingency, "center", "bold");
  // Offline and not yet authorised: ONE copy, the consumer's (reprints are the same paper).
  if (doc.contingency && doc.infProt === null) {
    paper.add("V", labels.pendingAuthorization, "center", "bold");
    paper.add("V", labels.consumerCopy, "center", "bold");
  }
  paper.add("V", labels.lookupByKey, "center");
  paper.add("V", text(doc.supl, "urlChave") ?? "", "center");
  paper.add("V", groupKey(doc.accessKey), "center");
  paper.rule("V");
}

function consumerPart(paper: Paper, doc: Parsed, labels: DanfeNfceLabels): void {
  const dest = element(doc.infNFe, "dest");
  const id = text(dest, "CPF") ?? text(dest, "CNPJ") ?? text(dest, "idEstrangeiro");
  if (id === null) {
    paper.add("VI", labels.unidentifiedConsumer, "center");
  } else {
    paper.add("VI", `${labels.consumer} ${id}`, "center");
    const name = text(dest, "xNome");
    if (name !== null) paper.add("VI", name, "center");
  }
  paper.rule("VI");
}

function identificationPart(paper: Paper, doc: Parsed, labels: DanfeNfceLabels): void {
  const issued = (text(doc.ide, "dhEmi") ?? "").replace("T", " ").slice(0, 19);
  paper.add("VII", `${labels.number} ${text(doc.ide, "nNF") ?? ""} ${labels.series} ${text(doc.ide, "serie") ?? ""} ${issued}`, "center", "bold");
  const { infProt } = doc;
  if (infProt !== null) {
    paper.add("VII", `${labels.protocol} ${text(infProt, "nProt") ?? ""}`, "center");
    paper.add("VII", `${labels.authorizedAt} ${(text(infProt, "dhRecbto") ?? "").replace("T", " ").slice(0, 19)}`, "center");
  }
}

function qrPart(paper: Paper, doc: Parsed, labels: DanfeNfceLabels): void {
  const qrCode = text(doc.supl, "qrCode");
  if (qrCode === null) throw new FiscalDocumentError("INVALID_INPUT", "the NFC-e XML carries no QR code (infNFeSupl/qrCode).");
  paper.add("VIII", labels.qrCaption, "center");
  paper.lines.push({ division: "VIII", text: "", align: "center", emphasis: "normal", qrCode });
  const message = text(element(doc.infNFe, "infAdic"), "infCpl");
  if (message !== null && message !== "") paper.add("VIII", message);
  const taxes = text(doc.total, "vTotTrib");
  if (taxes !== null && Number(taxes) > 0) paper.add("VIII", `${labels.approximateTaxes} ${money(taxes)}`);
}

export function renderDanfeNfce(input: DanfeNfceInput): DanfeLine[] {
  const missing = DANFE_LABEL_KEYS.filter((key) => input.labels?.[key] === undefined);
  if (missing.length > 0) throw new FiscalDocumentError("INVALID_INPUT", `labels is missing: ${missing.join(", ")}.`);
  const width = DANFE_COLUMNS[input.paperWidth];
  if (width === undefined) throw new FiscalDocumentError("INVALID_INPUT", "paperWidth must be 58 or 80.");
  const doc = parse(input.xml);
  const paper = new Paper(width);
  issuerPart(paper, doc, input.labels);
  const count = itemsPart(paper, doc, input.labels);
  totalsPart(paper, doc, input.labels, count);
  fiscalMessagePart(paper, doc, input.labels);
  consumerPart(paper, doc, input.labels);
  identificationPart(paper, doc, input.labels);
  qrPart(paper, doc, input.labels);
  return paper.lines;
}
