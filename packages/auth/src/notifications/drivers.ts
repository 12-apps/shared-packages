import { appendFileSync } from "node:fs";

import type { EmailDriver } from "@12-apps/notifications/server";

/** What a driver is handed. Structural, so this never depends on a vendor. */
interface EmailMessage {
  subject: string;
  text: string;
  html?: string;
}

/**
 * The two drivers every host of this flow ends up writing, and why they are not
 * a host's business.
 *
 * A vendor driver IS the host's: which service, which key, which from-address
 * are its choices and its environment variables. These two are not.
 *
 * - **The sink** is how a sign-up is completed without a mailbox, and how an
 *   end-to-end test reads back the link that was actually sent. Every host that
 *   tests this flow needs it, and a host that writes its own will sooner or
 *   later log the address without meaning to.
 * - **The refusal** is a security property, not a preference. A deployment with
 *   no provider configured must fail loudly rather than fall back to logging —
 *   a password-reset link in a log aggregator is a credential in a log
 *   aggregator, and the person waiting for the mail has no other way in and no
 *   way to tell that nothing was sent.
 *
 * Neither reads an environment variable. The host passes the sink's path and
 * the callbacks that reach its own logger, so nothing here knows what any
 * particular deployment calls its settings.
 */

export interface SinkDriverConfig {
  /**
   * File to append each message to, LINK INCLUDED.
   *
   * Absent means inert: the driver still reports the send to {@link onSend} and
   * writes nothing. That is what makes it safe to leave wired in a host whose
   * harness only sometimes wants it.
   */
  filePath?: string;
  /**
   * Told about every message, so it reaches the host's own logger.
   *
   * The package does not choose a logging vendor: a `console.log` here would be
   * invisible to a host whose observability hangs off its own factory.
   */
  onSend?: (to: string, message: EmailMessage) => void;
  /** Injectable clock, so a test can assert the stamped time. */
  now?: () => number;
}

/**
 * Log the message and append it to a file a test can read.
 *
 * Deliberately NOT the generic "log" driver a notification transport ships.
 * That one logs the subject alone and no address or body, which is the right
 * call for a notification — a recipient address is PII and must never reach a
 * log aggregator. Here the whole point is to read the LINK back out, so this is
 * a separate driver a host reaches for explicitly, never a fallback.
 */
export function createSinkDriver(config: SinkDriverConfig = {}): EmailDriver {
  const { filePath, onSend, now = Date.now } = config;
  return {
    send: (to, message) => {
      onSend?.(to, message);
      if (filePath) {
        try {
          appendFileSync(filePath, `${JSON.stringify({ to, ...message, at: now() })}\n`, "utf8");
        } catch {
          // The harness reads what did get written; a lost line fails its own
          // step, which is a better signal than an exception from a mailer.
        }
      }
      return Promise.resolve();
    },
  };
}

export interface UnconfiguredDriverConfig {
  /**
   * Told that a message was NOT sent, with enough to identify which.
   *
   * Required, unlike the sink's callback: a refusal nobody is told about is the
   * silent failure this driver exists to prevent.
   */
  onRefused: (info: { to: string; subject: string }) => void;
}

/**
 * Refuse to send, loudly.
 *
 * Returns rather than throws, so one unsendable message does not take down the
 * request that produced it — the flow's own anti-enumeration answers do not
 * change based on whether the mail left, and a throw here would make them.
 */
export function createUnconfiguredDriver(config: UnconfiguredDriverConfig): EmailDriver {
  return {
    send: (to, message) => {
      config.onRefused({ to, subject: message.subject });
      return Promise.resolve();
    },
  };
}
