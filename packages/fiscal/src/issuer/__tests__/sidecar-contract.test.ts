import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { SaleForDocument } from "../../sale/types";
import type { SidecarErrorBody } from "../../sidecar/types";
import type { IssuerOutcome, SigningMaterial } from "../port";
import { createSidecarIssuer, type SidecarFetch } from "../sidecar";

/**
 * The adapter against the fiscal service's OWN recorded answers. Each file in
 * `fixtures/sidecar/` is what the real kernel answered for one recorded SEFAZ
 * reply (`sidecar/tests/Support/record-answers.php` regenerates them): the
 * request the service received (certificate and CSC left out) and its status
 * and body. Replaying one checks both directions of the contract: the adapter
 * sends that exact request, and maps that exact answer.
 */

interface Recording {
  readonly path: string;
  readonly request: Record<string, unknown> & { document?: SaleForDocument };
  readonly status: number;
  readonly body: unknown;
}

const DIR = join(import.meta.dirname, "fixtures", "sidecar");
const RECORDINGS: Record<string, Recording> = Object.fromEntries(
  readdirSync(DIR)
    .filter((file) => file.endsWith(".json"))
    .map((file) => [file.replace(/\.json$/, ""), JSON.parse(readFileSync(join(DIR, file), "utf8")) as Recording]),
);

const SIGNING: SigningMaterial = {
  certificate: { pfxBase64: "UEZYLUJZVEVT", password: "pfx-password-not-a-real-one" },
  csc: { id: "000001", token: "TESTCSC0123456789ABCDEF0123456789" },
};

function replaying(name: string): { fetch: SidecarFetch; sent: Array<{ url: string; body: Record<string, unknown> }> } {
  const recording = RECORDINGS[name];
  if (recording === undefined) throw new Error(`no recording ${name}`);
  const sent: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetch: SidecarFetch = async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body ?? "{}") as Record<string, unknown> });
    return { status: recording.status, text: async () => JSON.stringify(recording.body) };
  };
  return { fetch, sent };
}

function issuerFor(fetch: SidecarFetch) {
  return createSidecarIssuer({ baseUrl: "http://fiscal-sidecar:8080/", fetch, timeoutMs: 90_000 });
}

/** The request as recorded: the call's own fields, the secrets put back where the service read them. */
function expectSentAsRecorded(name: string, sent: { url: string; body: Record<string, unknown> }) {
  const recording = RECORDINGS[name]!;
  expect(sent.url).toBe(`http://fiscal-sidecar:8080${recording.path}`);
  const { certificate, csc, ...rest } = sent.body;
  expect(certificate).toEqual(SIGNING.certificate);
  if (recording.path.endsWith("/issue") || recording.path.endsWith("/sign-contingency")) {
    expect(csc).toEqual(recording.path.startsWith("/nfce") ? SIGNING.csc : null);
  }
  expect(rest).toEqual(recording.request);
}

function expectFailure(outcome: IssuerOutcome<unknown>, name: string): SidecarErrorBody["error"] {
  expect(outcome.ok).toBe(false);
  if (outcome.ok) throw new Error("unreachable");
  expect(outcome.error).toEqual((RECORDINGS[name]!.body as SidecarErrorBody).error);
  return outcome.error;
}

const nfceDocument = () => RECORDINGS["nfce-issue-authorized"]!.request.document!;
const environment = "homologacao" as const;

describe("the sidecar issuer, against the service's recorded answers", () => {
  it("issues an NFC-e: sends the document with the A1 and the CSC, maps AUTHORIZED", async () => {
    const { fetch, sent } = replaying("nfce-issue-authorized");
    const outcome = await issuerFor(fetch).issue({ model: "NFCE", environment, signing: SIGNING, document: nfceDocument() });
    expectSentAsRecorded("nfce-issue-authorized", sent[0]!);
    expect(outcome).toEqual({ ok: true, answer: RECORDINGS["nfce-issue-authorized"]!.body });
    if (outcome.ok) {
      expect(outcome.answer.status).toBe("AUTHORIZED");
      expect(outcome.answer.accessKey).toMatch(/^\d{44}$/);
      expect(outcome.answer.authorizedXml).toContain("<nfeProc");
    }
  });

  it("maps a denial of use as an answer, not an error", async () => {
    const { fetch } = replaying("nfce-issue-denied");
    const outcome = await issuerFor(fetch).issue({ model: "NFCE", environment, signing: SIGNING, document: nfceDocument() });
    expect(outcome.ok && outcome.answer.status).toBe("DENIED");
  });

  it.each([
    ["nfce-issue-rejected", "REJECTED", "539", false],
    ["nfce-issue-retryable", "RETRYABLE", "656", false],
    ["nfce-issue-contingency", "CONTINGENCY", "108", false],
    ["nfce-issue-unanswered", "CONTINGENCY", null, true],
    ["nfce-issue-auth", "AUTH", "281", false],
    ["nfce-issue-2027", "INVALID", "NT_2026_008_NOT_SUPPORTED", false],
  ] as const)("classifies %s as %s", async (name, errorClass, code, outcomeUnknown) => {
    const { fetch, sent } = replaying(name);
    const outcome = await issuerFor(fetch).issue({
      model: "NFCE",
      environment,
      signing: SIGNING,
      document: RECORDINGS[name]!.request.document!,
    });
    expectSentAsRecorded(name, sent[0]!);
    const error = expectFailure(outcome, name);
    expect([error.class, error.code, error.outcomeUnknown]).toEqual([errorClass, code, outcomeUnknown]);
  });

  it("signs offline, then transmits the signed XML", async () => {
    const signed = replaying("nfce-sign-contingency");
    const contingency = RECORDINGS["nfce-sign-contingency"]!.request["contingency"] as { since: string; reason: string };
    const outcome = await issuerFor(signed.fetch).signContingency({ environment, signing: SIGNING, document: nfceDocument(), contingency });
    expectSentAsRecorded("nfce-sign-contingency", signed.sent[0]!);
    if (!outcome.ok) throw new Error("expected SIGNED");
    expect(outcome.answer.accessKey.charAt(34)).toBe("9");

    const transmitted = replaying("nfce-transmit-authorized");
    const answer = await issuerFor(transmitted.fetch).transmit({ model: "NFCE", environment, signing: SIGNING, signedXml: outcome.answer.signedXml });
    expectSentAsRecorded("nfce-transmit-authorized", transmitted.sent[0]!);
    expect(answer.ok && answer.answer.accessKey).toBe(outcome.answer.accessKey);
  });

  it("cancels inside the window, and maps a late cancel as REJECTED 501", async () => {
    const request = RECORDINGS["nfce-cancel"]!.request as { accessKey: string; protocol: string; reason: string };
    const ok = replaying("nfce-cancel");
    const outcome = await issuerFor(ok.fetch).cancel({ model: "NFCE", environment, signing: SIGNING, ...request });
    expectSentAsRecorded("nfce-cancel", ok.sent[0]!);
    expect(outcome.ok && outcome.answer.status).toBe("CANCELLED");

    const late = replaying("nfce-cancel-late");
    expect(expectFailure(await issuerFor(late.fetch).cancel({ model: "NFCE", environment, signing: SIGNING, ...request }), "nfce-cancel-late").code).toBe("501");
  });

  it("cancels by substitution (110112), naming the contingency document that replaced it", async () => {
    const request = RECORDINGS["nfce-cancel-substitution"]!.request as {
      accessKey: string;
      protocol: string;
      reason: string;
      substituteAccessKey: string;
    };
    const { fetch, sent } = replaying("nfce-cancel-substitution");
    const outcome = await issuerFor(fetch).cancelBySubstitution({ environment, signing: SIGNING, ...request });
    expectSentAsRecorded("nfce-cancel-substitution", sent[0]!);
    expect(outcome.ok && outcome.answer).toMatchObject({ status: "CANCELLED", protocol: "135260000200002" });
  });

  it.each([
    ["nfce-lookup-authorized", "AUTHORIZED"],
    ["nfce-lookup-not-found", "NOT_FOUND"],
  ] as const)("looks a key up: %s", async (name, status) => {
    const { fetch, sent } = replaying(name);
    const accessKey = RECORDINGS[name]!.request["accessKey"] as string;
    const outcome = await issuerFor(fetch).lookup({ model: "NFCE", environment, signing: SIGNING, accessKey });
    expectSentAsRecorded(name, sent[0]!);
    expect(outcome.ok && outcome.answer.status).toBe(status);
  });

  it("inutilizes a range, and maps a used number as REJECTED 241", async () => {
    const { uf, cnpj, year, series, from, to, reason } = RECORDINGS["inutilize"]!.request as {
      uf: string;
      cnpj: string;
      year: number;
      series: number;
      from: number;
      to: number;
      reason: string;
    };
    const range = { uf, cnpj, year, series, from, to, reason };
    const ok = replaying("inutilize");
    const outcome = await issuerFor(ok.fetch).inutilize({ model: "NFCE", environment, signing: SIGNING, ...range });
    expectSentAsRecorded("inutilize", ok.sent[0]!);
    expect(outcome.ok && outcome.answer.status).toBe("INUTILIZED");

    const used = replaying("inutilize-used");
    const refused = await issuerFor(used.fetch).inutilize({ model: "NFCE", environment, signing: SIGNING, ...range });
    expect(expectFailure(refused, "inutilize-used").code).toBe("241");
  });
});

describe("the sidecar issuer, when the service itself does not answer", () => {
  const secretFree = (outcome: IssuerOutcome<unknown>) => {
    expect(outcome.ok).toBe(false);
    const text = JSON.stringify(outcome);
    expect(text).not.toContain(SIGNING.certificate.password);
    expect(text).not.toContain(SIGNING.certificate.pfxBase64);
    expect(text).not.toContain(SIGNING.csc!.token);
    return outcome.ok ? null : outcome.error;
  };

  it("a fetch that fails is RETRYABLE with an unknown outcome, and names no secret", async () => {
    const issuer = issuerFor(async () => {
      throw new TypeError(`connect ECONNREFUSED ${SIGNING.certificate.password}`);
    });
    const error = secretFree(await issuer.issue({ model: "NFCE", environment, signing: SIGNING, document: nfceDocument() }));
    expect(error).toMatchObject({ class: "RETRYABLE", outcomeUnknown: true });
  });

  it("an answer that is not the service's JSON is RETRYABLE with an unknown outcome", async () => {
    const issuer = issuerFor(async () => ({ status: 502, text: async () => "<html>Bad Gateway</html>" }));
    const error = secretFree(await issuer.issue({ model: "NFCE", environment, signing: SIGNING, document: nfceDocument() }));
    expect(error).toMatchObject({ class: "RETRYABLE", outcomeUnknown: true, message: expect.stringContaining("HTTP 502") });
  });

  it("an NF-e carries no CSC, whatever the signing material holds", async () => {
    const { fetch, sent } = replaying("nfce-issue-authorized");
    await issuerFor(fetch).issue({ model: "NFE", environment, signing: SIGNING, document: nfceDocument() });
    expect(sent[0]!.url).toBe("http://fiscal-sidecar:8080/nfe/issue");
    expect(sent[0]!.body["csc"]).toBeNull();
  });

  it("refuses a config with no base URL, fetch or timeout: there are no defaults", () => {
    const fetch: SidecarFetch = async () => ({ status: 200, text: async () => "{}" });
    expect(() => createSidecarIssuer({ baseUrl: "", fetch, timeoutMs: 1 })).toThrow(/baseUrl/);
    expect(() => createSidecarIssuer({ baseUrl: "http://x", fetch: undefined as never, timeoutMs: 1 })).toThrow(/fetch/);
    expect(() => createSidecarIssuer({ baseUrl: "http://x", fetch, timeoutMs: 0 })).toThrow(/timeoutMs/);
  });
});
