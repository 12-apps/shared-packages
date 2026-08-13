/**
 * Every published subpath RESOLVES from the packed tarball, and its headline
 * symbol is really there (12-23).
 *
 * This suite exists because of how `@12-apps/rbac`'s `./coverage` shipped BROKEN:
 * nothing in the repo imported it, so nothing noticed. An export map entry is a
 * promise to a consumer, and the only thing that can check it is a consumer —
 * which is what the harness is. It installs from `npm pack` output (see
 * `scripts/harness-install.mjs`), so a subpath missing from `exports`, a file
 * excluded by `files`, or a transitive dependency that does not resolve once the
 * pnpm workspace links are gone all fail HERE rather than in someone's app.
 *
 * `@12-apps/mcp/coverage` is the sharp one: it reaches
 * `@12-apps/rbac/coverage` transitively, so this asserts a cross-package hop
 * through two tarballs, not just one manifest.
 *
 * Deliberately shallow. Behaviour is proven by each package's own suite and by the
 * other harness suites; all this asks is "does the door open".
 */
import { describe, expect, it } from 'vitest';

describe('@12-apps/mcp published subpaths', () => {
  it('exposes the MCP core from `.`', async () => {
    const mod = await import('@12-apps/mcp');
    expect(typeof mod.generateTools).toBe('function');
    expect(typeof mod.dispatchTool).toBe('function');
  });

  it('exposes the OAuth 2.1 authorization server from `./oauth`', async () => {
    const mod = await import('@12-apps/mcp/oauth');
    expect(typeof mod.createApiMcpOauth).toBe('function');
    expect(typeof mod.signingKeyProvider).toBe('function');
  });

  it('exposes the Hono adapter from `./hono`', async () => {
    const mod = await import('@12-apps/mcp/hono');
    expect(typeof mod.mcpOauthRouter).toBe('function');
  });

  it('exposes the mcp:coverage gate from `./coverage` — and rbac through it', async () => {
    const mod = await import('@12-apps/mcp/coverage');
    expect(typeof mod.runMcpCoverage).toBe('function');
    expect(typeof mod.mcpCoverageCli).toBe('function');
    // The transitive hop, which is the actual risk: this gate's export-head parser
    // IS `@12-apps/rbac/coverage`'s, so resolving `./coverage` from the mcp tarball
    // only works if rbac's own subpath resolves from ITS tarball too.
    expect(mod.exportedMethodsOf('export const GET = h;')).toEqual(['GET']);
  });

  it('exposes the mcp:generate gate from `./generate`', async () => {
    const mod = await import('@12-apps/mcp/generate');
    expect(typeof mod.mcpGenerateCli).toBe('function');
  });
});

describe('the subpath @12-apps/mcp/coverage depends on', () => {
  it('resolves `@12-apps/rbac/coverage` directly as well', async () => {
    const mod = await import('@12-apps/rbac/coverage');
    // The shared walk itself — added to that barrel in 12-23, so a consumer
    // installing both packages must find it on the published surface.
    expect(typeof mod.exportedNamesOf).toBe('function');
    expect(mod.exportedNamesOf('export const a = 1;')).toEqual(['a']);
    expect(typeof mod.runRbacCoverage).toBe('function');
  });
});
