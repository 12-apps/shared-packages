import { describe, expect, it } from "vitest";

import { FiscalDocumentError } from "../errors";
import { scrubSecrets, transition } from "../machine";
import {
  AUTHORIZED,
  CANCELLED,
  DENIED,
  INUTILIZED,
  SIGNED,
  aDocument,
  lookedUp,
  sidecarError,
} from "./fixtures";

const AT = "2026-11-20T15:31:00.000Z";
const CONTINGENCY = { since: "2026-11-20T12:30:00-03:00", reason: "SEFAZ sem resposta no momento da venda" };

function refused(run: () => unknown): FiscalDocumentError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(FiscalDocumentError);
    return error as FiscalDocumentError;
  }
  throw new Error("expected a refusal");
}

describe("the fiscal document state machine", () => {
  it("issues: PENDING → SUBMITTED → AUTHORIZED, one event per step", () => {
    const submitted = transition(aDocument(), { kind: "SUBMIT" }, AT);
    expect(submitted.document.status).toBe("SUBMITTED");
    expect(submitted.document.attempts).toBe(1);
    expect(submitted.event).toMatchObject({ kind: "SUBMIT", fromStatus: "PENDING", toStatus: "SUBMITTED", answer: null });

    const authorized = transition(submitted.document, { kind: "AUTHORIZE", answer: AUTHORIZED, xmlKey: "xml/1" }, AT);
    expect(authorized.document).toMatchObject({
      status: "AUTHORIZED",
      accessKey: AUTHORIZED.accessKey,
      protocol: AUTHORIZED.protocol,
      authorizedAt: AUTHORIZED.authorizedAt,
      xmlKey: "xml/1",
      numberVoid: null,
    });
    expect(authorized.event).toMatchObject({ kind: "AUTHORIZE", code: "100", answer: AUTHORIZED });
  });

  it("refuses CANCELLED from PENDING", () => {
    const error = refused(() =>
      transition(aDocument(), { kind: "CANCEL", answer: CANCELLED, reason: "erro de digitacao no pedido", eventXmlKey: null }, AT),
    );
    expect(error.code).toBe("TRANSITION_REFUSED");
  });

  it("refuses AUTHORIZED from REJECTED", () => {
    const rejected = aDocument({ status: "REJECTED", numberVoid: "INUTILIZE" });
    const error = refused(() => transition(rejected, { kind: "AUTHORIZE", answer: AUTHORIZED, xmlKey: "x" }, AT));
    expect(error.code).toBe("TRANSITION_REFUSED");
  });

  it("a rejection keeps SEFAZ's code and owes the number an inutilization", () => {
    const { document, event } = transition(
      aDocument({ status: "SUBMITTED" }),
      { kind: "REJECT", error: sidecarError("REJECTED", { code: "539" }) },
      AT,
    );
    expect(document).toMatchObject({ status: "REJECTED", statusCode: "539", lastErrorClass: "REJECTED", numberVoid: "INUTILIZE" });
    expect(event).toMatchObject({ errorClass: "REJECTED", code: "539" });

    const voided = transition(document, { kind: "INUTILIZE", answer: INUTILIZED, eventXmlKey: "inut/1" }, AT);
    expect(voided.document).toMatchObject({ status: "REJECTED", numberVoid: "INUTILIZED", eventXmlKey: "inut/1" });
    refused(() => transition(voided.document, { kind: "INUTILIZE", answer: INUTILIZED, eventXmlKey: null }, AT));
  });

  it("a denial is final and spends the number", () => {
    const { document } = transition(aDocument({ status: "SUBMITTED" }), { kind: "DENY", answer: DENIED, xmlKey: "x" }, AT);
    expect(document).toMatchObject({ status: "DENIED", numberVoid: null });
    refused(() => transition(document, { kind: "INUTILIZE", answer: INUTILIZED, eventXmlKey: null }, AT));
  });

  it("a retry stays SUBMITTED and remembers an unknown outcome", () => {
    const { document } = transition(
      aDocument({ status: "SUBMITTED", attempts: 1 }),
      { kind: "RETRY", error: sidecarError("RETRYABLE", { outcomeUnknown: true, accessKey: "k" }) },
      AT,
    );
    expect(document).toMatchObject({ status: "SUBMITTED", outcomeUnknown: true, accessKey: "k", attempts: 2 });
  });

  it("goes offline as a second document: the contingency number is signed, the online one replaced", () => {
    refused(() => transition(aDocument(), { kind: "SIGN_OFFLINE", answer: SIGNED, contingency: CONTINGENCY, xmlKey: "x" }, AT));
    const offline = transition(
      aDocument({ id: "doc-2", seriesKind: "CONTINGENCY", series: 900 }),
      { kind: "SIGN_OFFLINE", answer: SIGNED, contingency: CONTINGENCY, xmlKey: "x" },
      AT,
    );
    expect(offline.document).toMatchObject({ status: "CONTINGENCY", contingency: CONTINGENCY, accessKey: SIGNED.accessKey });

    const never = transition(aDocument(), { kind: "REPLACE", replacedById: "doc-2" }, AT);
    expect(never.document).toMatchObject({ status: "REPLACED", replacedById: "doc-2", numberVoid: "INUTILIZE" });

    const unknown = transition(aDocument({ status: "SUBMITTED", outcomeUnknown: true, accessKey: "k" }), { kind: "REPLACE", replacedById: "doc-2" }, AT);
    expect(unknown.document.numberVoid).toBe("LOOKUP_FIRST");

    const transmitted = transition(offline.document, { kind: "AUTHORIZE", answer: AUTHORIZED, xmlKey: "y" }, AT);
    expect(transmitted.document).toMatchObject({ status: "AUTHORIZED", contingency: CONTINGENCY });
  });

  it("settles a replaced number after a lookup: not found is inutilized, found authorised is cancelled", () => {
    const replaced = aDocument({ status: "REPLACED", numberVoid: "LOOKUP_FIRST", replacedById: "doc-2" });
    expect(transition(replaced, { kind: "LOOKUP", answer: lookedUp("NOT_FOUND") }, AT).document.numberVoid).toBe("INUTILIZE");
    const owed = transition(replaced, { kind: "LOOKUP", answer: lookedUp("AUTHORIZED") }, AT).document;
    expect(owed).toMatchObject({ status: "REPLACED", numberVoid: "CANCEL" });
    const cancelled = transition(owed, { kind: "CANCEL", answer: CANCELLED, reason: "substituida por contingencia", eventXmlKey: null }, AT);
    expect(cancelled.document).toMatchObject({ status: "REPLACED", numberVoid: "CANCELLED", cancelProtocol: CANCELLED.protocol });
  });

  it("cancels only an authorised document, and a lookup that finds it cancelled elsewhere follows", () => {
    const authorized = aDocument({ status: "AUTHORIZED", accessKey: "k", protocol: "p" });
    const { document } = transition(authorized, { kind: "CANCEL", answer: CANCELLED, reason: "pedido cancelado pelo cliente", eventXmlKey: "ev/1" }, AT);
    expect(document).toMatchObject({ status: "CANCELLED", cancelReason: "pedido cancelado pelo cliente", eventXmlKey: "ev/1" });
    expect(transition(authorized, { kind: "LOOKUP", answer: lookedUp("CANCELLED") }, AT).document.status).toBe("CANCELLED");
    refused(() => transition(document, { kind: "CANCEL", answer: CANCELLED, reason: "pedido cancelado pelo cliente", eventXmlKey: null }, AT));
  });

  it("never keeps a secret-named key in an event", () => {
    expect(
      scrubSecrets({ a: 1, certificate: { pfxBase64: "x", password: "y" }, nested: [{ csc: { token: "z" }, b: 2 }] }),
    ).toEqual({ a: 1, nested: [{ b: 2 }] });
    const { event } = transition(
      aDocument({ status: "SUBMITTED" }),
      { kind: "AUTHORIZE", answer: { ...AUTHORIZED, password: "leak" } as typeof AUTHORIZED, xmlKey: "x" },
      AT,
    );
    expect(JSON.stringify(event)).not.toContain("leak");
  });
});
