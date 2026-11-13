/**
 * The Issuer adapter over the fiscal service in this package's `sidecar/`
 * folder, speaking exactly its wire contract (`../sidecar/types`). JSON in,
 * JSON out; a non-2xx answer carries `{ error }` and is handed back
 * classified, never thrown.
 *
 * What the service cannot classify because it never answered — the fetch
 * failed, timed out or got something that is not the service's JSON — is
 * `RETRYABLE` with `outcomeUnknown: true`: the call may have reached SEFAZ, so
 * the next attempt is a retry of the SAME call, which the service settles by
 * looking the key up first. The message names the path and the HTTP status,
 * never the request: the request carries the certificate.
 */

import type {
  CancelBySubstitutionRequest,
  CancelRequest,
  InutilizeRequest,
  IssueRequest,
  LookupRequest,
  SidecarErrorBody,
  SidecarHealth,
  SignContingencyRequest,
  TransmitRequest,
} from "../sidecar/types";
import { SIDECAR_ERROR_CLASSES } from "../sidecar/types";
import { type Issuer, type IssuerFailure, type IssuerOutcome, modelPath } from "./port";

/** The `fetch` the adapter calls: the global one fits. */
export type SidecarFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  readonly status: number;
  text(): Promise<string>;
}>;

export interface SidecarIssuerConfig {
  /** Where the service listens, `http://fiscal-sidecar:8080`. No default. */
  readonly baseUrl: string;
  readonly fetch: SidecarFetch;
  /**
   * How long one call may take, in ms. The service gives SEFAZ its connect
   * timeout plus 20 s and may then look the key up, so this is longer than
   * both; a shorter one turns answered calls into unknown outcomes.
   */
  readonly timeoutMs: number;
}

function unanswered(message: string): IssuerFailure {
  return {
    class: "RETRYABLE",
    code: null,
    message,
    details: [],
    accessKey: null,
    signedXml: null,
    sefazReply: null,
    outcomeUnknown: true,
  };
}

function isErrorBody(value: unknown): value is SidecarErrorBody {
  if (value === null || typeof value !== "object" || !("error" in value)) return false;
  const error = (value as { error: unknown }).error;
  return (
    error !== null &&
    typeof error === "object" &&
    SIDECAR_ERROR_CLASSES.includes((error as { class: IssuerFailure["class"] }).class)
  );
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** One POST to the service, its answer classified; never throws. */
async function post<T>(config: SidecarIssuerConfig, base: string, path: string, body: unknown): Promise<IssuerOutcome<T>> {
  let status: number;
  let text: string;
  try {
    const response = await config.fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    status = response.status;
    text = await response.text();
  } catch (error) {
    const why = error instanceof Error ? error.name : "unknown";
    return { ok: false, error: unanswered(`POST ${path} got no answer from the fiscal service (${why}).`) };
  }
  const parsed = parse(text);
  if (status >= 200 && status < 300 && parsed !== undefined && !isErrorBody(parsed)) return { ok: true, answer: parsed as T };
  if (isErrorBody(parsed)) return { ok: false, error: parsed.error };
  return { ok: false, error: unanswered(`POST ${path} answered HTTP ${status} without the service's error body.`) };
}

export function createSidecarIssuer(config: SidecarIssuerConfig): Issuer {
  if (typeof config?.baseUrl !== "string" || config.baseUrl === "") throw new TypeError("createSidecarIssuer needs baseUrl.");
  if (typeof config.fetch !== "function") throw new TypeError("createSidecarIssuer needs fetch.");
  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs <= 0) throw new TypeError("createSidecarIssuer needs a positive timeoutMs.");
  const base = config.baseUrl.replace(/\/+$/, "");

  const call = <T>(path: string, body: unknown) => post<T>(config, base, path, body);

  return {
    issue: ({ model, environment, signing, document }) =>
      call(`/${modelPath(model)}/issue`, {
        environment,
        certificate: signing.certificate,
        csc: model === "NFCE" ? signing.csc : null,
        document,
      } satisfies IssueRequest),
    signContingency: ({ environment, signing, document, contingency }) =>
      call("/nfce/sign-contingency", {
        environment,
        certificate: signing.certificate,
        csc: signing.csc,
        document,
        contingency,
      } satisfies SignContingencyRequest),
    transmit: ({ model, environment, signing, signedXml }) =>
      call(`/${modelPath(model)}/transmit`, { environment, certificate: signing.certificate, signedXml } satisfies TransmitRequest),
    cancel: ({ model, environment, signing, accessKey, protocol, reason }) =>
      call(`/${modelPath(model)}/cancel`, {
        environment,
        certificate: signing.certificate,
        accessKey,
        protocol,
        reason,
      } satisfies CancelRequest),
    cancelBySubstitution: ({ environment, signing, accessKey, protocol, reason, substituteAccessKey }) =>
      call("/nfce/cancel-substitution", {
        environment,
        certificate: signing.certificate,
        accessKey,
        protocol,
        reason,
        substituteAccessKey,
      } satisfies CancelBySubstitutionRequest),
    lookup: ({ model, environment, signing, accessKey }) =>
      call(`/${modelPath(model)}/lookup`, { environment, certificate: signing.certificate, accessKey } satisfies LookupRequest),
    inutilize: ({ model, environment, signing, uf, cnpj, year, series, from, to, reason }) =>
      call("/inutilize", {
        environment,
        certificate: signing.certificate,
        model: modelPath(model),
        uf,
        cnpj,
        year,
        series,
        from,
        to,
        reason,
      } satisfies InutilizeRequest),
    async health() {
      const response = await config.fetch(`${base}/health`, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      if (response.status !== 200) throw new Error(`The fiscal service's /health answered HTTP ${response.status}.`);
      return JSON.parse(await response.text()) as SidecarHealth;
    },
  };
}
