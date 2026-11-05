// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/* eslint-disable test-flakiness/no-unmocked-fs --
   the real source tree IS the subject: this asserts the module graph a
   consumer installs, which a memfs fixture could not. Reads only, of the
   working tree; nothing another case could observe. */

import * as entry from "../index";

/**
 * The `hosted-return` entry is asked at a host's boot, before any checkout
 * screen is drawn (FUT-1055): its whole module graph is plain functions and
 * types. This walks the graph from the entry, following relative imports
 * (`import type` included: harmless at runtime, but a type file that grows a
 * value import would join the graph unseen otherwise), and refuses any file
 * that is a component, or any import of React, MUI or another package.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.resolve(HERE, "../index.ts");
const IMPORT = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/g;

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

/** The specifiers one file imports or re-exports from. */
function importsOf(file: string): string[] {
  return [...readFileSync(file, "utf8").matchAll(IMPORT)].map((match) => match[1] as string);
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

function graph(): { files: string[]; external: string[] } {
  const { files, external } = walk(ENTRY);
  return { files: [...files].map((file) => path.relative(path.resolve(HERE, "../.."), file)).sort(), external: [...external].sort() };
}

describe("@12-apps/payments-frontend/hosted-return", () => {
  it("reaches no component, and no package at all", () => {
    const { files, external } = graph();
    expect(files.filter((file) => file.endsWith(".tsx"))).toEqual([]);
    expect(external).toEqual([]);
  });

  it("is these files and no more: a new one is a decision, not a drift", () => {
    expect(graph().files).toEqual([
      "components/checkout/basket.ts",
      "components/checkout/debit-types.ts",
      "components/checkout/decline.ts",
      "components/checkout/google-pay-params.ts",
      "components/checkout/hosted-return.ts",
      "components/checkout/hosted-store.ts",
      "components/checkout/types.ts",
      "hosted-return/index.ts",
    ]);
  });

  it("answers the host gate's question and names the parked entry's key", () => {
    expect(typeof entry.hostedCheckoutReturnPending).toBe("function");
    expect(entry.HOSTED_ORDER_STORAGE_KEY).toBe("payments.checkout.hostedOrder");
    expect(typeof entry.basketSignature).toBe("function");
  });
});
