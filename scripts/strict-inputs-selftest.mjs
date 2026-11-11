// Selftest for the strict-inputs gate (scripts/lib/strict-inputs.mjs).
//
// Every case is a way the gate could quietly stop meaning anything: a stripping
// object it fails to see, a nested one it never reaches, a response schema it
// wrongly refuses, a ratchet that lets debt grow. Each must fail where it
// should, because a gate that only ever passes is decoration.
import { pathToFileURL } from "node:url";

import { newDebt, nonStrictInputs, touchMustFix } from "./lib/strict-inputs.mjs";

const LABEL = "[strict-inputs]";
const Z = 'import { z } from "zod";\n';
const names = (source) => [...nonStrictInputs(source).keys()];

const cases = [
  [names(`${Z}export const inviteBody = z.object({ a: z.string() });`).join() === "inviteBody",
    "a plain z.object body is a finding"],
  [names(`${Z}export const inviteBody = z.strictObject({ a: z.string() });`).length === 0,
    "z.strictObject passes"],
  [names(`${Z}export const inviteBody = z.object({ a: z.string() }).strict();`).length === 0,
    ".strict() directly after the object passes"],
  [names(`${Z}export const inviteBody = z.object({ a: z.object({ b: z.string() }).strict() });`).join() === "inviteBody",
    "a strict nested object does not excuse a stripping top level"],
  [names(`${Z}export const inviteBody = z.strictObject({ a: z.object({ b: z.string() }) });`).join() === "inviteBody",
    "a stripping nested object under a strict top level is a finding (depth)"],
  [names(`${Z}const inner = z.object({ b: z.string() });\nexport const saveBody = z.strictObject({ a: inner });`).join() === "inner",
    "an in-file schema an input reaches is reported under its own name"],
  [names(`${Z}export const orderResponse = z.object({ id: z.string() });`).length === 0,
    "a response schema is never read"],
  [names(`${Z}export const listQuery = z\n  .object({ a: z.string() })\n  .refine(Boolean);`).join() === "listQuery",
    "a chain that starts on its own line is still seen"],
  [names(`${Z}export const listQuery = z\n  .object({ a: z.string() })\n  .strict()\n  .refine(Boolean);`).length === 0,
    "a .strict() later in a multi-line chain passes"],
  [names(`${Z}export const saveBody = z.strictObject({ a: z.string() }).passthrough();`).join() === "saveBody",
    "passthrough is a finding"],
  [names(`${Z}export const saveBody = z.looseObject({ a: z.string() });`).join() === "saveBody",
    "looseObject is a finding"],
  [names(`${Z}// @request-input\nexport const thingSchema = z.object({ a: z.string() });`).join() === "thingSchema",
    "the @request-input tag makes a Schema-named declaration an input"],
  [names(`${Z}export const thingSchema = z.object({ a: z.string() });`).length === 0,
    "an untagged, unnamed schema is not an input"],
  [names(`${Z}function build() {\n  return {\n    inviteBody: z.object({ a: z.string() }),\n    other: z.object({}),\n  };\n}`).join() === "inviteBody",
    "an object key named like an input is read, its sibling is not"],
  [names(`${Z}const route = {\n  body: z.object({ a: z.string() }),\n};`).join() === "body",
    "an inline route body is an input by position"],
  [names(`// z.object in a comment: createBody\nconst a = 1;`).length === 0,
    "a file without zod is never read"],
  [names(`${Z}export const saveBody = z.strictObject({ note: z.string().describe("use z.object( here") });`).length === 0,
    "an object call inside a string is not a call"],
  [names(`${Z}export const registerWebhookBody = z.object({ pixKey: z.string() });`).join() === "registerWebhookBody",
    "an input schema is a finding wherever it lives, a webhook-named file included (no path waiver)"],
  [newDebt({
      baseLedger: new Map([["a::b", { kind: "grandfathered" }]]),
      headLedger: new Map([["a::b", { kind: "grandfathered" }], ["c::d", { kind: "grandfathered" }]]),
      ledgerPath: "l.json",
    }).length === 1,
    "a newly grandfathered entry fails the shrink-only rule"],
  [newDebt({ baseLedger: new Map(), headLedger: new Map([["c::d", { kind: "exempt" }]]), ledgerPath: "l" }).length === 0,
    "an exempt entry is not debt"],
  [touchMustFix({
      changedFiles: ["packages/x/src/wire.ts"],
      headLedger: new Map([["packages/x/src/wire.ts::aBody", { kind: "grandfathered" }]]),
      ledgerPath: "l.json",
    }).length === 1,
    "editing a file with a grandfathered schema obliges clearing it"],
  [touchMustFix({
      changedFiles: ["packages/x/src/other.ts"],
      headLedger: new Map([["packages/x/src/wire.ts::aBody", { kind: "grandfathered" }]]),
      ledgerPath: "l.json",
    }).length === 0,
    "editing another file does not"],
];

export function selftest() {
  const failed = cases.filter(([ok]) => !ok);
  for (const [, name] of failed) console.error(`${LABEL} selftest FAILED: ${name}`);
  if (failed.length === 0) console.log(`${LABEL} selftest: ${cases.length} cases ok`);
  return failed.length === 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(selftest() ? 0 : 1);
