import { expect, type Locator, type Page } from '@playwright/test';

import { paymentsWorld } from '../world.js';

/**
 * Whether a wire probe's text records only reads (FUT-4028): one or more
 * requests, every one of them a `GET <path>`.
 *
 * Parsed rather than matched with one pattern: the probe's text is split on
 * the separators a host may use (`,` or a new line) and each entry is checked
 * on its own, so nothing here can backtrack, whatever the probe printed.
 */
export function onlyReads(text: string): boolean {
  const entries = wireEntries(text);
  return entries.length > 0 && entries.every((entry) => isRead(entry));
}

/**
 * Whether a wire probe's text records no write: no entry is a request with a
 * verb other than `GET`. What is not a request at all — a host's "(none)"
 * placeholder — writes nothing either. On its own this proves nothing about an
 * EMPTY probe; {@link expectNoWritesOn} adds the liveness that does.
 */
export function noWrites(text: string): boolean {
  return wireEntries(text).every((entry) => !isWrite(entry));
}

/** The probe's entries, split on the separators a host may use (`,` or a new line). */
function wireEntries(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

/** An entry as `[verb, path]`, or `null` when it is not one request line. */
function request(entry: string): [string, string] | null {
  const [verb, path, ...rest] = entry.split(' ').filter((part) => part !== '');
  if (verb === undefined || path === undefined || rest.length > 0 || /\s/.test(path)) return null;
  return [verb, path];
}

/** `GET` and a path with no whitespace in it — `GET /api/checkout/config`. */
function isRead(entry: string): boolean {
  return request(entry)?.[0] === 'GET';
}

/** The HTTP verbs that write. */
const WRITE_VERBS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * An entry whose first token is a writing verb — `POST /api/checkout` — or any
 * other well-formed request line that is not a `GET`. A writing verb counts
 * whatever follows it, malformed or not: a broken line is never a pass. What
 * is no request at all (a host's "(none)") is not a write.
 */
function isWrite(entry: string): boolean {
  const [verb = ''] = entry.split(' ').filter((part) => part !== '');
  if (WRITE_VERBS.has(verb.toUpperCase())) return true;
  const line = request(entry);
  return line !== null && line[0] !== 'GET';
}

/** How long the probe has to stay write-free, and how often it is read meanwhile. */
export const NO_WRITE_WINDOW_MS = 1_500;
const NO_WRITE_SAMPLE_MS = 250;

/** What {@link expectNoWritesOn} reads: the probe, and the host's heartbeat if it has one. */
export interface NoWriteProbe {
  /** Every request the checkout made, as the host records them. */
  paths: Locator;
  /** See `PaymentsWireProbe.heartbeat`. */
  heartbeat?: (page: Page) => Promise<string>;
}

/**
 * Nothing that writes reached the wire — no order, no charge — and the probe
 * was LIVE while that was true (FUT-4028). Call it once the screen that says
 * so is up.
 *
 *  1. Liveness. With a heartbeat, the host sends one known read through the
 *     recorder its checkout uses, and its line has to show up: a probe that
 *     records nothing cannot hide a write behind an empty text. Without one,
 *     the probe must already hold at least one read, and only reads; an empty
 *     probe is never taken as proof.
 *  2. Settle. The probe is then read every {@link NO_WRITE_SAMPLE_MS} for
 *     {@link NO_WRITE_WINDOW_MS}, and a write in any sample fails, so a POST
 *     that lands a moment after the screen does is still seen.
 *
 * It does NOT require the config read: a host may know the store cannot
 * charge without asking.
 */
export async function expectNoWritesOn(page: Page, probe: NoWriteProbe): Promise<void> {
  if (probe.heartbeat) {
    const line = await probe.heartbeat(page);
    await expect(probe.paths, 'the wire probe did not record the heartbeat: it is not live').toContainText(line);
  } else {
    const text = (await probe.paths.textContent()) ?? '';
    expect(
      onlyReads(text),
      `the wire probe holds no read to prove it is live (got "${text}"); implement wire.heartbeat`,
    ).toBe(true);
  }
  for (let read = 0; read * NO_WRITE_SAMPLE_MS <= NO_WRITE_WINDOW_MS; read += 1) {
    const text = (await probe.paths.textContent()) ?? '';
    expect(noWrites(text), `a write reached the wire: ${text}`).toBe(true);
    await page.waitForTimeout(NO_WRITE_SAMPLE_MS);
  }
}

/** {@link expectNoWritesOn}, against the host's registered wire probe. */
export async function expectNoWrites(page: Page): Promise<void> {
  const { wire } = paymentsWorld();
  await expectNoWritesOn(page, { paths: wire.paths(page), heartbeat: wire.heartbeat });
}

/**
 * The wire carried the config read and nothing that writes (FUT-4028). For a
 * scenario whose premise IS that the config was read and answered. A read
 * beside it is no payable: the list also reads the buyer's saved cards
 * (`GET /api/checkout/cards`), where the tabs read the config alone. Every
 * recorded line is a GET, however a host separates them (`,` or a new line).
 */
export async function expectOnlyReads(page: Page): Promise<void> {
  const paths = paymentsWorld().wire.paths(page);
  await expect(paths).toContainText('GET /api/checkout/config');
  await expect.poll(async () => onlyReads((await paths.textContent()) ?? '')).toBe(true);
}
