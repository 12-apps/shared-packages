/* eslint-disable test-flakiness/no-unmocked-fs --
 * The point is to read the shipped source as it is on disk; it is read-only
 * and never changes during the run. */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The protocol is imported by a React Native terminal app as well as by the
 * station, so its shipped source may use no Node-only and no DOM-only API:
 * no `node:` import, no `Buffer`, no `atob`/`btoa`, no `crypto.subtle`, no
 * `process`. `TextEncoder` is in both runtimes and is allowed.
 */

const DIR = join(__dirname, "..");
const shipped = readdirSync(DIR).filter((name) => name.endsWith(".ts"));

const FORBIDDEN: readonly [string, RegExp][] = [
  ["a Node import", /from\s+["']node:|require\(/],
  ["an import from outside the subpath", /from\s+["']\.\.\//],
  ["Buffer", /\bBuffer\b/],
  ["atob or btoa", /\b(atob|btoa)\s*\(/],
  ["crypto.subtle", /crypto\.subtle/],
  ["process", /\bprocess\./],
  ["a DOM global", /\b(window|document)\./],
];

/** The source without its comments: a docblock may name what the code avoids. */
const codeOf = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the terminal-link subpath stays React-Native-safe", () => {
  it("ships the protocol files", () => {
    expect([...shipped].sort()).toEqual(["encoding.ts", "hmac-sha256.ts", "index.ts", "messages.ts", "peer.ts"]);
  });

  it.each(shipped)("%s uses no Node-only or DOM-only API", (name) => {
    const source = codeOf(readFileSync(join(DIR, name), "utf8"));
    const found = FORBIDDEN.filter(([, pattern]) => pattern.test(source)).map(([label]) => label);
    expect(found).toEqual([]);
  });
});
