/**
 * Reading the few fields a DANFE prints out of an NF-e XML, with no parser
 * dependency. The XML is SEFAZ's own layout, written by the fiscal service: no
 * attributes are read but `Id`, no namespaces matter, and text is either plain
 * (entity-escaped) or one CDATA section (the QR code).
 */

const ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(text: string): string {
  const cdata = /^<!\[CDATA\[([\s\S]*)\]\]>$/.exec(text.trim());
  if (cdata !== null) return cdata[1] ?? "";
  return text.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, name: string) => {
    if (name.startsWith("#x") || name.startsWith("#X")) return String.fromCodePoint(parseInt(name.slice(2), 16));
    if (name.startsWith("#")) return String.fromCodePoint(Number(name.slice(1)));
    return ENTITIES[name.toLowerCase()] ?? "";
  });
}

/** The inner XML of the first `<tag>` (with or without attributes), or `null`. */
export function element(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(xml);
  return match === null ? null : (match[1] ?? "");
}

/** The decoded text of the first `<tag>`, or `null`. */
export function text(xml: string | null, tag: string): string | null {
  if (xml === null) return null;
  const inner = element(xml, tag);
  return inner === null ? null : decode(inner);
}

/** Every `<tag …>…</tag>` block, in order. */
export function elements(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g"))].map((match) => match[1] ?? "");
}

/** The access key from `<infNFe Id="NFe…">`. */
export function accessKeyOf(xml: string): string | null {
  return /<infNFe[^>]*\sId="NFe([0-9A-Z]{44})"/.exec(xml)?.[1] ?? null;
}
