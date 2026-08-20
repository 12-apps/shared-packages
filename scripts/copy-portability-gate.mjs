// The copy-portability gate: shipped package source carries no pt-BR.
//
// The doctrine is payments' (FUT-760): user-facing copy is HOST vocabulary.
// A package states the copy it NEEDS as required config and ships no
// defaults — because a default in the origin host's language reads as
// finished to the next host right up until "a host selling insurance got a
// waiter, and nothing failed". That rule lived as prose plus one
// payments-scoped lint, and a brand-new package reintroduced the
// anti-pattern on day one: optional copy with pt-BR defaults, plus a route
// surface answering "Não autenticado." with no copy port at all. Nothing
// red. This gate is the mechanism the prose was missing, repo-wide.
//
// WHAT IT DETECTS: pt-BR diacritics in comment-stripped shipped source
// (`packages/*/…/src/**`). Accents are the highest-signal, lowest-noise
// indicator there is — English identifiers and prose never carry them, and
// real Portuguese copy essentially always does within a sentence or two.
// Domain-vocabulary leaks in plain English (a `kitchen`/`service` kind
// union) are a REAL smell this gate does not see; those stay with the
// per-package portability suites, which judge vocabulary, not language.
//
// WHAT MAY SHIP PORTUGUESE, by category (not allowlist):
//   - a NAMED PACK — a file whose name says what it is (`pt-BR.ts`,
//     `copy.pt-br.ts`, anything under `locales/`). That is the sanctioned
//     pattern: a host imports `PT_BR_MESSAGES` and passes it BY HAND, so
//     choosing Portuguese is a line in the host's diff, never a silence.
//   - tests, stories, e2e worlds and Gherkin features — a spec that clicks
//     "Continuar com Google" or seeds "Cantina do Porto" is exercising
//     product copy, not shipping it.
//
// THE RATCHET: `.copy-portability-exceptions.json` grandfathers the leaks
// that predate the gate, each with a written reason. Shrink-only in both
// directions — a NEW finding fails (you cannot grandfather forward), and an
// entry whose file no longer leaks fails as stale (delete the line). The
// burn-down is each package's wiring adoption wave, where its copy becomes
// required config.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const LABEL = "[copy-portability]";
const EXCEPTIONS_PATH = ".copy-portability-exceptions.json";

// The diacritics Portuguese actually uses (both cases). ü/ï etc. are left
// out on purpose: they would only widen the net toward other languages this
// repo does not ship.
const PT_BR_DIACRITICS = /[àáâãçéêíóôõú]/i;

const SHIPPED_SOURCE = /^packages\/[^/]+(?:\/[^/]+)?\/src\/.+\.(?:ts|tsx|js|jsx|mjs)$/;
const CATEGORY_EXCLUDED =
  /(?:__tests__|__stories__|\.test\.|\.spec\.|\.stories\.|\.test-story\.|(?:^|\/)e2e\/|(?:^|\/)features\/|test-helpers)/;
const NAMED_PACK = /(?:pt-?br[^/]*\.(?:ts|tsx|js|jsx|mjs)$|(?:^|\/)locales\/)/i;

/**
 * Strip `//` and `/* *\/` comments, KEEPING string/template contents — the
 * leak is what ships to a user, and that lives in strings and JSX text. A
 * small state machine rather than regexes: a `//` inside a string is copy,
 * not a comment.
 */
export function stripComments(source) {
  let out = "";
  let state = "code"; // code | line | block | single | double | template
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];
    if (state === "code") {
      if (ch === "/" && next === "/") {
        state = "line";
        i += 1;
      } else if (ch === "/" && next === "*") {
        state = "block";
        i += 1;
      } else {
        if (ch === "'") state = "single";
        else if (ch === '"') state = "double";
        else if (ch === "`") state = "template";
        out += ch;
      }
    } else if (state === "line") {
      if (ch === "\n") {
        state = "code";
        out += ch;
      }
    } else if (state === "block") {
      if (ch === "*" && next === "/") {
        state = "code";
        i += 1;
      } else if (ch === "\n") {
        out += ch; // keep line numbers stable
      }
    } else {
      if (ch === "\\") {
        out += ch + (next ?? "");
        i += 1;
        continue;
      }
      if (
        (state === "single" && ch === "'") ||
        (state === "double" && ch === '"') ||
        (state === "template" && ch === "`")
      ) {
        state = "code";
      }
      out += ch;
    }
  }
  return out;
}

/** First offending line (1-based) in comment-stripped source, or null. */
export function firstLeakLine(source) {
  const lines = stripComments(source).split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (PT_BR_DIACRITICS.test(lines[i])) return i + 1;
  }
  return null;
}

/** Whether a tracked path is in scope for the scan at all. */
export function inScope(path) {
  return SHIPPED_SOURCE.test(path) && !CATEGORY_EXCLUDED.test(path) && !NAMED_PACK.test(path);
}

function scanRepo() {
  const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  const findings = new Map();
  for (const path of tracked) {
    if (!inScope(path)) continue;
    const line = firstLeakLine(readFileSync(path, "utf8"));
    if (line !== null) findings.set(path, line);
  }
  return findings;
}

function readExceptions() {
  if (!existsSync(EXCEPTIONS_PATH)) return {};
  return JSON.parse(readFileSync(EXCEPTIONS_PATH, "utf8"));
}

function selftest() {
  const cases = [
    [firstLeakLine('const a = "Não autenticado.";') === 1, "accented string is a leak"],
    [firstLeakLine("// não — comment only\nconst a = 1;") === null, "comments are stripped"],
    [firstLeakLine('const url = "https://x/a//b";\nconst b = "ação";') === 2, "// inside a string is not a comment"],
    [firstLeakLine("const t = `Relatório ${x}`;") === 1, "template copy is a leak"],
    [inScope("packages/x/src/server/routes.ts"), "shipped src is in scope"],
    [inScope("packages/payments/backend/src/copy.ts"), "nested package src is in scope"],
    [!inScope("packages/x/src/react/pt-BR.ts"), "a named pack may ship Portuguese"],
    [!inScope("packages/x/src/__tests__/copy.test.ts"), "tests are out of scope"],
    [!inScope("packages/x/src/e2e/steps.ts"), "e2e worlds are out of scope"],
    [!inScope("apps/anything/src/page.ts"), "only packages/* ships"],
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
  for (const [path, line] of findings) {
    if (!(path in exceptions)) {
      failures.push(
        `pt-BR in shipped source: ${path}:${line} — copy is host vocabulary. Move it behind ` +
          `required copy config, or ship it as a named pt-BR pack a host imports by hand.`,
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
  const grandfathered = Object.keys(exceptions).length;
  console.log(
    `${LABEL} clean — ${findings.size} pt-BR file(s), all ${grandfathered} grandfathered (shrink-only; the burn-down is each package's adoption wave).`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
