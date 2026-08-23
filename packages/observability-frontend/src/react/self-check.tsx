/**
 * The Sentry self-check page — "is reporting actually wired, right now?"
 *
 * ## Why a page and not a test
 *
 * Every part of this pipeline is unit-tested, and all of it can still be dead
 * in production, because the parts that break are the ones no test can see: a
 * DSN that never reached Doppler, a source-map upload that 404'd on a renamed
 * project, a `SENTRY_RELEASE` that disagrees with the release the maps went up
 * under. Each fails the same way — SILENCE — and silence is indistinguishable
 * from "nothing has crashed lately".
 *
 * FUT-723 is the proof that this is not hypothetical: for two deploys the admin
 * SPA uploaded its source maps to the super-admin's project. Builds were green,
 * uploads succeeded, the config endpoint answered 200, and symbolication was
 * broken the entire time. No test in this repo could have said so, because
 * every component was individually correct — only the PAIRING was wrong.
 *
 * So: a page that makes an event on demand and tells you where to look. Open it
 * after a deploy, press a button, find the issue in Sentry. If the stack names a
 * `.tsx` file and line, the whole chain works — SDK init, DSN, ingest, release
 * match, debug id, uploaded map, symbolication. If it does not, the status panel
 * usually says why before you click anything.
 *
 * ## Why it is reachable without signing in
 *
 * The moment you most want telemetry is when the app is broken, and "the app is
 * broken" frequently means auth is broken. A check that needs a working session
 * cannot answer the question it exists for.
 *
 * That does mean anyone can reach it and file an event. It adds no attack
 * surface: the ingest DSN is public BY DESIGN — it ships inside a JavaScript
 * bundle every visitor downloads — so anyone wanting to burn the quota can
 * already POST to Sentry directly without this page. What the page adds is a
 * button, and {@link THROTTLE_MS} keeps a leaning finger from becoming a flood.
 * Every event carries {@link SYNTHETIC_TAG}, so they filter and delete as a set.
 */
import { Alert } from "@12-apps/ui/data-display/Alert";
import { Button } from "@12-apps/ui/form/Button";
import { Heading } from "@12-apps/ui/typography/Heading";
import { Text } from "@12-apps/ui/typography/Text";
import * as Sentry from "@sentry/react";
import { useCallback, useEffect, useRef, useState, type JSX } from "react";

import { reportWarning } from "../index";

/** Minimum gap between two synthetic events from one tab. */
const THROTTLE_MS = 3_000;

/** Marks every event this page produces, so they can be found and deleted as a set. */
const SYNTHETIC_TAG = "self-check";

/**
 * What the LIVE SDK thinks it is doing.
 *
 * Read from the running client rather than re-fetched from
 * `/api/observability-config`, and that difference is the entire point: the
 * endpoint answering correctly proves the SERVER is configured, not that this
 * bundle ever managed to initialise. A page that re-fetched the config would
 * cheerfully show a healthy DSN while reporting nothing at all.
 */
interface SdkStatus {
  initialised: boolean;
  dsn: string | null;
  environment: string | null;
  release: string | null;
}

/** Keep the host and project id, drop the public key. */
function maskDsn(dsn: string): string {
  return dsn.replace(/\/\/[^@]+@/, "//***@");
}

function readSdkStatus(): SdkStatus {
  const client = Sentry.getClient();
  if (!client) return { initialised: false, dsn: null, environment: null, release: null };

  const options = client.getOptions();
  return {
    initialised: true,
    dsn: options.dsn ? maskDsn(String(options.dsn)) : null,
    environment: options.environment ?? null,
    release: options.release ?? null,
  };
}

/** A distinctive, self-describing message — whoever finds it in Sentry should not have to ask. */
function syntheticMessage(kind: string): string {
  return `[self-check] ${kind} — synthetic event, safe to delete (${new Date().toISOString()})`;
}

/**
 * Throws during RENDER, so the surrounding error boundary catches it and reports
 * through `reportRouteCrash` — the path a real page crash takes.
 */
function ExplodingChild(): JSX.Element {
  throw new Error(syntheticMessage("render crash"));
}

/** One line of the status panel. */
function StatusRow({ label, value, ok }: { label: string; value: string; ok: boolean }): JSX.Element {
  return (
    <div style={{ display: "flex", gap: 8, padding: "2px 0", alignItems: "baseline" }}>
      <Text size="sm" color="neutral" style={{ width: 110, flexShrink: 0 }}>
        {label}
      </Text>
      <Text size="sm" weight="bold" color={ok ? "success" : "danger"}>
        {ok ? "✓" : "✗"}
      </Text>
      <Text size="sm" style={{ wordBreak: "break-all", fontFamily: "monospace" }}>
        {value}
      </Text>
    </div>
  );
}

/**
 * The live-state panel, plus the one message that matters when it is all zeroes.
 *
 * Split out for the complexity gate, but it earns the split: this is the half a
 * human reads, and the buttons below are the half they press.
 */
function StatusPanel({ status }: { status: SdkStatus }): JSX.Element {
  const dsnOk = Boolean(status.dsn);
  return (
    <>
      <section
        style={{ border: "1px solid rgba(128,128,128,.35)", borderRadius: 8, padding: 16, margin: "16px 0" }}
        data-testid="self-check-status"
      >
        <StatusRow
          label="SDK"
          value={status.initialised ? "initialised" : "NOT initialised"}
          ok={status.initialised}
        />
        <StatusRow label="DSN" value={status.dsn ?? "empty — reporting is off"} ok={dsnOk} />
        <StatusRow
          label="environment"
          value={status.environment ?? "(not set)"}
          ok={Boolean(status.environment)}
        />
        <StatusRow label="release" value={status.release ?? "(not set)"} ok={Boolean(status.release)} />
      </section>

      {!dsnOk && (
        <Alert variant="warning" title="Reporting is off in this build" data-testid="self-check-off">
          With no DSN the SDK opens no connection and no button below sends anything. That is
          normal in dev, CI and PR builds; in production it means the variable never reached the
          process.
        </Alert>
      )}
    </>
  );
}

/** The three trigger buttons, one per reporting path. */
function TriggerRow({
  onRenderCrash,
  onHandlerError,
  onWarning,
}: {
  onRenderCrash: () => void;
  onHandlerError: () => void;
  onWarning: () => void;
}): JSX.Element {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
      <Button variant="solid" color="danger" onClick={onRenderCrash} data-testid="self-check-render">
        Quebrar no render (error boundary)
      </Button>
      <Button variant="outline" color="danger" onClick={onHandlerError} data-testid="self-check-handler">
        Handler error (window.onerror)
      </Button>
      <Button variant="outline" color="warning" onClick={onWarning} data-testid="self-check-warning">
        Send a warning
      </Button>
    </div>
  );
}

/**
 * How long to keep looking for a client before accepting that there is none.
 *
 * Must outlast the config fetch in `loadObservabilityConfig`, which gives up
 * after 5s — polling for less would report "not initialised" for a build that
 * was merely slow, which is the same lie by a different route.
 */
const INIT_WAIT_MS = 8_000;
const INIT_POLL_MS = 250;

/**
 * The SDK's live state, RE-READ until it initialises.
 *
 * A single read at mount is wrong, and wrong in the direction that matters. The
 * whole architecture of this feature defers init behind a network round-trip —
 * `startObservability` fetches the DSN from `/api/observability-config` before
 * it can call `Sentry.init`, deliberately, so that reporting never gates first
 * paint. This page renders long before that returns, so a lazy `useState`
 * initialiser snapshots `getClient() === undefined` and shows a confident
 * "NOT initialised" forever, on a perfectly healthy build.
 *
 * That is precisely the failure this page exists to expose, produced by the
 * page itself. So poll until the client shows up, and stop as soon as it does.
 */
function useSdkStatus(): SdkStatus {
  const [status, setStatus] = useState<SdkStatus>(readSdkStatus);

  useEffect(() => {
    if (status.initialised) return undefined;

    const startedAt = Date.now();
    const timer = setInterval(() => {
      const next = readSdkStatus();
      if (next.initialised) {
        setStatus(next);
        clearInterval(timer);
        return;
      }
      // Genuinely off (dev, CI, a PR build, or a missing variable in prod).
      // Give up rather than spin, so the OFF banner is a real answer.
      if (Date.now() - startedAt > INIT_WAIT_MS) clearInterval(timer);
    }, INIT_POLL_MS);

    return () => clearInterval(timer);
  }, [status.initialised]);

  return status;
}

/**
 * The page.
 *
 * Mount it behind its OWN error boundary. Two of the three apps keep theirs
 * inside a layout that sits behind the auth gate, so a route mounted outside
 * that gate has no boundary above it — the render-crash button would blank the
 * tab instead of exercising `reportRouteCrash`, which is the one path most
 * worth checking.
 */
export function ObservabilitySelfCheck(): JSX.Element {
  const status = useSdkStatus();
  const [explode, setExplode] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const lastFiredAt = useRef(0);

  const throttled = useCallback((): boolean => {
    const now = Date.now();
    if (now - lastFiredAt.current < THROTTLE_MS) {
      setNote(`Wait ${Math.ceil(THROTTLE_MS / 1000)}s between triggers.`);
      return true;
    }
    lastFiredAt.current = now;
    return false;
  }, []);

  // An uncaught throw inside a handler never reaches a React error boundary —
  // boundaries only see render. It lands on `window.onerror`, the OTHER half of
  // the browser reporting surface, and is worth checking on its own.
  const throwInHandler = useCallback((): void => {
    if (throttled()) return;
    setNote("Erro lancado no handler — deve chegar via window.onerror.");
    setTimeout(() => {
      throw new Error(syntheticMessage("handler error"));
    }, 0);
  }, [throttled]);

  const sendWarning = useCallback((): void => {
    if (throttled()) return;
    reportWarning(syntheticMessage("warning"), { synthetic: SYNTHETIC_TAG });
    setNote("Warning enviado via reportWarning.");
  }, [throttled]);

  const crashRender = useCallback((): void => {
    if (!throttled()) setExplode(true);
  }, [throttled]);

  if (explode) return <ExplodingChild />;

  return (
    <main style={{ padding: 24, maxWidth: 760, margin: "0 auto" }} data-testid="observability-self-check">
      <Heading level="h1">
        Observability diagnostics
      </Heading>
      <Text size="sm" color="neutral">
        Fires a synthetic event to confirm Sentry is wired into this build.
      </Text>

      <StatusPanel status={status} />

      <TriggerRow onRenderCrash={crashRender} onHandlerError={throwInHandler} onWarning={sendWarning} />

      {note && (
        <Text size="sm" style={{ display: "block", marginTop: 12 }} data-testid="self-check-note">
          {note}
        </Text>
      )}

      <Text size="xs" color="neutral" style={{ display: "block", marginTop: 24 }}>
        The event takes a few seconds to show up. The stack must name a .tsx/.ts file and a line
        — if it comes back minified, the source maps are not paired with this release. Every event
        from here carries the &quot;{SYNTHETIC_TAG}&quot; tag and can be deleted in bulk.
      </Text>
    </main>
  );
}
