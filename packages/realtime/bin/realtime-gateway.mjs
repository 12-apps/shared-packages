#!/usr/bin/env node
/* global console, process */
/**
 * `realtime-gateway` — the WebSocket gateway as a command (12-16).
 *
 *     npx realtime-gateway
 *     REALTIME_GATEWAY_PORT=3100 REDIS_URL=redis://… npx realtime-gateway
 *
 * Configuration is entirely environmental (`../src/gateway/config.ts`), which is
 * what makes this usable as a container command with no wrapper file. A host that
 * wants to configure it in code imports `startRealtimeGateway` from
 * `@12-apps/realtime/gateway` instead.
 *
 * ## Why this file registers a TypeScript loader
 *
 * Every `@12-apps/*` package publishes TypeScript SOURCE — the `exports` map points
 * at `./src/**.ts` and there is no build step, deliberately, so a consumer's own
 * bundler compiles one copy of everything. That is fine for an imported library and
 * not fine for a `bin`, which plain `node` has to be able to execute.
 *
 * So the bin is plain JavaScript and installs `tsx`'s ESM hooks before importing the
 * gateway. `tsx` is an OPTIONAL peer: a host that only imports the library never
 * needs it, and one that runs this command has it (it is how every TypeScript-source
 * server in this monorepo already runs). If it is missing, the message below says
 * exactly what to do rather than surfacing `Unknown file extension ".ts"`.
 */
const HERE = new URL("./", import.meta.url);

try {
  const { register } = await import("tsx/esm/api");
  register();
} catch (error) {
  console.error(
    "[realtime-gateway] this command needs `tsx` to load the package's TypeScript source.\n" +
      "  Install it beside @12-apps/realtime:  npm i -D tsx\n" +
      "  Or import { startRealtimeGateway } from '@12-apps/realtime/gateway' from your own\n" +
      "  already-compiled entry point.\n",
    error,
  );
  process.exit(1);
}

const { runRealtimeGateway } = await import(new URL("../src/gateway/index.ts", HERE).href);

await runRealtimeGateway();
