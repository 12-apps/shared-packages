import { useEffect, useMemo, useRef, useState } from "react";

import { applePaySessionClass, type ApplePaySessionClass } from "./apple-pay-button";

/**
 * Apple Pay in a browser that is not Safari (FUT-5372), through Apple's own
 * JS SDK ("Apple Pay on the Web" in third-party browsers): loaded, it installs
 * an `ApplePaySession` and the `<apple-pay-button>` element in Chrome, Edge and
 * Firefox, and its sheet is a QR code the person scans with an iPhone. The
 * session is the same API Safari ships, so the merchant validation and the
 * charge behind a tap are exactly Safari's (`startApplePaySession`).
 *
 * ## A remote script, loaded only where Apple Pay is offered
 *
 * Nothing here runs at import. The script is appended on demand by
 * {@link loadApplePaySdk}, which only a surface that offers Apple Pay calls —
 * the homologação evidence always, the checkout only when its host turned the
 * path on — and only where the browser has no native session (Safari never
 * loads it). A host with a Content-Security-Policy allows
 * `https://applepay.cdn-apple.com` for `script-src`, `frame-src` and `img-src`
 * on those pages (Apple's "Loading the latest version of the Apple Pay JS SDK").
 *
 * ## Pinned, with Subresource Integrity
 *
 * Apple publishes an auto-updating `1.latest` URL and semantic versions, and
 * says to use `integrity` with a semantic version only. This loads a pinned
 * version WITH its hash, from Apple's change log: a script that runs on a
 * payment page (and on the platform's own screen) never changes under it
 * without a release here. Moving to a newer one is a change of both constants.
 *
 * ## Failure is the hint, never a crash
 *
 * A script that cannot load (offline CDN, a blocked host, a hash mismatch), a
 * load that takes longer than {@link SDK_TIMEOUT_MS}, or a loaded SDK whose
 * `canMakePayments()` says no (Apple's SDK answers no on a phone browser that
 * is not Safari) all resolve to `null`: no button, and the surface says what
 * it said before.
 */

/** Apple Pay JS SDK 1.3.8 — the current `1.latest` when this was pinned (Apple's change log). */
export const APPLE_PAY_SDK_URL = "https://applepay.cdn-apple.com/jsapi/v1.3.8/apple-pay-sdk.js";

/** The SRI hash Apple publishes for {@link APPLE_PAY_SDK_URL}. */
export const APPLE_PAY_SDK_INTEGRITY = "sha384-u/9mOkmShCO0v+dqCAZFhiutJuORfzvuyM5i+676iy7mLSWS6rlllHrIt15f/mqH";

/** A load that has not answered by then is a failed one. */
const SDK_TIMEOUT_MS = 15_000;

/** Load Apple's SDK and answer its session class, or `null` when it cannot pay here. */
export type ApplePaySdkLoader = () => Promise<ApplePaySessionClass | null>;

/** The in-flight (or settled) load — one script tag per page; a failed load may be retried by a later mount. */
const loader: {
  pending: Promise<ApplePaySessionClass | null> | null;
  loaded: ApplePaySessionClass | null;
  /**
   * The tag of a load that timed out. Taking it away would not stop its fetch, and a
   * second tag would then run Apple's file twice (`customElements.define` throws
   * "already defined"), so a retry waits on this one instead of appending another.
   */
  straggler: HTMLScriptElement | null;
} = {
  pending: null,
  loaded: null,
  straggler: null,
};

/** The class when it can pay on this device, else `null` — `canMakePayments` never throws past here. */
function payable(Session: ApplePaySessionClass | null): ApplePaySessionClass | null {
  if (!Session) return null;
  try {
    return Session.canMakePayments() ? Session : null;
  } catch {
    return null;
  }
}

/**
 * Whether `Session` is Apple's SDK class rather than Safari's own. The SDK
 * marks its class (`static isNotWebkit = true`, Apple Pay JS 1.3.x), which
 * also covers an SDK that arrives AFTER its load was given up on: that one
 * was never recorded in {@link loader}, and must still never be taken for
 * Safari's.
 */
function isSdkClass(Session: ApplePaySessionClass): boolean {
  return Session === loader.loaded || (Session as unknown as { isNotWebkit?: unknown }).isNotWebkit === true;
}

/**
 * Wait for Apple's script tag: a new one, or the tag of an earlier load that
 * timed out (see {@link loader}.straggler), so Apple's file is never appended
 * twice. A tag that errors is taken away so the next mount can try again; one
 * that times out stays, and is the one the next mount waits on.
 */
function awaitScript(): Promise<ApplePaySessionClass | null> {
  return new Promise((resolve) => {
    // A timed-out tag something else took off the page will never answer: start afresh.
    if (loader.straggler && !loader.straggler.isConnected) loader.straggler = null;
    const fresh = loader.straggler === null;
    const script = loader.straggler ?? document.createElement("script");
    const settle = (Session: ApplePaySessionClass | null): void => {
      clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
      loader.straggler = null;
      if (!Session) script.remove();
      resolve(Session);
    };
    const timer = setTimeout(() => {
      // Kept, not removed: it may still run. Its own late answer only clears the slot.
      loader.straggler = script;
      script.onload = () => {
        loader.straggler = null;
      };
      script.onerror = () => {
        loader.straggler = null;
        script.remove();
      };
      resolve(null);
    }, SDK_TIMEOUT_MS);
    script.onload = () => settle(applePaySessionClass());
    script.onerror = () => settle(null);
    if (!fresh) return;
    script.src = APPLE_PAY_SDK_URL;
    script.integrity = APPLE_PAY_SDK_INTEGRITY;
    script.crossOrigin = "anonymous";
    script.async = true;
    document.head.appendChild(script);
  });
}

/**
 * Load Apple's SDK once per page — concurrent callers share one load and one
 * tag — and answer its `ApplePaySession` when this device can pay with it.
 * Never throws. A class already on the window (Safari's own, a harness's, or
 * an SDK that arrived late) is answered without a request; a failed load is
 * tried again by the next caller.
 */
const loadApplePaySdk: ApplePaySdkLoader = () => {
  const installed = applePaySessionClass();
  if (installed) return Promise.resolve(payable(installed));
  if (typeof document === "undefined") return Promise.resolve(null);
  // A class loaded earlier that is no longer on the window (a page that took it away) is loaded again.
  if (loader.loaded) {
    loader.pending = null;
    loader.loaded = null;
  }
  loader.pending ??= awaitScript().then((Session) => {
    loader.loaded = Session;
    // A failed load leaves the page free to try again on the next mount.
    if (!Session) loader.pending = null;
    return payable(Session);
  });
  return loader.pending;
};

/** Where this page's Apple Pay session class came from. */
export type ApplePayVia = "native" | "sdk";

/** {@link useApplePaySession}'s answer. */
export interface ApplePaySessionState {
  /** The class to start a session from, or `null` while loading and when Apple Pay cannot run here. */
  Session: ApplePaySessionClass | null;
  /** `native` — Safari's own; `sdk` — Apple's SDK in another browser (draw `<apple-pay-button>`). */
  via: ApplePayVia | null;
  /** The SDK is still loading: say nothing yet, neither a button nor why there is none. */
  loading: boolean;
}

/** The native class, when Safari (or a harness) has one this device can pay with — and it is not the SDK's. */
function nativeSession(): ApplePaySessionClass | null {
  const Session = applePaySessionClass();
  if (!Session || isSdkClass(Session)) return null;
  return payable(Session);
}

const NONE: ApplePaySessionState = { Session: null, via: null, loading: false };

/**
 * The Apple Pay session this page can start: Safari's own first, unchanged;
 * else, when `sdk` is on, Apple's SDK loaded on demand. `sdk` off (the
 * checkout's default) is exactly the page before FUT-5372 — no script, and
 * Apple Pay only where the browser has a native session.
 *
 * `load` is read through a ref: a caller passing a new function each render
 * (an inline arrow) neither re-runs the load nor re-renders the page.
 */
export function useApplePaySession(sdk: boolean, load: ApplePaySdkLoader = loadApplePaySdk): ApplePaySessionState {
  const native = nativeSession();
  const wantsSdk = sdk && native === null;
  const loadRef = useRef(load);
  loadRef.current = load;
  const [loaded, setLoaded] = useState<{ Session: ApplePaySessionClass | null; done: boolean }>({ Session: null, done: false });
  useEffect(() => {
    if (!wantsSdk) return undefined;
    const alive = { current: true };
    void loadRef.current()
      .catch(() => null)
      .then((Session) => {
        if (alive.current) setLoaded({ Session, done: true });
      });
    return () => {
      alive.current = false;
    };
  }, [wantsSdk]);
  const Session = native ?? (wantsSdk ? loaded.Session : null);
  const via: ApplePayVia | null = native ? "native" : Session ? "sdk" : null;
  const loading = wantsSdk && !loaded.done;
  // One object per answer: a capability memoized on it is not rebuilt every render.
  return useMemo(() => (Session || loading ? { Session, via, loading } : NONE), [Session, via, loading]);
}
