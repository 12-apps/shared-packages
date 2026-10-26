// The literal-copy gate: a rendered word in shipped package source comes from
// the HOST, and the check for that is structural rather than lexical.
//
// ## Why a third gate, when two already look at copy
//
// `copy-portability-gate.mjs` finds pt-BR by its DIACRITICS.
// `vocabulary-portability-gate.mjs` finds the origin host's domain NOUNS.
// Both ask "does this string look like it came from that product?", and both
// answer with a word list — which is the thing that cannot be made complete.
//
// Measured, on the same tree, over four widenings of the same scanner:
//
//   pass 1  diacritics only ................  0 in the files below
//   pass 2  + UI verbs ....................  39
//   pass 3  + inflections .................  51
//   pass 4  + gerunds, -mente, -ção, glue .  51, and a different 51
//
// Every one of those was reported as a floor at the time, and every one was
// wrong in the same direction. `Bloco`, `Marcar tudo`, `Publicar`, `Campo`,
// `Formato`, `Empilhado`, `Duplicar` — each shipped through at least one pass
// built to find exactly it. A fifth widening would find a fifth number.
//
// It also cannot see the OTHER half of the same defect at all. `@12-apps/ui`
// ships `aria-label="Zoom in"`, `title="No data available"`, `Next`, `Skip`.
// Those are just as unportable — a Brazilian host mounting `Lightbox` gets
// English read out to its blind users — and no Portuguese word list will ever
// name one. "Is this the origin host's language?" was never the question. The
// question is "did the package write a word instead of asking for it?", and
// that one is decidable.
//
// ## WHAT IS FLAGGED
//
// Every shape is narrow on purpose. A gate that cries wolf gets an ever longer
// exceptions file and then protects nothing, so each one below was measured
// against the whole tree before it was admitted, and each has a positive and
// a negative case in `selftest()`.
//
//   1. A COPY PROP given a bare string literal. `label`, `title`,
//      `placeholder`, `aria-label`, `accessibilityLabel`, `helperText`, `alt`,
//      … and any `…Label` / `…Title` / `…Text` name — the props whose value a
//      person reads. Everything else on an element is structure, styling or
//      identity, and a literal there is not copy. Inside a copy prop a single
//      lower-case word counts too (`aria-label="close"`): that slot says the
//      value is read, so `close` cannot be an identifier there.
//
//   2. A JSX TEXT CHILD that is prose: alone on its line between an opening
//      and a closing tag (`<Button>` / `Publicar` / `</Button>`, how this
//      repo's formatter writes a button's words, a leading `+ ` glyph
//      included), or inside a matched tag pair on one line.
//
//   3. A copy prop given an EXPRESSION whose value can be a literal: a
//      template literal with a word in its literal part (`Go to slide ${n}`),
//      a ternary's branches, the right side of `??` / `||` / `&&`
//      (`alt={label ?? 'Image'}`). Only what the expression can EVALUATE TO
//      counts, so a key lookup (`copy[open ? 'a' : 'b']`), a comparison and a
//      call's argument never do.
//
//   4. An expression TEXT CHILD of the same kind: `{error.message || 'Failed'}`.
//
//   5. An OBJECT LITERAL key that names copy — a component's `*_DEFAULTS`
//      table (`PHONE_INPUT_DEFAULTS = { label: 'Phone Number' }`). Prose only
//      here: a lone `label: 'bold'` is a lookup key, and `message`,
//      `description` and `summary` keys are left out (see `OBJECT_KEY_DEV`).
//
//   6. A DEFAULT VALUE for a copy-named parameter or destructured prop —
//      `({ title = 'Sign in' })`, `(message = 'This field is required')`.
//      Prose only, and never in a class constructor (an `Error`'s message).
//
// `.ts` files are scanned too, for shapes 5 and 6 only: a plain module holds
// no JSX, but it does hold the defaults tables and the curried validators
// whose fallback sentences a user reads. `.d.ts` files are not scanned.
//
// `isProse` then drops what is not a word a reader sees: camelCase tokens,
// kebab/snake ids, SCREAMING constants, URLs and paths, CSS functions, product
// and format names, and anything under two characters or carrying no letter.
//
// Deliberately NOT flagged, each because the alternative is worse:
//
//   - A token glued to a placeholder in a template (`tab-${id}`, `${n}px`,
//     `v${n}`): a unit, an id or a prefix, never a word.
//   - Multi-line prose. Narrow beats complete here: this gate's value is that
//     every entry is real, so that the ledger is a work list rather than a
//     wall of noise to be exempted wholesale.
//   - The NAMED PACKS (`en-US.ts`, `pt-BR.*.ts`, `locales/`): they are where
//     the words are supposed to be, which is why a fallback is read from one.
//
// ## THE RATCHET
//
// `.literal-copy-exceptions.json`, shrink-only in BOTH directions, keyed by
// `path:line — snippet` so one file's twelve findings burn down one at a
// time. A NEW finding fails (you cannot grandfather forward); an entry whose
// finding is gone fails as stale (delete the line). The count is what makes
// the class visible: it was invisible before, which is why it grew.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { checkLedger, readLedger, summarize } from "./lib/exception-ledger.mjs";
import { inScope } from "./lib/shipped-source.mjs";
import {
  copyProps,
  findLiterals,
  isCopyName,
  isCopyWord,
  isProse,
  templateHasWords,
  valueLiterals,
} from "./lib/literal-copy-shapes.mjs";

const LABEL = "[literal-copy]";
const EXCEPTIONS_PATH = ".literal-copy-exceptions.json";

/**
 * Surfaces whose reader is a DEVELOPER, exempted as whole files.
 *
 * A file-level rule, not a per-line grandfather, because the claim is about
 * what the surface IS rather than about which words it currently holds — so it
 * does not go stale when a line moves, and it cannot quietly cover a product
 * string that drifts into the same file later without someone reading this
 * list again.
 *
 * The test is not "is it technical", it is "would a host ever write different
 * words here?". CLAUDE.md puts everything a developer reads in English
 * deliberately; a pack for one of these would be every adopter copying the
 * same English sentence to satisfy a type, which is ceremony rather than
 * portability — and ceremony is how a gate loses the argument the next time
 * someone wants an exemption.
 */
const DEV_SURFACES = new Map([
  [
    "packages/observability-frontend/src/react/self-check.tsx",
    "The Sentry diagnostics page. It names window.onerror, source maps and the DSN, " +
      "is mounted at a fixed runbook URL, and exists to be opened by whoever is debugging " +
      "that deployment — never by its users.",
  ],
  [
    "packages/payments/backend/src/platform/homologacao-anexo.ts",
    "A payment provider's homologation evidence file. Its reader is that provider's " +
      "integration reviewer, the platform uploads it once to the provider's own Portuguese form, and " +
      "its step titles describe the sandbox calls captured beside them — no host " +
      "renders it and no host would ever write different words for it.",
  ],
  [
    "packages/ui/src/components/utility/Portal/Portal.button-container.example.tsx",
    "A worked example of mounting a Portal into an HTMLButtonElement. Nothing " +
      "imports it and it is not in the package's exports — it exists to be READ, " +
      "by someone deciding whether Portal does what they need. Its sentences are " +
      "the demonstration itself ('This portal is rendered inside the button " +
      "element!'), so porting them to a copy table would ask every host to " +
      "supply words for a screen no host mounts.",
  ],
]);

/**
 * Files that hold sample data rather than the package's own words: a story's
 * fixture table, a `*.fixtures.ts` file a test and a story share. Their strings
 * are what a HOST would pass — the other side of the question this gate asks.
 * Local to this gate on purpose: the copy and vocabulary gates ask about the
 * language of anything in the tarball, and a fixture is in the tarball.
 */
const SAMPLE_DATA = /(?:^|\/)(?:stories|fixtures)\/|(?:^|\/)fixtures\.[jt]sx?$|\.fixtures\.[jt]sx?$/;

export { copyProps, findLiterals, isCopyName, isCopyWord, isProse, templateHasWords, valueLiterals };

/** How a finding is keyed in the ledger, and printed in the failure list. */
export function describe(path, line, snippet) {
  return `${path}:${line} — ${snippet}`;
}

/**
 * `.tsx` and plain `.ts`, never a declaration file. A `copy/*.ts` contract is
 * types plus doc comments, and the packs (`en-US.*.ts`, `pt-BR.*.ts`,
 * `locales/`) are out of scope by `inScope` already: they are where the words
 * are SUPPOSED to be.
 */
const SCANNED = /(?<!\.d)\.tsx?$/;

function scanRepo() {
  const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
  const keyed = tracked
    .filter((path) => SCANNED.test(path) && inScope(path) && !DEV_SURFACES.has(path) && !SAMPLE_DATA.test(path))
    .flatMap((path) =>
      findLiterals(readFileSync(path, "utf8"), { jsx: path.endsWith(".tsx") }).map(([line, snippet]) =>
        describe(path, line, snippet),
      ),
    );
  return new Set(keyed);
}

function selftest() {
  const cases = [
    [findLiterals('<Button label="Publicar" />').length === 1, "a copy prop with a literal is a finding"],
    [findLiterals('<Button label={copy.publish} />').length === 0, "a copy prop reading a contract is not"],
    [findLiterals('<Box data-testid="publish-button" />').length === 0, "a test id is not copy"],
    [findLiterals('<Box className="publish" />').length === 0, "a class name is not copy"],
    [findLiterals("<Button>\n  Publicar\n</Button>").length === 1, "a prose text child is a finding"],
    [findLiterals("<SectionHeading>Agrupar por</SectionHeading>").length === 1, "and the same words on one line"],
    [findLiterals("<Box>{copy.groupBy}</Box>").length === 0, "an inline expression is not"],
    [findLiterals("const f: () => Promise<void> = g;").length === 0, "a generic is not a tag pair"],
    [findLiterals("<Text>Publicar</Text> and <Text>Salvar</Text>").length === 2, "both pairs on a line"],
    [findLiterals("<Button>\n  {copy.publish}\n</Button>").length === 0, "an expression child is not"],
    [findLiterals('<img alt="Foto do produto" />').length === 1, "alt text is copy"],
    [findLiterals('// <Button label="Publicar" />\nconst a = 1;').length === 0, "comments are stripped"],
    [findLiterals('<A aria-label="Zoom in" />').length === 1, "English is a finding too — the leak is the literal, not the language"],
    [isProse("Zoom in") && isProse("Publicar"), "prose in either language"],
    [!isProse("dataTestId") && !isProse("publish-button") && !isProse("MAX_ROWS"), "tokens are not prose"],
    [!isProse("https://x.test") && !isProse("./a/b") && !isProse("x"), "paths and single letters are not prose"],
    [inScope("packages/ui/src/components/form/Button.tsx"), "shipped src is in scope"],
    [[...DEV_SURFACES.values()].every((why) => why.length > 40), "every dev surface states why"],
    [!inScope("packages/ui/src/components/form/__tests__/Button.test.tsx"), "tests are out of scope"],
    // Shape 1, widened: one lower-case word in a slot that says it is read.
    [findLiterals('<IconButton aria-label="close" />').length === 1, "a lone lower-case word in aria-label is copy"],
    [findLiterals('<Spinner accessibilityLabel="loading" />').length === 1, "and in accessibilityLabel"],
    [findLiterals('<Panel closeLabel="close" />').length === 1, "and in a …Label prop"],
    [findLiterals('<Input type="email" variant="outlined" />').length === 0, "a lower-case word in a structural prop is not"],
    [findLiterals('<Box label="x" aria-label="_" />').length === 0, "a single character is not a word"],
    // Shape 2a, widened: the add-row glyph.
    [findLiterals("<Button>\n  + Medida\n</Button>").length === 1, "a text child led by `+ ` is a finding"],
    [findLiterals("<Button>\n  + 1\n</Button>").length === 0, "but `+ 1` carries no word"],
    // Shape 3: a copy prop given an expression.
    [findLiterals("<Dot aria-label={`Go to slide ${n}`} />").length === 1, "a template literal with a word is a finding"],
    [findLiterals("<Dot aria-label={`${a}/${b}`} key={`tab-${id}`} />").length === 0, "a template of placeholders and ids is not"],
    [findLiterals("<Chip label={`v${version}`} />").length === 0, "nor a prefix glued to a placeholder"],
    [findLiterals("<Btn title={open ? 'Collapse' : 'Expand'} />").length === 2, "both branches of a conditional are findings"],
    [findLiterals("<Btn title={copy[open ? 'collapse' : 'expand']} />").length === 0, "a conditional KEY lookup is not"],
    [findLiterals("<Tab aria-current={active ? 'page' : undefined} />").length === 0, "nor a conditional in a structural prop"],
    [findLiterals("<Img alt={label ?? 'Image'} />").length === 1, "a `??` fallback literal is a finding"],
    [findLiterals("<Img alt={label ?? copy.image} />").length === 0, "a `??` fallback from the pack is not"],
    [findLiterals("<Btn aria-label={t('close')} />").length === 0, "a call's argument is not a value the slot takes"],
    // Shape 4: an expression text child.
    [findLiterals("<Alert>\n  {error.message || 'Something failed'}\n</Alert>").length === 1, "a `||` fallback child is a finding"],
    [findLiterals("<Alert>\n  {error.message || copy.failed}\n</Alert>").length === 0, "the same child from the pack is not"],
    [findLiterals("<Text>{' '}</Text>").length === 0, "a spacer child is not"],
    // Shape 5: a defaults table, the PHONE_INPUT_DEFAULTS case.
    [findLiterals("const PHONE_INPUT_DEFAULTS = { label: 'Phone Number' };").length === 1, "a copy key in a defaults table is a finding"],
    [findLiterals("const PHONE_INPUT_DEFAULTS = { label: COPY.label, size: 'Medium Large' };").length === 0, "a pack read and a structural key are not"],
    [findLiterals("const tools = [{ label: 'bold', icon: Bold }];").length === 0, "a lone lower-case word under a key is a lookup key"],
    [findLiterals("throw { message: 'Webhook verification failed' };").length === 0, "an error body's message key is not copy"],
    // Shape 6: default parameter values.
    [findLiterals("function Card({ title = 'Sign in to continue' }) {}").length === 1, "a copy-named prop default is a finding"],
    [findLiterals("const required = (message = 'This field is required') => message;").length === 1, "and a curried validator's default"],
    [findLiterals("function Card({ title = COPY.title, size = 'Extra Large' }) {}").length === 0, "a pack default and a structural default are not"],
    [findLiterals("class E extends Error {\n  constructor(message = 'Webhook verification failed') {}\n}").length === 0, "an Error constructor's default is a developer's sentence"],
    [findLiterals("const label = 'Not a default';").length === 0, "a declaration is not a default"],
    // `.ts` files: only the two unambiguous shapes.
    [findLiterals("export const D = { placeholder: 'Search settings' };", { jsx: false }).length === 1, "a .ts defaults table is scanned"],
    [findLiterals('const html = `<Button label="Publicar" />`;', { jsx: false }).length === 0, "a .ts file gets no JSX shape"],
    [SCANNED.test("packages/forms-core/src/validators.ts") && !SCANNED.test("packages/ui/src/index.d.ts"), ".ts is scanned, .d.ts is not"],
  ];
  const failed = cases.filter(([ok]) => !ok);
  for (const [, name] of failed) console.error(`${LABEL} selftest FAILED: ${name}`);
  return failed.length === 0;
}

function main() {
  if (!selftest()) process.exit(1);
  const findings = scanRepo();
  const ledger = readLedger(EXCEPTIONS_PATH, { existsSync, readFileSync });
  const { failures, counts } = checkLedger({
    findings,
    ledger,
    ledgerPath: EXCEPTIONS_PATH,
    unlisted: (finding) =>
      `a word this package WROTE rather than asked for: ${finding} — user-facing copy is host ` +
      `config with no default. Add the key to the package's copy contract and its pt-BR pack, ` +
      `and read it here.`,
  });
  if (failures.length > 0) {
    console.error(`${LABEL} ${failures.length} violation(s):`);
    for (const failure of failures) console.error(`  ✗ ${failure}`);
    process.exit(1);
  }
  console.log(
    summarize({
      label: LABEL,
      total: findings.size,
      noun: "literal(s) in shipped .ts/.tsx",
      counts,
      burndown: "the burn-down is each package's copy contract",
    }),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
