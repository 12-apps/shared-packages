import { mkdir, readFile, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { CONTENT_TYPE_BY_EXTENSION } from '../../content-types';
import type { StorageDriver, StoredObject } from '../driver';

/**
 * Objects on the app server's OWN DISK — the development driver, and the one
 * that needs no account, no bucket and no credentials.
 *
 * `root` is REQUIRED and has no default on purpose. `<cwd>/.uploads` is a fine
 * development value and a silent disaster in production: a container's disk is
 * ephemeral, so an app that fell back to it would report every upload as a
 * success and lose the objects at the next deploy — with nothing in any log to
 * say so. A host that wants the development default writes it in its own config,
 * where the choice is visible and reviewable.
 *
 * `publicPathPrefix` is where the serve route is mounted, so a stored key can be
 * turned into a URL on this same origin. One definition of both, so a deployment
 * cannot write objects to one place and serve them from another.
 */
export interface LocalDiskDriverConfig {
  /** Absolute path of the directory objects live under. */
  root: string;
  /** Path the serve route is mounted at, e.g. `/api/uploads/local`. */
  publicPathPrefix: string;
}

/** A key segment safe to use as a path component. */
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

/**
 * Absolute path for a stored object key under `root`.
 *
 * Keys reaching here are server-minted, so the segment check is a backstop
 * rather than the validation of an untrusted key — the serve route validates its
 * caller-supplied path itself, in more detail, before it ever builds one. It
 * throws rather than returning null because there is no legitimate caller that
 * can produce a traversal segment: one here would mean a key was assembled
 * somewhere it should not have been.
 */
export function localObjectPath(root: string, key: string): string {
  const segments = key.split('/');
  if (!segments.every((segment) => SAFE_SEGMENT.test(segment))) {
    throw new Error(`Refusing to resolve an unsafe object key: ${key}`);
  }
  return path.join(root, ...segments);
}

/** `full.webp` → `image/webp`; an unknown extension → a generic type. */
function contentTypeOfPath(filePath: string): string {
  const extension = path.extname(filePath).replace('.', '').toLowerCase();
  return CONTENT_TYPE_BY_EXTENSION[extension] ?? 'application/octet-stream';
}

/**
 * Remove the object at `filePath`, then prune the directory it was the last
 * member of.
 *
 * A photo stored with its crops is six files in a directory of its own, so
 * reclaiming one leaves that directory behind, empty, once the last file goes.
 * A bucket has no such thing — a key's slashes are just characters — so the
 * leftover is purely an artifact of this driver, and pruning it keeps the root a
 * truthful picture of what is stored. `rmdir` on a directory that still holds a
 * sibling fails, which IS the check: no listing, and no race between two
 * concurrent reclaims.
 */
async function removeAndPrune(root: string, filePath: string): Promise<void> {
  await rm(filePath, { force: true });
  const parent = path.dirname(filePath);
  if (path.resolve(parent) === path.resolve(root)) return;
  try {
    await rmdir(parent);
  } catch {
    // Not empty, or already gone. Either way there is nothing to clean up.
  }
}

export function createLocalDiskDriver(config: LocalDiskDriverConfig): StorageDriver {
  const prefix = config.publicPathPrefix.replace(/\/$/, '');
  return {
    name: 'local-disk',
    put: async (key, bytes) => {
      const filePath = localObjectPath(config.root, key);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, bytes);
    },
    delete: async (key) => {
      await removeAndPrune(config.root, localObjectPath(config.root, key));
    },
    publicUrl: (key) => `${prefix}/${key}`,
    read: async (key): Promise<StoredObject | null> => {
      const filePath = localObjectPath(config.root, key);
      try {
        // `stat` first, so a directory whose name happens to match a key reads
        // as absent rather than as an unreadable object.
        if (!(await stat(filePath)).isFile()) return null;
        return { bytes: new Uint8Array(await readFile(filePath)), contentType: contentTypeOfPath(filePath) };
      } catch {
        return null;
      }
    },
  };
}
