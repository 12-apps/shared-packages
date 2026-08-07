/**
 * Source-map upload for the three SPA builds (FUT-723).
 *
 * ## The bug this closes, which is not the one it was added for
 *
 * All three apps already build with `sourcemap: true`, their Dockerfiles copy
 * `dist` wholesale, and `caddy/spa.Caddyfile` serves `assets/*` with a plain
 * `file_server`. The three together mean `GET /admin/assets/<chunk>.js.map`
 * has been returning the original TypeScript from production.
 *
 * There is an accidental upside — Sentry can fetch a public map and symbolicate
 * with no upload at all — and it is a trap, not a solution. Taking it would
 * mean keeping the source public forever and tying symbolication to Sentry
 * being able to reach the URL, which stops being true the first time anything
 * moves behind auth.
 *
 * So: upload the maps at build time, then delete them from `dist` before the
 * Caddy stage copies it. `filesToDeleteAfterUpload` does both in one step, so
 * the two halves cannot drift apart — and the belt-and-braces half is in the
 * Caddyfiles, which now refuse `*.map` outright.
 *
 * ## Why it is disabled without a token
 *
 * Local builds and PR builds have no `SENTRY_AUTH_TOKEN` — it is a real
 * credential, unlike the write-only ingest DSN — and they must still produce a
 * working bundle. `disable` makes that explicit rather than leaving the plugin
 * to fail somewhere inside the upload.
 *
 * Note what that implies: on a build with no token the maps are NOT deleted,
 * because nothing uploaded them. That is the right trade for a developer
 * debugging locally, and it is why the Caddyfile rule exists as a second line —
 * production must never serve them even if a token goes missing.
 */
import { sentryVitePlugin } from "@sentry/vite-plugin";
import type { PluginOption } from "vite";

export interface SentrySourcemapOptions {
  /**
   * The Sentry project slug for this SPA — one of `paladira-store-frontend`,
   * `paladira-admin-frontend` or `paladira-super-admin-frontend`. Passed
   * explicitly rather than read from env so a mis-set variable cannot quietly
   * upload one app's maps to another's project, where they would silently fail
   * to match any event.
   */
  project: string;
}

/**
 * The upload plugin, or `false` when reporting is not configured for this build.
 *
 * Returning `false` rather than `undefined` because Vite accepts a falsy entry
 * in a `plugins` array and skips it, so the caller can spread this
 * unconditionally.
 */
const SKIP_PREFIX = "[sentry] source map upload skipped (transient):";
const MISCONFIG_PREFIX =
  "[sentry] SOURCE MAP UPLOAD IS MISCONFIGURED — every build will fail this way until it is fixed:";

/**
 * Whether the upload failed for a reason no retry will fix.
 *
 * `401`/`403` is the token: missing, expired, or without `project:releases`.
 * `404` is the ORG or PROJECT SLUG — and the slug is the trap, because a
 * project's informal name is usually not its slug, and a slug that merely LOOKS
 * right can belong to a sibling app. Confirm against the org before trusting
 * one:
 *
 *   curl -s -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
 *     https://sentry.io/api/0/organizations/<org>/projects/
 */
function looksMisconfigured(error: Error): boolean {
  return /\b(401|403|404)\b|insufficient_scope|permission|not found/i.test(error.message);
}

/**
 * Once ANY step of a build has failed for a configuration reason, every later
 * step in that build is failing for the same reason.
 *
 * The plugin calls `errorHandler` more than once — `releases new` first, then
 * `sourcemaps upload` — and only the FIRST carries a status code. The second
 * says nothing but `failed with exit code 1`, which on its own reads exactly
 * like a network blip. Without this latch a bad slug prints one loud line and
 * one reassuring one, and the reassuring one is the last thing on screen.
 */
let sawMisconfiguration = false;

function misconfigured(error: Error): boolean {
  if (looksMisconfigured(error)) sawMisconfiguration = true;
  return sawMisconfiguration;
}

export function sentrySourcemaps({ project }: SentrySourcemapOptions): PluginOption | false {
  const authToken = process.env.SENTRY_AUTH_TOKEN;
  const org = process.env.SENTRY_ORG;
  if (!authToken || !org) return false;

  return sentryVitePlugin({
    org,
    project,
    authToken,
    release: {
      // MUST equal the release the browser SDK reports at runtime, which comes
      // from `/api/observability-config` and ultimately from IMAGE_TAG (the
      // deploy SHA). When the two disagree Sentry holds the map and the event
      // and associates neither — the failure looks exactly like "upload did
      // not work", which is the wrong thing to go and debug.
      name: process.env.SENTRY_RELEASE,
    },
    sourcemaps: {
      // Upload, then remove from `dist` in the same step, so the bundle that
      // reaches the Caddy stage of the Dockerfile has no maps to serve.
      filesToDeleteAfterUpload: ["**/*.js.map", "**/*.css.map"],
    },
    // The plugin is otherwise happy to fail the whole build on a network
    // hiccup at the upload step. A deploy that cannot reach Sentry should ship
    // without symbolication, not stop shipping.
    errorHandler: (error: Error) => {
      // Build-time, not runtime (FUT-724): this runs inside `vite build`, where
      // the console IS the output and no reporter exists yet — the bundle that
      // would carry one has not been produced.
      //
      // A MISCONFIGURATION is shouted about; a hiccup is not. Both used to
      // print the same quiet line, and that cost real time: two of the three
      // project slugs here were wrong (the informal names, not the real ones),
      // every upload 404'd, the build went green, and the result was
      // indistinguishable from "source maps were never set up". Anything that
      // will fail identically on every future build until a human changes a
      // setting deserves to look different from a network blip.
      // eslint-disable-next-line no-console
      console.warn(`${misconfigured(error) ? MISCONFIG_PREFIX : SKIP_PREFIX} ${error.message}`);
    },
  });
}
