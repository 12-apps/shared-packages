import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

interface ManifestShape {
  prisma?: { seed?: string };
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const manifestPath = join(__dirname, 'package.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as ManifestShape;

describe('shared-helpers manifest — prisma seed wiring', () => {
  it('declares the seed command (tsx prisma/seed.ts) in prisma.config.ts (Prisma 7)', () => {
    // Prisma 7 moved seed config out of the package.json "prisma" block into
    // prisma.config.ts (migrations.seed).
    const config = readFileSync(join(__dirname, 'prisma.config.ts'), 'utf-8');
    expect(config).toMatch(/seed\s*:\s*'tsx prisma\/seed\.ts'/);
    expect(manifest.prisma?.seed).toBeUndefined();
  });

  it('exposes a db:seed script for deterministic CI invocation', () => {
    expect(manifest.scripts?.['db:seed']).toBeDefined();
    expect(typeof manifest.scripts?.['db:seed']).toBe('string');
  });

  it('adds tsx as a devDependency', () => {
    expect(manifest.devDependencies?.tsx).toBeDefined();
  });
});
