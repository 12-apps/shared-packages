// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/* eslint-disable test-flakiness/no-unmocked-fs --
   the real source tree IS the subject: this asserts the module graph a
   consumer installs, which a memfs fixture could not. Reads only, of the
   working tree; nothing another case could observe. */

import * as hostedReturn from "../hosted-return";
import * as live from "../live";
import * as taxId from "../tax-id";

/**
 * The narrow entries a host imports on its first paint (FUT-1055):
 * `hosted-return`, `live` and `tax-id`. None may reach a checkout screen.
 *
 * Each case walks the entry's module graph through every import form a
 * file can take: `import … from`, `export … from`, a side-effect
 * `import "…"`, and a dynamic `import("…")` (a lazy screen is still one a host
 * fetches through this entry). `import type` is followed too: harmless at run
 * time, but a type file that grows a value import would join the graph unseen
 * otherwise. Each graph is pinned twice: no component file and no package but
 * the ones named, and the exact file list, so a file joining the graph is a
 * decision rather than a drift. The walk's own spellings are pinned below.
 */
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** `import|export … from "x"`, a side-effect `import "x"`, and a dynamic `import("x")`. */
const IMPORT_FORMS = [
  /(?:^|[\n;])\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/g,
  /(?:^|[\n;])\s*import\s+["']([^"']+)["']/g,
  /\bimport\(\s*["']([^"']+)["']\s*\)/g,
];

function resolve(from: string, spec: string): string {
  const base = path.resolve(path.dirname(from), spec);
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    try {
      readFileSync(candidate);
      return candidate;
    } catch {
      // Not this spelling.
    }
  }
  throw new Error(`cannot resolve ${spec} from ${from}`);
}

/** The specifiers a source text imports, re-exports, imports for effect or imports lazily. */
function specifiersIn(text: string): string[] {
  return IMPORT_FORMS.flatMap((form) => [...text.matchAll(form)].map((match) => match[1] as string));
}

/** The specifiers one file reaches. */
function importsOf(file: string): string[] {
  return specifiersIn(readFileSync(file, "utf8"));
}

/** Every file reachable from `from` through relative imports, and every package specifier met on the way. */
function walk(from: string, seen: ReadonlySet<string> = new Set()): { files: Set<string>; external: Set<string> } {
  const reached = { files: new Set([...seen, from]), external: new Set<string>() };
  for (const spec of importsOf(from)) {
    if (!spec.startsWith(".")) {
      reached.external.add(spec);
      continue;
    }
    const next = resolve(from, spec);
    if (reached.files.has(next)) continue;
    const deeper = walk(next, reached.files);
    deeper.files.forEach((file) => reached.files.add(file));
    deeper.external.forEach((name) => reached.external.add(name));
  }
  return reached;
}

function graph(entry: string): { files: string[]; external: string[] } {
  const { files, external } = walk(path.join(SRC, entry, "index.ts"));
  return { files: [...files].map((file) => path.relative(SRC, file)).sort(), external: [...external].sort() };
}

const ENTRIES = [
  {
    entry: "hosted-return",
    components: [],
    packages: [],
    files: [
      "components/checkout/basket.ts",
      "components/checkout/debit-types.ts",
      "components/checkout/decline.ts",
      "components/checkout/google-pay-params.ts",
      "components/checkout/hosted-return.ts",
      "components/checkout/hosted-store.ts",
      "components/checkout/types.ts",
      "hosted-return/index.ts",
    ],
  },
  {
    // A provider, not a screen: the one component file is the context itself.
    entry: "live",
    components: ["components/checkout/live-context.tsx"],
    packages: ["react"],
    files: [
      "components/checkout/live-context.tsx",
      "components/checkout/poll-delay.ts",
      "components/checkout/poll-hint.ts",
      "components/checkout/poll-live.ts",
      "components/checkout/poll-loop.ts",
      "components/checkout/poll-rearm.ts",
      "components/checkout/types.ts",
      "components/checkout/debit-types.ts",
      "components/checkout/decline.ts",
      "components/checkout/google-pay-params.ts",
      "live/index.ts",
      "result.ts",
    ].sort(),
  },
  {
    entry: "tax-id",
    components: [],
    packages: [],
    files: ["card/copy.ts", "card/cpf.ts", "card/format.ts", "card/tax-id.ts", "tax-id/index.ts"],
  },
] as const;

describe.each(ENTRIES)("@12-apps/payments-frontend/$entry", ({ entry, components, packages, files }) => {
  it("reaches no component and no package but the ones named", () => {
    const reached = graph(entry);
    expect(reached.files.filter((file) => file.endsWith(".tsx"))).toEqual([...components]);
    expect(reached.external).toEqual([...packages]);
  });

  it("is these files and no more", () => {
    expect(graph(entry).files).toEqual([...files]);
  });
});

describe("the walk sees every import form (code review B1)", () => {
  it.each([
    ['import { a } from "../x";', "../x"],
    ['export { a } from "../x";', "../x"],
    ['import type { A } from "../x";', "../x"],
    ['import "../components/checkout/checkout-flow";', "../components/checkout/checkout-flow"],
    ['const flow = () => import("../components/checkout/checkout-flow");', "../components/checkout/checkout-flow"],
    ["const flow = () => import( '../x' );", "../x"],
  ])("%s", (text, specifier) => {
    expect(specifiersIn(text)).toEqual([specifier]);
  });

  it("does not read a word that merely contains import", () => {
    expect(specifiersIn('const reimport = "../x"; // importing nothing')).toEqual([]);
  });
});

describe("what the narrow entries export", () => {
  it("hosted-return answers the host gate's question and names the parked entry's key", () => {
    expect(typeof hostedReturn.hostedCheckoutReturnPending).toBe("function");
    expect(hostedReturn.HOSTED_ORDER_STORAGE_KEY).toBe("payments.checkout.hostedOrder");
    expect(typeof hostedReturn.basketSignature).toBe("function");
  });

  it("live hands the provider and its default cadence", () => {
    expect(typeof live.CheckoutLiveProvider).toBe("function");
    expect(live.DEFAULT_LIVE_INTERVAL_MS).toBe(15_000);
  });

  it("tax-id checks a CPF and a CNPJ", () => {
    expect(taxId.isValidCpfOrCnpj("529.982.247-25")).toBe(true);
    expect(taxId.formatCpf("52998224725")).toBe("529.982.247-25");
    expect(typeof taxId.validateCpf).toBe("function");
    expect(typeof taxId.validateCpfOrCnpj).toBe("function");
  });
});
