/**
 * `@12-apps/mcp/e2e` — the packaged AI-connect journeys and the port a host
 * implements to run them.
 *
 * The `e2e` capability the manifest declares. A host adds the three globs to
 * its bdd config and calls `defineMcpConnectWorld` from inside its own steps
 * glob; every scenario this package ships then runs in that host, including the
 * ones added after it integrated. Nothing is copied, so nothing can rot.
 */
export { mcpFeatures, mcpFeaturesRoot, mcpSteps } from './globs.js';
export {
  defineMcpConnectWorld,
  mcpConnectWorld,
  type McpConnectFixtures,
  type McpConnectWorld,
} from './world.js';
