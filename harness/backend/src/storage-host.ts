/**
 * Everything `@12-apps/storage` needs from a HOST, in one object (12-20).
 *
 * What is genuinely the host's, and all that is here: who is calling and which
 * tenant they act for (a header-driven stand-in — a browser cannot have a real
 * session), where bytes live (a local-disk driver on a temp directory), which of
 * ITS OWN tables can still need an object (the reference probes, over a real
 * Postgres), and which image pipeline it is prepared to pay for. Everything else
 * — the endpoint, the streaming cap, the magic-number check, key minting, the
 * write order, the URLs, the reclaim and every pt-BR sentence — is the package's,
 * which is the entire claim under test.
 *
 * ## Why the probes are real tables
 *
 * "Is this object still needed?" is the one storage question a package cannot
 * answer, because the answer lives in the host's catalog. So the harness gives it
 * a catalog: two tables on the same PGlite the rest of the harness uses, one of
 * live rows and one of pending edits held as JSON — the shape the origin host's own
 * reclaim probes, including the `entity_versions` table that must NOT pin an
 * object. Those are the claims worth running against a real database.
 *
 * ## Why the pipeline is not sharp
 *
 * libvips cannot be loaded in this environment at all, so a harness that imported
 * `sharp` would fail at COLLECTION and look exactly like a broken package. The
 * shipped sharp adapter's decisions — enlargement, animation, the padding colour,
 * a partial set — are covered in the package's own suite against a stub module,
 * which is precisely what taking the module as an ARGUMENT is for. What this
 * pipeline still exercises for real is everything downstream of it: the key shape
 * a non-empty cut list produces, six objects on disk, the serve route, and the
 * srcset the server builds from the key.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Hono } from 'hono';
import type { PGlite } from '@electric-sql/pglite';
import { STORAGE_PATHS } from '@12-apps/storage';
import type { ImagePipeline, StorageReferenceProbe } from '@12-apps/storage/server';
import { createLocalDiskDriver } from '@12-apps/storage/server';
import { storageRouter } from '@12-apps/storage/hono';

/** The tenant the SPA page and most suites drive. */
export const STORAGE_TENANT = 'harness-store';

/**
 * The neighbour. Cross-tenant reclaim is the highest-stakes property here, and a
 * harness with one tenant cannot exercise it at the tarball level.
 */
export const STORAGE_TENANT_B = 'harness-store-b';

/** The header a suite sets to act as somebody else; the SPA sends none. */
const ACTOR_HEADER = 'x-storage-actor';
/** `deny` refuses the upload gate — the host's verdict, not the package's. */
const GATE_HEADER = 'x-storage-gate';

export interface StorageHost {
  /**
   * The package's mount at `/api`, plus the host's own control surface under
   * `/__harness/storage`. One router, so the server assembles it with one line.
   */
  router: Hono;
  /** Where objects land, so a suite can assert files rather than responses. */
  root: string;
  reset(): Promise<void>;
  close(): void;
}

/** The host's own catalog: a live row, and an edit somebody is about to publish. */
async function createHostTables(pg: PGlite): Promise<void> {
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS harness_photos (
      id TEXT PRIMARY KEY, tenant TEXT NOT NULL, image_key TEXT, status TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS harness_pending_edits (
      id TEXT PRIMARY KEY, tenant TEXT NOT NULL, status TEXT NOT NULL, payload JSONB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS harness_photo_versions (
      id TEXT PRIMARY KEY, tenant TEXT NOT NULL, image_key TEXT NOT NULL
    );
  `);
}

/**
 * The two probes, and the one table deliberately absent from them.
 *
 * `harness_photo_versions` is version history, and counting a version as a
 * reference would pin every replaced object for the whole retention window — so
 * "replace a photo" would reclaim nothing, ever. That is the behaviour the
 * suite asserts, not an oversight.
 *
 * The pending probe is scoped to rows that are genuinely OPEN. A discarded edit
 * is as dead as a version; leaving it in would restore "never reclaims" one
 * abandoned edit at a time. And the key is BOUND as a parameter, never
 * interpolated.
 */
function probesOver(pg: PGlite): readonly StorageReferenceProbe[] {
  return [
    {
      name: 'live-rows',
      referenced: async (scope, key) => {
        const rows = await pg.query<{ id: string }>(
          'SELECT id FROM harness_photos WHERE tenant = $1 AND image_key = $2 LIMIT 1',
          [scope, key],
        );
        return rows.rows.length > 0;
      },
    },
    {
      name: 'pending-edits',
      referenced: async (scope, key) => {
        const rows = await pg.query<{ id: string }>(
          `SELECT id FROM harness_pending_edits
            WHERE tenant = $1 AND status = 'OPEN' AND payload::text LIKE $2 LIMIT 1`,
          [scope, `%${key}%`],
        );
        return rows.rows.length > 0;
      },
    },
  ];
}

/**
 * A pipeline whose uncropped object is the file that was picked, byte for byte.
 *
 * That is the point of it: the object a browser gets back from the serve route is
 * a real, decodable image, so the frontend spec can prove the whole round trip in
 * an `<img>`. The crops are marker payloads — distinguishable per canvas, and
 * enough for "six objects exist, each of them resolves, and the srcset names
 * exactly these" — because synthesising five genuinely resampled images without a
 * codec would be a second implementation of the thing under test.
 */
export function harnessImagePipeline(): ImagePipeline {
  return {
    name: 'harness-marker',
    cutsRenditions: true,
    process: async (bytes, contentType) => ({ ok: true, image: { bytes, contentType } }),
    cut: async (_bytes, specs) =>
      specs.map((spec) => ({
        spec,
        bytes: new TextEncoder().encode(`${spec.name}:${spec.width}x${spec.height}`),
      })),
  };
}

export async function createStorageHost(pg: PGlite): Promise<StorageHost> {
  await createHostTables(pg);
  const root = mkdtempSync(join(tmpdir(), 'harness-storage-'));
  const api = storageRouter({
    driver: createLocalDiskDriver({
      root,
      // Composed, never retyped: the driver builds display URLs from this and the
      // serve route answers them, so a literal here is how a deployment writes
      // objects at one path and serves them from another.
      publicPathPrefix: `/api${STORAGE_PATHS.serve}`,
    }),
    maxBytes: 1024 * 1024,
    imagePipeline: harnessImagePipeline(),
    // A fresh host: every key it will ever mint carries a scope, so a key without
    // one can only be somebody else's or nobody's.
    unscopedKeys: 'reject',
    references: probesOver(pg),
    logger: { error: (message) => process.stderr.write(`${message}\n`) },
    resolveActor: (c) => {
      const scope = c.req.header(ACTOR_HEADER) ?? STORAGE_TENANT;
      // Both halves of "may this upload happen" are the host's: whose rights
      // decide, and whether this session may change anything at all.
      return { scope, mayUpload: c.req.header(GATE_HEADER) !== 'deny' };
    },
  });

  const router = new Hono();
  router.route('/api', api.router);
  router.route('/__harness/storage', controlRouter(pg, api));

  return {
    router,
    root,
    reset: async () => {
      await pg.exec(
        'TRUNCATE TABLE harness_photos, harness_pending_edits, harness_photo_versions',
      );
    },
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** A row the host's catalog holds — what a suite inserts to pin an object. */
interface HostRow {
  tenant?: string;
  imageKey?: string;
  status?: string;
}

/**
 * The HOST's control surface, deliberately NOT under `/api`.
 *
 * A reclaim is called from a host WRITE, never from an endpoint, so exercising it
 * needs a host write — these are the harness's stand-in for one. They also seed
 * the three tables the probes read, which is how a suite states "a live row still
 * points at this" without reaching around the mount into the database.
 */
function controlRouter(pg: PGlite, api: ReturnType<typeof storageRouter>): Hono {
  const control = new Hono();

  control.post('/rows', async (c) => {
    const row = (await c.req.json()) as HostRow;
    await pg.query(
      'INSERT INTO harness_photos (id, tenant, image_key, status) VALUES ($1, $2, $3, $4)',
      [crypto.randomUUID(), row.tenant ?? STORAGE_TENANT, row.imageKey ?? null, row.status ?? 'LIVE'],
    );
    return c.body(null, 204);
  });

  control.post('/pending', async (c) => {
    const row = (await c.req.json()) as HostRow;
    await pg.query(
      'INSERT INTO harness_pending_edits (id, tenant, status, payload) VALUES ($1, $2, $3, $4)',
      [
        crypto.randomUUID(),
        row.tenant ?? STORAGE_TENANT,
        row.status ?? 'OPEN',
        JSON.stringify({ imageKey: row.imageKey ?? null }),
      ],
    );
    return c.body(null, 204);
  });

  control.post('/versions', async (c) => {
    const row = (await c.req.json()) as HostRow;
    await pg.query(
      'INSERT INTO harness_photo_versions (id, tenant, image_key) VALUES ($1, $2, $3)',
      [crypto.randomUUID(), row.tenant ?? STORAGE_TENANT, row.imageKey ?? ''],
    );
    return c.body(null, 204);
  });

  /** "A write just replaced this photo" — the only way the reclaim is ever reached. */
  control.post('/reclaim', async (c) => {
    const body = (await c.req.json()) as {
      scope?: string;
      key?: string;
      before?: string[];
      after?: string[];
      discard?: string[];
    };
    const scope = body.scope ?? STORAGE_TENANT;
    if (body.discard) await api.reclaim.discardMinted(scope, body.discard);
    else if (body.before) await api.reclaim.deleteReplaced(scope, body.before, body.after ?? []);
    else await api.reclaim.deleteIfOrphaned(scope, body.key ?? null);
    return c.body(null, 204);
  });

  /** What the server would hand a client for a stored key. */
  control.get('/sources', (c) => {
    const key = c.req.query('key') ?? '';
    return c.json({
      url: api.urls.objectUrl(key),
      sources: api.urls.imageSources(key),
      objects: api.reclaim.objectKeysFor(key),
      limits: api.limits,
    });
  });

  return control;
}
