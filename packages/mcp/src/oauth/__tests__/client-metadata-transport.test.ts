import { lookup as dnsLookup } from "node:dns";
import { createServer, request as httpRequest, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ClientMetadataDocumentError } from "../client-metadata-errors";
import { createMetadataDocumentTransport, publicOnlyLookup } from "../client-metadata-fetch";

/**
 * The real transport's bounds (FUT-4522), against a real socket: a local HTTP
 * server stands in for the document host, with the production request options
 * and only the scheme and the lookup swapped so a loopback server is reachable.
 */

const LIMITS = { timeoutMs: 1000, maxBytes: 256 };
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

async function serve(handler: Parameters<typeof createServer>[1]): Promise<URL> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  return new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/client`);
}

const transport = createMetadataDocumentTransport({
  request: httpRequest as never,
  lookup: dnsLookup as never,
});

describe("the metadata document transport", () => {
  it("asks for JSON and returns the status, body and Cache-Control", async () => {
    const seen: IncomingHttpHeaders[] = [];
    const url = await serve((req, res) => {
      seen.push(req.headers);
      res.writeHead(200, { "content-type": "application/json", "cache-control": "max-age=60" });
      res.end('{"ok":true}');
    });
    await expect(transport(url, LIMITS)).resolves.toEqual({ status: 200, body: '{"ok":true}', cacheControl: "max-age=60" });
    expect(seen[0]?.accept).toBe("application/json");
  });

  it("returns a redirect as a status and never follows it", async () => {
    const hits: string[] = [];
    const url = await serve((req, res) => {
      hits.push(req.url ?? "");
      res.writeHead(302, { location: "/elsewhere" });
      res.end();
    });
    expect((await transport(url, LIMITS)).status).toBe(302);
    expect(hits).toEqual(["/client"]);
  });

  it("refuses a body whose declared length is over the cap", async () => {
    const url = await serve((_req, res) => {
      res.writeHead(200, { "content-length": "1000" });
      res.end("x".repeat(1000));
    });
    await expect(transport(url, LIMITS)).rejects.toThrow("document is too large");
  });

  it("refuses a body that grows past the cap while it streams", async () => {
    const url = await serve((_req, res) => {
      res.writeHead(200);
      res.write("x".repeat(200));
      res.end("x".repeat(200));
    });
    const refusal = await transport(url, LIMITS).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(ClientMetadataDocumentError);
    expect((refusal as ClientMetadataDocumentError).transient).toBe(false);
  });

  it("bounds an answer that never finishes, and calls it transient", async () => {
    const url = await serve((_req, res) => {
      res.writeHead(200);
      res.write("{");
      // Never ended: only the transport's own deadline can close this exchange.
    });
    const refusal = await transport(url, { timeoutMs: 400, maxBytes: 4096 }).catch((error: unknown) => error);
    expect((refusal as ClientMetadataDocumentError).message).toBe("document fetch timed out");
    expect((refusal as ClientMetadataDocumentError).transient).toBe(true);
  });

  it("calls a name that does not exist a verdict, not an outage", async () => {
    const refusal = await createMetadataDocumentTransport()(new URL("https://does-not-exist.invalid/client"), LIMITS)
      .catch((error: unknown) => error);
    expect((refusal as ClientMetadataDocumentError).message).toBe("client_id host does not exist");
    expect((refusal as ClientMetadataDocumentError).transient).toBe(false);
  });

  it("dials a fresh socket through the address check on every fetch", async () => {
    const request = vi.fn((_url: URL, options: Record<string, unknown>) => {
      expect(options.agent).toBe(false);
      expect(options.lookup).toBe(publicOnlyLookup);
      throw new Error("stop here");
    });
    const production = createMetadataDocumentTransport({ request: request as never });
    await expect(production(new URL("https://claude.ai/oauth/x"), LIMITS)).rejects.toThrow("stop here");
    expect(request).toHaveBeenCalledOnce();
  });
});
