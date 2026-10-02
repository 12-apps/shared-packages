import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createPrismaMcpStores } from '../../dist/oauth/index.js';

const requirePrisma = createRequire(new URL('../../../prisma/package.json', import.meta.url));
const { PrismaClient } = requirePrisma('@prisma/client');
const { PrismaPg } = requirePrisma('@prisma/adapter-pg');
const { Pool } = createRequire(requirePrisma.resolve('@prisma/adapter-pg'))('pg');
export const AT = new Date('2026-10-02T00:00:00.000Z');
export const OWNER = { userId: 'synthetic-owner', email: 'owner@example.invalid' };
export const ROOT = {
  tokenHash: 'synthetic-root', clientId: 'synthetic-client', userEmail: OWNER.email,
  userSub: OWNER.userId, scopes: ['mcp:read'], rotatedFrom: null,
  expiresAt: new Date('2099-01-01T00:00:00.000Z'), graceSeal: 'synthetic-seal',
};
export const child = (hash) => ({ ...ROOT, tokenHash: hash, rotatedFrom: ROOT.tokenHash });

// Fail closed: this executable may only erase its explicitly named local fixture DB.
function fixtureUrl() {
  const url = new URL(process.env.MCP_CONCURRENCY_DATABASE_URL);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
  assert.equal(url.pathname, '/mcp_concurrency');
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  return url.toString();
}

function latch() {
  const reached = Promise.withResolvers();
  const released = Promise.withResolvers();
  let used = false;
  return {
    reached: reached.promise,
    release: () => released.resolve(),
    async pause() {
      if (used) return;
      used = true;
      reached.resolve();
      await released.promise;
    },
  };
}

function instrumentDelegate(delegate, model, hooks) {
  return new Proxy(delegate, {
    get(target, key) {
      const method = target[key];
      if (typeof method !== 'function') return method;
      return async (...args) => {
        const result = await method.apply(target, args);
        await hooks[`${model}.${String(key)}`]?.(result, args);
        return result;
      };
    },
  });
}

function observedPrisma(client, record, hooks) {
  return new Proxy(client, {
    get(target, key) {
      if (key !== '$transaction') return target[key];
      return async (operation, options) => {
        record.attempts += 1;
        try {
          return await target.$transaction(async (tx) => {
            const [identity] = await tx.$queryRawUnsafe(
              "SELECT pg_backend_pid() AS pid, current_setting('transaction_isolation') AS isolation",
            );
            record.sessions.add(identity.pid);
            assert.equal(identity.isolation, 'serializable');
            return operation({
              oAuthRefreshToken: instrumentDelegate(tx.oAuthRefreshToken, 'token', hooks),
              mcpConnection: instrumentDelegate(tx.mcpConnection, 'connection', hooks),
            });
          }, { ...options, timeout: 15_000 });
        } catch (error) {
          record.errors.push(error.code);
          throw error;
        }
      };
    },
  });
}

export async function fixture(t) {
  const connectionString = fixtureUrl();
  const pool = new Pool({ connectionString });
  const clients = [];
  const holds = [];
  t.after(async () => {
    for (const hold of holds) hold.release();
    await Promise.all(clients.map((client) => client.$disconnect()));
    await pool.end();
  });
  const migrations = new URL('../../prisma/migrations/', import.meta.url);
  for (const name of (await readdir(migrations)).sort()) {
    await pool.query(await readFile(new URL(`${name}/migration.sql`, migrations), 'utf8'));
  }
  await pool.query('TRUNCATE oauth_clients, oauth_refresh_tokens, mcp_connections');
  const client = (name) => {
    const value = new PrismaClient({ adapter: new PrismaPg({ connectionString, application_name: name }) });
    clients.push(value);
    return value;
  };
  const control = client('fut211-control');
  await control.oAuthRefreshToken.create({ data: ROOT });
  await control.mcpConnection.create({ data: {
    userId: OWNER.userId, oauthClientId: ROOT.clientId, clientName: 'Synthetic client',
    host: 'claude', connectedAt: AT, lastActiveAt: AT,
  } });
  return {
    control, pool,
    hold() {
      const held = latch();
      holds.push(held);
      return held;
    },
    actor(name, hooks = {}) {
      const record = { attempts: 0, errors: [], sessions: new Set() };
      const prisma = observedPrisma(client(name), record, hooks);
      return { stores: createPrismaMcpStores(() => prisma), record };
    },
  };
}

export async function waitForLock(pool, applicationName) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await pool.query(
      "SELECT pid FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'",
      [applicationName],
    );
    if (result.rowCount > 0) return;
  }
  throw new Error(`No real PostgreSQL lock wait observed for ${applicationName}`);
}

export function assertRetry(record) {
  assert.ok(record.attempts >= 2 && record.attempts <= 3);
  assert.ok(record.errors.includes('P2034'), 'real Prisma serialization conflict required');
}

export function report(t, ...actors) {
  const records = actors.map(({ record }) => ({ ...record, sessions: [...record.sessions] }));
  assert.ok(new Set(records.flatMap((entry) => entry.sessions)).size >= 2);
  t.diagnostic(JSON.stringify({ postgresSessions: records }));
}
