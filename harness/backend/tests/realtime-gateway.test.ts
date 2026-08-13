/* eslint-disable test-flakiness/no-test-isolation, test-flakiness/no-unmocked-network --
   the NETWORK is the subject: this suite exists to prove the published gateway entry is
   genuinely runnable from a tarball and that a real WebSocket carries real events through it.
   Mocking the socket would leave the suite asserting against a fake of the one thing under
   test. Each case starts its own gateway on an ephemeral port and closes it. */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import WebSocket from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { publishRealtimeEvent, resetRealtimeRuntime } from '@12-apps/realtime';
import { startRealtimeGateway, type RealtimeGateway } from '@12-apps/realtime/gateway';
import { mintRealtimeTicket } from '@12-apps/realtime/ticket';

/**
 * `@12-apps/realtime/gateway` — RUN, not merely imported.
 *
 * The ticket says the gateway must ship as a runnable entry from the package, "genuinely
 * runnable from an installed tarball — prove it". Two proofs, because they can fail
 * independently:
 *
 *   1. the PROGRAMMATIC entry — `startRealtimeGateway`, a real listener, a real `ws` client,
 *      a real event crossing the bus onto that socket;
 *   2. the BIN — `npx realtime-gateway`, spawned as a plain `node` process against the
 *      installed package, answering `/health` and accepting a socket. That is the one that
 *      catches a `bin` entry that is present in the manifest and unloadable in practice,
 *      which is exactly how a TypeScript-source package's `bin` normally breaks.
 */

const SECRET = 'gateway-harness-secret';
const HOST = '127.0.0.1';

/** Where the installed package lives — the tarball, not the workspace. */
const packageDir = fileURLToPath(new URL('../node_modules/@12-apps/realtime/', import.meta.url));

const running: { gateway: RealtimeGateway | null } = { gateway: null };

afterEach(async () => {
  const gateway = running.gateway;
  running.gateway = null;
  await gateway?.close();
  resetRealtimeRuntime();
});

/** Start on port 0 — the OS picks a free one, so parallel runs cannot collide. */
async function start(): Promise<{ gateway: RealtimeGateway; port: number }> {
  const gateway = await startRealtimeGateway({
    port: 0,
    ticketSecret: SECRET,
    redisUrl: null,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  });
  running.gateway = gateway;
  const address = gateway.server.address();
  if (address === null || typeof address === 'string') throw new Error('the gateway did not listen');
  return { gateway, port: address.port };
}

/** Open a socket and resolve once it is open, or reject with the HTTP refusal. */
function connect(port: number, ticket: string): Promise<WebSocket> {
  const socket = new WebSocket(`ws://${HOST}:${port}/ws?ticket=${encodeURIComponent(ticket)}`);
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
    // `ws` surfaces a pre-upgrade refusal here, which is what a bad ticket produces.
    socket.once('unexpected-response', (_request, response) =>
      reject(new Error(`refused: ${response.statusCode ?? 0}`)),
    );
  });
}

/** The next frame this socket receives, decoded. */
function nextFrame(socket: WebSocket): Promise<{ topic: string; type: string; data: unknown }> {
  return new Promise((resolve) => {
    socket.once('message', (raw) => resolve(JSON.parse(String(raw)) as never));
  });
}

describe('the programmatic entry', () => {
  it('listens, and answers its health probe', async () => {
    const { port, gateway } = await start();
    const response = await fetch(`http://${HOST}:${port}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, connections: 0 });
    expect(gateway.config.socketPath).toBe('/ws');
  });

  it('404s anything that is not the health probe', async () => {
    const { port } = await start();
    // The gateway serves exactly one upgrade path and one health probe; everything else is
    // somebody pointing the wrong thing at this port.
    expect((await fetch(`http://${HOST}:${port}/api/admin/x`)).status).toBe(404);
  });

  it('accepts a signed ticket and relays that topic’s events', async () => {
    const { port, gateway } = await start();
    const socket = await connect(port, mintRealtimeTicket(['tenant:t-1:kitchen'], SECRET));
    try {
      expect(gateway.connections).toBe(1);
      const frame = nextFrame(socket);
      // The gateway shares this process's bus, so a publish here is the worker's publish in
      // a real deployment (which crosses processes through Redis).
      await publishRealtimeEvent('tenant:t-1:kitchen', {
        type: 'kitchen.changed',
        data: { ticketId: 'k-1' },
      });
      expect(await frame).toMatchObject({
        topic: 'tenant:t-1:kitchen',
        type: 'kitchen.changed',
        data: { ticketId: 'k-1' },
      });
    } finally {
      socket.close();
    }
  });

  it('never relays a topic the ticket did not name', async () => {
    const { port } = await start();
    const socket = await connect(port, mintRealtimeTicket(['tenant:t-1:kitchen'], SECRET));
    try {
      const frame = nextFrame(socket);
      // A topic that was never handed over is a topic that is never subscribed to — the
      // property that makes a gateway bug unable to leak another tenant's events.
      await publishRealtimeEvent('tenant:t-2:kitchen', { type: 'foreign.event', data: {} });
      await publishRealtimeEvent('tenant:t-1:kitchen', { type: 'mine.event', data: {} });
      // Order, not absence: the foreign publish came first, so the next frame being ours
      // proves it was never delivered.
      expect(await frame).toMatchObject({ type: 'mine.event' });
    } finally {
      socket.close();
    }
  });

  it('refuses a forged ticket at the HTTP layer, before the handshake', async () => {
    const { port } = await start();
    await expect(connect(port, 'not-a-ticket')).rejects.toThrow(/refused: 401/);
  });

  it('refuses a ticket signed with ANOTHER deployment’s secret', async () => {
    const { port } = await start();
    const foreign = mintRealtimeTicket(['tenant:t-1:kitchen'], 'some-other-deployment');
    await expect(connect(port, foreign)).rejects.toThrow(/refused: 401/);
  });

  it('BURNS a ticket on first use — a replay is refused with the same 401', async () => {
    const { port } = await start();
    const ticket = mintRealtimeTicket(['tenant:t-1:kitchen'], SECRET);
    const socket = await connect(port, ticket);
    try {
      // A ticket travels in a query string, so it can land in a proxy log. Single use makes a
      // captured one worthless the moment its owner connects.
      await expect(connect(port, ticket)).rejects.toThrow(/refused: 401/);
    } finally {
      socket.close();
    }
  });

  it('answers a client ping with the topics it believes it serves', async () => {
    const { port } = await start();
    const socket = await connect(port, mintRealtimeTicket(['tenant:t-1:kitchen'], SECRET));
    try {
      const frame = nextFrame(socket);
      socket.send(JSON.stringify({ type: 'ping' }));
      expect(await frame).toMatchObject({
        topic: '$gateway',
        type: 'pong',
        data: { topics: ['tenant:t-1:kitchen'] },
      });
    } finally {
      socket.close();
    }
  });

  it('widens on a freshly signed subscribe, and refuses its replay', async () => {
    const { port } = await start();
    const socket = await connect(port, mintRealtimeTicket(['tenant:t-1:kitchen'], SECRET));
    try {
      const widening = mintRealtimeTicket(['tenant:t-1:orders'], SECRET);
      const first = nextFrame(socket);
      socket.send(JSON.stringify({ type: 'subscribe', ticket: widening }));
      expect(await first).toMatchObject({
        type: 'subscribed',
        data: { topics: ['tenant:t-1:kitchen', 'tenant:t-1:orders'] },
      });

      const second = nextFrame(socket);
      socket.send(JSON.stringify({ type: 'subscribe', ticket: widening }));
      expect(await second).toMatchObject({ type: 'error', data: { reason: 'replayed-ticket' } });
    } finally {
      socket.close();
    }
  });

  it('refuses an upgrade on any other path', async () => {
    const { port } = await start();
    const socket = new WebSocket(`ws://${HOST}:${port}/anything`);
    await expect(
      new Promise((resolve, reject) => {
        socket.once('open', () => resolve('opened'));
        socket.once('error', reject);
      }),
    ).rejects.toThrow();
  });

  it('closes every socket on shutdown, so clients see a clean EOF', async () => {
    const { port, gateway } = await start();
    const socket = await connect(port, mintRealtimeTicket(['tenant:t-1:kitchen'], SECRET));
    const closed = new Promise<number>((resolve) => socket.once('close', (code) => resolve(code)));
    await gateway.close();
    running.gateway = null;
    // 1001 "going away" — the client's reconnect handles it like any other close.
    expect(await closed).toBe(1001);
  });
});

describe('the shipped bin', () => {
  it('runs under plain node from the installed package, and serves a socket', async () => {
    // THE proof the ticket asks for. `npx` is not used: the bin is resolved by PATH inside
    // node_modules/.bin, which is what an installed consumer gets.
    const binPath = fileURLToPath(new URL('.bin/realtime-gateway', new URL('../node_modules/', import.meta.url)));
    const port = 34517;
    const child = spawn(process.execPath, [binPath], {
      env: {
        ...process.env,
        REALTIME_TICKET_SECRET: SECRET,
        REALTIME_GATEWAY_PORT: String(port),
        REDIS_URL: '',
      },
      cwd: packageDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stderr: string[] = [];
    child.stderr.on('data', (chunk: Buffer) => stderr.push(String(chunk)));

    try {
      // Poll the health probe rather than sleep: the readiness signal is the server
      // ANSWERING, and a fixed wait is a guess that would either be flaky or slow. The
      // failure message carries the child's stderr, because "the bin never listened" is
      // useless without the reason — a missing `tsx`, a syntax error in the entry, a port
      // already held.
      await vi.waitFor(
        async () => {
          const response = await fetch(`http://${HOST}:${port}/health`);
          expect(response.ok, `the bin never listened. stderr:\n${stderr.join('')}`).toBe(true);
        },
        { timeout: 30_000, interval: 100 },
      );

      // And it really serves the socket, with the same ticket contract.
      const socket = await connect(port, mintRealtimeTicket(['tenant:t-1:kitchen'], SECRET));
      const frame = nextFrame(socket);
      socket.send(JSON.stringify({ type: 'ping' }));
      expect(await frame).toMatchObject({ type: 'pong', data: { topics: ['tenant:t-1:kitchen'] } });
      socket.close();
    } finally {
      child.kill('SIGTERM');
    }
  }, 60_000);
});
