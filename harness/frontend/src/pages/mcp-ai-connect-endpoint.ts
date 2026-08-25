/**
 * The MCP endpoint this harness serves, as an owner would paste it.
 *
 * It sits in its OWN module, with no React import anywhere in its graph, and
 * that is load-bearing rather than tidiness. The packaged journeys' world
 * (`tests/e2e/steps/mcp-connect-world.ts`) has to name this value, and bddgen
 * loads step files with **Node** — so importing it from the page instead pulls
 * `@12-apps/mcp/react` and MUI into a Node resolver that answers
 * `ERR_UNSUPPORTED_DIR_IMPORT` on `@mui/material/utils` and takes the whole
 * feature compilation down with it.
 *
 * Stating it once here is what keeps the page and the world agreeing about the
 * URL the scenarios assert, without either importing the other.
 */
export const HARNESS_MCP_ENDPOINT = 'https://harness.example/api/mcp';
