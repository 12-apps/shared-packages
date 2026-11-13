import { describe, expect, it } from "vitest";

import { createSidecarIssuer } from "../sidecar";

/**
 * The live contract: a running fiscal service talking to SEFAZ homologação
 * with a real A1. It waits on the certificate of the CNPJ the owner chose
 * (FUT-2237, 2026-11-13), so without the variables below it is skipped and
 * says why. With them, it checks the service's health and looks up a key that
 * does not exist, which SEFAZ answers without spending a number.
 *
 *   FISCAL_TEST_BASE_URL       the running service (`docker run … fiscal-sidecar`)
 *   FISCAL_TEST_PFX_BASE64     the A1, base64
 *   FISCAL_TEST_PFX_PASSWORD
 *   FISCAL_TEST_UF             the CNPJ's state, for the lookup's key
 *   FISCAL_TEST_CNPJ
 *
 * Issuing and cancelling for real is the service's own live suite
 * (`sidecar/tests/Live`), which this one does not repeat.
 */
const REQUIRED = ["FISCAL_TEST_BASE_URL", "FISCAL_TEST_PFX_BASE64", "FISCAL_TEST_PFX_PASSWORD", "FISCAL_TEST_UF", "FISCAL_TEST_CNPJ"] as const;
/** Read by name, so the variables stay a list in one place. */
const variable = (name: (typeof REQUIRED)[number]): string => process.env[name] ?? "";
const missing = REQUIRED.filter((name) => variable(name) === "");
const live = missing.length === 0;

if (!live) {
  console.info(`[fiscal] live issuer contract skipped: set ${missing.join(", ")} (waiting on the homologação A1).`);
}

const UF_CODE: Record<string, string> = { SP: "35", RJ: "33", MG: "31", PR: "41", RS: "43", SC: "42", BA: "29", DF: "53" };

describe.skipIf(!live)("the sidecar issuer, live against SEFAZ homologação", () => {
  const issuer = () => createSidecarIssuer({ baseUrl: variable("FISCAL_TEST_BASE_URL"), fetch, timeoutMs: 120_000 });
  const signing = {
    certificate: { pfxBase64: variable("FISCAL_TEST_PFX_BASE64"), password: variable("FISCAL_TEST_PFX_PASSWORD") },
    csc: null,
  };

  it("reports a healthy service that verifies SEFAZ", async () => {
    const health = await issuer().health();
    expect(health.status).toBe("ok");
    expect(health.sefazTlsVerify).toBe(true);
  });

  it("answers NOT_FOUND for a key nobody issued", async () => {
    const uf = UF_CODE[variable("FISCAL_TEST_UF")] ?? "35";
    const body = `${uf}2611${(variable("FISCAL_TEST_CNPJ")).padStart(14, "0")}65889999999991999999999`.slice(0, 43);
    const outcome = await issuer().lookup({ model: "NFCE", environment: "homologacao", signing, accessKey: `${body}${checkDigit(body)}` });
    expect(outcome.ok && outcome.answer.status).toBe("NOT_FOUND");
  });
});

/** The access key's modulo-11 check digit. */
function checkDigit(body: string): number {
  let sum = 0;
  let weight = 2;
  for (let i = body.length - 1; i >= 0; i -= 1) {
    sum += Number(body[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}
