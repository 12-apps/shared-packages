// The vocabulary-portability gate: shipped package source names no domain of
// the application these packages were extracted from.
//
// The copy gate (`copy-portability-gate.mjs`) finds pt-BR by its DIACRITICS,
// which is the highest-signal indicator of language there is — and its own
// header names what that structurally cannot see:
//
//   "Domain-vocabulary leaks in plain English (a `kitchen`/`service` kind
//    union) are a REAL smell this gate does not see; those stay with the
//    per-package portability suites, which judge vocabulary, not language."
//
// Those suites existed for 7 of 30 packages. A per-package suite is a file
// somebody has to remember to write, and the packages most likely to leak are
// the ones nobody wrote one for: `@12-apps/shift` exported
// `SHIFT_KINDS = ['kitchen', 'service']` and validated against those two
// literals, so a dental clinic adopting it got `kitchen` in its types AND in
// its OpenAPI. That is worse than a string leak — a string is cosmetic, a
// union is structural, and it propagates into every adopter's wire contract.
// This gate is the repo-wide half, which is the same argument the copy gate
// won: a gate nobody has to remember beats a suite everybody must.
//
// It also catches a language leak the copy gate misses by construction.
// "Pagamento seguro" carries no diacritic at all, and shipped for months in a
// buyer-facing screen with nothing red.
//
// ## WHAT IS BANNED: the origin application's nouns, not English
//
// PATTERNS, not substrings, and every one word-bounded. The discipline the
// per-package lists learned is that a ban which cries wolf gets deleted, and
// then it protects nothing — so each entry below was measured against the
// whole tree before it was admitted, and `waiter` was MEASURED AND DROPPED:
// `@12-apps/impersonation` keeps a `Set` of promise waiters, which is
// ordinary English and not a dining room. `garçom` covers the real noun.
//
// Deliberately NOT here, each for a reason worth writing down, because an
// unexplained gap in a completeness gate is indistinguishable from an
// oversight:
//
//   - `order`, `table`, `client`, `menu`, `sector`, `shift` — ordinary
//     English a generic package cannot describe itself without. `clientId` is
//     the tenant key in every package here; a `table` is what SQL and HTML
//     both call one; `MenuItem` is a component MUI ships.
//   - PROVIDER names (`pagbank`, `stripe`) — `payments/no-provider-names` in
//     `eslint.payments-portability.config.mjs` owns those, and scopes out
//     `packages/payments/**` deliberately, because naming PagBank is that
//     package's whole subject. A repo-wide ban would have to re-import that
//     exemption and would then disagree with it.
//   - The application's BRAND — `host-brand-gate.mjs` owns it, sweeps every
//     tracked file with no allowlist, and base64-decodes its patterns so it
//     is not its own first hit. This gate needs no such trick: `kitchen` is
//     not a brand, and `scripts/**` is not shipped source.
//
// ## THE RATCHET
//
// `.vocabulary-portability-exceptions.json`, shrink-only in both directions —
// a NEW finding fails (you cannot grandfather forward) and an entry whose
// file no longer leaks fails as stale (delete the line). Most entries are
// files the COPY ratchet already carries: the same pt-BR sentence that trips
// the diacritics gate usually names a mesa or a pedido too, and one burn-down
// clears both. They are listed here anyway rather than deferred to that
// ledger, because deferring would mean a file already fenced for its language
// could grow a `kitchen` union with nothing red — which is the exact failure
// this gate was built for.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { globToRegExp, inScope } from "./lib/shipped-source.mjs";
import { stripComments } from "./copy-portability-gate.mjs";

const LABEL = "[vocabulary-portability]";
const EXCEPTIONS_PATH = ".vocabulary-portability-exceptions.json";

/**
 * The origin application's domain nouns — a storefront selling food, with a
 * dining room and a kitchen behind it — in English and in Portuguese, accented
 * or not. Accent-INSENSITIVE on purpose: the accented spelling is already the
 * copy gate's, and the unaccented one is precisely what it cannot see.
 *
 * Built fresh per call so no caller can mutate what a later one checks against.
 */
export function bannedVocabulary() {
  return [
    // The kitchen, and the room the food is carried into.
    { label: "kitchen", pattern: /\bkitchens?\b/i },
    { label: "cozinha", pattern: /\bcozinhas?\b/i },
    { label: "garçom", pattern: /gar[çc]o(m|ns)\b/i },
    { label: "salão", pattern: /\bsal[ãa]o\b/i },
    { label: "mesa", pattern: /\bmesas?\b/i },
    { label: "comanda", pattern: /\bcomandas?\b/i },
    { label: "balcão", pattern: /\bbalc[ãa]o\b/i },
    // What it sells, and where.
    { label: "cardápio", pattern: /card[áa]pios?\b/i },
    { label: "loja", pattern: /\blojas?\b/i },
    { label: "storefront", pattern: /\bstorefronts?\b/i },
    { label: "restaurant", pattern: /\brestaurants?\b/i },
    // The transaction, in the origin host's language. `pagamento` is the one
    // that proves the point: no diacritic, so the copy gate is blind to it.
    { label: "pedido", pattern: /\bpedidos?\b/i },
    { label: "pagamento", pattern: /\bpagamentos?\b/i },
    { label: "entrega", pattern: /\bentregas?\b/i },
    { label: "situação", pattern: /\bsitua[çc][ãa]o\b/i },
    // The back office.
    { label: "estoque", pattern: /\bestoques?\b/i },
    { label: "fornecedor", pattern: /\bfornecedor(es)?\b/i },
  ];
}

/**
 * Every banned label present in comment-stripped source, with the line of its
 * first offence. One pass per pattern over the whole text (none is sticky or
 * global, so `match` finds the first hit), and the line number is counted only
 * for actual hits — never lines x patterns.
 */
export function findLeaks(source) {
  const stripped = stripComments(source);
  const found = new Map();
  for (const { label, pattern } of bannedVocabulary()) {
    const match = stripped.match(pattern);
    if (match?.index === undefined) continue;
    found.set(label, stripped.slice(0, match.index).split("\n").length);
  }
  return found;
}

function scanRepo() {
  const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
  const findings = new Map();
  for (const path of tracked) {
    if (!inScope(path)) continue;
    const leaks = findLeaks(readFileSync(path, "utf8"));
    if (leaks.size > 0) findings.set(path, leaks);
  }
  return findings;
}

function readExceptions() {
  if (!existsSync(EXCEPTIONS_PATH)) return {};
  return JSON.parse(readFileSync(EXCEPTIONS_PATH, "utf8"));
}

/** How a finding reads in the failure list: `path:line — label, label`. */
export function describe(path, leaks) {
  const parts = [...leaks.entries()].sort((a, b) => a[1] - b[1]);
  const line = Math.min(...parts.map(([, n]) => n));
  return `${path}:${line} — ${parts.map(([label]) => label).join(", ")}`;
}

function selftest() {
  const cases = [
    [findLeaks("const KINDS = ['kitchen', 'service'];").get("kitchen") === 1, "a kind union is a leak"],
    [findLeaks("// kitchen, in a comment\nconst a = 1;").size === 0, "comments are stripped"],
    [findLeaks('const t = "Pagamento seguro";').get("pagamento") === 1, "unaccented pt-BR is a leak"],
    [findLeaks("const waiters = new Set();\nfor (const waiter of waiters) waiter();").size === 0, "promise waiters are English"],
    [findLeaks("const rows = await db.table('x');\nconst order = 'asc';").size === 0, "table and order are English"],
    [findLeaks("import { MenuItem } from '@mui/material';").size === 0, "MUI's MenuItem is not a menu leak"],
    [findLeaks("const n = mesada + lojista;").size === 0, "word boundaries hold"],
    [findLeaks("const s = 'situacao';").get("situação") === 1, "accent-insensitive"],
    [inScope("packages/shift/src/types.ts"), "shipped src is in scope"],
    [!inScope("packages/shift/src/__tests__/service.test.ts"), "tests are out of scope"],
    [!inScope("packages/payments/frontend/src/stories/store.ts"), "a manifest-excluded path does not ship"],
    // The \`files\` translation — the half of scope that is not a literal
    // regex in this repo, so it has nowhere else to be checked. npm reads
    // these globs gitignore-style; the cases are the shapes our manifests use.
    [globToRegExp("src/stories/**").test("src/stories/host.tsx"), "a ** suffix matches beneath it"],
    [!globToRegExp("src/stories/**").test("src/flows/host.tsx"), "and not a sibling directory"],
    [globToRegExp("**/__tests__/**").test("__tests__/x.ts"), "a leading **/ may match nothing"],
    [globToRegExp("*.test.*").test("src/a/b.test.ts"), "a slashless glob matches at any depth"],
    [!globToRegExp("*.test.*").test("src/a/btest.ts"), "its dots stay literal"],
  ];
  const failed = cases.filter(([ok]) => !ok);
  for (const [, name] of failed) console.error(`${LABEL} selftest FAILED: ${name}`);
  return failed.length === 0;
}

function main() {
  if (!selftest()) process.exit(1);
  const findings = scanRepo();
  const exceptions = readExceptions();
  const failures = [];
  for (const [path, leaks] of findings) {
    if (!(path in exceptions)) {
      failures.push(
        `origin-host vocabulary in shipped source: ${describe(path, leaks)} — a domain noun in a ` +
          `published type, value or string becomes every adopter's wire contract. Take it from host ` +
          `config, or name it for the shape rather than for the application.`,
      );
    }
  }
  for (const path of Object.keys(exceptions)) {
    if (!findings.has(path)) {
      failures.push(
        `stale exception: ${path} no longer leaks (or no longer exists) — delete its line from ${EXCEPTIONS_PATH}`,
      );
    }
  }
  if (failures.length > 0) {
    console.error(`${LABEL} ${failures.length} violation(s):`);
    for (const failure of failures) console.error(`  ✗ ${failure}`);
    process.exit(1);
  }
  console.log(
    `${LABEL} clean — ${findings.size} file(s) naming the origin host's domain, all ` +
      `${Object.keys(exceptions).length} grandfathered (shrink-only).`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
