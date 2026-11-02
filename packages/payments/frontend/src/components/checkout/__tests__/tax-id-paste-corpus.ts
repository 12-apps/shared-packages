/**
 * EVERY pasted document the FUT-590 reviews tried, with what the field must
 * keep — one table, read by the checkout's field and the activation form's
 * alike, so the two cannot answer the same paste differently.
 *
 * The rule (round 5): a value led by a CPF/CNPJ label run keeps the document
 * TOKEN after the deepest cut that is (a) a valid CNPJ, or a valid CPF unless
 * the run names only CNPJ; else (b) a token of a document's length; else (c)
 * the deepest token. Nothing is ever cut to 11 or 14: "CNPJ:
 * 11.222.355/0001-42" is a CNPJ with a typo, never the valid CPF its first
 * eleven digits are. A value with no label run is kept as typed, unless text
 * follows its first document token after a space: then only that token.
 *
 * Round 6: separator look-alikes (dashes, minus, division and fullwidth
 * slashes, comma) read as the mask's own first; a mark between the label and
 * the document is skipped; and when no cut's token is a document by (a) or
 * (b), a document written with spaces after the cut ("CNPJ: 11 222 333 0001
 * 81") counts before (c), by the same two tests.
 *
 * The generated documents of the reviewer's corpus are written out literally:
 * MF.ABC.345/01DE-31, NO.123.456/7890-15, CP.F12.345/6789-44 and
 * MF.120.001/0183-64 are valid CNPJs; 11.222.355/0001-42 is one with a wrong
 * check digit whose first eleven digits are a valid CPF.
 */
export const PASTE_CORPUS: ReadonlyArray<readonly [pasted: string, kept: string]> = [
  ["CPF 529.982.247-25", "52998224725"],
  ["CNPJ: 11.222.333/0001-81", "11222333000181"],
  ["cnpj:12.abc.345/01de-35", "12ABC34501DE35"],
  ["12.ABC.345/01DE-35", "12ABC34501DE35"],
  ["  cpf :  529.982.247-25", "52998224725"],
  ["CPF/CNPJ: 11.222.333/0001-81", "11222333000181"],
  ["CNPJ/MF 11.222.333/0001-81", "11222333000181"],
  ["CNPJ nº 11.222.333/0001-81", "11222333000181"],
  ["CPF.: 529.982.247-25", "52998224725"],
  ["CNPJ n° 11.222.333/0001-81", "11222333000181"],
  ["CNPJ No. 11.222.333/0001-81", "11222333000181"],
  ["CPF12ABC34501", "CPF12ABC34501"],
  ["MF.ABC.345/01DE-35", "MFABC34501DE35"],
  ["NO.ABC.345/01DE-35", "NOABC34501DE35"],
  ["CNPJ: MF.ABC.345/01DE-31", "MFABC34501DE31"],
  ["CNPJ MF.ABC.345/01DE-31", "MFABC34501DE31"],
  ["CNPJ/MF: MF.ABC.345/01DE-31", "MFABC34501DE31"],
  ["CNPJ/MF: 11.222.333/0001-81", "11222333000181"],
  ["CNPJ No 11.222.333/0001-81", "11222333000181"],
  ["CNPJ Nº 11.222.333/0001-81", "11222333000181"],
  ["CPF n.º 529.982.247-25", "52998224725"],
  ["CPF N.º 529.982.247-25", "52998224725"],
  ["CNPJ: 11.222.333/0001-81 - Empresa X LTDA", "11222333000181"],
  ["CNPJ: 11.222.333/0001-8", "1122233300018"],
  ["CPF 529.982.247-25 Fulano de Tal", "52998224725"],
  ["CNPJ: MF.ABC.345/01DE-32", "MFABC34501DE32"],
  ["CNPJ: NO.123.456/7890-15", "NO123456789015"],
  ["CPF: 529.982.247-26", "52998224726"],
  ["CPF/CNPJ 529.982.247-26", "52998224726"],
  ["CPF CP.F12.345/6789-44", "CPF12345678944"],
  ["CP.F12.345/6789-44", "CPF12345678944"],
  ["CPF12345678944", "CPF12345678944"],
  ["MF.ABC.345/01DE-31", "MFABC34501DE31"],
  ["MFABC34501DE31", "MFABC34501DE31"],
  ["CPF: 529.982.247-25, nascido em 1990", "52998224725"],
  ["CNPJ: MF.ABC.345/01DE-31 Empresa", "MFABC34501DE31"],
  ["CNPJ: 11.222.355/0001-42", "11222355000142"],
  ["CNPJ 11222355000142", "11222355000142"],
  ["11222355000142", "11222355000142"],
  ["11.222.355/0001-42", "11222355000142"],
  ["CNPJ: MF.120.001/0183-64", "MF120001018364"],
  ["MF.120.001/0183-64", "MF120001018364"],
  ["11.222.333/0001-81 Empresa", "11222333000181"],
  ["529.982.247-25 x", "52998224725"],
  ["12.ABC.345/01DE-35 Loja X", "12ABC34501DE35"],
  [" 529.982.247-25", "52998224725"],
  [" 529.982.247-25 Fulano", "52998224725"],
  ["529.982.247-26 x", "52998224726"],
  // A document written with spaces is still one (FUT-4080).
  ["529 982 247 25", "52998224725"],
  [" 11 222 333 0001 81 ", "11222333000181"],
  ["CNPJ 1", "1"],
  ["CPF ", "CPF"],
  ["CNPJ:", "CNPJ"],
  ["1122235500014", "1122235500014"],
  ["112223550001", "112223550001"],
  // Round 6: a mark between the label and the document is no document.
  ["CNPJ \u2014 11.222.333/0001-81", "11222333000181"],
  ["CPF \u2013 529.982.247-25", "52998224725"],
  ['CPF: "529.982.247-25"', "52998224725"],
  ["CNPJ: (11.222.333/0001-81)", "11222333000181"],
  ["CPF: *529.982.247-25", "52998224725"],
  ["CNPJ: #11.222.333/0001-81", "11222333000181"],
  ["CPF: \u2022 529.982.247-25", "52998224725"],
  ["CPF: '529.982.247-25'", "52998224725"],
  // Round 6: a labelled document written with spaces is still one.
  ["CNPJ: 11 222 333 0001 81", "11222333000181"],
  ["CNPJ 11 222 333/0001-81", "11222333000181"],
  ["CPF: 529 982 247 25 Fulano", "52998224725"],
  ["CNPJ: 11.222.333 / 0001-81", "11222333000181"],
  ["CNPJ: 11.222.333/0001 - 81", "11222333000181"],
  // Round 6: separator look-alikes read as the mask's own.
  ["CPF: 529.982.247\u201125", "52998224725"],
  ["CNPJ: 11,222,333/0001-81", "11222333000181"],
  ["CNPJ: 11.222.333\u22150001-81", "11222333000181"],
  ["CNPJ: 11.222.333\uff0f0001\u221281", "11222333000181"],
  // Round 6: digits before a name keep only the digits; a glued label goes
  // only when what is left is a valid document.
  ["529.982.247 Fulano", "529982247"],
  ["CPF529.982.247-25", "52998224725"],
  ["CNPJ11.222.333/0001-81", "11222333000181"],
  // A spaced CNPJ under a CNPJ-only label never yields a hidden CPF.
  ["CNPJ: 11 222 355 0001 42", "11222355000142"],
];
