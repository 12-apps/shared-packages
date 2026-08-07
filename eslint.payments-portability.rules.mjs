import { readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The three PORTABILITY rules, and the provider-name list they are built on.
 * Wired up (scope, severities, ignores) by
 * `eslint.payments-portability.config.mjs`, which is where the rationale for
 * the gate as a whole lives — read that first.
 *
 * Split out for one boring reason: the repo's own complexity gate caps a file
 * at 400 lines and `.quality-exceptions` is burned down, so grandfathering the
 * gate that enforces portability would have been a poor first act. The seam is
 * a real one anyway — rule BEHAVIOUR here, rule SCOPE there.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Provider names, DERIVED from the adapter catalog
// ---------------------------------------------------------------------------

const CATALOG_PATH = join(
  HERE,
  "packages/payments/backend/src/providers/catalog.ts",
);

/**
 * The keys of `providerCatalog` — the package's own canonical list of shipped
 * adapters — scraped from the source rather than retyped here.
 *
 * A hand-kept copy is a gate that rots: the fifth provider lands, nobody edits
 * this file, and the rule reports green for precisely the vendor whose name
 * nobody has swept for yet. Same argument `catalog.ts` makes for itself.
 *
 * Deliberately THROWS when the scrape comes back empty. If the catalog is
 * renamed or reshaped, the correct outcome is a loud failure — a silently
 * empty name list would build a regex that matches nothing and turn this rule
 * into decoration.
 */
function catalogProviderNames() {
  const source = readFileSync(CATALOG_PATH, "utf8");
  const body = source.match(
    /export const providerCatalog\s*=\s*\{([\s\S]*?)^\}/m,
  );
  if (!body) {
    throw new Error(
      `payments-portability: could not find \`export const providerCatalog\` in ${CATALOG_PATH}. ` +
        `The gate derives provider names from it; fix the scrape rather than hardcoding a list.`,
    );
  }
  const names = [...body[1].matchAll(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*:/gm)].map(
    (m) => m[1],
  );
  if (names.length === 0) {
    throw new Error(
      `payments-portability: \`providerCatalog\` in ${CATALOG_PATH} yielded no provider names. ` +
        `Refusing to run a gate whose pattern matches nothing.`,
    );
  }
  return names;
}

/**
 * Names a vendor answers to that are NOT registry keys, so the catalog cannot
 * supply them. One entry today: PagBank was PagSeguro until the 2019 rebrand,
 * and the old name is still what its API hosts, its webhook paths and its
 * browser SDK are called — so it is the spelling a drifting consumer is most
 * likely to hardcode.
 *
 * Keyed by the registry name it belongs to, so an adapter leaving the catalog
 * takes its aliases with it.
 */
const VENDOR_ALIASES = {
  pagbank: ["pagseguro"],
};

export const PROVIDER_NAMES = (() => {
  const registry = catalogProviderNames();
  const aliases = registry.flatMap((name) => VENDOR_ALIASES[name] ?? []);
  return [...new Set([...registry, ...aliases])].sort();
})();

/**
 * Word-bounded and case-insensitive. The boundaries are load-bearing: `stripe`
 * without them matches `striped`, `stripeColor` and `TableStripeColor` all over
 * `packages/ui`, and `stone` matches `milestone`. A rule that cries wolf on the
 * table component gets disabled within a week.
 */
const PROVIDER_RE = new RegExp(`\\b(${PROVIDER_NAMES.join("|")})\\b`, "i");

/**
 * Exact matches for PROPERTY KEYS, which are identifiers rather than strings
 * and so never reach the literal check. `{ pagbank: …, stone: …, stripe: … }`
 * — a record keyed by vendor — is the single most common shape a consumer's
 * drift takes, and it is what both harness fixtures look like today.
 *
 * Exact rather than word-bounded on purpose: `stripeColor` is a legitimate
 * prop name in `packages/ui`, `stripe` is not.
 */
const PROVIDER_KEYS = new Set(PROVIDER_NAMES);

// ---------------------------------------------------------------------------
// Rule 1 — the payments package imports nothing repo-specific
// ---------------------------------------------------------------------------

const PAYMENTS_ROOT = join(HERE, "packages", "payments");

/**
 * Scoped specifiers the payments package MAY name. Both halves of the package
 * itself (the frontend depends on the backend for types), plus the two tooling
 * configs, which are genuinely generic — they carry an ESLint preset and a
 * tsconfig, are `devDependencies`, and are reached from `eslint.config.js` /
 * `tsconfig.json` rather than from any source file. Vendoring the folder into
 * another repo drops them with no code change.
 *
 * Everything else under `@12-apps/*` / `@repo/*` — shared-helpers, ui, auth,
 * rbac, … — is repo-specific for this purpose: real or not as a shared
 * library, it is not something an adopting repo is guaranteed to have.
 */
const ALLOWED_SCOPED_IMPORTS = new Set([
  "@12-apps/payments-backend",
  "@12-apps/payments-frontend",
  "@12-apps/eslint-config",
  "@12-apps/typescript-config",
]);

const SCOPED_RE = /^(@12-apps\/[^/]+|@repo\/[^/]+)/;

function scopedViolation(specifier) {
  const scope = SCOPED_RE.exec(specifier)?.[1];
  if (!scope || ALLOWED_SCOPED_IMPORTS.has(scope)) return null;
  return (
    `\`${specifier}\` is a sibling workspace package. Nothing under packages/payments/ may import one — ` +
    `the package is meant to be published or vendored into a repo that does not have it (ADOPTING.md §6). ` +
    `Move what you need into packages/payments/, or take it as a constructor port from the host.`
  );
}

const HARNESS_ROOT = join(HERE, "harness");

const under = (target, root) => target === root || target.startsWith(root + sep);

const harnessMessage = (specifier) =>
  `\`${specifier}\` imports the consumer harness. harness/ exists to drive the PUBLISHED payments packages ` +
  `from the outside, the way an adopting repo does; an import back the other way inverts that and makes the ` +
  `package unshippable.`;

/**
 * Relative imports are judged by where they RESOLVE, not by how they read.
 * `./harness` in `backend/src/checkout/__tests__/` is that suite's own test
 * harness and perfectly fine; `../../../../harness/...` is the consumer
 * fixture app and is not. A rule that matched the word would have failed four
 * existing test files and been switched off the same afternoon.
 */
function relativeViolation(specifier, filename) {
  if (!specifier.startsWith(".")) return null;
  const target = resolve(dirname(filename), specifier);
  if (under(target, PAYMENTS_ROOT)) return null;
  if (under(target, HARNESS_ROOT)) return harnessMessage(specifier);
  return (
    `\`${specifier}\` reaches outside packages/payments/. The package must be liftable as a folder, ` +
    `so every relative import has to stay inside it (ADOPTING.md §6).`
  );
}

/** A bare `harness/...` specifier — the same reach, spelled as a package. */
function bareHarnessViolation(specifier) {
  if (specifier.startsWith(".")) return null;
  return /^harness(\/|$)/.test(specifier) ? harnessMessage(specifier) : null;
}

const noHostImports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "packages/payments/** may not import the harness or a sibling workspace package",
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename ?? context.getFilename();
    const check = (node, specifier) => {
      if (typeof specifier !== "string") return;
      const message =
        bareHarnessViolation(specifier) ??
        scopedViolation(specifier) ??
        relativeViolation(specifier, filename);
      if (message) context.report({ node, message });
    };
    return {
      ImportDeclaration: (node) => check(node.source, node.source.value),
      ImportExpression: (node) =>
        node.source.type === "Literal" && check(node.source, node.source.value),
      ExportNamedDeclaration: (node) =>
        node.source && check(node.source, node.source.value),
      ExportAllDeclaration: (node) =>
        node.source && check(node.source, node.source.value),
      "CallExpression[callee.name='require']": (node) => {
        const arg = node.arguments[0];
        if (arg?.type === "Literal") check(arg, arg.value);
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Rule 2 — no provider name in a string literal outside the package
// ---------------------------------------------------------------------------

const noProviderNameLiteral = {
  meta: {
    type: "problem",
    docs: {
      description:
        "provider-name string literals belong inside packages/payments/**",
    },
    schema: [],
  },
  create(context) {
    const flag = (node, name) =>
      context.report({
        node,
        message:
          `"${name}" is a payment provider's name. Provider names live inside packages/payments/** and ` +
          `nowhere else (ADOPTING.md §6): outside it, branch on a capability the adapter reports, not on who ` +
          `the vendor is. Known providers: ${PROVIDER_NAMES.join(", ")}. If this really is provider-specific ` +
          `by design, add an entry to PROVIDER_NAME_EXEMPT_GLOBS in eslint.payments-portability.config.mjs ` +
          `with a comment saying why, or an \`eslint-disable-next-line payments/no-provider-name-literal -- <reason>\`.`,
      });
    const reportText = (node, text) => {
      const hit = PROVIDER_RE.exec(text);
      if (hit) flag(node, hit[1]);
    };
    const reportKey = (node) => {
      const key = node.key;
      if (node.computed || key?.type !== "Identifier") return;
      if (PROVIDER_KEYS.has(key.name.toLowerCase())) flag(key, key.name);
    };
    return {
      Literal: (node) =>
        typeof node.value === "string" && reportText(node, node.value),
      TemplateElement: (node) => reportText(node, node.value.raw ?? ""),
      JSXText: (node) => reportText(node, node.value),
      Property: reportKey,
      PropertyDefinition: reportKey,
      TSPropertySignature: reportKey,
    };
  },
};

// ---------------------------------------------------------------------------
// Rule 3 — the frontend takes only TYPES from the backend
// ---------------------------------------------------------------------------

const BACKEND_PKG = "@12-apps/payments-backend";

/**
 * A backend import, by EITHER name it can arrive under.
 *
 * The bare specifier is the obvious one. The relative one is the hole: inside
 * this repo `packages/payments/frontend` and `.../backend` are siblings on
 * disk, so `../../backend/src/core/registry` pulls the same server code — and
 * the same `node:crypto` — into a browser bundle while never spelling the
 * package name. Judging the RESOLVED path rather than the string is what makes
 * the rule about the harm instead of about the spelling.
 */
const BACKEND_DIR = `${sep}payments${sep}backend${sep}`;

const isBackendSpecifier = (specifier, fromFile) => {
  if (typeof specifier !== "string") return false;
  if (specifier === BACKEND_PKG || specifier.startsWith(`${BACKEND_PKG}/`)) return true;
  if (!specifier.startsWith(".")) return false;
  const resolved = resolve(dirname(fromFile ?? ""), specifier);
  return `${resolved}${sep}`.includes(BACKEND_DIR);
};

const RUNTIME_MESSAGE =
  `packages/payments/frontend may import only TYPES from ${BACKEND_PKG} (ADOPTING.md §6). ` +
  `A runtime value pulls server code — and its \`node:crypto\` imports — into a browser bundle. ` +
  `Use \`import type { … }\`, or reach the behaviour over the host's mounted HTTP surface via src/client.ts.`;

const frontendTypesOnly = {
  meta: {
    type: "problem",
    docs: {
      description: `packages/payments/frontend imports only types from ${BACKEND_PKG}`,
    },
    schema: [],
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        if (!isBackendSpecifier(node.source.value, context.filename)) return;
        if (node.importKind === "type") return;
        // A bare `import '@12-apps/payments-backend'` has no specifiers at all
        // and exists purely for its side effects — the most runtime thing there
        // is.
        if (node.specifiers.length === 0) {
          context.report({ node, message: RUNTIME_MESSAGE });
          return;
        }
        for (const specifier of node.specifiers) {
          // Default and namespace bindings are always values; a named specifier
          // is a value unless it carries its own inline `type`.
          const isType =
            specifier.type === "ImportSpecifier" &&
            specifier.importKind === "type";
          if (!isType) context.report({ node: specifier, message: RUNTIME_MESSAGE });
        }
      },
      ExportNamedDeclaration(node) {
        if (!node.source || !isBackendSpecifier(node.source.value, context.filename)) return;
        if (node.exportKind === "type") return;
        for (const specifier of node.specifiers) {
          if (specifier.exportKind !== "type") {
            context.report({ node: specifier, message: RUNTIME_MESSAGE });
          }
        }
      },
      ExportAllDeclaration(node) {
        if (!node.source || !isBackendSpecifier(node.source.value, context.filename)) return;
        if (node.exportKind === "type") return;
        context.report({ node, message: RUNTIME_MESSAGE });
      },
      ImportExpression(node) {
        if (node.source.type === "Literal" && isBackendSpecifier(node.source.value, context.filename)) {
          context.report({ node, message: RUNTIME_MESSAGE });
        }
      },
      "CallExpression[callee.name='require']": (node) => {
        const arg = node.arguments[0];
        if (arg?.type === "Literal" && isBackendSpecifier(arg.value)) {
          context.report({ node, message: RUNTIME_MESSAGE });
        }
      },
    };
  },
};

export const paymentsPortabilityPlugin = {
  rules: {
    "no-host-imports": noHostImports,
    "no-provider-name-literal": noProviderNameLiteral,
    "frontend-types-only": frontendTypesOnly,
  },
};
