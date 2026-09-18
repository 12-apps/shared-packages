import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { encodeTicket } from "../escpos";
import type { TicketLine } from "../index";
import { sendToNetworkPrinter } from "../net";

import { scanForPrinters, type ScanOptions, type ScanResult } from "./index";

/**
 * How a helper running on the counter's PC hands its answer to a web page.
 *
 * The scan has to happen on the merchant's machine — a browser cannot open a
 * TCP socket, and a server in a datacentre cannot see `192.168.0.x`. But the
 * ANSWER has to arrive in a form field in a tab. That gap is this module, and
 * the shape it takes is forced by three browser rules that each kill the
 * obvious alternatives:
 *
 * 1. **Mixed content.** The settings screen is HTTPS. It may not fetch
 *    `http://192.168.0.50` at all, so the page cannot scan even in principle.
 * 2. **…except loopback.** `http://127.0.0.1` is *potentially trustworthy* by
 *    spec, so it is the ONE plaintext origin an HTTPS page may still call.
 *    Everything here follows from that exemption.
 * 3. **Private Network Access.** Chrome sends a preflight carrying
 *    `Access-Control-Request-Private-Network` before a public page may touch a
 *    private or loopback address, and blocks the request unless the answer
 *    carries {@link ALLOW_PRIVATE_NETWORK}. A printer on :9100 could never
 *    answer that. A server we wrote can.
 *
 * ## The thing that makes this dangerous, and what answers it
 *
 * A server on loopback is reachable by EVERY page the merchant has open, not
 * just ours. Left open, this would be a port scanner that any website could
 * aim at the shop's network and read the results of. So:
 *
 * - it binds {@link LOOPBACK_ONLY} — never `0.0.0.0`, which would expose the
 *   scan to the whole network the scan is looking at;
 * - it answers only the origins it was started with, and a request with no
 *   `Origin` or a foreign one is refused before any scanning happens. Browsers
 *   set that header themselves and a page cannot forge it, which is exactly the
 *   threat being defended against;
 * - it EXITS on its own ({@link DEFAULT_TTL_MS}). A helper somebody ran once to
 *   set up a printer should not still be listening next Tuesday.
 *
 * The origin allowlist is the real control here; the TTL bounds the window it
 * has to be wrong in.
 */

/** The address this may bind. Stated as a constant so a diff changing it shows. */
export const LOOPBACK_ONLY = "127.0.0.1";

/**
 * The port the page looks for.
 *
 * Fixed rather than negotiated, because the page has to know where to knock
 * with nothing to go on. High, and outside every range IANA has assigned, so a
 * collision means another copy of this helper rather than somebody's dev server.
 */
export const BRIDGE_PORT = 48_653;

/** Chrome's Private Network Access opt-in. Without it the fetch never lands. */
export const ALLOW_PRIVATE_NETWORK = "Access-Control-Allow-Private-Network";

/** Long enough to set a printer up, short enough not to be left running. */
export const DEFAULT_TTL_MS = 10 * 60_000;

export interface BridgeOptions {
  /** Web origins allowed to call this. Exact matches; no wildcard is honoured. */
  allowedOrigins: string[];
  port?: number;
  ttlMs?: number;
  /** Passed through to the scan — the seam tests use to avoid real sockets. */
  scanOptions?: ScanOptions;
  /** Runs when the TTL expires, so a CLI can print a line and exit. */
  onExpire?: () => void;
}

export interface BridgeHandle {
  server: Server;
  port: number;
  close: () => Promise<void>;
}

/** What `GET /discover` answers with. The page's half of this contract. */
export interface DiscoverResponse extends ScanResult {
  protocol: 1;
}

/** A test page, in the helper's own words — the host has none to lend it. */
export interface TestPrintRequest {
  host: string;
  port: number;
  lines: TicketLine[];
}

function isAllowed(origin: string | undefined, allowed: string[]): boolean {
  // No Origin at all is refused rather than trusted. `curl` omits it, but so
  // does anything else that is not a browser, and this server exists only to be
  // called by one — a scan is not something to run for an unidentified caller.
  if (!origin) return false;
  return allowed.includes(origin);
}

function applyCors(response: ServerResponse, origin: string): void {
  response.setHeader("Access-Control-Allow-Origin", origin);
  // Echoing one origin rather than `*` means the browser will not share this
  // with a page that was not on the list, and `Vary` keeps a cache from
  // handing one origin's answer to another.
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "content-type");
  response.setHeader(ALLOW_PRIVATE_NETWORK, "true");
  response.setHeader("Access-Control-Max-Age", "600");
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    // The answer describes a network that may have changed a second ago.
    "cache-control": "no-store",
  });
  response.end(payload);
}

async function readJson(request: IncomingMessage, limitBytes = 64 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    // A local helper is not a place to discover an out-of-memory condition.
    if (size > limitBytes) throw new Error("body too large");
    chunks.push(buffer);
  }
  if (size === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function parseTestPrint(body: unknown): TestPrintRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const candidate = body as Partial<TestPrintRequest>;
  if (typeof candidate.host !== "string" || candidate.host.length === 0) return null;
  if (typeof candidate.port !== "number" || !Number.isInteger(candidate.port)) return null;
  if (candidate.port < 1 || candidate.port > 65_535) return null;
  if (!Array.isArray(candidate.lines) || candidate.lines.length === 0) return null;
  return { host: candidate.host, port: candidate.port, lines: candidate.lines };
}

/**
 * Start the bridge.
 *
 * Resolves once it is listening, so a CLI can print the URL knowing the page
 * will find something there.
 */
export function startDiscoveryBridge(options: BridgeOptions): Promise<BridgeHandle> {
  const port = options.port ?? BRIDGE_PORT;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;

  const server = createServer((request, response) => {
    const origin = request.headers.origin;
    if (!isAllowed(origin, options.allowedOrigins)) {
      // No CORS headers on the way out either: a refused origin learns only
      // that something is here, never what it found.
      sendJson(response, 403, { error: "origin-not-allowed" });
      return;
    }
    applyCors(response, origin as string);

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    const path = (request.url ?? "/").split("?")[0];

    if (request.method === "GET" && path === "/health") {
      sendJson(response, 200, { ok: true, protocol: 1 });
      return;
    }

    if (request.method === "GET" && path === "/discover") {
      void scanForPrinters(options.scanOptions ?? {})
        .then((result) => {
          const body: DiscoverResponse = { ...result, protocol: 1 };
          sendJson(response, 200, body);
        })
        .catch((error: unknown) => {
          sendJson(response, 500, {
            error: "scan-failed",
            detail: error instanceof Error ? error.message : String(error),
          });
        });
      return;
    }

    // Printing the test page from HERE rather than from the server is the
    // whole point for a shop whose printer the server cannot reach: it proves
    // the address is right, on paper, without anything outside the building.
    if (request.method === "POST" && path === "/test-print") {
      void readJson(request)
        .then(async (body) => {
          const parsed = parseTestPrint(body);
          if (!parsed) {
            sendJson(response, 400, { error: "invalid-request" });
            return;
          }
          const bytes = encodeTicket(parsed.lines);
          const result = await sendToNetworkPrinter(parsed.host, parsed.port, bytes);
          sendJson(response, result.ok ? 200 : 502, result);
        })
        .catch((error: unknown) => {
          sendJson(response, 400, {
            error: "invalid-request",
            detail: error instanceof Error ? error.message : String(error),
          });
        });
      return;
    }

    sendJson(response, 404, { error: "not-found" });
  });

  const expiry = setTimeout(() => {
    options.onExpire?.();
    server.close();
  }, ttlMs);
  // The timer must not be what keeps the process alive, or the helper would sit
  // there for the whole TTL after the server is already closed.
  expiry.unref();

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, LOOPBACK_ONLY, () => {
      server.removeListener("error", reject);
      // The BOUND port, not the requested one: a caller may pass 0 to let the
      // OS choose, and a handle reporting 0 back would be useless to it.
      const bound = server.address();
      resolve({
        server,
        port: typeof bound === "object" && bound !== null ? bound.port : port,
        close: () =>
          new Promise<void>((done) => {
            clearTimeout(expiry);
            server.close(() => done());
          }),
      });
    });
  });
}
