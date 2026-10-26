import { expect, type Page } from '@playwright/test';

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
  const entries = text
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  return entries.length > 0 && entries.every((entry) => isRead(entry));
}

/** `GET` and a path with no whitespace in it — `GET /api/checkout/config`. */
function isRead(entry: string): boolean {
  const [verb, path, ...rest] = entry.split(' ').filter((part) => part !== '');
  return verb === 'GET' && path !== undefined && rest.length === 0 && !/\s/.test(path);
}

/**
 * The wire carried the config read and nothing that writes (FUT-4028). A read
 * beside it is no payable: the list also reads the buyer's saved cards
 * (`GET /api/checkout/cards`), where the tabs read the config alone. Every
 * recorded line is a GET, however a host separates them (`,` or a new line).
 */
export async function expectOnlyReads(page: Page): Promise<void> {
  const paths = paymentsWorld().wire.paths(page);
  await expect(paths).toContainText('GET /api/checkout/config');
  await expect.poll(async () => onlyReads((await paths.textContent()) ?? '')).toBe(true);
}
