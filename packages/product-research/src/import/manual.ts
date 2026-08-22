import type { ManualImportCopy } from '../connectors/diagnostics-copy';
import { z } from 'zod';
import { parseMoneyToCents } from '../normalize/money';

/**
 * Manual price-list import (FUT-415): parsing and normalization for the
 * prices that live behind credential-gated portals with no API — bottler
 * price lists, distributor tables, phone quotes. Hosts feed either structured
 * rows (from a UI form/XLSX mapping step) or raw CSV text; both funnel into
 * `normalizeManualRows`, which produces storable entries plus a PROBLEMS list
 * — an unmappable row is surfaced with its line number, never dropped
 * silently.
 */

export interface ManualRowProblem {
  /** 1-based data-row number (header excluded for CSV input). */
  line: number;
  reason: string;
}

const AVAILABILITY_VALUES = ['IN_STOCK', 'OUT_OF_STOCK', 'UNKNOWN'] as const;

/** One row as a host submits it — strings straight from a sheet are fine. */
export const manualPriceRowSchema = z.object({
  title: z.string().trim().min(2).max(300),
  price: z.union([z.string().trim().min(1).max(40), z.number()]),
  supplierName: z.string().trim().min(1).max(160).optional(),
  brand: z.string().trim().min(1).max(100).optional(),
  ean: z.string().trim().optional(),
  packQuantity: z.coerce.number().int().min(1).max(10_000).optional(),
  url: z.string().trim().url().max(500).optional(),
  availability: z.enum(AVAILABILITY_VALUES).optional(),
  etaDays: z.coerce.number().int().min(0).max(365).optional(),
  /** A date string — ISO ("2026-08-31") or BR ("31/08/2026"). Kept as a
   * string so the schema projects to JSON Schema for the MCP surface;
   * `normalizeManualRows` parses it and surfaces an unparseable value. */
  validUntil: z.string().trim().min(4).max(30).optional(),
});

export type ManualPriceRowInput = z.infer<typeof manualPriceRowSchema>;

/** A row after normalization — what a host store persists. */
export interface NormalizedManualRow {
  supplierName?: string;
  title: string;
  brand?: string;
  ean?: string;
  packQuantity?: number;
  priceCents: number;
  currency: string;
  url?: string;
  availability?: (typeof AVAILABILITY_VALUES)[number];
  etaDays?: number;
  validUntil: Date;
}

const EAN_PATTERN = /^\d{8,14}$/;

/** Parse an ISO or BR (dd/mm/yyyy) date string; null when unparseable. */
const parseDateString = (value: string): Date | null => {
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  const parsed = new Date(br ? `${br[3]}-${br[2]}-${br[1]}` : value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/**
 * Normalize submitted rows to storable entries. Money accepts every shape
 * distributor sheets contain ("R$ 1.234,56", "4,29", 4.29); a row whose price
 * cannot be parsed is a PROBLEM, not a silent drop. An invalid EAN is
 * non-fatal: the row imports without it and the problem list says so.
 */
export const normalizeManualRows = (
  rows: ManualPriceRowInput[],
  options: { defaultValidUntil: Date },
  copy: ManualImportCopy,
): { entries: NormalizedManualRow[]; problems: ManualRowProblem[] } => {
  const entries: NormalizedManualRow[] = [];
  const problems: ManualRowProblem[] = [];

  rows.forEach((row, index) => {
    const line = index + 1;
    const priceCents = parseMoneyToCents(row.price);
    if (priceCents === null || priceCents <= 0) {
      problems.push({ line, reason: copy.unreadablePrice(String(row.price)) });
      return;
    }

    let ean = row.ean?.replace(/\D/g, '') || undefined;
    if (row.ean !== undefined && ean !== undefined && !EAN_PATTERN.test(ean)) {
      problems.push({
        line,
        reason: copy.invalidEan(row.ean),
      });
      ean = undefined;
    }

    let validUntil = options.defaultValidUntil;
    if (row.validUntil !== undefined) {
      const parsedDate = parseDateString(row.validUntil);
      if (parsedDate === null) {
        problems.push({
          line,
          reason: copy.invalidValidUntil(row.validUntil),
        });
      } else {
        validUntil = parsedDate;
      }
    }

    entries.push({
      supplierName: row.supplierName,
      title: row.title,
      brand: row.brand,
      ean,
      packQuantity: row.packQuantity,
      priceCents,
      currency: 'BRL',
      url: row.url,
      availability: row.availability,
      etaDays: row.etaDays,
      validUntil,
    });
  });

  return { entries, problems };
};

export type MappableField =
  | 'title'
  | 'price'
  | 'supplierName'
  | 'brand'
  | 'ean'
  | 'packQuantity'
  | 'validUntil';

/** PT-BR/EN header spellings recognized without an explicit mapping. */
const HEADER_ALIASES: Record<MappableField, readonly string[]> = {
  title: ['produto', 'descricao', 'descrição', 'item', 'nome', 'product', 'title'],
  price: ['preco', 'preço', 'valor', 'price', 'r$', 'preco unitario', 'preço unitário'],
  supplierName: ['fornecedor', 'distribuidor', 'supplier'],
  brand: ['marca', 'brand'],
  ean: ['ean', 'gtin', 'codigo de barras', 'código de barras', 'barcode'],
  packQuantity: ['embalagem', 'pack', 'qtd por caixa', 'unidades por caixa', 'fardo'],
  validUntil: ['validade', 'valido ate', 'válido até', 'valid until'],
};

const normalizeHeader = (header: string): string =>
  header
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

/** Split one CSV line honoring double-quoted fields ("" escapes a quote). */
const splitCsvLine = (line: string, delimiter: string): string[] => {
  const fields: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields.map((field) => field.trim());
};

const detectDelimiter = (headerLine: string): string =>
  (headerLine.match(/;/g)?.length ?? 0) >= (headerLine.match(/,/g)?.length ?? 0) ? ';' : ',';

/** Brazilian sheets write dates dd/mm/yyyy; rewrite to ISO so coercion works. */
const normalizeDateCell = (value: string | undefined): string | undefined => {
  if (value === undefined) return undefined;
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  return br ? `${br[3]}-${br[2]}-${br[1]}` : value;
};

const resolveColumns = (
  headers: string[],
  mapping: Partial<Record<MappableField, string>>,
): Partial<Record<MappableField, number>> => {
  const normalized = headers.map(normalizeHeader);
  const columns: Partial<Record<MappableField, number>> = {};
  for (const field of Object.keys(HEADER_ALIASES) as MappableField[]) {
    const mapped = mapping[field];
    const aliases = HEADER_ALIASES[field].map(normalizeHeader);
    const index =
      mapped !== undefined
        ? normalized.indexOf(normalizeHeader(mapped))
        : normalized.findIndex((header) => aliases.includes(header));
    if (index !== -1) columns[field] = index;
  }
  return columns;
};

/**
 * The header row as the CSV parser will read it, with the delimiter it will
 * use — what an import UI shows in its column-mapping step.
 */
export const readCsvHeaders = (
  content: string,
  delimiter?: string,
): { headers: string[]; delimiter: string } => {
  const headerLine = content.split(/\r?\n/).find((line) => line.trim() !== '') ?? '';
  const resolved = delimiter ?? detectDelimiter(headerLine);
  return { headers: splitCsvLine(headerLine, resolved), delimiter: resolved };
};

/**
 * Auto-guess a field → header-name mapping from the same alias table the CSV
 * parser resolves with, so a UI's pre-filled mapping step and the eventual
 * parse can never disagree. Unrecognized fields are simply absent.
 */
export const guessHeaderMapping = (
  headers: string[],
): Partial<Record<MappableField, string>> => {
  const columns = resolveColumns(headers, {});
  const mapping: Partial<Record<MappableField, string>> = {};
  for (const [field, index] of Object.entries(columns) as [MappableField, number][]) {
    const header = headers[index];
    if (header !== undefined) mapping[field] = header;
  }
  return mapping;
};

export interface CsvParseInput {
  content: string;
  /** Field → header name, for sheets whose headers the aliases don't cover. */
  mapping?: Partial<Record<MappableField, string>>;
  /** Auto-detected from the header line (";" vs ",") when omitted. */
  delimiter?: string;
}

/**
 * Parse CSV text into submittable rows. Returns rows + problems; a fatal
 * header problem (no title/price column) yields zero rows and one problem at
 * line 0. Data-row line numbers are 1-based and exclude the header.
 */
export const parseCsvPriceList = (
  input: CsvParseInput,
  copy: ManualImportCopy,
): { rows: ManualPriceRowInput[]; problems: ManualRowProblem[] } => {
  const lines = input.content.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length < 2) {
    return { rows: [], problems: [{ line: 0, reason: copy.emptyFile }] };
  }

  const headerLine = lines[0] ?? '';
  const delimiter = input.delimiter ?? detectDelimiter(headerLine);
  const columns = resolveColumns(splitCsvLine(headerLine, delimiter), input.mapping ?? {});
  if (columns.title === undefined || columns.price === undefined) {
    return {
      rows: [],
      problems: [
        {
          line: 0,
          reason:
            copy.missingRequiredColumns,
        },
      ],
    };
  }

  const rows: ManualPriceRowInput[] = [];
  const problems: ManualRowProblem[] = [];
  lines.slice(1).forEach((line, index) => {
    const fields = splitCsvLine(line, delimiter);
    const cell = (column: number | undefined): string | undefined => {
      const value = column === undefined ? undefined : fields[column];
      return value === undefined || value === '' ? undefined : value;
    };

    const candidate = {
      title: cell(columns.title) ?? '',
      price: cell(columns.price) ?? '',
      supplierName: cell(columns.supplierName),
      brand: cell(columns.brand),
      ean: cell(columns.ean),
      packQuantity: cell(columns.packQuantity),
      validUntil: normalizeDateCell(cell(columns.validUntil)),
    };
    const parsed = manualPriceRowSchema.safeParse(candidate);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      problems.push({
        line: index + 1,
        reason: copy.unimportableRow(first?.path.join('.') ?? '', first?.message ?? ''),
      });
      return;
    }
    rows.push(parsed.data);
  });

  return { rows, problems };
};
