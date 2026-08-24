// "Does this filename say which language it is?" — one answer, in plain string
// operations, shared by `lib/shipped-source.mjs` and `locale-coverage-gate.mjs`.
//
// Two gates asking one question from two hand-kept patterns is the drift this
// folder already exists to prevent: the pair would disagree the first time
// either widened, and the direction that disagreement takes is always "one gate
// quietly stopped looking".
//
// ## Why not a regex
//
// The obvious spelling is
// `(?:^|[./-])[a-z]{2}-[A-Z]{2}(?:\.[^/]*)?\.(?:ts|tsx|js|jsx|mjs)$`, and it was
// one until CodeQL flagged the `[^/]*` before a literal `.`: a star over a class
// that CONTAINS its own terminator backtracks once per character on every
// non-matching name, which is the polynomial-ReDoS shape. Nothing here reads
// remote input, so the risk was theoretical — but the string version is both
// linear and easier to read than the regex it replaces, so there was nothing to
// weigh.
//
// ## The rule
//
// A locale file names a BCP-47 `language-REGION` tag as a DELIMITED SEGMENT of
// its basename. All four spellings this repo uses are legal:
//
//   pt-BR.ts                  family ""
//   pt-BR.form.ts             family "form"
//   mail-templates.pt-BR.ts   family "mail-templates"
//   setup-guide-pt-BR.ts      family "setup-guide"
//
// The REGION subtag is required and the tag must sit on a `.` or `-` boundary,
// which is what keeps `packages/forms-core/src/br.ts` — CPF/CNPJ validation, not
// a language pack — from exempting itself by its name alone.

const EXTENSIONS = ["ts", "tsx", "js", "jsx", "mjs"];

const isLower = (ch) => ch >= "a" && ch <= "z";
const isUpper = (ch) => ch >= "A" && ch <= "Z";

/** The basename with its extension removed, or `null` if it has none of ours. */
function stemOf(basename) {
  const cut = basename.lastIndexOf(".");
  if (cut === -1) return null;
  return EXTENSIONS.includes(basename.slice(cut + 1)) ? basename.slice(0, cut) : null;
}

/** Whether `stem` holds `language-REGION` at exactly this offset. */
function tagShapeAt(stem, at) {
  return (
    isLower(stem[at]) &&
    isLower(stem[at + 1]) &&
    stem[at + 2] === "-" &&
    isUpper(stem[at + 3]) &&
    isUpper(stem[at + 4])
  );
}

/** Whether the five characters at `at` stand alone rather than inside a word. */
function delimitedAt(stem, at) {
  const before = at === 0 ? "" : stem[at - 1];
  const after = stem[at + 5] ?? "";
  return (before === "" || before === "." || before === "-") && (after === "" || after === ".");
}

/**
 * The tag a basename names, or `null`.
 *
 * Scans every offset rather than taking the first shape that fits: a name may
 * hold something tag-shaped that is not delimited (`use-UIx-BRt`) before the
 * real tag, and stopping at the first would answer `null` for a file that IS a
 * pack.
 */
export function localeTagIn(basename) {
  const stem = stemOf(basename);
  if (stem === null) return null;
  for (let at = 0; at + 5 <= stem.length; at += 1) {
    if (!tagShapeAt(stem, at) || !delimitedAt(stem, at)) continue;
    return { tag: stem.slice(at, at + 5), at, stem };
  }
  return null;
}

/**
 * The family a locale file belongs to: its name with the tag and ONE adjacent
 * delimiter removed.
 *
 * That is what makes `setup-guide-pt-BR` pair with `setup-guide-en-US` and not
 * merely with some other English file in the same folder — the failure a
 * coverage gate exists to catch is a pack split seven ways that grew one
 * translated file and read as done.
 */
export function familyOf({ stem, at }) {
  const before = stem.slice(0, at).replace(/[.-]$/, "");
  const after = stem.slice(at + 5).replace(/^[.-]/, "");
  return [before, after].filter(Boolean).join(".");
}
