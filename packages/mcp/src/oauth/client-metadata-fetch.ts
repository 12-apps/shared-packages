import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request as httpsRequest } from "node:https";
import type { IncomingMessage } from "node:http";
import type { LookupFunction } from "node:net";

import { ClientMetadataDocumentError } from "./client-metadata-errors";
import { isNonPublicAddress } from "./client-metadata-url";

/**
 * The transport half of Client ID Metadata Documents (FUT-4522): one https GET
 * that cannot reach a private address, cannot follow a redirect, and cannot run
 * past its time or size budget. `authorize` is unauthenticated, so this is a
 * fetch anyone may trigger with a URL of their choosing.
 */

/** One GET of a metadata document: the status and the body, capped. */
export interface MetadataDocumentAnswer {
  status: number;
  body: string;
  /** The response's `Cache-Control`, which sets how long the document is reused. */
  cacheControl?: string;
}

export type FetchMetadataDocument = (
  url: URL,
  limits: { timeoutMs: number; maxBytes: number },
) => Promise<MetadataDocumentAnswer>;

const nonPublic = (): ClientMetadataDocumentError =>
  new ClientMetadataDocumentError("client_id host resolves to a non-public address");

/**
 * `dns.lookup`, refusing the connection when ANY address the name resolves to is
 * non-public. It is the socket's own lookup, so the address checked is the
 * address dialled: a name that answers a public address to a pre-check and a
 * private one to the connection (DNS rebinding) still cannot reach the private one.
 */
export const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true, verbatim: true }, (error, addresses) => {
    if (error) {
      callback(error, "", 0);
      return;
    }
    const list = addresses as unknown as LookupAddress[];
    const first = list[0];
    if (!first || list.some((entry) => isNonPublicAddress(entry.address))) {
      callback(nonPublic(), "", 0);
      return;
    }
    if (options.all) {
      (callback as unknown as (err: null, all: LookupAddress[]) => void)(null, list);
      return;
    }
    callback(null, first.address, first.family);
  });
};

const transient = (message: string): ClientMetadataDocumentError =>
  new ClientMetadataDocumentError(message, { transient: true });

/** Read a response into a string, refusing it the moment it passes `maxBytes`. */
function collect(
  res: IncomingMessage,
  maxBytes: number,
  resolve: (answer: MetadataDocumentAnswer) => void,
  reject: (error: Error) => void,
): void {
  const tooLarge = (): void => {
    res.destroy();
    reject(new ClientMetadataDocumentError("document is too large"));
  };
  if (Number(res.headers["content-length"]) > maxBytes) {
    tooLarge();
    return;
  }
  const chunks: Buffer[] = [];
  let total = 0;
  res.on("data", (chunk: Buffer) => {
    total += chunk.byteLength;
    if (total > maxBytes) {
      tooLarge();
      return;
    }
    chunks.push(chunk);
  });
  res.on("end", () => {
    const cacheControl = res.headers["cache-control"];
    resolve({
      status: res.statusCode ?? 0,
      body: Buffer.concat(chunks).toString("utf8"),
      ...(cacheControl ? { cacheControl } : {}),
    });
  });
  res.on("error", () => reject(transient("document could not be fetched")));
}

/** What the transport is built from; the defaults are the production ones. */
export interface MetadataDocumentTransportDeps {
  /** The request function. Default `node:https`'s `request`. */
  request?: typeof httpsRequest;
  /** The socket's DNS lookup. Default {@link publicOnlyLookup}. */
  lookup?: LookupFunction;
}

/**
 * A transport: one GET through the given lookup, with no redirect followed
 * (`node:https` never follows one; a 3xx comes back as a status), the WHOLE
 * exchange bounded by `timeoutMs`, and the body by `maxBytes` while it streams.
 *
 * `agent: false` is load-bearing. The global agent pools keep-alive sockets by
 * host and port, and a pooled socket is reused WITHOUT a lookup — so a host that
 * had already talked to `internal.example:443` would hand this fetch a live
 * socket to it, and the address check would never run. A fresh socket per fetch
 * means every fetch dials, and every dial goes through the lookup.
 */
export function createMetadataDocumentTransport(deps: MetadataDocumentTransportDeps = {}): FetchMetadataDocument {
  const request = deps.request ?? httpsRequest;
  const lookup = deps.lookup ?? publicOnlyLookup;
  return (url, { timeoutMs, maxBytes }) =>
    new Promise((resolve, reject) => {
      const req = request(
        url,
        { method: "GET", headers: { accept: "application/json" }, lookup, agent: false, timeout: timeoutMs },
        (res) => collect(res, maxBytes, resolve, reject),
      );
      const deadline = setTimeout(() => req.destroy(transient("document fetch timed out")), timeoutMs);
      req.on("timeout", () => req.destroy(transient("document fetch timed out")));
      req.on("error", (error) => reject(socketFailure(error)));
      req.on("close", () => clearTimeout(deadline));
      req.end();
    });
}

/**
 * The address refusal and a name that does not exist are verdicts on the
 * client_id; every other socket error (reset, refused, TLS, timeout) is the
 * network's bad minute.
 */
function socketFailure(error: unknown): ClientMetadataDocumentError {
  if (error instanceof ClientMetadataDocumentError) return error;
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "ENOTFOUND") return new ClientMetadataDocumentError("client_id host does not exist");
  return transient("document could not be fetched");
}

/** The default transport: `node:https` through {@link publicOnlyLookup}. */
export const fetchMetadataDocument: FetchMetadataDocument = createMetadataDocumentTransport();
