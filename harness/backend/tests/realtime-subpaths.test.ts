import { describe, expect, it } from 'vitest';

/**
 * EVERY published subpath of `@12-apps/realtime` resolves from the tarball, and one symbol
 * out of each is real.
 *
 * This exists because of two proven failures, one in each direction:
 *
 *  - #150 shipped a DEAD `./coverage` export: the manifest declared it, nothing in the
 *    repo imported it, and the file it pointed at did not resolve for a consumer. Green
 *    everywhere.
 *  - the review of #156 found two subpaths of a sibling package that no test imported at
 *    all. They happened to work; nothing would have said so if they had not.
 *
 * So this is a COMPLETENESS guard rather than a behaviour test, and its value is that it
 * fails on the day an `exports` entry stops resolving — including transitively, which is
 * how #150 actually broke.
 *
 * The guard is the `expect()` on a SYMBOL out of each subpath, not the import: every import
 * below is `await import(...)`, deliberately, so one dead entry is one failing case rather
 * than a whole file that will not load. Touching a name is what makes the check
 * un-tree-shakeable — an import whose bindings are never read is exactly what a bundler is
 * allowed to drop.
 */

describe('@12-apps/realtime — every published subpath resolves', () => {
  it('. — the core bus', async () => {
    const core = await import('@12-apps/realtime');
    expect(core.tenantTopic('t-1', 'kitchen')).toBe('tenant:t-1:kitchen');
    expect(core.userTopic('u-1', 'notifications')).toBe('user:u-1:notifications');
    expect(typeof core.publishRealtimeEvent).toBe('function');
    expect(typeof core.createInlineRealtimeDriver).toBe('function');
  });

  it('./redis — the cross-process driver', async () => {
    // Behind its own subpath so an emit site never drags ioredis into a bundle that only
    // publishes inline. Constructed nowhere here: that would open a connection.
    const redis = await import('@12-apps/realtime/redis');
    expect(typeof redis.createRedisRealtimeDriver).toBe('function');
  });

  it('./ticket — mint, verify, replay guard', async () => {
    const tickets = await import('@12-apps/realtime/ticket');
    const ticket = tickets.mintRealtimeTicket(['tenant:t-1:kitchen'], 'secret');
    expect(tickets.verifyRealtimeTicket(ticket, 'secret')?.topics).toEqual(['tenant:t-1:kitchen']);
    expect(new tickets.TicketReplayGuard().size).toBe(0);
  });

  it('./server — the API half', async () => {
    const server = await import('@12-apps/realtime/server');
    expect(typeof server.createApiEvents).toBe('function');
    expect(typeof server.enqueueRealtimeEvent).toBe('function');
    expect(typeof server.createRealtimeOutbox).toBe('function');
    expect(new server.EventsDenial(403, 'nope').status).toBe(403);
  });

  it('./hono — the adapter', async () => {
    const hono = await import('@12-apps/realtime/hono');
    expect(typeof hono.eventsRouter).toBe('function');
  });

  it('./gateway — the runnable entry', async () => {
    const gateway = await import('@12-apps/realtime/gateway');
    expect(typeof gateway.startRealtimeGateway).toBe('function');
    expect(typeof gateway.runRealtimeGateway).toBe('function');
    expect(gateway.DEFAULT_GATEWAY_SOCKET_PATH).toBe('/ws');
  });

  it('./react — the browser half', async () => {
    // Resolvable in a NODE context too: the module graph must not require a DOM at import
    // time, or a host that renders on the server cannot even load it.
    const react = await import('@12-apps/realtime/react');
    expect(typeof react.createWebEvents).toBe('function');
    expect(react.reconcileRefetchInterval('connected', 5_000, 30_000)).toBe(30_000);
    expect(react.topicServes('tenant:t-1:kitchen', 'kitchen')).toBe(true);
  });

  it('./worker — the SharedWorker body', async () => {
    const worker = await import('@12-apps/realtime/worker');
    // Not STARTED here: it installs `self.onconnect`, and this process has no worker scope.
    expect(typeof worker.startRealtimeWorker).toBe('function');
  });

  it('./parity — the publisher gate', async () => {
    const parity = await import('@12-apps/realtime/parity');
    expect(typeof parity.runPublisherParity).toBe('function');
    expect(typeof parity.publisherParityCli).toBe('function');
    expect(parity.FUTURE_PAY_PUBLISHER_DECLARATIONS.length).toBeGreaterThan(0);
  });

  it('./package.json — the manifest, and it declares every subpath above', async () => {
    const manifest = (await import('@12-apps/realtime/package.json')) as unknown as {
      default: { exports: Record<string, string>; bin: Record<string, string> };
    };
    expect(Object.keys(manifest.default.exports).sort()).toEqual([
      '.',
      './gateway',
      './hono',
      './package.json',
      './parity',
      './react',
      './redis',
      './server',
      './ticket',
      './worker',
    ]);
    // The bin is the gateway's other entry, and `realtime-gateway.test.ts` spawns it.
    expect(manifest.default.bin).toEqual({ 'realtime-gateway': './bin/realtime-gateway.mjs' });
  });
});
