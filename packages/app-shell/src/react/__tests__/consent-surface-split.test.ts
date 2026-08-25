import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The consent GATE is eager; the dialog it might show is not.
 *
 * `TermsConsentDialog` is mounted app-wide by every host and returns `null` on
 * essentially every render — the terms version has not moved, or the user is on
 * the terms page reading them. The screen behind that `null` was a static
 * import, so every app's ENTRY chunk carried MUI's `Dialog`, `Modal`, `Fade`,
 * `Paper` and focus trap to support a surface that appears when a legal
 * document changes.
 *
 * The split has to keep the DECIDING half eager — the consent hook, its poll
 * and the realtime accelerator — or the dialog would stop appearing when it
 * should, which is a far worse failure than the bytes. So this asserts both
 * directions: the surface is reached only dynamically, and the hook is not.
 *
 * Source text rather than behaviour, because what regressed is the SHAPE OF THE
 * IMPORT and only a bundler reads that; every runtime assertion about this
 * component passed throughout.
 */

const CONSENT_ROOT = join(fileURLToPath(new URL('../consent/', import.meta.url)));

function read(file: string): string {
  // The claim is about what the FILE says, so it has to be the real file.
  // eslint-disable-next-line test-flakiness/no-unmocked-fs
  return readFileSync(join(CONSENT_ROOT, file), 'utf8');
}

/** See the sibling packages' equivalents: `[^;]` keeps a match inside ONE statement. */
function importsOf(source: string, module: string): string[] {
  return [...source.matchAll(new RegExp(`^import[^;]*?from '\\./${module}';$`, 'gm'))].map(
    (match) => match[0],
  );
}

describe('the consent gate does not carry its own dialog', () => {
  const gate = read('terms-consent-dialog.tsx');

  it('reaches the surface only through a dynamic import', () => {
    expect(importsOf(gate, 'terms-consent-surface')).toEqual([]);
    expect(gate).toContain("import('./terms-consent-surface')");
  });

  it('keeps the consent HOOK eager, so the gate still decides without a chunk', () => {
    const statements = importsOf(gate, 'use-terms-consent');

    expect(statements.length).toBeGreaterThan(0);
    expect(statements.filter((s) => s.startsWith('import type'))).toEqual([]);
  });

  it('leaves every design-system import on the surface, not the gate', () => {
    expect(gate).not.toContain('@12-apps/ui/');
    expect(read('terms-consent-surface.tsx')).toContain('@12-apps/ui/feedback/Dialog');
  });
});
