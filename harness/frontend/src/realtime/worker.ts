/**
 * The SharedWorker module a HOST writes — two lines, and this is all of it (12-16).
 *
 * Emitting a worker chunk is the host bundler's job: `new SharedWorker(new URL("./worker.ts",
 * import.meta.url))` is a BUILD instruction as much as a runtime one, and bundlers detect
 * that exact shape. A published package cannot portably do it for a consumer — the URL would
 * have to resolve inside `node_modules` through whatever bundler the host happens to use, and
 * a failure there is a BUILD failure, not something the runtime fallback can catch.
 *
 * So the package ships the BODY (`@12-apps/realtime/worker`) and the host owns the file. This
 * one exists to prove the arrangement works for a real consumer, through a real Vite build.
 */
import { startRealtimeWorker } from '@12-apps/realtime/worker';

startRealtimeWorker();
