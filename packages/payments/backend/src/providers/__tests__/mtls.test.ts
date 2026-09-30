import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import type { TLSSocket } from 'node:tls';

import { describe, expect, it } from 'vitest';

import { ProviderRequestError } from '../../core/errors';
import { providerFetch } from '../http';
import { identityProblem, mtlsTransport } from '../mtls';
import { selfSignedIdentity } from './pki';

/**
 * The mTLS transport against a REAL TLS server that demands a client
 * certificate — the one thing a stubbed `fetch` can never prove. The server
 * trusts exactly one client identity; the client trusts exactly the server's.
 */

const SERVER = selfSignedIdentity('localhost');
const MERCHANT = selfSignedIdentity('merchant-a');
const STRANGER = selfSignedIdentity('merchant-b');

/** A server that answers with the CN of the certificate the caller presented, plus what it was sent. */
async function mutualTlsServer(status: number): Promise<{ server: Server; url: string }> {
  const server = createServer(
    { cert: SERVER.cert, key: SERVER.key, ca: MERCHANT.cert, requestCert: true, rejectUnauthorized: true },
    (req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const peer = (req.socket as TLSSocket).getPeerCertificate();
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ cn: peer.subject?.CN, method: req.method, body: Buffer.concat(chunks).toString('utf8') }));
      });
    },
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { server, url: `https://localhost:${port}/pix` };
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe('mtlsTransport', () => {
  it('presents the merchant certificate, and the server sees exactly that identity', async () => {
    const { server, url } = await mutualTlsServer(200);
    try {
      const answer = await providerFetch<{ cn: string; method: string; body: string }>(
        'itau',
        'probe',
        url,
        { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{"valor":"1.00"}' },
        mtlsTransport(MERCHANT, { ca: SERVER.cert }),
      );
      expect(answer).toEqual({ cn: 'merchant-a', method: 'PUT', body: '{"valor":"1.00"}' });
    } finally {
      await close(server);
    }
  });

  it('is refused at the handshake with a certificate the server does not trust', async () => {
    const { server, url } = await mutualTlsServer(200);
    try {
      await expect(
        providerFetch('itau', 'probe', url, { method: 'GET', headers: {} }, mtlsTransport(STRANGER, { ca: SERVER.cert })),
      ).rejects.toBeInstanceOf(Error);
    } finally {
      await close(server);
    }
  });

  it('maps a non-2xx answer through the shared error path, status intact', async () => {
    const { server, url } = await mutualTlsServer(403);
    try {
      const failure = await providerFetch('itau', 'probe', url, { method: 'GET', headers: {} }, mtlsTransport(MERCHANT, { ca: SERVER.cert })).catch(
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(ProviderRequestError);
      expect((failure as ProviderRequestError).options.httpStatus).toBe(403);
    } finally {
      await close(server);
    }
  });
});

describe('identityProblem', () => {
  it('accepts a certificate with its own key', () => {
    expect(identityProblem(MERCHANT)).toBeNull();
  });

  it('names a key that belongs to another certificate', () => {
    expect(identityProblem({ cert: MERCHANT.cert, key: STRANGER.key })).toBe('MISMATCH');
  });

  it('names a truncated paste as unreadable', () => {
    expect(identityProblem({ cert: MERCHANT.cert.slice(0, 80), key: MERCHANT.key })).toBe('INVALID');
  });
});
